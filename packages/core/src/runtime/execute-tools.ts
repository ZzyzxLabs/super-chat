// Tool execution.
//
// Two rules that matter more than they look:
//
//  1. A tool that throws returns `{ error }` to the model, not an exception to
//     the caller. A model that reads "no pool found for SUI/FOO" picks a
//     different pool; a stack trace that kills the run teaches it nothing and
//     costs the user their turn.
//
//  2. Errors are COMPACTED. A raw error can be a 40KB stack that then rides in
//     history for the rest of the conversation, crowding out the actual work.

import { AgentError, toAgentError } from "../errors.js";
import { makeCard } from "../cards/registry.js";
import { CARD_KEY, isCardCarrier, withCard, type Card, type CardSpec } from "../cards/types.js";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "../tools/types.js";

export type ToolCallRequest = { callId: string; name: string; input: unknown };

export type ToolCallOutcome = {
  callId: string;
  name: string;
  output: unknown;
  card?: Card;
  failure?: string;
  ms: number;
};

const MAX_ERROR_CHARS = 400;

/** Shrink an error to something worth carrying in history. */
export function compactError(e: unknown): { error: string; kind?: string } {
  if (e instanceof AgentError) {
    return { error: e.message.slice(0, MAX_ERROR_CHARS), kind: e.kind };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { error: message.slice(0, MAX_ERROR_CHARS) || "Tool failed with no message." };
}

const isToolResult = (v: unknown): v is ToolResult =>
  typeof v === "object" && v !== null && "output" in v && Object.keys(v).every((k) => ["output", "card", "failure"].includes(k));

export type ExecuteToolOptions = {
  tools: readonly ToolDefinition[];
  vars: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onCard?: (card: Card) => void;
  /** Suspend and ask the user. Supplied by the runtime; resolves on a CardAction. */
  requestCard?: (callId: string, spec: CardSpec) => Promise<unknown>;
  /** Host-executed tools (no `execute`) are delegated here. */
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
};

export async function executeToolCall(call: ToolCallRequest, opts: ExecuteToolOptions): Promise<ToolCallOutcome> {
  const started = Date.now();
  const tool = opts.tools.find((t) => t.name === call.name);

  if (!tool) {
    // Name the tools that DO exist — a model that hallucinated a name recovers
    // from a list, and loops forever without one.
    return {
      callId: call.callId,
      name: call.name,
      output: {
        error: `Unknown tool "${call.name}".`,
        availableTools: opts.tools.map((t) => t.name),
      },
      failure: "not-found",
      ms: Date.now() - started,
    };
  }

  let emittedCard: Card | undefined;
  const ctx: ToolExecutionContext = {
    vars: opts.vars,
    signal: opts.signal,
    callId: call.callId,
    emitCard: (spec) => {
      const card = makeCard(spec, call.callId);
      emittedCard = card;
      opts.onCard?.(card);
    },
    ...(opts.requestCard ? { requestCard: (spec: CardSpec) => opts.requestCard!(call.callId, spec) } : {}),
  };

  try {
    const raw = tool.execute
      ? await withTimeout(Promise.resolve(tool.execute(call.input, ctx)), opts.timeoutMs, call.name)
      : opts.onHostTool
        ? await withTimeout(opts.onHostTool(call), opts.timeoutMs, call.name)
        : (() => {
            throw new AgentError("not-supported", `Tool "${call.name}" has no executor and no host handler.`);
          })();

    const result: ToolResult = isToolResult(raw) ? raw : { output: raw };

    // A tool may attach a card three ways, and all three must work — a tool
    // author should not have to know which one the runtime happens to check:
    //   1. `ctx.emitCard(spec)`      mid-execution (progress on a long tool)
    //   2. `{ output, card: spec }`  the explicit result field
    //   3. `withCard(output, spec)`  embedded in the output under $card
    // Whichever is used, the card ends up BOTH surfaced to the UI and carried
    // inside the output — the latter so it survives persistence, since the
    // ContextBuilder strips it again before the next provider call.
    let card = emittedCard;
    let output = result.output;

    if (result.card) {
      card = makeCard(result.card, call.callId);
      output = withCard(asRecord(result.output), card.spec, card.id);
      opts.onCard?.(card);
    } else if (isCardCarrier(result.output)) {
      const embedded = result.output[CARD_KEY];
      card = { ...embedded, callId: call.callId };
      opts.onCard?.(card);
    }

    return {
      callId: call.callId,
      name: call.name,
      output,
      ...(card ? { card } : {}),
      ...(result.failure ? { failure: result.failure } : {}),
      ms: Date.now() - started,
    };
  } catch (e) {
    const err = toAgentError(e);
    return {
      callId: call.callId,
      name: call.name,
      output: compactError(err),
      failure: err.kind === "cancelled" ? "denied" : "execution-error",
      ms: Date.now() - started,
    };
  }
}

/**
 * Execute a step's calls concurrently.
 *
 * Parallel because models emit independent calls in one step and running them
 * serially triples the latency of a three-lookup turn. Order of RESULTS is
 * preserved to match the calls, since providers correlate by call_id but humans
 * read the transcript top to bottom.
 */
export async function executeToolCalls(
  calls: readonly ToolCallRequest[],
  opts: ExecuteToolOptions,
): Promise<ToolCallOutcome[]> {
  // Interactive tools must NOT run in parallel — two confirm dialogs racing for
  // the same user is not a thing a user can answer.
  const interactive = calls.filter((c) => opts.tools.find((t) => t.name === c.name)?.side === "confirm");
  const concurrent = calls.filter((c) => !interactive.includes(c));

  const concurrentResults = await Promise.all(concurrent.map((c) => executeToolCall(c, opts)));
  const serialResults: ToolCallOutcome[] = [];
  for (const c of interactive) serialResults.push(await executeToolCall(c, opts));

  const byId = new Map([...concurrentResults, ...serialResults].map((r) => [r.callId, r]));
  return calls.map((c) => byId.get(c.callId)!).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return { result: value };
}

function withTimeout<T>(promise: Promise<T>, ms: number | undefined, name: string): Promise<T> {
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AgentError("timeout", `Tool "${name}" timed out after ${ms}ms.`)), ms),
    ),
  ]);
}

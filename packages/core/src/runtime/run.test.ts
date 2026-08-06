// End-to-end runtime tests against a mocked transport.
//
// The transport seam is what makes this possible: we hand the real OpenAI
// adapter canned Responses payloads, so every layer above the network — request
// building, output mapping, the tool loop, card emission, human-in-the-loop
// suspension, background polling — is exercised for real, with no key and no
// network.

import { describe, expect, it, vi } from "vitest";
import { BUILTIN_CARDS } from "../cards/builtin.js";
import { CardRegistry } from "../cards/registry.js";
import { ContextBuilder } from "../context/builder.js";
import { createOpenAIProvider } from "../providers/openai/adapter.js";
import { SkillRegistry } from "../skills/registry.js";
import { ToolRegistry } from "../tools/registry.js";
import { createVisualizeTool } from "../tools/builtin.js";
import { userMessage } from "../content/parts.js";
import { isCardCarrier, withCard } from "../cards/types.js";
import { runAgent } from "./run.js";
import { initialRunState, reduceRunEvent, type RunEvent } from "./events.js";
import type { ContentPart } from "../content/types.js";
import type { Transport, TransportRequest } from "../transport/types.js";
import type { ToolDefinition } from "../tools/types.js";

/** A transport that replays scripted JSON bodies, recording what was sent. */
function mockTransport(responses: unknown[]): Transport & { sent: TransportRequest[] } {
  const sent: TransportRequest[] = [];
  let i = 0;
  return {
    kind: "custom",
    credentialSafe: true,
    sent,
    async fetch(req: TransportRequest): Promise<Response> {
      sent.push(req);
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

const respondText = (text: string, id = "resp_1") => ({
  id,
  object: "response",
  created_at: 0,
  model: "gpt-5.2",
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

const respondToolCall = (name: string, args: unknown, callId = "call_1", id = "resp_1") => ({
  id,
  object: "response",
  created_at: 0,
  model: "gpt-5.2",
  status: "completed",
  output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }],
  usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
});

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the input back.",
  inputSchema: { type: "object", properties: { value: { type: "string" } } },
  execute: (input) => ({ output: { echoed: (input as { value?: string })?.value ?? null } }),
};

function harness(responses: unknown[], tools: ToolDefinition[] = [echoTool]) {
  const transport = mockTransport(responses);
  const provider = createOpenAIProvider({ transport, dialect: "responses" });
  const registry = new ToolRegistry().registerAll(tools, ["observer"]);
  const contextBuilder = new ContextBuilder({ identity: "You are a test agent.", contextWindow: 32_000 });
  return { transport, provider, registry, contextBuilder };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runAgent", () => {
  it("runs a plain turn and emits a well-ordered event stream", async () => {
    const h = harness([respondText("Hello there.")]);
    const events = await collect(
      runAgent([userMessage("hi")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run-start");
    expect(types).toContain("context-built");
    expect(types.at(-1)).toBe("run-finish");

    const finish = events.at(-1) as Extract<RunEvent, { type: "run-finish" }>;
    expect(finish.finishReason).toBe("stop");
    expect(finish.usage.totalTokens).toBe(120);
  });

  it("executes a tool call and loops back to the model", async () => {
    const h = harness([respondToolCall("echo", { value: "ping" }), respondText("It said ping.")]);
    const events = await collect(
      runAgent([userMessage("echo ping")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect(result.name).toBe("echo");
    expect(result.output).toEqual({ echoed: "ping" });

    // The second request must carry both the call and its output, or OpenAI 400s.
    const second = h.transport.sent[1]!.body as { input: { type: string; call_id?: string }[] };
    expect(second.input.some((i) => i.type === "function_call" && i.call_id === "call_1")).toBe(true);
    expect(second.input.some((i) => i.type === "function_call_output" && i.call_id === "call_1")).toBe(true);
  });

  it("returns an unknown-tool error to the model instead of throwing", async () => {
    const h = harness([respondToolCall("doesNotExist", {}), respondText("Understood.")]);
    const events = await collect(
      runAgent([userMessage("go")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect(result.failure).toBe("not-found");
    // Listing the real tools is what lets the model recover on the next step.
    expect((result.output as { availableTools: string[] }).availableTools).toContain("echo");
    expect(events.at(-1)).toMatchObject({ type: "run-finish", finishReason: "stop" });
  });

  it("turns a thrown tool error into data rather than killing the run", async () => {
    const boom: ToolDefinition = {
      name: "boom",
      description: "Always fails.",
      inputSchema: { type: "object" },
      execute: () => {
        throw new Error("upstream exploded");
      },
    };
    const h = harness([respondToolCall("boom", {}), respondText("That failed.")], [boom]);
    const events = await collect(
      runAgent([userMessage("go")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect(result.failure).toBe("execution-error");
    expect((result.output as { error: string }).error).toContain("upstream exploded");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("emits a card when a tool produces one", async () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", { kind: "stats", spec: { items: [{ label: "TVL", value: 42 }] } }),
        respondText("Shown above."),
      ],
      [createVisualizeTool({ cards })],
    );
    const events = await collect(
      runAgent([userMessage("show me")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const card = events.find((e) => e.type === "card") as Extract<RunEvent, { type: "card" }>;
    expect(card).toBeDefined();
    expect((card.card.spec as { kind: string }).kind).toBe("stats");
  });

  it("surfaces a card attached by any of the three supported ways", async () => {
    // A tool author should not have to know which mechanism the runtime checks.
    // `withCard` embedding was silently dropped once — hence this test.
    const viaField: ToolDefinition = {
      name: "viaField",
      description: "explicit card field",
      inputSchema: { type: "object" },
      execute: () => ({ output: { n: 1 }, card: { kind: "stats", items: [{ label: "A", value: 1 }] } }),
    };
    const viaWithCard: ToolDefinition = {
      name: "viaWithCard",
      description: "card embedded in output",
      inputSchema: { type: "object" },
      execute: () => ({ output: withCard({ n: 2 }, { kind: "stats", items: [{ label: "B", value: 2 }] }) }),
    };
    const viaEmit: ToolDefinition = {
      name: "viaEmit",
      description: "card emitted mid-execution",
      inputSchema: { type: "object" },
      execute: (_input, ctx) => {
        ctx.emitCard?.({ kind: "stats", items: [{ label: "C", value: 3 }] });
        return { output: { n: 3 } };
      },
    };

    for (const [tool, label] of [
      [viaField, "A"],
      [viaWithCard, "B"],
      [viaEmit, "C"],
    ] as const) {
      const h = harness([respondToolCall(tool.name, {}), respondText("done")], [tool]);
      const events = await collect(
        runAgent([userMessage("go")], {
          provider: h.provider,
          model: "gpt-5.2",
          contextBuilder: h.contextBuilder,
          tools: h.registry,
          toolResolution: { presets: ["observer"] },
          mode: "sync",
        }),
      );
      const card = events.find((e) => e.type === "card") as Extract<RunEvent, { type: "card" }> | undefined;
      expect(card, `${tool.name} produced no card`).toBeDefined();
      expect((card!.card.spec as { items: { label: string }[] }).items[0]!.label).toBe(label);
    }
  });

  it("keeps the card inside the tool output so a reloaded thread can still render it", async () => {
    const tool: ToolDefinition = {
      name: "charted",
      description: "returns a card",
      inputSchema: { type: "object" },
      execute: () => ({ output: { n: 1 }, card: { kind: "stats", items: [{ label: "A", value: 1 }] } }),
    };
    const h = harness([respondToolCall("charted", {}), respondText("done")], [tool]);
    const events = await collect(
      runAgent([userMessage("go")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect(isCardCarrier(result.output)).toBe(true);

    // …but it must NOT reach the provider on the next step — the model already
    // read the summary, and re-sending the spec is double billing.
    const second = h.transport.sent[1]!.body as { input: { type: string; output?: string }[] };
    const toolOutput = second.input.find((i) => i.type === "function_call_output");
    expect(toolOutput?.output).not.toContain("$card");
    expect(toolOutput?.output).toContain("card shown to the user");
  });

  it("suspends on an interactive card and resumes with the user's answer", async () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", { kind: "choice", spec: { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } }),
        respondText("You picked B."),
      ],
      [createVisualizeTool({ cards })],
    );

    const events = await collect(
      runAgent([userMessage("pick one")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        onUserDecision: async (callId, card) => ({
          cardId: card.id,
          callId,
          kind: "choice",
          type: "select",
          value: { selected: ["b"] },
          at: 0,
        }),
      }),
    );

    expect(events.some((e) => e.type === "awaiting-user")).toBe(true);
    expect(events.some((e) => e.type === "user-responded")).toBe(true);

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect((result.output as { response: { selected: string[] } }).response).toEqual({ selected: ["b"] });

    // The card the user answered must not be minted a second time — the thread
    // would render the same question twice, once live and once on commit.
    const cardIds = new Set([
      ...events.filter((e) => e.type === "awaiting-user").map((e) => (e as Extract<RunEvent, { type: "awaiting-user" }>).card.id),
      ...events.filter((e) => e.type === "card").map((e) => (e as Extract<RunEvent, { type: "card" }>).card.id),
    ]);
    expect(cardIds.size).toBe(1);
  });

  it("emits awaiting-user BEFORE the tool resolves, so the UI can show the card", async () => {
    // The regression this guards: `awaiting-user` was buffered and only yielded
    // after tool execution finished — but execution waits on the user, who
    // waits on the card. Deadlock. A responder that resolves immediately hides
    // it; this one refuses to answer until it has actually seen the event.
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", { kind: "confirm", spec: { title: "Proceed?", summary: [{ label: "Amount", value: 1 }] } }),
        respondText("Done."),
      ],
      [createVisualizeTool({ cards })],
    );

    let sawEvent = false;
    // Definite assignment: the Promise executor runs synchronously, but TS's
    // control-flow analysis cannot see that.
    let resolveDecision!: () => void;
    const seen = new Promise<void>((r) => {
      resolveDecision = r;
    });

    const gen = runAgent([userMessage("go")], {
      provider: h.provider,
      model: "gpt-5.2",
      contextBuilder: h.contextBuilder,
      tools: h.registry,
      toolResolution: { presets: ["observer"] },
      mode: "sync",
      onUserDecision: async (callId, card) => {
        // Block until the consumer confirms it observed `awaiting-user`.
        await seen;
        return { cardId: card.id, callId, kind: "confirm", type: "confirm", value: { confirmed: true }, at: 0 };
      },
    });

    const events: RunEvent[] = [];
    const pump = (async () => {
      for await (const e of gen) {
        events.push(e);
        if (e.type === "awaiting-user") {
          sawEvent = true;
          resolveDecision();
        }
      }
    })();

    // Without the fix this never settles.
    await Promise.race([
      pump,
      new Promise((_, reject) => setTimeout(() => reject(new Error("runAgent deadlocked waiting on the user")), 4_000)),
    ]);

    expect(sawEvent).toBe(true);
    expect(events.some((e) => e.type === "user-responded")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run-finish" });
  }, 10_000);

  it("streams a long tool's progress cards while it is still running", async () => {
    // Same channel guarantee, non-interactive: emitCard must surface live.
    const slow: ToolDefinition = {
      name: "slow",
      description: "emits progress",
      inputSchema: { type: "object" },
      execute: async (_input, ctx) => {
        ctx.emitCard?.({ kind: "progress", steps: [{ label: "one", status: "done" }] });
        await new Promise((r) => setTimeout(r, 120));
        ctx.emitCard?.({ kind: "progress", steps: [{ label: "two", status: "done" }] });
        return { output: { ok: true } };
      },
    };
    const h = harness([respondToolCall("slow", {}), respondText("finished")], [slow]);

    const seenBeforeResult: string[] = [];
    for await (const e of runAgent([userMessage("go")], {
      provider: h.provider,
      model: "gpt-5.2",
      contextBuilder: h.contextBuilder,
      tools: h.registry,
      toolResolution: { presets: ["observer"] },
      mode: "sync",
    })) {
      if (e.type === "card") seenBeforeResult.push("card");
      if (e.type === "tool-result") seenBeforeResult.push("result");
    }

    // Both cards arrive ahead of the result, and each is emitted exactly once —
    // no duplicate replay after the tool finishes.
    expect(seenBeforeResult).toEqual(["card", "card", "result"]);
  });

  it("records a decline and lets the model see it", async () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", { kind: "confirm", spec: { title: "Send funds", summary: [{ label: "Amount", value: 100 }] } }),
        respondText("Cancelled."),
      ],
      [createVisualizeTool({ cards })],
    );

    const events = await collect(
      runAgent([userMessage("send it")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        onUserDecision: async (callId, card) => ({ cardId: card.id, callId, kind: "confirm", type: "cancel", at: 0 }),
      }),
    );

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect((result.output as { response: { cancelled: boolean } }).response.cancelled).toBe(true);
  });

  it("stops at maxSteps and says the answer may be incomplete", async () => {
    // A model stuck in a tool loop: every response asks for the tool again.
    const h = harness([respondToolCall("echo", { value: "again" })]);
    const events = await collect(
      runAgent([userMessage("loop")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        maxSteps: 3,
      }),
    );

    const steps = events.filter((e) => e.type === "step-start").length;
    expect(steps).toBe(3);
    const notice = events.filter((e) => e.type === "message").at(-1) as Extract<RunEvent, { type: "message" }>;
    expect((notice.parts[0] as { text: string }).text).toContain("step limit");
  });

  it("only exposes tools the preset allows", async () => {
    const secret: ToolDefinition = { name: "secret", description: "hidden", inputSchema: { type: "object" }, execute: () => ({ output: 1 }) };
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport, dialect: "responses" });
    const registry = new ToolRegistry().register(echoTool, ["observer"]).register(secret, ["executor"]);

    await collect(
      runAgent([userMessage("hi")], {
        provider,
        model: "gpt-5.2",
        contextBuilder: new ContextBuilder({ contextWindow: 32_000 }),
        tools: registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const body = transport.sent[0]!.body as { tools?: { name: string }[] };
    expect(body.tools?.map((t) => t.name)).toEqual(["echo"]);
  });

  it("unlocks a skill's tools only when that skill matches", async () => {
    const gated: ToolDefinition = { name: "gated", description: "g", inputSchema: { type: "object" }, execute: () => ({ output: 1 }) };
    const skills = new SkillRegistry([
      {
        id: "trading",
        name: "Trading",
        description: "trading",
        mode: "matched",
        aliases: ["swap", "trade"],
        body: "Trade carefully.",
        tools: ["gated"],
      },
    ]);
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport, dialect: "responses" });
    const registry = new ToolRegistry().register(echoTool, ["observer"]).register(gated);
    const contextBuilder = new ContextBuilder({ skills, contextWindow: 32_000 });

    const run = (text: string) =>
      collect(
        runAgent([userMessage(text)], {
          provider,
          model: "gpt-5.2",
          contextBuilder,
          tools: registry,
          toolResolution: { presets: ["observer"] },
          mode: "sync",
        }),
      );

    await run("what is the weather");
    expect((transport.sent[0]!.body as { tools?: { name: string }[] }).tools?.map((t) => t.name)).toEqual(["echo"]);

    await run("I want to swap tokens");
    expect((transport.sent[1]!.body as { tools?: { name: string }[] }).tools?.map((t) => t.name)).toEqual(["echo", "gated"]);
  });

  it("drives a background job through polling to a result", async () => {
    const queued = { id: "resp_bg", object: "response", created_at: 0, model: "gpt-5.2", status: "queued", output: [] };
    const inProgress = { ...queued, status: "in_progress" };
    const done = { ...respondText("Background answer.", "resp_bg"), status: "completed" };
    const h = harness([queued, inProgress, done]);

    const events = await collect(
      runAgent([userMessage("long task")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "background",
      }),
    );

    expect(events.some((e) => e.type === "job-started")).toBe(true);
    const status = events.find((e) => e.type === "job-status") as Extract<RunEvent, { type: "job-status" }>;
    expect(status.status).toBe("completed");

    // The create request must set background AND store, or the job is unpollable.
    const create = h.transport.sent[0]!.body as { background?: boolean; store?: boolean };
    expect(create.background).toBe(true);
    expect(create.store).toBe(true);

    // Polls are GETs against the returned id.
    expect(h.transport.sent[1]).toMatchObject({ method: "GET", path: "/responses/resp_bg" });

    const message = events.find((e) => e.type === "message") as Extract<RunEvent, { type: "message" }>;
    expect((message.parts[0] as { text: string }).text).toBe("Background answer.");
  }, 15_000);

  it("reports a cancelled run as cancelled, not as a crash", async () => {
    const h = harness([respondText("never seen")]);
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      runAgent([userMessage("hi")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        signal: controller.signal,
      }),
    );

    expect(events.at(-1)).toMatchObject({ type: "run-finish", finishReason: "cancelled" });
  });
});

describe("reduceRunEvent terminal states", () => {
  const finish = (finishReason: string) =>
    ({ type: "run-finish", runId: "run", finishReason, usage: {}, steps: 1 }) as RunEvent;
  const fail = { type: "error", error: new Error("boom"), recoverable: false } as RunEvent;

  it("keeps a failed run failed through run-finish", () => {
    const state = [fail, finish("error")].reduce(reduceRunEvent, initialRunState("run", "sync"));
    expect(state.status).toBe("error");
    expect(state.error).toBeInstanceOf(Error);
  });

  it("maps a cancelled run to done — a user abort is not a fault", () => {
    const state = [fail, finish("cancelled")].reduce(reduceRunEvent, initialRunState("run", "sync"));
    expect(state.status).toBe("done");
  });

  it("surfaces a transport failure as status error end to end", async () => {
    const transport: Transport = {
      kind: "custom",
      credentialSafe: true,
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "upstream down" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    };
    const provider = createOpenAIProvider({ transport, dialect: "responses" });
    const registry = new ToolRegistry().registerAll([echoTool], ["observer"]);
    const contextBuilder = new ContextBuilder({ identity: "You are a test agent.", contextWindow: 32_000 });

    const events = await collect(
      runAgent([userMessage("hi")], {
        provider,
        model: "gpt-5.2",
        contextBuilder,
        tools: registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const state = events.reduce(reduceRunEvent, initialRunState("run", "sync"));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(state.status).toBe("error");
    expect(state.finishReason).toBe("error");
  });
});

describe("interactive card answers survive the turn", () => {
  it("records the action on the card so a committed transcript is not a guess", async () => {
    // The regression: the answer lived only in the renderer's state, so a card
    // re-mounted from history showed the fallback branch — a confirmed action
    // read back as "Declined."
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", {
          kind: "confirm",
          spec: { title: "Create alert", summary: [{ label: "Asset", value: "SUI" }] },
        }),
        respondText("Done."),
      ],
      [createVisualizeTool({ cards })],
    );

    const events = await collect(
      runAgent([userMessage("set an alert")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        onUserDecision: async (callId, card) => ({
          cardId: card.id,
          callId,
          kind: "confirm",
          type: "confirm",
          value: { confirmed: true },
          at: 0,
        }),
      }),
    );

    const state = events.reduce(reduceRunEvent, initialRunState("run", "sync"));
    const answered = state.cards.find((c) => (c.spec as { kind?: string }).kind === "confirm");
    expect(answered?.action?.type).toBe("confirm");
  });

  it("records a cancel distinctly from a confirm", async () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const h = harness(
      [
        respondToolCall("visualize", {
          kind: "confirm",
          spec: { title: "Delete everything", summary: [{ label: "Scope", value: "all" }] },
        }),
        respondText("Cancelled."),
      ],
      [createVisualizeTool({ cards })],
    );

    const events = await collect(
      runAgent([userMessage("delete it")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        onUserDecision: async (callId, card) => ({ cardId: card.id, callId, kind: "confirm", type: "cancel", at: 0 }),
      }),
    );

    const state = events.reduce(reduceRunEvent, initialRunState("run", "sync"));
    const answered = state.cards.find((c) => (c.spec as { kind?: string }).kind === "confirm");
    expect(answered?.action?.type).toBe("cancel");
  });
});

describe("tool duration reaches the rendered part", () => {
  it("keeps ms on the tool-result part, not just on the event", async () => {
    // The event always carried `ms`; the reducer dropped it, so no UI could show
    // how long a call took — live or in a reloaded thread.
    const h = harness([respondToolCall("echo", { value: "ping" }), respondText("done")]);
    const events = await collect(
      runAgent([userMessage("go")], {
        provider: h.provider,
        model: "gpt-5.2",
        contextBuilder: h.contextBuilder,
        tools: h.registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const state = events.reduce(reduceRunEvent, initialRunState("run", "sync"));
    const part = state.parts.find((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");
    expect(part).toBeDefined();
    expect(typeof part!.ms).toBe("number");
    expect(part!.ms).toBeGreaterThanOrEqual(0);
  });
});
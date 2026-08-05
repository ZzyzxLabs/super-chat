// The Anthropic provider — the second adapter, and the real test of whether
// the normalized content model holds up (HANDOFF said it would be).
//
// Everything speaks POST /messages. There is no background mode, no
// server-side history, no /files upload here (the Files API is beta and out of
// scope) — the capabilities object says so instead of the adapter pretending.
//
// Auth note: Anthropic wants `x-api-key` (not `Authorization: Bearer`) plus an
// `anthropic-version` header on every call. The version header is attached
// per-request below; the key belongs to the transport — use
// `authStyle: "x-api-key"` on a direct transport or proxy provider entry.

import { AgentError, toAgentError } from "../../errors.js";
import { errorFromResponse, withRetry } from "../../transport/retry.js";
import type { RetryPolicy, Transport } from "../../transport/types.js";
import type {
  CallOptions,
  GenerateResult,
  ModelInfo,
  NormalizedRequest,
  Provider,
  ProviderCapabilities,
  StreamEvent,
} from "../types.js";
import { buildAnthropicRequest, usesOwnFiles } from "./map-in.js";
import { finishFromAnthropic, partsFromAnthropic, usageFromAnthropic } from "./map-out.js";
import { streamAnthropic } from "./stream.js";
import type { AnthropicResponse } from "./wire.js";

export type AnthropicProviderConfig = {
  transport: Transport;
  /** Provider id, so several instances can coexist. Defaults to "anthropic". */
  id?: string;
  label?: string;
  retry?: RetryPolicy;
  capabilities?: Partial<ProviderCapabilities>;
  models?: ModelInfo[];
  /** `anthropic-version` header value. */
  version?: string;
  /** `max_tokens` is REQUIRED on this wire; applied when the request has none. */
  defaultMaxTokens?: number;
};

const ANTHROPIC_CAPS: ProviderCapabilities = {
  streaming: true,
  backgroundJobs: false,
  resumableStreams: false,
  tools: true,
  parallelToolCalls: true,
  images: true,
  files: true, // document blocks (PDF etc.)
  audio: false,
  reasoning: true,
  strictJsonSchema: true,
  serverSideHistory: false,
  fileUpload: false, // Files API is beta; not implemented here
};

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 1_000_000, maxOutputTokens: 128_000 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000, maxOutputTokens: 64_000 },
];

export function createAnthropicProvider(config: AnthropicProviderConfig): Provider {
  const id = config.id ?? "anthropic";
  const version = config.version ?? "2023-06-01";
  const capabilities: ProviderCapabilities = { ...ANTHROPIC_CAPS, ...config.capabilities };

  async function call(
    body: unknown,
    opts: CallOptions | undefined,
    extra: { stream?: boolean; betas?: string[] } = {},
  ): Promise<Response> {
    return withRetry(
      async () => {
        const res = await config.transport.fetch({
          provider: id,
          path: "/messages",
          method: "POST",
          body,
          stream: extra.stream,
          headers: {
            "anthropic-version": version,
            ...(extra.betas?.length ? { "anthropic-beta": extra.betas.join(",") } : {}),
            ...opts?.headers,
          },
          signal: opts?.signal,
        });
        if (!res.ok) throw await errorFromResponse(res, id);
        return res;
      },
      { policy: config.retry, signal: opts?.signal, provider: id },
    );
  }

  function guardRequest(req: NormalizedRequest) {
    if (req.background) {
      throw new AgentError("not-supported", `Provider "${id}" has no background mode. Use streaming or sync.`, {
        provider: id,
      });
    }
    if (req.responseFormat && req.responseFormat.type === "json") {
      throw new AgentError(
        "not-supported",
        `Provider "${id}" supports responseFormat "json_schema", not bare "json". Provide a schema.`,
        { provider: id },
      );
    }
    const has = (type: "image" | "file" | "audio") => req.messages.some((m) => m.parts.some((p) => p.type === type));
    if (!capabilities.images && has("image")) {
      throw new AgentError("not-supported", `Provider "${id}" does not accept image parts.`, { provider: id });
    }
    if (!capabilities.audio && has("audio")) {
      // Audio degrades to transcript text in the builder; only refuse when
      // there is nothing to degrade to.
      const silent = req.messages.some((m) => m.parts.some((p) => p.type === "audio" && !p.transcript));
      if (silent) {
        throw new AgentError("not-supported", `Provider "${id}" does not accept audio parts.`, { provider: id });
      }
    }
  }

  const buildOpts = (stream?: boolean) => ({
    ...(stream ? { stream: true } : {}),
    providerId: id,
    parallelToolCalls: capabilities.parallelToolCalls,
    defaultMaxTokens: config.defaultMaxTokens,
  });

  const applyCapabilities = (req: NormalizedRequest): NormalizedRequest =>
    capabilities.strictJsonSchema || !req.tools?.some((t) => t.strict)
      ? req
      : { ...req, tools: req.tools!.map(({ strict: _strict, ...t }) => t) };

  const betasFor = (req: NormalizedRequest): string[] =>
    usesOwnFiles(req, id) ? ["files-api-2025-04-14"] : [];

  return {
    id,
    label: config.label ?? "Anthropic",
    capabilities,
    transport: config.transport,

    async generate(rawReq, opts): Promise<GenerateResult> {
      guardRequest(rawReq);
      const req = applyCapabilities(rawReq);
      const res = await call(buildAnthropicRequest(req, buildOpts()), opts, { betas: betasFor(req) });
      const json = (await res.json()) as AnthropicResponse;
      return {
        parts: partsFromAnthropic(json),
        finishReason: finishFromAnthropic(json.stop_reason),
        usage: usageFromAnthropic(json.usage),
        responseId: json.id,
        modelId: json.model,
        raw: json,
      };
    },

    async *stream(rawReq, opts): AsyncIterable<StreamEvent> {
      guardRequest(rawReq);
      const req = applyCapabilities(rawReq);
      try {
        const res = await call(buildAnthropicRequest(req, buildOpts(true)), opts, {
          stream: true,
          betas: betasFor(req),
        });
        if (!res.body) throw new AgentError("network", "Response had no body to stream.", { provider: id });
        yield* streamAnthropic(res.body);
      } catch (e) {
        yield { type: "error", error: toAgentError(e, id) };
      }
    },

    async listModels(): Promise<ModelInfo[]> {
      // /models exists but adds an allowlist entry for little gain; a static
      // list mirrors the OpenAI adapter's offline fallback behavior.
      return config.models ?? ANTHROPIC_MODELS;
    },
  };
}

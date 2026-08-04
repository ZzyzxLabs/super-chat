// The OpenAI provider. Speaks both dialects behind one `Provider` interface and
// implements background mode as first-class async jobs.
//
// Dialect choice: Responses is the default and the only one that supports
// background jobs, server-side history and reasoning replay. Chat Completions
// stays available because most "OpenAI-compatible" endpoints (routers, vLLM,
// Ollama, Together, NVIDIA NIM) implement only that one — pointing this adapter
// at them with `dialect: "chat"` is the whole integration.

import { AgentError, toAgentError } from "../../errors.js";
import { errorFromResponse, withRetry } from "../../transport/retry.js";
import type { RetryPolicy, Transport } from "../../transport/types.js";
import type {
  CallOptions,
  GenerateResult,
  JobHandle,
  JobSnapshot,
  ModelInfo,
  NormalizedRequest,
  Provider,
  ProviderCapabilities,
  StreamEvent,
} from "../types.js";
import { buildChatRequest, buildResponsesRequest } from "./map-in.js";
import { finishFromChat, finishFromResponses, partsFromChat, partsFromResponses, usageFromChat, usageFromResponses } from "./map-out.js";
import { finalResponseFromStream, streamChat, streamResponses } from "./stream.js";
import { OPENAI_MODELS, modelCapabilities } from "./models.js";
import type { ChatResponse, ResponsesResponse } from "./wire.js";

export type OpenAIDialect = "responses" | "chat";

export type OpenAIProviderConfig = {
  transport: Transport;
  /** Defaults to "responses". Use "chat" for OpenAI-compatible third parties. */
  dialect?: OpenAIDialect;
  /** Provider id, so several instances (openai, groq, nvidia) can coexist. */
  id?: string;
  label?: string;
  retry?: RetryPolicy;
  /** Capability overrides — a compatible endpoint may lack background/reasoning. */
  capabilities?: Partial<ProviderCapabilities>;
  models?: ModelInfo[];
};

const RESPONSES_CAPS: ProviderCapabilities = {
  streaming: true,
  backgroundJobs: true,
  resumableStreams: true,
  tools: true,
  parallelToolCalls: true,
  images: true,
  files: true,
  audio: false,
  reasoning: true,
  strictJsonSchema: true,
  serverSideHistory: true,
};

const CHAT_CAPS: ProviderCapabilities = {
  ...RESPONSES_CAPS,
  backgroundJobs: false,
  resumableStreams: false,
  audio: true,
  serverSideHistory: false,
};

export function createOpenAIProvider(config: OpenAIProviderConfig): Provider {
  const dialect: OpenAIDialect = config.dialect ?? "responses";
  const id = config.id ?? "openai";
  const capabilities: ProviderCapabilities = {
    ...(dialect === "responses" ? RESPONSES_CAPS : CHAT_CAPS),
    ...config.capabilities,
  };

  /** Every HTTP call funnels through here so retry + error mapping happen once. */
  async function call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; stream?: boolean; query?: Record<string, string | number | boolean | undefined> },
    opts?: CallOptions,
  ): Promise<Response> {
    return withRetry(
      async () => {
        const res = await config.transport.fetch({
          provider: id,
          path,
          method: init.method,
          body: init.body,
          stream: init.stream,
          query: init.query,
          headers: opts?.headers,
          signal: opts?.signal,
        });
        if (!res.ok) throw await errorFromResponse(res, id);
        return res;
      },
      { policy: config.retry, signal: opts?.signal, provider: id },
    );
  }

  function guardRequest(req: NormalizedRequest) {
    if (req.background && !capabilities.backgroundJobs) {
      throw new AgentError(
        "not-supported",
        `Provider "${id}" (${dialect} dialect) has no background mode. Use streaming, or switch to the Responses dialect.`,
        { provider: id },
      );
    }
    if (req.tools?.length && !capabilities.tools) {
      throw new AgentError("not-supported", `Provider "${id}" does not support tools.`, { provider: id });
    }
  }

  function resultFromResponses(r: ResponsesResponse): GenerateResult {
    return {
      parts: partsFromResponses(r),
      finishReason: finishFromResponses(r),
      usage: usageFromResponses(r.usage),
      responseId: r.id,
      modelId: r.model,
      raw: r,
    };
  }

  const provider: Provider = {
    id,
    label: config.label ?? (dialect === "responses" ? "OpenAI" : "OpenAI-compatible"),
    capabilities,
    transport: config.transport,

    async generate(req, opts): Promise<GenerateResult> {
      guardRequest(req);

      if (dialect === "responses") {
        const res = await call("/responses", { method: "POST", body: buildResponsesRequest(req) }, opts);
        const json = (await res.json()) as ResponsesResponse;
        if (json.status === "failed" && json.error) {
          throw new AgentError("unknown", json.error.message, { provider: id, detail: json.error });
        }
        return resultFromResponses(json);
      }

      const res = await call("/chat/completions", { method: "POST", body: buildChatRequest(req) }, opts);
      const json = (await res.json()) as ChatResponse;
      return {
        parts: partsFromChat(json),
        finishReason: finishFromChat(json.choices?.[0]?.finish_reason),
        usage: usageFromChat(json.usage),
        responseId: json.id,
        modelId: json.model,
        raw: json,
      };
    },

    async *stream(req, opts): AsyncIterable<StreamEvent> {
      guardRequest(req);
      try {
        if (dialect === "responses") {
          const res = await call(
            "/responses",
            { method: "POST", body: buildResponsesRequest(req, { stream: true }), stream: true },
            opts,
          );
          if (!res.body) throw new AgentError("network", "Response had no body to stream.", { provider: id });
          yield* streamResponses(res.body);
          return;
        }
        const res = await call(
          "/chat/completions",
          { method: "POST", body: buildChatRequest(req, { stream: true }), stream: true },
          opts,
        );
        if (!res.body) throw new AgentError("network", "Response had no body to stream.", { provider: id });
        yield* streamChat(res.body);
      } catch (e) {
        // A stream that throws mid-iteration would leave the consumer's reducer
        // half-applied; emitting an error event lets it close out cleanly.
        yield { type: "error", error: toAgentError(e, id) };
      }
    },

    async startJob(req, opts): Promise<JobHandle> {
      if (!capabilities.backgroundJobs) {
        throw new AgentError("not-supported", `Provider "${id}" has no background mode.`, { provider: id });
      }
      const body = buildResponsesRequest({ ...req, background: true });
      const res = await call("/responses", { method: "POST", body }, opts);
      const json = (await res.json()) as ResponsesResponse;
      return { provider: id, id: json.id, model: json.model || req.model, createdAt: Date.now() };
    },

    async pollJob(handle, opts): Promise<JobSnapshot> {
      const res = await call(`/responses/${encodeURIComponent(handle.id)}`, { method: "GET" }, opts);
      const json = (await res.json()) as ResponsesResponse;

      if (json.status === "failed") {
        return {
          handle,
          status: "failed",
          error: { message: json.error?.message ?? "Background response failed.", code: json.error?.code },
        };
      }
      if (json.status === "completed" || json.status === "incomplete") {
        // `incomplete` still carries usable output (it hit a cap mid-answer), so
        // it resolves as a result with a `length` finish reason rather than an error.
        return { handle, status: json.status, result: resultFromResponses(json) };
      }
      return { handle, status: json.status };
    },

    async cancelJob(handle, opts): Promise<JobSnapshot> {
      const res = await call(`/responses/${encodeURIComponent(handle.id)}/cancel`, { method: "POST" }, opts);
      const json = (await res.json()) as ResponsesResponse;
      return { handle, status: json.status === "cancelled" ? "cancelled" : json.status };
    },

    async *streamJob(handle, opts): AsyncIterable<StreamEvent> {
      // Attach to a running background response. `starting_after` replays from
      // the cursor, which is what makes a reload lose nothing: we persist the
      // last sequence number and resume from it.
      let cursor = handle.cursor;
      try {
        const res = await call(
          `/responses/${encodeURIComponent(handle.id)}`,
          {
            method: "GET",
            stream: true,
            query: { stream: true, ...(cursor != null ? { starting_after: cursor } : {}) },
          },
          opts,
        );
        if (!res.body) throw new AgentError("network", "Job stream had no body.", { provider: id });
        yield* streamResponses(res.body, {
          onCursor: (seq) => {
            cursor = seq;
            handle.cursor = seq;
          },
        });
      } catch (e) {
        yield { type: "error", error: toAgentError(e, id) };
      }
    },

    async listModels(opts): Promise<ModelInfo[]> {
      if (config.models) return config.models;
      try {
        const res = await call("/models", { method: "GET" }, opts);
        const json = (await res.json()) as { data?: { id: string }[] };
        const remote = (json.data ?? []).map((m) => ({
          id: m.id,
          ...(modelCapabilities(m.id) ? { supports: modelCapabilities(m.id) } : {}),
        }));
        return remote.length ? remote : OPENAI_MODELS;
      } catch {
        // A proxy that does not allowlist /models is a normal setup, not an error.
        return OPENAI_MODELS;
      }
    },
  };

  return provider;
}

export { finalResponseFromStream };

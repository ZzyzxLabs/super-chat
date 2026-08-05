import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { executeToolCall } from "../runtime/execute-tools.js";
import type { Transport, TransportRequest } from "../transport/types.js";
import { McpClient } from "./client.js";
import { importMcpTools, mapMcpResult } from "./import.js";
import type { JsonRpcRequest } from "./types.js";

function serverTransport(opts: {
  name?: string;
  tools?: { name: string; description?: string; inputSchema?: object }[];
  call?: (name: string, args: unknown) => unknown;
}): Transport {
  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(req: TransportRequest): Promise<Response> {
      const rpc = req.body as JsonRpcRequest;
      const reply = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      switch (rpc.method) {
        case "initialize":
          return reply({ protocolVersion: "2025-06-18", serverInfo: { name: opts.name ?? "Utils Server!" } });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return reply({ tools: (opts.tools ?? []).map((t) => ({ inputSchema: { type: "object" }, ...t })) });
        case "tools/call": {
          const p = rpc.params as { name: string; arguments: unknown };
          return reply(opts.call?.(p.name, p.arguments) ?? { content: [] });
        }
        default:
          return reply({});
      }
    },
  };
}

describe("importMcpTools", () => {
  it("namespaces with the sanitized server name and executes through the client", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const client = new McpClient({
      transport: serverTransport({
        name: "Utils Server!",
        tools: [{ name: "word_count", description: "Count words." }],
        call: (name, args) => {
          calls.push({ name, args });
          return { content: [{ type: "text", text: '{"words":2}' }] };
        },
      }),
    });
    const defs = await importMcpTools(client);

    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe("Utils-Server_word_count");
    expect(defs[0]?.side).toBe("read");

    const outcome = await executeToolCall(
      { callId: "c1", name: "Utils-Server_word_count", input: { text: "two words" } },
      { tools: defs, vars: {} },
    );
    // The server received the ORIGINAL name, not the namespaced one.
    expect(calls[0]).toEqual({ name: "word_count", args: { text: "two words" } });
    expect(outcome.output).toEqual({ words: 2 });
  });

  it("avoids the reserved mcp namespace that normalizeToolName would strip", async () => {
    const client = new McpClient({
      transport: serverTransport({ name: "MCP", tools: [{ name: "t" }] }),
    });
    const defs = await importMcpTools(client);
    expect(defs[0]?.name).toBe("srv_t");
  });

  it("throws on a post-namespacing collision instead of silently overwriting", async () => {
    const client = new McpClient({
      transport: serverTransport({ name: "s", tools: [{ name: "dup" }, { name: "dup" }] }),
    });
    await expect(importMcpTools(client)).rejects.toThrow(/distinct namespaces/);
  });

  it("registers as skill-gated by default: invisible to presets, surfaced by allow", async () => {
    const client = new McpClient({
      transport: serverTransport({ name: "utils", tools: [{ name: "slugify" }] }),
    });
    const defs = await importMcpTools(client);
    const registry = new ToolRegistry();
    registry.registerAll(defs); // the documented host move — NO preset

    expect(registry.resolve({ presets: ["observer"] }).map((t) => t.name)).toEqual([]);
    expect(registry.resolve({ presets: ["observer"], allow: ["utils_slugify"] }).map((t) => t.name)).toEqual([
      "utils_slugify",
    ]);
  });
});

describe("mapMcpResult", () => {
  it("prefers structuredContent verbatim", () => {
    expect(mapMcpResult({ content: [{ type: "text", text: "ignored" }], structuredContent: { a: 1 } })).toEqual({
      output: { a: 1 },
    });
  });

  it("parses a single JSON text into a value, keeps plain text as a string", () => {
    expect(mapMcpResult({ content: [{ type: "text", text: '{"n":3}' }] }).output).toEqual({ n: 3 });
    expect(mapMcpResult({ content: [{ type: "text", text: "plain answer" }] }).output).toBe("plain answer");
    expect(mapMcpResult({ content: [{ type: "text", text: "{broken json" }] }).output).toBe("{broken json");
  });

  it("joins multiple texts with newlines", () => {
    expect(
      mapMcpResult({ content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }] }).output,
    ).toBe("line one\nline two");
  });

  it("turns an image into a media card while keeping the output textual", () => {
    const mapped = mapMcpResult({
      content: [{ type: "text", text: "rendered" }, { type: "image", data: "AAAA", mimeType: "image/png" }],
    });
    expect(mapped.output).toBe("rendered");
    expect(mapped.card).toEqual({
      kind: "media",
      items: [{ url: "data:image/png;base64,AAAA", mediaType: "image/png" }],
      layout: "single",
    });
  });

  it("collects resource references", () => {
    const mapped = mapMcpResult({
      content: [
        { type: "text", text: "see the doc" },
        { type: "resource", resource: { uri: "file:///a.md", text: "# A" } },
      ],
    });
    expect(mapped.output).toEqual({ text: "see the doc", resources: [{ uri: "file:///a.md", text: "# A" }] });
  });

  it("maps isError to an execution-error failure the model can read", () => {
    expect(mapMcpResult({ content: [{ type: "text", text: "boom" }], isError: true })).toEqual({
      output: { error: "boom" },
      failure: "execution-error",
    });
  });
});

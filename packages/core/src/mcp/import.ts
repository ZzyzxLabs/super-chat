// MCP tools → ToolDefinitions.
//
// Import grants EXISTENCE, never authority. `importMcpTools` returns
// definitions; registering them is the host's move, and registering with no
// preset makes them skill-gated — private until a skill (or an explicit
// `allow`) surfaces them, exactly like any locally defined domain tool. An MCP
// server must not be able to walk its tools into the executor tier by being
// connected.

import type { ToolDefinition, ToolResult, ToolSide } from "../tools/types.js";
import type { McpClient } from "./client.js";
import type { McpCallResult, McpContent } from "./types.js";

export type McpImportOptions = {
  /**
   * Prefix for imported tool names ("namespace_toolName"), so two servers with
   * a `search` tool can coexist. Defaults to the server's sanitized name.
   */
  namespace?: string;
  /** Defaults to "read": a remote server's tools are reads until the host says otherwise. */
  side?: ToolSide;
  costHint?: number;
  /** Override the result mapping per server. */
  mapResult?: (result: McpCallResult) => ToolResult;
};

/** `normalizeToolName` strips a leading "mcp_", so that namespace would break dispatch. */
const RESERVED_NAMESPACE = "mcp";

function sanitizeNamespace(raw: string | undefined): string {
  const cleaned = (raw ?? "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned.toLowerCase() === RESERVED_NAMESPACE) return "srv";
  return cleaned;
}

/**
 * Fetch the server's tool list and wrap each tool in a `ToolDefinition` whose
 * executor calls back through the client. Throws when two tools collide after
 * namespacing — a silent overwrite would drop a tool with no trace.
 */
export async function importMcpTools(client: McpClient, opts: McpImportOptions = {}): Promise<ToolDefinition[]> {
  const { serverInfo } = await client.connect();
  const namespace = sanitizeNamespace(opts.namespace ?? serverInfo.name);
  const mapResult = opts.mapResult ?? mapMcpResult;

  const tools = await client.listTools();
  const out: ToolDefinition[] = [];
  const seen = new Set<string>();

  for (const tool of tools) {
    const name = `${namespace}_${tool.name}`;
    if (seen.has(name)) {
      throw new Error(`MCP import: two tools map to "${name}". Give the servers distinct namespaces.`);
    }
    seen.add(name);

    out.push({
      name,
      description: tool.description ?? `Tool "${tool.name}" from the ${namespace} MCP server.`,
      inputSchema: tool.inputSchema ?? { type: "object" },
      side: opts.side ?? "read",
      ...(opts.costHint != null ? { costHint: opts.costHint } : {}),
      execute: async (input, ctx) => {
        // The model calls the namespaced name; the server knows the original.
        const result = await client.callTool(tool.name, input, { signal: ctx.signal });
        return mapResult(result);
      },
    });
  }

  return out;
}

/**
 * Default MCP result → ToolResult mapping.
 *
 * The model reads `output`; a UI-worthy image rides as a card. Kept small on
 * purpose — the output is billed on every later turn of the thread.
 */
export function mapMcpResult(result: McpCallResult): ToolResult {
  if (result.isError) {
    return { output: { error: textOf(result.content) || "MCP tool failed." }, failure: "execution-error" };
  }
  if (result.structuredContent !== undefined) {
    return { output: result.structuredContent };
  }

  const texts = result.content.filter((c): c is Extract<McpContent, { type: "text" }> => c.type === "text");
  const resources = result.content.filter((c): c is Extract<McpContent, { type: "resource" }> => c.type === "resource");
  const image = result.content.find((c): c is Extract<McpContent, { type: "image" }> => c.type === "image");

  let output: unknown;
  if (texts.length === 1) {
    // A single text that parses as JSON becomes the parsed value — models do
    // better with structure than with a string of escaped braces.
    output = parseMaybeJson(texts[0]!.text);
  } else if (texts.length > 1) {
    output = texts.map((t) => t.text).join("\n");
  }

  if (resources.length) {
    const refs = resources.map((r) => ({ uri: r.resource.uri, ...(r.resource.text ? { text: r.resource.text } : {}) }));
    output = output === undefined ? { resources: refs } : { text: output, resources: refs };
  }
  if (output === undefined) output = image ? "(image result)" : null;

  return {
    output,
    ...(image
      ? {
          card: {
            kind: "media",
            items: [{ url: `data:${image.mimeType};base64,${image.data}`, mediaType: image.mimeType }],
            layout: "single",
          },
        }
      : {}),
  };
}

const textOf = (content: McpContent[]): string =>
  content
    .filter((c): c is Extract<McpContent, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("\n");

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

// MCP wire types — only the slice this client speaks. Hand-rolled against the
// Model Context Protocol spec (Streamable HTTP transport, JSON-RPC 2.0), no
// @modelcontextprotocol/sdk: the core carries zero runtime dependencies, and
// the four requests we need (initialize, initialized, tools/list, tools/call)
// do not justify one.

import type { JSONSchema } from "../providers/types.js";

export type McpServerInfo = { name: string; version?: string };

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
};

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } };

export type McpCallResult = {
  content: McpContent[];
  /** Structured output, when the tool declares an output schema. */
  structuredContent?: unknown;
  /** Tool-level failure — the tool ran and reports an error the MODEL should see. */
  isError?: boolean;
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

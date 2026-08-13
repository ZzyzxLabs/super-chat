# @zzyzxlabs/super-chat-core

Provider-agnostic agent core: content model, skills, context assembly, tools,
runtime, and hand-rolled provider adapters. No React — isomorphic, runs on a
server or in a browser tab.

Part of the [superchat](../../README.md) monorepo. See the root README for the
full pitch and [../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing
design decisions.

## What's in here

| module | responsibility |
| --- | --- |
| `providers/openai`, `providers/anthropic` | hand-rolled request/response mapping for each wire dialect |
| `transport` | SSE parsing, retry, proxy handler, multipart upload |
| `context` | derives a token-budgeted context from named sources every turn |
| `skills` | trigger + cost units that inject prompt text and unlock tools |
| `tools` | capability registry with explicit preset allowlists |
| `cards` | validator + schema for the 23 built-in agent-card kinds |
| `runtime` | the agent loop, tool execution, background job polling |
| `memory`, `retrieval` | pluggable long-term memory and cited-evidence retrieval seams |
| `mcp` | Streamable HTTP MCP client and tool import |
| `app-state` | lets the agent read/operate host application state |
| `documents` | the document seam: store, anchored edit protocol, `.eml` exit |
| `content/blocks` | the block split every document anchor is defined against |

## Install

```bash
pnpm add @zzyzxlabs/super-chat-core
```

## Develop

```bash
pnpm --filter @zzyzxlabs/super-chat-core build       # tsup, emits dist/
pnpm --filter @zzyzxlabs/super-chat-core typecheck   # tsc --noEmit
pnpm vitest run packages/core             # this package's tests
```

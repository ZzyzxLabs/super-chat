# superchat

A frontend framework for agent services. It assembles **contexts**, **skills** and
**I/O content** into requests that are correct on the wire for each provider, and
gives the agent a **flexible visual vocabulary** to answer with.

Not a chat app. The thing chat apps leave to you.

> **Picking this up cold?** Read **[HANDOFF.md](HANDOFF.md)** first — load-bearing
> decisions, bugs already fixed, and what will bite you.

```
@superchat/core    provider-agnostic engine — no React, isomorphic
@superchat/react   thread state, run control, card actions
@superchat/ui      card renderers, chat primitives, context inspector
apps/playground    Next.js dev panels — one per capability, no API key needed
```

---

## Why this exists

Open WebUI, LibreChat, LobeChat and AnythingLLM are excellent *products*. When you
need an agent surface inside your own product, you end up rebuilding the same four
subsystems anyway — and each one has a failure mode that only shows up in
production:

| Subsystem | The failure you hit |
| --- | --- |
| **Request crafting** | Responses and Chat Completions disagree on tool shape, image parts, and token limits. A dangling `function_call` with no output 400s the *entire thread*, permanently. |
| **Context assembly** | History grows, silently starves the system prompt, and the model "forgets" its rules. Reads like a prompt problem; isn't. |
| **Capability scoping** | Tools accumulate. The day you add a destructive one, it is already live on every key you ever minted. |
| **Agent cards** | A hand-maintained parser/renderer dispatch chain drifts, and a card silently degrades to a "ran ✓" chip. |

superchat takes a position on all four.

---

## The four subsystems

### 1. Request crafting — hand-rolled, both dialects, async first-class

No LLM SDK dependency. The adapter owns the wire format, because that is the part
you actually need to get right.

```ts
const provider = createOpenAIProvider({
  transport: createProxyTransport({ url: "/api/agent" }),
  dialect: "responses",              // or "chat" for OpenAI-compatible endpoints
});
```

Both dialects are implemented as **separate builders sharing no object literals**,
because conflating them is the single largest source of 400s:

|  | Responses | Chat Completions |
| --- | --- | --- |
| tool declaration | flat `{type, name, parameters}` | nested `{type, function:{…}}` |
| user text part | `input_text` | `text` |
| image part | `input_image` | `image_url` |
| tool output | `function_call_output` item | `role:"tool"` message |
| output cap | `max_output_tokens` | `max_completion_tokens` |
| async | `background:true` + polling | — |

**Async / background mode** is a first-class run mode, not an afterthought:

```ts
for await (const event of runAgent(messages, { ...config, mode: "background" })) {
  if (event.type === "job-started") persist(event.handle);   // survives a reload
  if (event.type === "job-status")  render(event.status);
}
```

Jobs are polled (not streamed) because polling is what survives a closed tab, a
dropped network, and a serverless timeout — the whole reason to use background
mode. `JobStore` persists handles; `resumeJobs()` re-polls them on next load.

Also handled, because each one bit someone: SSE frames split mid-UTF-8-codepoint,
streamed parallel tool calls correlated by `index`, `stream_options.include_usage`
(without it every streamed turn meters as zero), reasoning-item replay, and
orphaned tool calls dropped before they poison the thread.

### 2. Context assembly — derived, budgeted, inspectable

Most chat apps *accumulate* an array. superchat *derives* the context every turn
from named sources under an explicit token budget, and records why each layer was
included, truncated or dropped.

```ts
const context = await contextBuilder.build({ messages });
context.trace.entries;   // [{ id: "skill:markets", status: "included", tokens: 214 }, …]
context.trace.headroom;  // tokens left for the reply
```

`<ContextInspector/>` renders that trace. "Why did the agent know that" becomes a
thing you read, not a thing you guess.

Compaction summarizes older turns with a cheap model and keeps recent ones
verbatim, always falling back to trimming if the summarizer fails — a summarizer
outage costs context quality, never the user's turn.

### 3. Skills — three delivery modes, one registry

A skill is a *unit* with a trigger and a cost, not a blob of prompt.

```ts
{ id: "markets", mode: "matched", aliases: ["price", "chart", "trend", "行情"],
  tools: ["getQuote", "getHistory"], body: "…" }
```

| mode | behaviour | for |
| --- | --- | --- |
| `always` | injected every turn, pinned | safety rules, identity, output format |
| `matched` | injected when the message scores against its aliases | domain playbooks |
| `manual` | never injected; the model pulls it with `loadSkill` | long methods, rare paths |

A skill can **unlock tools**, so a legal question never puts twelve marketing
tool schemas in front of the model. Matching is lexical — no embedding
round-trip before the real request — and CJK-aware; swap in your own matcher if
you want semantic retrieval.

Unlocking grants **relevance, not authority**. A tool that belongs to no preset
is private until a skill surfaces it; a tool that carries a preset still needs
that preset enabled. Otherwise any skill could hand out the executor tier just
by naming a tool.

### 4. Agent cards — the agent's visual vocabulary

Two ways a card appears: a domain tool attaches one to its result, or the agent
calls `visualize` and **chooses** a presentation. The second is what makes it
visually flexible rather than limited to whatever someone pre-built.

20 built-in kinds, chosen to span what agents actually need to express rather
than one industry's habits:

| group | kinds |
| --- | --- |
| structured data | `table` `stats` `comparison` `keyvalue` `tree` |
| quantitative shape | `chart` `funnel` `gauge` |
| sequence and state | `timeline` `progress` `checklist` |
| prose and evidence | `markdown` `callout` `citations` `code` `diff` `media` |
| **interactive** | `choice` `form` `confirm` |

`comparison` is the most portable of them — legal clause-vs-clause, vendor
selection, pricing tiers, candidate evaluation all reduce to options × criteria.
`citations` matters specifically for agents: it is the card that lets a reader
check the work instead of trusting the summary.

The kit is deliberately domain-neutral. Each kind's one-line `summary` is what
the model actually reads when choosing, so those summaries name no industry —
an early draft described `stats` as "portfolio totals" and `choice` meta as
"APR, price, size", and that alone was enough to make every agent built on it
behave like a finance agent.

```ts
return { output: { symbol: "SUI", price: 3.42 },
         card: { kind: "stats", items: [{ label: "Price", value: 3.42, format: "currency" }] } };
```

Interactive cards **suspend the run** until the user answers, and the answer
becomes the tool result the model reads next step. That is the human-in-the-loop
seam, end to end.

Three rules the design enforces:

1. **Validator and renderer register together.** A test asserts core's
   `BUILTIN_CARDS` and ui's `BUILTIN_RENDERERS` match exactly, so a card cannot
   validate with nowhere to render. Unknown kinds render a *visible* fallback.
2. **Interactive cards never collapse.** A hidden confirm dialog is an
   unanswerable question, and the run just looks hung.
3. **Cards carry an `expired` state.** Trimmed from persisted history, a card says
   so rather than rendering an empty shell.

Card payloads are stripped from history before the next request — the model
already read the tool's `output`; re-sending 2,000 chart points is double billing.

---

## Transport: where the key lives

The adapter never holds a credential. It describes the call; the transport decides
where it goes.

```ts
// Default — key stays on your server
createProxyTransport({ url: "/api/agent" })

// BYOK — key in the browser. Named to make you say it out loud.
createDirectTransport({ baseUrl: "…", apiKey, dangerouslyAllowBrowser: true })
```

The server half is ~10 lines and **allowlists paths**, because a proxy that
forwards any path is an open relay for your API key:

```ts
export const POST = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
      allowPaths: ["/responses", "/responses/*", "/responses/*/cancel", "/chat/completions"],
    },
  },
  authorize: (req) => checkSession(req),   // your session / quota logic
});
```

Verified in tests: unlisted paths 403, `..` traversal 403, client-supplied
`Authorization` headers ignored.

---

## Capability presets

Explicit **allowlists**, not blocklists. A newly registered tool is invisible until
someone puts it in a preset.

```ts
registry.register(getQuote,   ["observer"]);   // pure reads
registry.register(buildTx,    ["draft"]);      // produces something the user signs
registry.register(createAlert,["executor"]);   // acts — asks first via side:"confirm"

registry.resolve({ presets: ["observer"] });   // deny is applied last, always
```

---

## Run it

```bash
pnpm install && pnpm build
```

```bash
pnpm dev
```

The playground is a set of **dev panels**, not a finished app — each isolates one
capability so you can see what is available without reading the source. It runs
with **no API key**: a scripted demo transport replaces the network while the
real adapter, runtime, tools and context builder do the actual work.

| panel | what it shows |
| --- | --- |
| `/` | Overview — what's in the box |
| `/cards` | All 20 card kinds, each beside the spec that produced it |
| `/skills` | Live match scoring, and the context a query assembles |
| `/tools` | Schemas, preset gating, the exposed set changing as you toggle |
| `/requests` | One request rendered into both dialects, side by side |
| `/run` | A live turn with the raw event stream and context trace beside it |

The demo agent covers **contract review, marketing analytics and market data**
through one registry — different skills and tools, identical machinery. Watch
`/run` and note that a legal question exposes only the legal tools.

For a live model, add `OPENAI_API_KEY` to `apps/playground/.env.local` and switch
the transport selector to **Server proxy**, or pick **BYOK direct** and paste a key.

```bash
pnpm test
```

237 tests. The runtime suite drives the real OpenAI and Anthropic adapters
against mocked transports, so the tool loop, card suspension, thinking replay,
background polling and concurrent proxy streaming are all exercised with no key
and no network.

---

## Status

v0.1. Working and tested; API not frozen.

**Built:** OpenAI adapter (Responses + Chat Completions + background jobs) and
Anthropic adapter (`/v1/messages`, thinking-signature replay), transport layer
(multipart upload through the proxy, bearer or x-api-key auth), file upload to
`/v1/files` with a cross-thread `FileStore`, thread persistence with message
branching (`ThreadStore` v2 — parentId tree, fork-on-edit/regenerate, branch
switcher), MCP tool import (hand-rolled Streamable HTTP client, elicitation via
interactive form cards, `createMcpSkill` for the relevance half), memory seam
(`MemoryStore` + context source + `remember` tool), retrieval seam (`Retriever`
+ cited-evidence context source + lexical reference impl), skills, context
assembly, tools + presets, 20 card kinds, React bindings, UI kit, dev panels.

Also built: an **app-state seam** (the agent reads and operates host
application state through the same context-source and tool machinery), a REST
`ThreadStore` alongside the memory and localStorage ones, and **provider-native
tool passthrough** (web search, code interpreter — declared per provider, their
activity surfaced in the transcript).

**Not built yet:** a Gemini adapter, and voice / image generation (out of scope
for a framework — they belong to the host's own product surface).

Prior art read closely: Open WebUI's tools/functions/knowledge split, LibreChat's
multi-provider handling, and the Sup Wallet agent in `zzyzx-full-repo` — whose
provider-resolve indirection, preset allowlists and alias-matched skills are the
direct ancestors of three subsystems here, and whose card-dispatch chain (and the
warning comment above it) motivated the registry design in the fourth.

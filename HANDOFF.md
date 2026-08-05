# Handoff

Written 2026-08-04, at the end of the session that built this. For whoever picks
it up next — probably a future me with no memory of any of it.

Read this before `README.md`. The README says what the framework *is*; this says
what you need to know to *change it safely*.

---

## Orientation, in 60 seconds

```
packages/core     the whole engine. isomorphic, no React, no LLM SDK.
packages/react    hooks over an AgentClient store. thin.
packages/ui       card renderers + chat primitives + context inspector.
apps/playground   Next.js dev panels. runs with NO API key.
```

```bash
pnpm install && pnpm build && pnpm dev     # → http://localhost:3210
pnpm test                                  # 237 tests, ~3s
```

The playground is **not a product**. It is six panels, one per capability, aimed
at a developer evaluating the framework: `/cards` `/skills` `/tools` `/requests`
`/run`. That framing was an explicit instruction — don't quietly turn it back
into an app.

**Naming**: the repo is `SuperChat`, the packages are `@agentloom/*`. That split
is unresolved — nobody has decided whether the framework keeps the agentloom name.
Ask before renaming; it touches every import.

---

## The load-bearing decisions

These were chosen deliberately, some of them against the obvious alternative.
Changing one is fine — reversing it *by accident* is not.

**Hand-rolled provider adapters, no Vercel AI SDK.** The explicit ask was to own
the request shape. `packages/core/src/providers/openai/map-in.ts` is the heart of
the project. Two builders, sharing no object literals, because Responses and Chat
Completions disagree about nearly every field and conflating them is the single
largest source of 400s. If you ever feel like factoring out "the common parts",
read the comparison table at the top of `wire.ts` first.

**Transport is a seam, not a config flag.** The adapter never holds a credential;
it describes a call and hands it to a `Transport`. That is why the same adapter
code runs server-proxied, BYOK-direct, and against a scripted demo. It is also
what makes `apps/playground/src/agent/demo-transport.ts` an honest demo rather
than a mock — it replaces the network and nothing else.

**Context is derived, never accumulated.** `ContextBuilder.build()` runs fresh
every turn and emits a `ContextTrace` recording why each layer was included,
truncated or dropped. Determinism matters here: same inputs must produce the same
request, or prompt caching never hits.

**Presets are allowlists.** A newly registered tool is invisible until someone
puts it in one. Do not "improve" this into a denylist.

**Cards register validator + renderer together.** `BUILTIN_CARDS` (core) and
`BUILTIN_RENDERERS` (ui) are asserted equal by
`packages/ui/src/cards/registry-sync.test.ts`. This exists because the reference
implementation kept them in two hand-maintained lists and a card that had a
parser but no render branch silently degraded to a "ran ✓" chip in production.
Adding a kind means editing both; the test will tell you if you forgot.

---

## Bugs already found and fixed — do not reintroduce

Every one of these was caught by driving the real UI, not by reading code. Each
has a regression test now; the test names spell out the failure.

1. **Human-in-the-loop deadlock.** `awaiting-user` was collected into an array
   and yielded *after* tool execution finished. But execution waits on the user,
   who waits to see the card. Fixed with `runtime/channel.ts`, drained
   concurrently. The original test passed only because its responder resolved
   immediately — the new one refuses to answer until it has observed the event.

2. **Skills could escalate privilege.** A matched skill's `allow` list bypassed
   preset gating entirely, so any skill could hand out the executor tier just by
   naming a tool. Now: a tool with *no* preset is skill-gated (private until a
   skill surfaces it); a tool *with* a preset still requires that preset.
   Skills grant relevance; presets grant authority.

3. **`withCard()` was a dead path.** Tools can attach a card three ways — the
   explicit `card` field, `withCard()` embedding, or `ctx.emitCard()` — and
   `executeToolCall` only checked the first. Cards from the other two never
   appeared.

4. **Card payloads were re-billed every step.** Stripping happened only when the
   *next* turn rebuilt context, so within one multi-step turn every chart spec
   was resent. Now stripped before each provider call, while the event keeps the
   full payload for the UI.

5. **Interactive cards rendered twice.** `requestCard` surfaces the card, then
   the tool returned it *again* as `result.card` with a fresh id.

6. **Compaction discarded the summary it had just paid for.** A secondary trim
   walks newest-first, so the summary (oldest) went first. It is pinned now.

7. **SSE decoder state was module-level**, so two concurrent streams would
   interleave into garbage. Per-instance now.

---

## Things that will bite you

- **`.next` and `dist` are shared with the dev server.** Running `next build`
  while `next dev` is live corrupts the running server and the page goes blank.
  Stop the server first.
- **`tsup --clean` wipes `dist` on every rebuild.** That is why
  `@agentloom/ui`'s `styles.css` export points at `src/`, not `dist/` — a
  consuming dev server that compiles during the wipe fails on a missing
  stylesheet. Don't "tidy" it back into dist.
- **Next's webpack does not resolve `.js` specifiers to `.ts`** in app source.
  Inside `apps/playground/src`, import without the extension. The workspace
  packages are fine because they resolve to built `dist`.
- **Typecheck order matters.** `packages/react` and `packages/ui` resolve
  `@agentloom/core` through its built `dist`, so build core before typechecking
  them. `pnpm -r typecheck` after `pnpm build` is the safe order.
- **G: is slow.** Scope searches; avoid unscoped recursive `find`/`du` here.
- The one thing verified only by DOM inspection, never visually: the browser pane
  was unavailable this whole session, so **nobody has actually looked at these
  panels**. Layout and spacing are unreviewed. Open it before trusting the visual
  design.

---

## Domain neutrality is a requirement, not a preference

This nearly went wrong and is easy to get wrong again.

The user's pipeline includes legal, marketing and "超多領域". An early draft was
built entirely around market data, and the tell was subtle: the *card kinds* were
generic, but each kind's one-line `summary` said things like "portfolio totals",
"holdings", and — for `choice` option metadata — "APR, price, size".

**Those summaries are what the model reads when choosing a card.** Not the
schemas. Industry vocabulary there skews every agent built on the kit toward that
industry. If you add a card kind, write its summary with no domain nouns in it.

The 20 kinds are grouped in `cards/builtin.ts` by what they *do*: structured data,
quantitative shape, sequence and state, prose and evidence, interactive. The
demo agent covers contract review, marketing analytics and market data through
one registry — keep it that way; it is the proof that the machinery is neutral.

`comparison` (options × criteria) is the most portable kind and the one to reach
for first. `citations` matters specifically for agents: it is what lets a reader
check the work instead of trusting a summary.

---

## Where to pick up

Since the original handoff, the roadmap items were built (file upload, thread
persistence + branching, MCP import + elicitation, the Anthropic adapter, the
memory and retrieval seams — see README's Status section), and an integration
audit fixed the seams that existed but didn't connect (loadSkill unlock,
updateCard upsert, shared playground registry, thread-switch generation guard,
job-resume routing, foreign-file degrade). What remains:

Nothing on the previous roadmap is outstanding — concurrent proxy streaming now
has a test, the REST `ThreadStore` ships, provider-native tools pass through,
and the app-state seam landed. What is genuinely open:

1. **A third provider (Gemini).** Two adapters proved the normalized content
   model holds; a third is now routine rather than risky.
2. **Nobody has driven the app-state panel against a live model.** The demo
   transport is scripted, so the board actions are exercised by tests and by
   hand — not by an actual model deciding to call them.
3. **The `agentloom` / `SuperChat` naming split is still unresolved** (see
   below). It touches every import; ask before renaming.

Deliberately *not* done, and worth leaving alone unless asked: multi-agent
orchestration, a plugin system, and any kind of visual builder. The framework's
value is that it is a library with sharp edges in the right places.

---

## Reference material

The Sup Wallet agent at `G:/GitHub/zzyzx-full-repo/Protocols/sup-wallet/apps/web/src/lib/agent/`
is the closest prior art and worth rereading if you are changing the registry,
skills, or card dispatch. What was taken from it: provider-resolve as a single
source of truth, explicit preset allowlists, alias-matched retrievable skills,
`CardBoundary` isolation, and the rule that actionable cards must never be
collapsed ("a hidden deposit form is an unreachable deposit form").

What was deliberately *not* taken: its card dispatch is a hand-maintained
if-chain, and its own comments record the cost. That motivated the registry
design here.

Also read, for landscape rather than code: Open WebUI's tools/functions/knowledge
split, and LibreChat's multi-provider handling.

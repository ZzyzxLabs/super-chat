# @zzyzxlabs/super-chat-ui

Card renderers and chat primitives for [@zzyzxlabs/super-chat-core](../core/README.md) +
[@zzyzxlabs/super-chat-react](../react/README.md). Ships a self-contained plain-CSS
baseline — no Tailwind, no preprocessor, no build step imposed on the host.

Part of the [superchat](../../README.md) monorepo. Design tokens, breakpoints,
theming and the full component spec live in
[../../docs/UI-SPEC.md](../../docs/UI-SPEC.md); load-bearing decisions are in
[../../docs/HANDOFF.md](../../docs/HANDOFF.md).

## What's in here

- `Thread.tsx` — the main chat surface: message list, composer, live streaming turn.
- `cards/` — one renderer per built-in card kind (table, chart, funnel, diff, confirm, …), registered in `cards/index.ts` and validated against `@zzyzxlabs/super-chat-core`'s `BUILTIN_CARDS` (`cards/registry-sync.test.ts` keeps the two in sync).
- `renderer-registry.tsx` — the `CardRenderer` dispatch + provider for host-supplied renderer overrides.
- `ContextInspector.tsx` — renders a context-build trace (what was included/truncated/dropped and why).
- `markdown.ts`, `format.ts`, `export.ts` — supporting utilities for message rendering and card export.
- `styles.css` — the token baseline. Import it from source (`@zzyzxlabs/super-chat-ui/styles.css`), not from `dist`.

## Install

```bash
pnpm add @zzyzxlabs/super-chat-core @zzyzxlabs/super-chat-react @zzyzxlabs/super-chat-ui
```

```ts
import "@zzyzxlabs/super-chat-ui/styles.css";
```

## Develop

```bash
pnpm --filter @zzyzxlabs/super-chat-ui build       # tsup, emits dist/
pnpm --filter @zzyzxlabs/super-chat-ui typecheck   # tsc --noEmit
pnpm vitest run packages/ui             # unit tests (jsdom — no real layout)
pnpm test:rwd                           # Playwright — real layout at 360/390/768/1280px
```

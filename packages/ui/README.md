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
- `mobile-agent` — framework-neutral action, model-selection and Orb motion
  contracts for native ports. It has no DOM, React Native or animation-library
  dependency; see [MOBILE-AGENT.md](MOBILE-AGENT.md).

## Install

```bash
pnpm add @zzyzxlabs/super-chat-core @zzyzxlabs/super-chat-react @zzyzxlabs/super-chat-ui
```

```ts
import "@zzyzxlabs/super-chat-ui/styles.css";
```

Native hosts should import only the portable contract entry:

```ts
import {
  SUPERCHAT_MOBILE_AGENT_ACTIONS,
  SUPERCHAT_MOBILE_AGENT_ORB,
} from "@zzyzxlabs/super-chat-ui/mobile-agent";
```

## Develop

```bash
pnpm --filter @zzyzxlabs/super-chat-ui build       # tsup, emits dist/
pnpm --filter @zzyzxlabs/super-chat-ui typecheck   # tsc --noEmit
pnpm vitest run packages/ui             # unit tests (jsdom — no real layout)
pnpm test:rwd                           # Playwright — real layout at 360/390/768/1280px
```

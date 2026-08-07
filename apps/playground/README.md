# @superchat/playground

Next.js 15 dev panels for the [superchat](../../README.md) monorepo — each
route isolates one capability so you can see what's available without reading
the source. Runs with **no API key**: a scripted demo transport
(`src/agent/demo-transport.ts`) replaces the network while the real adapter,
runtime, tools and context builder do the actual work.

| route | panel |
| --- | --- |
| `/` | Overview — what's in the box |
| `/cards` | All 20 card kinds, each beside the spec that produced it |
| `/agent-ui` | Agent surfaces — thinking, orbs, composer |
| `/skills` | Live match scoring, and the context a query assembles |
| `/tools` | Schemas, preset gating, the exposed set changing as you toggle |
| `/requests` | One request rendered into both wire dialects, side by side |
| `/app-state` | The agent reading and driving host application state |
| `/run` | A live turn with the raw event stream and context trace beside it |

`src/agent/` holds the demo agent's setup, tools, and skills — one registry
covering contract review, marketing analytics and market data, so `/run`
shows different skills/tools loading per message through identical machinery.

## Run it

```bash
pnpm install && pnpm build   # build the workspace packages first — this app imports their dist output
pnpm dev                     # from the repo root, or: pnpm --filter @superchat/playground dev
```

For a live model instead of the scripted demo transport, add `OPENAI_API_KEY`
to `.env.local` (see `.env.example`) and switch the transport selector to
**Server proxy**, or pick **BYOK direct** and paste a key in the browser.

See [../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing design
decisions and [../../docs/UI-SPEC.md](../../docs/UI-SPEC.md) for the design spec.

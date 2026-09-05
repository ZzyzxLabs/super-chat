# Mobile Agent port contract

`@zzyzxlabs/super-chat-ui/mobile-agent` is the framework-neutral source of
truth for native Agent ports. It contains data and pure helpers only; it does
not render DOM or React Native views and does not require an animation library.

```ts
import {
  SUPERCHAT_MOBILE_AGENT_ACTIONS,
  SUPERCHAT_MOBILE_AGENT_ORB,
  SUPERCHAT_MOBILE_AGENT_ORB_ACTIVITY,
  resolveSuperChatMobileAgentModel,
} from "@zzyzxlabs/super-chat-ui/mobile-agent";
```

Native hosts own typography, icons, safe-area handling, localization and the
actual controls. The contract owns these cross-platform semantics:

- stable action ids and when an action is meaningful;
- model rows with a primary label plus optional provider, description and
  context metadata;
- listening (`C2`), streaming (`C3`) and analyzing (`C4`) Orb assignments;
- the exact 28px reference geometry, durations, easing, keyframes, per-dot
  phase and reduced-motion resting frame for those Orbs.

An unsupported action should be omitted. If a product needs to advertise a
future capability, render it explicitly disabled with a visible status; never
ship a control whose tap has no result. Model lists remain host-supplied and
the selected-model fallback is exact id first, then the first available model.

For React Native, drive one linear shared clock for an Orb cycle, apply each
keyframe's easing only within its interval, and stop on the provided
`reducedMotionOpacity` frame when reduced motion is enabled. The contract is
small enough to mirror into a native repository; keep a parity test against
this entry if the native app cannot consume the package directly.

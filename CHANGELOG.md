# Changelog

## Unreleased

### Performance

- **core:** `parseSSE` and `parseSSEJson` no longer rescan a partial line each
  time a chunk arrives, so a long line costs time linear in its length. A 5 MB
  `data:` line (a base64 image) in 16 KB chunks: 3.3 s → 26 ms on Bun,
  2.4 s → 17 ms on Node. Events, the reads they follow and errors are
  unchanged.
- **core:** `bytesToBase64` and `base64ToBytes` hand the work to the platform
  codec (`Uint8Array` `toBase64` / `fromBase64` where the runtime has them,
  else `btoa` / `atob`) instead of a per-byte loop. 20 MB encode: 325 ms →
  7 ms on Bun, 1 s → 82 ms on Node; decode: 42 ms → 8 ms on Bun, 132 ms →
  43 ms on Node. Output and error messages are unchanged, including for input
  that is not a `Uint8Array`.

## 0.3.0

### Changed

- **core:** When a step runs tools in parallel, `runAgent` now sends each
  `tool-result` as soon as its tool finishes, in completion order. Before this,
  every result in the step was held until the slowest tool finished. Match
  results to calls by `callId`, not by position.
- **core:** The `role: "tool"` message written back to history still keeps
  call order. `confirm` tools still run one at a time after the parallel ones.
- **core:** `executeToolCalls` accepts `onOutcome`, called once per call as it
  settles, including failures and timeouts. The returned array stays in call
  order.
- **core:** A tool that has already timed out can no longer emit cards or ask
  the user a question. Anything it surfaced would have arrived after its own
  result.
- **react:** `AgentClient` commits a turn's tool results in call order, while
  live run state still shows them as they finish.

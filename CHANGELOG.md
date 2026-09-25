# Changelog

## Unreleased

### Performance

- **react:** `useBranches` reads each message's sibling position from one
  index per tree, shared by every `BranchNav`, instead of scanning the whole
  tree once per message on every store notify. Per streamed token, with a
  `BranchNav` on each message of the active path: 337-message thread
  8–46 ms -> 0.01–0.07 ms; 2,000 messages 0.4–0.9 s -> 0.13–0.3 ms. A notify
  that brings a new tree builds the index once (0.06–0.5 ms at 337). Positions
  and counts are unchanged for every change `AgentClient` makes. The index is
  keyed by the `tree` array, so `ThreadState.tree` must be replaced, never
  mutated in place: a host that edits the array, or a message's `id` or
  `parentId`, through `client.store` sees stale branch positions until the
  next replacement.

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

# Changelog

## Unreleased

### Performance

Timings are bun medians on a desktop shared with other jobs. Absolute times
moved by as much as 3.5x between runs; every speedup reproduced.

- **core:** `applyEdits` splices every edit into the document in one pass.
  It used to re-slice the rewritten document once per edit, so the cost grew
  with edits × length: on a 1 MB document, 200 block-scoped edits went from
  176 ms to 20 ms and 1,000 from 579 ms to 28 ms. Results are the same for any
  edit whose `find` is a string.
- **core:** `searchBlocks` splits the document once instead of twice and builds
  outline entries only for the blocks that match: 65 ms to 40 ms on a 2 MB
  document. Results are unchanged.
- **core:** `repairToolArguments` no longer rebuilds malformed arguments a
  character at a time, builds each repair only once the one before it has
  failed, and skips parses that cannot succeed: 1 MB of `createDocument`
  arguments with a trailing comma went from 410 ms to 7 ms. A long run of
  whitespace anywhere in the arguments, raw newlines included, no longer makes
  the closing-fence check quadratic (40,000 spaces: 0.7 s to 0.14 ms; 40,000
  newlines: 0.8 s to 1.8 ms). Results are unchanged.

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

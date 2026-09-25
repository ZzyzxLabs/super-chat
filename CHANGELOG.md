# Changelog

## Unreleased

### Performance

- **ui:** `DiffCardView` finds its line diff with a bounded Myers search
  instead of filling an n × m table. Two 2000-line texts with 5% of lines
  changed: 30 ms → 0.38 ms and 34 MB → 1.5 MB peak; two unrelated 2000-line
  texts: 20 ms → 0.8 ms. Where the search gives up (a reordered file), the
  old table walk runs over only the lines both sides share: a shuffled
  2000-line file, 27 ms → 11 ms and 34 MB → 15 MB. The rows are the same as
  before for every input.
- **ui:** `LiveTurn` no longer re-renders the whole answer's markdown every
  frame while it streams: blocks later text can no longer change are kept
  from earlier frames, and only the open tail is rendered again. An 80 KB
  answer: 9.9 ms → 0.06 ms per frame, 5.2 s → 0.13 s over a 1200-frame
  stream. The HTML is identical to rendering the whole text; the browser's
  own DOM update per frame is unchanged.

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

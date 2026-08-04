// The renderer map that pairs with core's BUILTIN_CARDS.
//
// Kept adjacent to the definitions on purpose: adding a card kind means editing
// core's BUILTIN_CARDS and this map, and the test in cards.test.ts asserts the
// two stay in sync — which is the guardrail against a card that validates but
// has nowhere to render.

import type { CardRendererMap } from "../renderer-registry.js";
import {
  CodeCardView,
  DiffCardView,
  KeyValueCardView,
  MarkdownCardView,
  MediaCardView,
  ProgressCardView,
  StatsCardView,
  TableCardView,
  TimelineCardView,
} from "./Basic.js";
import { ChartCardView } from "./Chart.js";
import {
  CalloutCardView,
  ChecklistCardView,
  CitationsCardView,
  ComparisonCardView,
  FunnelCardView,
  GaugeCardView,
  TreeCardView,
} from "./General.js";
import { ChoiceCardView, ConfirmCardView, FormCardView } from "./Interactive.js";

export const BUILTIN_RENDERERS: CardRendererMap = {
  table: TableCardView as CardRendererMap[string],
  stats: StatsCardView as CardRendererMap[string],
  comparison: ComparisonCardView as CardRendererMap[string],
  keyvalue: KeyValueCardView as CardRendererMap[string],
  tree: TreeCardView as CardRendererMap[string],
  chart: ChartCardView as CardRendererMap[string],
  funnel: FunnelCardView as CardRendererMap[string],
  gauge: GaugeCardView as CardRendererMap[string],
  timeline: TimelineCardView as CardRendererMap[string],
  progress: ProgressCardView as CardRendererMap[string],
  checklist: ChecklistCardView as CardRendererMap[string],
  markdown: MarkdownCardView as CardRendererMap[string],
  callout: CalloutCardView as CardRendererMap[string],
  citations: CitationsCardView as CardRendererMap[string],
  code: CodeCardView as CardRendererMap[string],
  diff: DiffCardView as CardRendererMap[string],
  media: MediaCardView as CardRendererMap[string],
  choice: ChoiceCardView as CardRendererMap[string],
  form: FormCardView as CardRendererMap[string],
  confirm: ConfirmCardView as CardRendererMap[string],
};

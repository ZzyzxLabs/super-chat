import Link from "next/link";
import { BUILTIN_CARDS } from "@zzyzxlabs/super-chat-core";
import { PanelHeader } from "@/components/Shell";

const RESOURCES = [
  {
    href: "/cards",
    title: "Agent cards",
    body: "20 built-in card kinds the agent can choose from — tables, comparisons, funnels, gauges, citations, checklists, trees, and three interactive kinds that pause the run for an answer. Each shown with the spec that produced it.",
    tag: "@zzyzxlabs/super-chat-core + /ui",
  },
  {
    href: "/skills",
    title: "Skills",
    body: "Retrievable operating knowledge with three delivery modes: always-on, matched by relevance, or pulled on demand by the model. Type a query and watch the scoring decide what enters context.",
    tag: "SkillRegistry",
  },
  {
    href: "/tools",
    title: "Tools & presets",
    body: "The tool registry with explicit capability allowlists. See every tool's JSON Schema, which presets grant it, and what the model is actually shown for a given preset selection.",
    tag: "ToolRegistry",
  },
  {
    href: "/requests",
    title: "Wire requests",
    body: "The same normalized request rendered into both OpenAI dialects, side by side. This is where the framework earns its keep — the two shapes disagree about almost everything.",
    tag: "providers/openai",
  },
  {
    href: "/run",
    title: "Run & events",
    body: "A live agent turn with the raw RunEvent stream beside it. Tool calls, card emission, human-in-the-loop suspension and context assembly, as they happen.",
    tag: "runAgent()",
  },
];

const FACTS = [
  ["Provider adapters", "Hand-rolled. OpenAI Responses + Chat Completions, no LLM SDK."],
  ["Async", "Background mode as a first-class run mode, polled and resumable across reloads."],
  ["Transport", "Pluggable. Server-proxy by default; BYOK-direct and scripted-demo also ship."],
  ["Context", "Rebuilt every turn under a token budget, with an inspectable trace."],
  ["Card kinds", `${BUILTIN_CARDS.length} built in, ${BUILTIN_CARDS.filter((c) => c.interactive).length} of them interactive.`],
  ["Tests", "105, including the full runtime driven against a mocked transport."],
];

export default function OverviewPanel() {
  return (
    <div className="dev__page">
      <PanelHeader title="superchat">
        A frontend framework for agent services. It assembles contexts, skills and I/O content into requests that are
        correct on the wire for each provider, and gives the agent a visual vocabulary to answer with. These panels
        show what is available, one capability at a time — nothing here is a finished product.
      </PanelHeader>

      <div className="dev__grid">
        {RESOURCES.map((r) => (
          <Link key={r.href} href={r.href} className="dev__tile">
            <h3>{r.title}</h3>
            <p>{r.body}</p>
            <p style={{ marginTop: 8 }}>
              <code className="sc-mono">{r.tag}</code>
            </p>
          </Link>
        ))}
      </div>

      <section className="dev__section">
        <h2 className="dev__section-title">At a glance</h2>
        <p className="dev__section-note">
          The framework is domain-neutral. The demo agent in these panels covers contract review, marketing analytics
          and market data through the same registry — different skills and tools, identical machinery.
        </p>
        <dl className="sc-kv">
          {FACTS.map(([k, v]) => (
            <div key={k} className="sc-kv__row">
              <dt>{k}</dt>
              <dd style={{ textAlign: "left", maxWidth: "62ch" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Install</h2>
        <pre className="sc-pre">{`pnpm add @zzyzxlabs/super-chat-core @zzyzxlabs/super-chat-react @zzyzxlabs/super-chat-ui`}</pre>
        <p className="dev__section-note" style={{ marginTop: 12 }}>
          Core is isomorphic and React-free. React and UI are optional — a server-side agent needs only core.
        </p>
      </section>
    </div>
  );
}

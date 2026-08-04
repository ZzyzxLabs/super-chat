"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, AgentProvider, useAgentState, useThread } from "@agentloom/react";
import { BUILTIN_RENDERERS, CardRendererProvider, ContextInspector, Composer, Thread } from "@agentloom/ui";
import type { RunEvent, RunMode } from "@agentloom/core";
import {
  MODELS,
  buildContextBuilder,
  buildProvider,
  buildToolRegistry,
  buildTransport,
  jobStore,
  type TransportMode,
} from "@/agent/setup";

const EXAMPLES = [
  { title: "Legal — clause review", prompt: "Review the Vertex MSA for liability exposure." },
  { title: "Legal — sourced answer", prompt: "Can we exclude liability entirely in our standard terms?" },
  { title: "Marketing — funnel", prompt: "Where are we losing people in the signup funnel?" },
  { title: "Marketing — positioning", prompt: "How do we compare against Northwind and Acme?" },
  { title: "Markets — chart", prompt: "Show me SUI price action over the last 60 days." },
  { title: "Interactive — confirm", prompt: "Set an alert for when SUI goes above $5." },
  { title: "Manual skill", prompt: "Do a deep research pass on the market structure." },
];

export default function RunPanel() {
  const [transportMode, setTransportMode] = useState<TransportMode>("demo");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODELS[0]!);
  const [mode, setMode] = useState<RunMode>("stream");
  const [presets, setPresets] = useState<string[]>(["observer", "executor"]);

  const tools = useMemo(() => buildToolRegistry(), []);
  const contextBuilder = useMemo(() => buildContextBuilder(), []);

  const client = useMemo(() => {
    const effective = transportMode === "direct" && !apiKey.trim() ? "demo" : transportMode;
    return new AgentClient({
      provider: buildProvider(buildTransport(effective, apiKey || undefined)),
      model,
      contextBuilder,
      tools,
      toolResolution: { presets },
      mode,
      maxSteps: 8,
      jobStore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportMode, transportMode === "direct" ? apiKey : "static"]);

  useEffect(() => {
    client.configure({ model, mode, toolResolution: { presets } });
  }, [client, model, mode, presets]);

  return (
    <AgentProvider client={client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS}>
        <div className="dev__run">
          <div className="dev__runmain">
            <div className="dev__runbar">
              <select className="dev__select" value={transportMode} onChange={(e) => setTransportMode(e.target.value as TransportMode)}>
                <option value="demo">Demo transport</option>
                <option value="proxy">Server proxy</option>
                <option value="direct">BYOK direct</option>
              </select>
              {transportMode === "direct" ? (
                <input className="dev__select" type="password" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              ) : null}
              <select className="dev__select" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select className="dev__select" value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
                <option value="stream">stream</option>
                <option value="sync">sync</option>
                <option value="background">background</option>
              </select>
              {(["observer", "executor"] as const).map((p) => (
                <label key={p} className="dev__toggle">
                  <input
                    type="checkbox"
                    checked={presets.includes(p)}
                    onChange={(e) => setPresets((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))}
                  />
                  {p}
                </label>
              ))}
              <ClearButton />
            </div>

            {transportMode === "demo" ? (
              <p className="dev__banner">
                Demo transport: replies are scripted, but everything below the provider is real — request building, the
                tool loop, card suspension and context assembly. Switch to proxy or BYOK for a live model.
              </p>
            ) : null}

            <Thread empty={<Examples />} />
            <Composer placeholder="Ask about a contract, a funnel, or a market…" />
          </div>

          <aside className="dev__runside">
            <EventStream />
            <ContextInspector />
          </aside>
        </div>
      </CardRendererProvider>
    </AgentProvider>
  );
}

function ClearButton() {
  const { clear, messages, isRunning } = useThread();
  return (
    <button type="button" className="al-btn al-btn--ghost al-btn--sm" disabled={!messages.length || isRunning} onClick={clear}>
      Clear
    </button>
  );
}

function Examples() {
  const { send } = useThread();
  return (
    <div className="dev__prompts">
      <p className="al-muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        One agent, three unrelated domains. Which skill loads — and which tools it unlocks — is decided per message by
        the registry, not by which app you opened.
      </p>
      {EXAMPLES.map((e) => (
        <button key={e.title} type="button" className="dev__prompt" onClick={() => void send(e.prompt)}>
          <strong>{e.title}</strong>
          <span>{e.prompt}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The raw event stream.
 *
 * Included because the events ARE the runtime's public API — React state, a CLI
 * renderer and a server-side recorder are all reducers over this one stream, and
 * a developer evaluating the framework needs to see its shape.
 */
function EventStream() {
  const run = useAgentState((s) => s.run);
  const [events, setEvents] = useState<{ type: string; detail: string }[]>([]);
  const seen = useRef(0);

  // Derive a readable log from run state transitions. (A host wanting the true
  // stream just consumes runAgent() directly — this panel reconstructs it so the
  // demo needn't fork the client.)
  useEffect(() => {
    const next: { type: string; detail: string }[] = [];
    if (run.trace) next.push({ type: "context-built", detail: `${run.trace.totals.total} tok · ${run.trace.entries.length} layers` });
    for (const p of run.parts) {
      if (p.type === "tool-call") next.push({ type: "tool-call", detail: `${p.name}(${JSON.stringify(p.input).slice(0, 46)}…)` });
      if (p.type === "tool-result") next.push({ type: "tool-result", detail: `${p.name}${p.failure ? ` · ${p.failure}` : ""}` });
    }
    for (const c of run.cards) next.push({ type: "card", detail: (c.spec as { kind?: string }).kind ?? "?" });
    if (run.pendingCard) next.push({ type: "awaiting-user", detail: (run.pendingCard.spec as { kind?: string }).kind ?? "?" });
    if (run.job) next.push({ type: "job-status", detail: `${run.job.handle.id.slice(0, 14)}… ${run.job.status}` });
    if (run.usage.totalTokens) next.push({ type: "usage", detail: `${run.usage.totalTokens} tok total` });
    if (run.status === "done") next.push({ type: "run-finish", detail: `${run.finishReason} · ${run.steps} step(s)` });
    setEvents(next);
    seen.current = next.length;
  }, [run]);

  const cls = (t: string) =>
    t.startsWith("tool") ? "tool" : t === "card" ? "card" : t === "awaiting-user" ? "user" : t === "error" ? "error" : "";

  return (
    <div className="dev__events">
      <div className="al-panel__title">Run events</div>
      {events.length === 0 ? (
        <p className="al-muted" style={{ fontSize: 12 }}>
          Send a message to see the event stream.
        </p>
      ) : (
        events.map((e, i) => (
          <div key={i} className={`dev__event dev__event--${cls(e.type)}`}>
            <span className="dev__event-dot" aria-hidden />
            <span className="dev__event-body">
              {e.type}
              <div className="dev__event-detail">{e.detail}</div>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

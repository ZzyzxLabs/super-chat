"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, AgentProvider, useAgentState, useThread, useThreadList } from "@agentloom/react";
import { BUILTIN_RENDERERS, CardRendererProvider, ContextInspector, Composer, Thread } from "@agentloom/ui";
import type { RunEvent, RunMode, StoredFile } from "@agentloom/core";
import {
  MODELS,
  buildContextBuilder,
  buildProvider,
  buildToolRegistry,
  buildTransport,
  fileStore,
  jobStore,
  threadStore,
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

  const [attachments, setAttachments] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const pendingFiles = useRef<StoredFile[]>([]);

  const tools = useMemo(() => buildToolRegistry(), []);
  const contextBuilder = useMemo(() => buildContextBuilder(), []);

  const provider = useMemo(() => {
    const effective = transportMode === "direct" && !apiKey.trim() ? "demo" : transportMode;
    return buildProvider(buildTransport(effective, apiKey || undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportMode, transportMode === "direct" ? apiKey : "static"]);

  const client = useMemo(() => {
    const c = new AgentClient({
      provider,
      model,
      contextBuilder,
      tools,
      toolResolution: { presets },
      mode,
      maxSteps: 8,
      jobStore,
      threadStore,
    });
    // Splice pending attachments into the next send. The ui Composer passes
    // text only; the client's send already accepts ContentPart[], so the panel
    // wraps the instance rather than forking the Composer.
    const plainSend = c.send.bind(c);
    c.send = (input) => {
      const attached = pendingFiles.current.splice(0);
      setAttachments([]);
      if (attached.length && typeof input === "string") {
        return plainSend([
          { type: "text", text: input },
          ...attached.map((f) => ({
            type: "file" as const,
            source: f.ref,
            mediaType: f.mediaType ?? "application/octet-stream",
            filename: f.filename,
          })),
        ]);
      }
      return plainSend(input);
    };
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const pickFile = async (picked: File | undefined) => {
    if (!picked || !provider.uploadFile) return;
    setUploading(true);
    try {
      const ref = await provider.uploadFile({
        data: picked,
        filename: picked.name,
        ...(picked.type ? { mediaType: picked.type } : {}),
      });
      const stored: StoredFile = {
        ref,
        filename: picked.name,
        ...(picked.type ? { mediaType: picked.type } : {}),
        sizeBytes: picked.size,
        createdAt: Date.now(),
      };
      void fileStore.put(stored);
      pendingFiles.current.push(stored);
      setAttachments((prev) => [...prev, stored]);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    client.configure({ model, mode, toolResolution: { presets } });
  }, [client, model, mode, presets]);

  // Reopen the live thread whenever the client is rebuilt (reload, transport
  // switch) — before this, both silently discarded the conversation.
  const lastThreadId = useRef<string | null>(null);
  useEffect(() => {
    const unsub = client.store.subscribe(() => {
      lastThreadId.current = client.store.get().id;
    });
    void (async () => {
      const target = lastThreadId.current ?? (await threadStore.list())[0]?.id;
      if (target && target !== client.store.get().id) await client.openThread(target);
    })();
    return unsub;
  }, [client]);

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
              <label className="al-btn al-btn--ghost al-btn--sm" title="Attach a file (uploaded once, referenced by id)">
                {uploading ? "Uploading…" : "📎 Attach"}
                <input
                  type="file"
                  style={{ display: "none" }}
                  disabled={uploading}
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    e.target.value = "";
                    void pickFile(picked);
                  }}
                />
              </label>
              <ClearButton />
            </div>

            {attachments.length ? (
              <div className="dev__prompts" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {attachments.map((f) => (
                  <span key={f.ref.id} className="al-btn al-btn--ghost al-btn--sm" title={f.ref.id}>
                    📄 {f.filename}
                    <button
                      type="button"
                      className="al-btn al-btn--ghost al-btn--sm"
                      aria-label={`Remove ${f.filename}`}
                      onClick={() => {
                        pendingFiles.current = pendingFiles.current.filter((p) => p.ref.id !== f.ref.id);
                        setAttachments((prev) => prev.filter((p) => p.ref.id !== f.ref.id));
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

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
            <ThreadsPanel />
            <EventStream />
            <ContextInspector />
          </aside>
        </div>
      </CardRendererProvider>
    </AgentProvider>
  );
}

/**
 * The thread picker — the ThreadStore demo. Snapshot-per-thread in
 * localStorage: reload the page and the conversation is still here.
 */
function ThreadsPanel() {
  const { threads, activeId, open, create, remove } = useThreadList();
  const { isRunning } = useThread();

  return (
    <div className="dev__events">
      <div className="al-panel__title">
        Threads
        <button
          type="button"
          className="al-btn al-btn--ghost al-btn--sm"
          style={{ float: "right" }}
          disabled={isRunning}
          onClick={create}
        >
          + New
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="al-muted" style={{ fontSize: 12 }}>
          Threads persist to localStorage as you chat.
        </p>
      ) : (
        threads.map((t) => (
          <div key={t.id} className="dev__event" style={{ alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="al-btn al-btn--ghost al-btn--sm"
              style={{ flex: 1, textAlign: "left", ...(t.id === activeId ? { fontWeight: 600 } : {}) }}
              disabled={isRunning}
              onClick={() => void open(t.id)}
              title={t.id}
            >
              {t.title ?? "(untitled)"}
              <span className="al-muted" style={{ display: "block", fontSize: 11 }}>
                {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
              </span>
            </button>
            <button
              type="button"
              className="al-btn al-btn--ghost al-btn--sm"
              aria-label={`Delete ${t.title ?? t.id}`}
              disabled={isRunning}
              onClick={() => void remove(t.id)}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
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

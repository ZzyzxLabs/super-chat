"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, AgentProvider, useAgentClient, useAgentState, useAttachments, useJobs, useThread, useThreadList } from "@agentloom/react";
import { BUILTIN_RENDERERS, CardRendererProvider, ContextInspector, Composer, Thread } from "@agentloom/ui";
import type { RunEvent, RunMode, StoredFile } from "@agentloom/core";
import {
  MODELS,
  buildContextBuilder,
  buildProvider,
  buildTransport,
  fileStore,
  jobStore,
  threadStore,
  toolRegistry,
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

  // The SHARED registry singleton — tools imported on /tools are callable here.
  const tools = toolRegistry;
  const contextBuilder = useMemo(() => buildContextBuilder(), []);

  // BYOK with an empty key falls back to demo — track that as a VISIBLE fact,
  // not a silent one, so nobody attaches a demo-minted file id believing it is
  // real.
  const effectiveMode: TransportMode = transportMode === "direct" && !apiKey.trim() ? "demo" : transportMode;

  const provider = useMemo(() => {
    return buildProvider(buildTransport(effectiveMode, apiKey || undefined), effectiveMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportMode, transportMode === "direct" ? apiKey : "static"]);

  const client = useMemo(() => {
    return new AgentClient({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  /** Upload (or reuse a previous upload of the same file) and stage the part. */
  const attachFile = async (picked: File) => {
    if (!provider.uploadFile) return;
    // Dedup: the same filename+size already uploaded to THIS provider means
    // "reference the existing id", not "mint a second one".
    const prior = (await fileStore.list()).find(
      (f) => f.filename === picked.name && f.sizeBytes === picked.size && f.ref.provider === provider.id,
    );
    const stored: StoredFile =
      prior ??
      (await (async () => {
        const ref = await provider.uploadFile!({
          data: picked,
          filename: picked.name,
          ...(picked.type ? { mediaType: picked.type } : {}),
        });
        const fresh: StoredFile = {
          ref,
          filename: picked.name,
          ...(picked.type ? { mediaType: picked.type } : {}),
          sizeBytes: picked.size,
          threadId: client.store.get().id,
          createdAt: Date.now(),
        };
        await fileStore.put(fresh);
        return fresh;
      })());
    client.attach({
      type: "file",
      source: stored.ref,
      mediaType: stored.mediaType ?? "application/octet-stream",
      filename: stored.filename,
    });
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
      // Guard against the fast-first-send race: if the user already started
      // talking to the fresh client while we awaited the list, opening the old
      // thread now would DISCARD their turn. Their action wins.
      if (client.isRunning || client.store.get().messages.length) return;
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
              <ReattachPicker providerId={provider.id} />
              <ClearButton />
            </div>

            {effectiveMode === "demo" ? (
              <p className="dev__banner">
                {transportMode === "direct"
                  ? "No API key entered — running on the DEMO transport until you paste one. Uploads mint demo ids, not real ones."
                  : "Demo transport: replies are scripted, but everything below the provider is real — request building, the tool loop, card suspension and context assembly. Switch to proxy or BYOK for a live model."}
              </p>
            ) : null}

            <Thread empty={<Examples />} />
            <Composer placeholder="Ask about a contract, a funnel, or a market…" onAttachFile={attachFile} />
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

/**
 * Re-attach a previous upload without re-uploading — the FileStore's read
 * path. Only refs minted by the CURRENT provider are offered; a foreign ref
 * would degrade to a placeholder.
 */
function ReattachPicker({ providerId }: { providerId: string }) {
  const client = useAgentClient();
  const { attachments } = useAttachments();
  const [files, setFiles] = useState<StoredFile[]>([]);

  useEffect(() => {
    void fileStore.list().then((all) => setFiles(all.filter((f) => f.ref.provider === providerId)));
  }, [providerId, attachments.length]);

  if (!files.length) return null;
  return (
    <select
      className="dev__select"
      value=""
      title="Attach a previous upload by id — no re-upload"
      onChange={(e) => {
        const picked = files.find((f) => f.ref.id === e.target.value);
        if (picked) {
          client.attach({
            type: "file",
            source: picked.ref,
            mediaType: picked.mediaType ?? "application/octet-stream",
            filename: picked.filename,
          });
        }
        e.target.value = "";
      }}
    >
      <option value="" disabled>
        ↻ Re-attach…
      </option>
      {files.map((f) => (
        <option key={f.ref.id} value={f.ref.id}>
          {f.filename}
        </option>
      ))}
    </select>
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
  // Also resumes background jobs from a previous session (one-shot on mount) —
  // without this call, a persisted job handle would never be polled again.
  const jobs = useJobs();
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
    for (const j of jobs) {
      if (j.handle.id !== run.job?.handle.id) next.push({ type: "job-resumed", detail: `${j.handle.id.slice(0, 14)}… ${j.status}` });
    }
    if (run.usage.totalTokens) next.push({ type: "usage", detail: `${run.usage.totalTokens} tok total` });
    if (run.status === "done") next.push({ type: "run-finish", detail: `${run.finishReason} · ${run.steps} step(s)` });
    setEvents(next);
    seen.current = next.length;
  }, [run, jobs]);

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

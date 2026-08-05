"use client";

// Chat primitives.
//
// The layout rule that matters: interactive cards render at TOP LEVEL, in part
// order, never inside a collapsible "steps" group. Read-only tool activity does
// collapse — a turn that made six lookups should not push the answer off screen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isCardCarrier, type Card, type ContentPart, type MediaSource, type Message } from "@agentloom/core";
import { useAgentClient, useAttachments, useBranches, useCardAction, useCards, useRun, useThread } from "@agentloom/react";
import { CardRenderer, useCardRenderers } from "./renderer-registry.js";

function partsOf(message: Message) {
  const cards: Card[] = [];
  const rest: ContentPart[] = [];
  for (const p of message.parts) {
    if (p.type === "artifact" && p.kind.startsWith("card:")) {
      // A persisted thread may have shed this card's payload under storage
      // quota; the stub carries `expired` so the renderer says so instead of
      // rendering an empty shell.
      const expired = (p.data as { expired?: boolean } | null)?.expired === true;
      cards.push({ id: p.id, spec: p.data as Card["spec"], ...(expired ? { expired: true } : {}) });
      continue;
    }
    rest.push(p);
  }
  return { cards, rest };
}

export function MessageView({ message, respond }: { message: Message; respond?: ReturnType<typeof useCardAction>["respond"] }) {
  const renderers = useCardRenderers();
  const { cards, rest } = useMemo(() => partsOf(message), [message]);

  const text = rest.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  const reasoning = rest.filter((p) => p.type === "reasoning").map((p) => (p as { text: string }).text).join("");
  const calls = rest.filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call");
  const results = rest.filter((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");

  // Split cards: interactive ones stay at top level, read-only ones may sit with
  // the tool activity they came from.
  const interactive = cards.filter((c) => isInteractiveKind((c.spec as { kind?: string }).kind));
  const passive = cards.filter((c) => !interactive.includes(c));

  const media = rest.filter(
    (p): p is Extract<ContentPart, { type: "image" | "file" | "audio" }> =>
      p.type === "image" || p.type === "file" || p.type === "audio",
  );

  if (message.role === "user") {
    return (
      <div className="al-msg al-msg--user">
        {media.length ? <MediaParts parts={media} /> : null}
        <UserBubble message={message} text={text} />
        <BranchNav messageId={message.id} />
      </div>
    );
  }

  if (message.role === "tool") {
    return results.length ? <ToolActivity calls={[]} results={results} /> : null;
  }

  return (
    <div className="al-msg al-msg--assistant">
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      {media.length ? <MediaParts parts={media} /> : null}
      {calls.length || results.length ? <ToolActivity calls={calls} results={results} /> : null}
      {passive.map((c) => (
        <CardRenderer key={c.id} card={c} />
      ))}
      {interactive.map((c) => (
        <CardRenderer key={c.id} card={c} respond={respond} answered />
      ))}
      {text ? <div className="al-prose al-msg__text">{text}</div> : null}
      {!text && !cards.length && !calls.length ? <div className="al-muted">(no response)</div> : null}
      <BranchNav messageId={message.id} />
    </div>
  );
}

/** "‹ 2/3 ›" — rendered only when the message actually has siblings. */
function BranchNav({ messageId }: { messageId: string }) {
  const { index, count, prev, next } = useBranches(messageId);
  const { isRunning } = useThread();
  if (count < 2) return null;
  return (
    <div className="al-branchnav" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
      <button type="button" className="al-btn al-btn--ghost al-btn--sm" disabled={isRunning} onClick={prev} aria-label="Previous branch">
        ‹
      </button>
      <span className="al-muted">
        {index + 1}/{count}
      </span>
      <button type="button" className="al-btn al-btn--ghost al-btn--sm" disabled={isRunning} onClick={next} aria-label="Next branch">
        ›
      </button>
    </div>
  );
}

/** The user bubble, with edit-as-fork: saving runs a sibling branch. */
function UserBubble({ message, text }: { message: Message; text: string }) {
  const client = useAgentClient();
  const { isRunning } = useThread();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (!text && !editing) return null;
  if (!editing) {
    return (
      <div className="al-bubble" style={{ position: "relative" }}>
        {text}
        <button
          type="button"
          className="al-btn al-btn--ghost al-btn--sm"
          style={{ marginLeft: 6 }}
          disabled={isRunning}
          aria-label="Edit message"
          title="Edit — the original stays as a switchable branch"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          ✎
        </button>
      </div>
    );
  }
  return (
    <div className="al-bubble" style={{ width: "100%" }}>
      <textarea
        className="al-composer__input"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          type="button"
          className="al-btn al-btn--primary al-btn--sm"
          disabled={!draft.trim() || isRunning}
          onClick={() => {
            setEditing(false);
            void client.editMessage(message.id, draft.trim());
          }}
        >
          Send edited
        </button>
        <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const INTERACTIVE_KINDS = new Set(["choice", "form", "confirm"]);
const isInteractiveKind = (kind?: string) => (kind ? INTERACTIVE_KINDS.has(kind) : false);

const mediaSrc = (source: MediaSource, mediaType?: string): string | null => {
  if (source.kind === "url") return source.url;
  if (source.kind === "base64") return `data:${mediaType ?? "image/png"};base64,${source.data}`;
  return null; // providerFile lives server-side; there is nothing to inline
};

/**
 * Attached media, rendered instead of silently dropped — a file the user
 * attached (and is billed for on every turn) must stay visible in the
 * transcript, including after a reload.
 */
function MediaParts({ parts }: { parts: Extract<ContentPart, { type: "image" | "file" | "audio" }>[] }) {
  return (
    <div className="al-media">
      {parts.map((p, i) => {
        if (p.type === "image") {
          const src = mediaSrc(p.source, p.mediaType);
          return src ? (
            <img key={i} className="al-media__img" src={src} alt="attached image" style={{ maxWidth: "min(100%, 360px)", borderRadius: 8 }} />
          ) : (
            <span key={i} className="al-pill" title={(p.source as { id?: string }).id}>
              🖼 attached image
            </span>
          );
        }
        if (p.type === "file") {
          const name = p.filename ?? (p.source.kind === "providerFile" ? p.source.id : "attachment");
          return (
            <span key={i} className="al-pill" title={p.mediaType}>
              📄 {name}
            </span>
          );
        }
        return (
          <span key={i} className="al-pill">
            🔊 audio{p.transcript ? ` — “${p.transcript.slice(0, 60)}${p.transcript.length > 60 ? "…" : ""}”` : ""}
          </span>
        );
      })}
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="al-reasoning">
      <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide reasoning" : "Show reasoning"}
      </button>
      {open ? <pre className="al-pre al-reasoning__body">{text}</pre> : null}
    </div>
  );
}

function ToolActivity({
  calls,
  results,
}: {
  calls: Extract<ContentPart, { type: "tool-call" }>[];
  results: Extract<ContentPart, { type: "tool-result" }>[];
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(results.map((r) => [r.callId, r]));
  const items = calls.length ? calls : results.map((r) => ({ callId: r.callId, name: r.name, input: undefined, status: "done" as const }));
  const failures = results.filter((r) => r.failure).length;

  return (
    <div className="al-tools">
      <button type="button" className="al-tools__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="al-tools__icon" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        {items.length} tool {items.length === 1 ? "call" : "calls"}
        {failures ? <span className="al-pill al-pill--negative">{failures} failed</span> : null}
      </button>
      {open ? (
        <ul className="al-tools__list">
          {items.map((c) => {
            const result = byId.get(c.callId);
            return (
              <li key={c.callId} className="al-tools__item">
                <code className="al-mono">{c.name}</code>
                {result?.failure ? <span className="al-pill al-pill--negative">{result.failure}</span> : null}
                {c.input !== undefined ? <pre className="al-pre al-pre--sm">{JSON.stringify(c.input, null, 2)}</pre> : null}
                {result ? (
                  <pre className="al-pre al-pre--sm">
                    {JSON.stringify(isCardCarrier(result.output) ? { ...result.output, $card: "[card]" } : result.output, null, 2).slice(0, 1200)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** The live turn: streamed text, cards as they arrive, and any blocking card. */
export function LiveTurn() {
  const run = useRun();
  const cards = useCards();
  const { pending, respond } = useCardAction();

  if (run.status === "idle" || run.status === "done") return null;

  const text = run.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  const reasoning = run.parts.filter((p) => p.type === "reasoning").map((p) => (p as { text: string }).text).join("");
  const calls = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call");
  const results = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");

  return (
    <div className="al-msg al-msg--assistant">
      {run.job ? (
        <div className="al-jobchip">
          <span className="al-spinner" aria-hidden /> Background job <code className="al-mono">{run.job.handle.id.slice(0, 18)}…</code>{" "}
          <span className="al-pill">{run.job.status}</span>
        </div>
      ) : null}
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      {calls.length ? <ToolActivity calls={calls} results={results} /> : null}
      {cards
        .filter((c) => c.id !== pending?.id)
        .map((c) => (
          <CardRenderer key={c.id} card={c} />
        ))}
      {/* The blocking card renders last and un-collapsed — it is the thing the
          user must act on, so nothing may hide it. */}
      {pending ? <CardRenderer key={pending.id} card={pending} respond={respond} /> : null}
      {text ? <div className="al-prose al-msg__text">{text}</div> : null}
      {run.status === "running" && !text && !calls.length ? (
        <div className="al-muted">
          <span className="al-spinner" aria-hidden /> Thinking…
        </div>
      ) : null}
    </div>
  );
}

export function Thread({ empty }: { empty?: ReactNode }) {
  const { messages } = useThread();
  const { respond } = useCardAction();
  const run = useRun();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Autoscroll, but yield to the user: once they scroll up mid-stream, stop
  // yanking them back down.
  useEffect(() => {
    if (pinned) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, run.parts.length, pinned]);

  return (
    <div
      className="al-thread"
      onScroll={(e) => {
        const el = e.currentTarget;
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      }}
    >
      {messages.length === 0 && run.status === "idle" ? <div className="al-empty">{empty}</div> : null}
      {messages.map((m) => (
        <MessageView key={m.id} message={m} respond={respond} />
      ))}
      <LiveTurn />
      <div ref={bottomRef} />
    </div>
  );
}

export type ComposerProps = {
  placeholder?: string;
  /**
   * Turn a picked browser File into staged attachment part(s) — typically
   * upload via `provider.uploadFile` and then `client.attach(file(ref, …))`.
   * When absent, the attach button is not rendered.
   */
  onAttachFile?: (file: File) => void | Promise<void>;
};

export function Composer({ placeholder = "Ask anything…", onAttachFile }: ComposerProps) {
  const { send, stop, isRunning } = useThread();
  const { attachments, remove } = useAttachments();
  const [value, setValue] = useState("");
  const [attaching, setAttaching] = useState(false);

  const submit = () => {
    const text = value.trim();
    // Attachments alone are a valid send — "summarize this file" is the text-less case.
    if ((!text && !attachments.length) || isRunning) return;
    setValue("");
    void send(text);
  };

  const pick = async (file: File | undefined) => {
    if (!file || !onAttachFile) return;
    setAttaching(true);
    try {
      await onAttachFile(file);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <form
      className="al-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {attachments.length ? (
        <div className="al-composer__attachments" style={{ display: "flex", flexWrap: "wrap", gap: 6, width: "100%" }}>
          {attachments.map((p, i) => (
            <span key={i} className="al-pill">
              {p.type === "image" ? "🖼" : p.type === "audio" ? "🔊" : "📄"}{" "}
              {(p as { filename?: string }).filename ?? p.type}
              <button
                type="button"
                className="al-btn al-btn--ghost al-btn--sm"
                aria-label="Remove attachment"
                onClick={() => remove(i)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {onAttachFile ? (
        <label className="al-btn al-btn--ghost" title="Attach a file" aria-disabled={attaching || isRunning}>
          {attaching ? "…" : "📎"}
          <input
            type="file"
            style={{ display: "none" }}
            disabled={attaching || isRunning}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void pick(file);
            }}
          />
        </label>
      ) : null}
      <textarea
        className="al-composer__input"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line — the convention every
          // chat UI has trained users on.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {isRunning ? (
        <button type="button" className="al-btn al-btn--ghost" onClick={stop}>
          Stop
        </button>
      ) : (
        <button type="submit" className="al-btn al-btn--primary" disabled={!value.trim() && !attachments.length}>
          Send
        </button>
      )}
    </form>
  );
}

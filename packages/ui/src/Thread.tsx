"use client";

// Chat primitives.
//
// The layout rule that matters: interactive cards render at TOP LEVEL, in part
// order, never inside a collapsible "steps" group. Read-only tool activity does
// collapse — a turn that made six lookups should not push the answer off screen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isCardCarrier, type Card, type ContentPart, type Message } from "@agentloom/core";
import { useCardAction, useCards, useRun, useThread } from "@agentloom/react";
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

  if (message.role === "user") {
    return (
      <div className="al-msg al-msg--user">
        <div className="al-bubble">{text}</div>
      </div>
    );
  }

  if (message.role === "tool") {
    return results.length ? <ToolActivity calls={[]} results={results} /> : null;
  }

  return (
    <div className="al-msg al-msg--assistant">
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      {calls.length || results.length ? <ToolActivity calls={calls} results={results} /> : null}
      {passive.map((c) => (
        <CardRenderer key={c.id} card={c} />
      ))}
      {interactive.map((c) => (
        <CardRenderer key={c.id} card={c} respond={respond} answered />
      ))}
      {text ? <div className="al-prose al-msg__text">{text}</div> : null}
      {!text && !cards.length && !calls.length ? <div className="al-muted">(no response)</div> : null}
    </div>
  );
}

const INTERACTIVE_KINDS = new Set(["choice", "form", "confirm"]);
const isInteractiveKind = (kind?: string) => (kind ? INTERACTIVE_KINDS.has(kind) : false);

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

export function Composer({ placeholder = "Ask anything…" }: { placeholder?: string }) {
  const { send, stop, isRunning } = useThread();
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || isRunning) return;
    setValue("");
    void send(text);
  };

  return (
    <form
      className="al-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
        <button type="submit" className="al-btn al-btn--primary" disabled={!value.trim()}>
          Send
        </button>
      )}
    </form>
  );
}

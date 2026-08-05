"use client";

// The read-only card renderers.

import { useMemo, useState } from "react";
import type {
  CodeCard,
  DiffCard,
  KeyValueCard,
  MarkdownCard,
  MediaCard,
  ProgressCard,
  StatsCard,
  TableCard,
  TimelineCard,
} from "@superchat/core";
import type { CardRendererProps } from "../renderer-registry.js";
import { deltaTone, formatDelta, formatValue, toneClass } from "../format.js";

export function TableCardView({ spec }: CardRendererProps<TableCard>) {
  const [sortBy, setSortBy] = useState(spec.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(spec.sortDir ?? "desc");

  const rows = useMemo(() => {
    if (!sortBy) return spec.rows;
    return [...spec.rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      // Numeric when both sides are numeric, lexical otherwise — a mixed column
      // sorted purely as strings puts "10" before "9".
      const an = Number(av);
      const bn = Number(bv);
      const cmp =
        Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [spec.rows, sortBy, sortDir]);

  const toggle = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead>
            <tr>
              {spec.columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
                  <button type="button" className="sc-th-btn" onClick={() => toggle(c.key)}>
                    {c.label}
                    {sortBy === c.key ? <span aria-hidden> {sortDir === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={spec.columns.length} className="sc-muted">
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {spec.columns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                      {c.pill ? (
                        <span className="sc-pill">{formatValue(row[c.key], c.format)}</span>
                      ) : (
                        formatValue(row[c.key], c.format)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {spec.caption ? <div className="sc-muted sc-card__caption">{spec.caption}</div> : null}
    </div>
  );
}

export function StatsCardView({ spec }: CardRendererProps<StatsCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-stats">
        {spec.items.map((item, i) => (
          <div key={i} className="sc-stat">
            <div className="sc-stat__label">{item.label}</div>
            <div className={`sc-stat__value${toneClass(item.tone)}`}>{formatValue(item.value, item.format)}</div>
            {item.delta != null ? (
              <div className={`sc-stat__delta sc-tone--${deltaTone(item.delta)}`}>
                {formatDelta(item.delta, item.deltaFormat ?? "percent")}
              </div>
            ) : null}
            {item.hint ? <div className="sc-muted sc-stat__hint">{item.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KeyValueCardView({ spec }: CardRendererProps<KeyValueCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <dl className="sc-kv">
        {spec.items.map((item, i) => (
          <div key={i} className="sc-kv__row">
            <dt>{item.label}</dt>
            <dd className={`${item.mono ? "sc-mono" : ""}${toneClass(item.tone)}`}>{formatValue(item.value, item.format)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TimelineCardView({ spec }: CardRendererProps<TimelineCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <ol className="sc-timeline">
        {spec.events.map((e, i) => (
          <li key={i} className={`sc-timeline__item${toneClass(e.tone)}`}>
            <span className="sc-timeline__dot" aria-hidden />
            <div>
              <div className="sc-timeline__label">{e.label}</div>
              <div className="sc-muted sc-timeline__at">{formatValue(e.at, "datetime")}</div>
              {e.detail ? <div className="sc-timeline__detail">{e.detail}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STEP_ICON: Record<string, string> = { pending: "○", active: "◐", done: "●", failed: "✕", skipped: "–" };

export function ProgressCardView({ spec }: CardRendererProps<ProgressCard>) {
  const done = spec.steps.filter((s) => s.status === "done").length;
  const fraction = spec.fraction ?? (spec.steps.length ? done / spec.steps.length : 0);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div
        className="sc-progress"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="sc-progress__bar" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
      </div>
      <ul className="sc-steps">
        {spec.steps.map((s, i) => (
          <li key={i} className={`sc-step sc-step--${s.status}`}>
            <span className="sc-step__icon" aria-hidden>
              {STEP_ICON[s.status] ?? "○"}
            </span>
            <span className="sc-step__label">{s.label}</span>
            {s.detail ? <span className="sc-muted sc-step__detail">{s.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MediaCardView({ spec }: CardRendererProps<MediaCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className={spec.layout === "single" ? "sc-media sc-media--single" : "sc-media"}>
        {spec.items.map((item, i) => (
          <figure key={i} className="sc-media__item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.alt ?? item.caption ?? ""} loading="lazy" />
            {item.caption ? <figcaption className="sc-muted">{item.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    </div>
  );
}

/**
 * Minimal markdown: headings, bold, italic, inline code, links and lists.
 *
 * Deliberately not a full parser — a card body is short, and pulling in a
 * markdown library plus a sanitizer for this is disproportionate. Everything is
 * escaped first, so model output cannot inject markup.
 */
function renderMarkdown(src: string): string {
  const escaped = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // Only http(s) links — a javascript: URL must never survive.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
    .split(/\n{2,}/)
    .map((block) => (block.trim().startsWith("<") ? block : `<p>${block.replace(/\n/g, "<br/>")}</p>`))
    .join("");
}

export function MarkdownCardView({ spec }: CardRendererProps<MarkdownCard>) {
  const html = useMemo(() => renderMarkdown(spec.body), [spec.body]);
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export function CodeCardView({ spec }: CardRendererProps<CodeCard>) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(spec.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is still selectable */
    }
  };

  return (
    <div className="sc-card">
      <div className="sc-card__head">
        <span className="sc-card__title">{spec.filename ?? spec.title ?? spec.language ?? "code"}</span>
        <button type="button" className="sc-btn sc-btn--ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="sc-pre">
        <code>{spec.code}</code>
      </pre>
    </div>
  );
}

export function DiffCardView({ spec }: CardRendererProps<DiffCard>) {
  // Line-level diff via longest-common-subsequence. Enough for a card; a real
  // review surface should use a proper diff view.
  const rows = useMemo(() => diffLines(spec.before.split("\n"), spec.after.split("\n")), [spec.before, spec.after]);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-diff">
        {rows.map((row, i) => (
          <div key={i} className={`sc-diff__line sc-diff__line--${row.kind}`}>
            <span className="sc-diff__sign" aria-hidden>
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            <span>{row.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function diffLines(a: string[], b: string[]): { kind: "same" | "add" | "del"; text: string }[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

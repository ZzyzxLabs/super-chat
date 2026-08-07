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
  TableColumn,
  TimelineCard,
} from "@zzyzxlabs/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { deltaTone, formatDelta, formatValue, toneClass } from "../format.js";
import { CodeBlock } from "../agent/CodeBlock.js";
import { renderMarkdown } from "../markdown.js";
import { CardActions } from "./CardActions.js";

// Rows beyond this render behind a "Show all" toggle — a 200-row agent result
// would otherwise turn the card into the entire scroll surface.
const TABLE_TRUNCATE_AT = 30;

/** Header row + data rows, tab-separated — what Copy/Download hand off for
 * TableCardView. Values go through the same formatValue() the cells render,
 * so the export matches what's on screen rather than raw payload values. Tabs
 * and newlines inside a cell are flattened to a space; TSV has no escaping
 * mechanism for them. */
function tableToTsv(columns: TableColumn[], rows: Record<string, unknown>[]): string {
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, " ");
  const header = columns.map((c) => cell(c.label)).join("\t");
  const body = rows.map((row) => columns.map((c) => cell(formatValue(row[c.key], c.format))).join("\t")).join("\n");
  return rows.length ? `${header}\n${body}` : header;
}

export function TableCardView({ spec }: CardRendererProps<TableCard>) {
  const [sortBy, setSortBy] = useState(spec.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(spec.sortDir ?? "desc");
  const [showAll, setShowAll] = useState(false);

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

  // A stable key per row: the row's own `id` when the payload carries one,
  // otherwise its position in spec.rows *before* sorting. Sorting reorders the
  // `rows` array on every column click — keying off the sorted array's index
  // would rekey (and remount) every row each time the user re-sorts.
  const originalIndex = useMemo(() => {
    const m = new Map<Record<string, unknown>, number>();
    spec.rows.forEach((row, i) => m.set(row, i));
    return m;
  }, [spec.rows]);
  const rowKey = (row: Record<string, unknown>): string | number => {
    const id = row["id"];
    if (typeof id === "string" || typeof id === "number") return id;
    return originalIndex.get(row) ?? -1;
  };

  // Truncation reads off the sorted array, not spec.rows — the user asked to
  // see the top 30 of *this* ordering, not the top 30 of whatever order the
  // agent originally sent.
  const truncated = rows.length > TABLE_TRUNCATE_AT;
  const visibleRows = showAll ? rows : rows.slice(0, TABLE_TRUNCATE_AT);

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
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={spec.columns.length} className="sc-muted">
                  No rows.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={rowKey(row)}>
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
      {truncated ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm sc-table__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show all (${rows.length})`}
        </button>
      ) : null}
      {spec.caption ? <div className="sc-muted sc-card__caption">{spec.caption}</div> : null}
      <CardActions getText={() => tableToTsv(spec.columns, rows)} filename="table.tsv" mimeType="text/tab-separated-values" />
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

export function MarkdownCardView({ spec }: CardRendererProps<MarkdownCard>) {
  const html = useMemo(() => renderMarkdown(spec.body), [spec.body]);
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-prose" dangerouslySetInnerHTML={{ __html: html }} />
      <CardActions getText={() => spec.body} filename="note.md" mimeType="text/markdown" />
    </div>
  );
}

// Best-effort language → extension map for the download filename when the
// card has no explicit `filename`. Deliberately not exhaustive — "txt" is a
// safe fallback, not a bug, for anything not listed.
const CODE_EXT: Record<string, string> = {
  javascript: "js", js: "js", jsx: "jsx",
  typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py",
  json: "json", html: "html", css: "css", scss: "scss", less: "less",
  markdown: "md", md: "md",
  bash: "sh", shell: "sh", sh: "sh", zsh: "sh",
  yaml: "yml", yml: "yml",
  rust: "rs", go: "go", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", "c#": "cs",
  ruby: "rb", rb: "rb", php: "php", sql: "sql",
  swift: "swift", kotlin: "kt", kt: "kt",
};

function codeFilename(spec: CodeCard): string {
  if (spec.filename) return spec.filename;
  const ext = (spec.language && CODE_EXT[spec.language.toLowerCase()]) || "txt";
  return `snippet.${ext}`;
}

export function CodeCardView({ spec }: CardRendererProps<CodeCard>) {
  // No surrounding sc-card shell: CodeBlock already carries its own header,
  // border and actions. It takes the download filename rather than pairing
  // with CardActions, so the card offers one action row instead of two Copy
  // buttons that behave slightly differently.
  return (
    <CodeBlock
      code={spec.code}
      lang={spec.language}
      filename={spec.filename ?? spec.title}
      downloadName={codeFilename(spec)}
      // A single line needs no gutter; numbering it is just noise.
      lineNumbers={spec.code.trimEnd().includes("\n")}
    />
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

// Above this many lines on either side, the classic (n+1)×(m+1) LCS matrix
// gets big enough to matter (a 5000-line file is 25M cells) — fall back to a
// cheap linear diff instead of allocating it.
const DIFF_LCS_LINE_CAP = 2000;

function diffLines(a: string[], b: string[]): { kind: "same" | "add" | "del"; text: string }[] {
  if (a.length > DIFF_LCS_LINE_CAP || b.length > DIFF_LCS_LINE_CAP) return diffLinesFast(a, b);

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

/**
 * O(n) fallback for inputs too large for full LCS. Trims the matching prefix
 * and suffix and treats everything between as one wholesale removal +
 * addition. It won't line up a match buried in the middle the way LCS would,
 * but it never allocates more than a handful of arrays no matter how large
 * the input is.
 */
function diffLinesFast(a: string[], b: string[]): { kind: "same" | "add" | "del"; text: string }[] {
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  for (let i = 0; i < start; i += 1) out.push({ kind: "same", text: a[i]! });
  for (let i = start; i < endA; i += 1) out.push({ kind: "del", text: a[i]! });
  for (let i = start; i < endB; i += 1) out.push({ kind: "add", text: b[i]! });
  for (let i = endA; i < a.length; i += 1) out.push({ kind: "same", text: a[i]! });
  return out;
}
"use client";

// The context inspector.
//
// This is the component that justifies the whole trace subsystem: it answers
// "what did you actually send, and what did you leave out" without anyone
// reading a log. Every framework can build a request; being able to SEE the
// request is what makes one debuggable.

import { useContextTrace, useSkills, useTools } from "@agentloom/react";
import type { TraceEntry } from "@agentloom/core";

const STATUS_TONE: Record<TraceEntry["status"], string> = {
  included: "positive",
  truncated: "warning",
  compacted: "info",
  dropped: "warning",
  failed: "negative",
};

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="al-bar">
      <div className="al-bar__head">
        <span>{label}</span>
        <span className="al-mono">{value.toLocaleString()} tok</span>
      </div>
      <div className="al-bar__track">
        <div className="al-bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ContextInspector() {
  const trace = useContextTrace();
  const { skills, matched } = useSkills();
  const { active, presets, fromRun } = useTools();

  if (!trace) {
    return (
      <div className="al-panel">
        <div className="al-panel__title">Context</div>
        <p className="al-muted">Send a message to see exactly what gets assembled and sent.</p>
        <div className="al-panel__section">
          <div className="al-panel__label">Registered skills</div>
          <ul className="al-list">
            {skills.map((s) => (
              <li key={s.id}>
                <code className="al-mono">{s.id}</code> <span className="al-pill">{s.mode}</span>
              </li>
            ))}
            {skills.length === 0 ? <li className="al-muted">None registered.</li> : null}
          </ul>
        </div>
      </div>
    );
  }

  const window = trace.budget.contextWindow;

  return (
    <div className="al-panel">
      <div className="al-panel__title">Context</div>

      <div className="al-panel__section">
        <Bar label="System (identity + skills)" value={trace.totals.system} total={window} />
        <Bar label="History" value={trace.totals.history} total={window} />
        <div className="al-panel__row">
          <span className="al-muted">Reserved for reply</span>
          <span className="al-mono">{trace.budget.shares.output.toLocaleString()} tok</span>
        </div>
        <div className="al-panel__row">
          <span className="al-muted">Headroom</span>
          <span className={`al-mono ${trace.headroom < 0 ? "al-tone--negative" : ""}`}>
            {trace.headroom.toLocaleString()} tok
          </span>
        </div>
      </div>

      {trace.warnings.length ? (
        <div className="al-panel__section">
          {trace.warnings.map((w, i) => (
            <div key={i} className="al-note al-note--warning">
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div className="al-panel__section">
        <div className="al-panel__label">What went in</div>
        <table className="al-table al-table--compact">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {trace.entries.map((e, i) => (
              <tr key={`${e.id}-${i}`} title={e.detail}>
                <td>
                  <code className="al-mono">{e.id}</code>
                </td>
                <td>
                  <span className={`al-pill al-pill--${STATUS_TONE[e.status]}`}>{e.status}</span>
                </td>
                <td style={{ textAlign: "right" }} className="al-mono">
                  {e.originalTokens && e.originalTokens !== e.tokens ? (
                    <>
                      <s className="al-muted">{e.originalTokens}</s> {e.tokens}
                    </>
                  ) : (
                    e.tokens
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="al-panel__section">
        <div className="al-panel__label">Skills loaded this turn</div>
        {matched.length ? (
          <div className="al-chips">
            {matched.map((id) => (
              <span key={id} className="al-pill al-pill--positive">
                {id}
              </span>
            ))}
          </div>
        ) : (
          <p className="al-muted">None matched — only always-on skills applied.</p>
        )}
      </div>

      <div className="al-panel__section">
        <div className="al-panel__label">
          Tools exposed <span className="al-muted">({presets.join(", ") || "no presets"}{fromRun ? " + skill unlocks" : ""})</span>
        </div>
        <div className="al-chips">
          {active.map((name) => (
            <span key={name} className="al-pill">
              {name}
            </span>
          ))}
          {active.length === 0 ? <span className="al-muted">None.</span> : null}
        </div>
      </div>
    </div>
  );
}

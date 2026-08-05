"use client";

import { useMemo, useState } from "react";
import { McpClient, createHttpTransport, importMcpTools } from "@agentloom/core";
import { PanelHeader } from "@/components/Shell";
import { buildToolRegistry } from "@/agent/setup";

const PRESETS = ["observer", "executor"] as const;

export default function ToolsPanel() {
  const registry = useMemo(() => buildToolRegistry(), []);
  const [enabled, setEnabled] = useState<string[]>(["observer"]);
  const [open, setOpen] = useState<string | null>(null);

  const [mcpUrl, setMcpUrl] = useState("/api/mcp");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>([]);
  const [allowImported, setAllowImported] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const importFromMcp = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const client = new McpClient({ transport: createHttpTransport({ baseUrl: mcpUrl }) });
      const defs = await importMcpTools(client);
      // NO preset: imported tools are skill-gated/private, like every other
      // domain tool. Import grants existence, never authority.
      registry.registerAll(defs);
      setImported(defs.map((d) => d.name));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const resolution = {
    presets: enabled,
    ...(allowImported && imported.length ? { allow: imported } : {}),
  };
  const all = registry.list();
  const exposed = new Set(registry.resolve(resolution).map((t) => t.name));
  const specs = registry.toSpecs(registry.resolve(resolution));

  return (
    <div className="dev__page">
      <PanelHeader title="Tools & presets">
        Presets are explicit <strong>allowlists</strong>, not blocklists — a newly registered tool is invisible until
        someone puts it in one. The inverse (everything exposed unless denied) means the day you add a destructive tool,
        it is already live on every key you ever minted. Toggle the presets and watch the exposed set change.
      </PanelHeader>

      <section className="dev__section" style={{ marginTop: 0 }}>
        <div className="dev__row">
          {PRESETS.map((p) => (
            <label key={p} className="dev__toggle">
              <input
                type="checkbox"
                checked={enabled.includes(p)}
                onChange={(e) => setEnabled((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))}
              />
              <code className="al-mono">{p}</code>
            </label>
          ))}
          <span className="al-muted" style={{ fontSize: 12 }}>
            {exposed.size} of {all.length} tools exposed
          </span>
        </div>

        <table className="al-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Presets</th>
              <th>Side</th>
              <th>Executor</th>
              <th>Exposed</th>
            </tr>
          </thead>
          <tbody>
            {all.map((t) => {
              const grants = registry.presetsFor(t.name);
              return (
                <tr key={t.name} style={{ opacity: exposed.has(t.name) ? 1 : 0.45 }}>
                  <td>
                    <button type="button" className="al-th-btn" onClick={() => setOpen(open === t.name ? null : t.name)}>
                      <code className="al-mono">{t.name}</code>
                    </button>
                    <div className="al-muted" style={{ fontSize: 11, maxWidth: "44ch", lineHeight: 1.4 }}>
                      {t.description.split("\n")[0]!.slice(0, 96)}
                      {t.description.length > 96 ? "…" : ""}
                    </div>
                  </td>
                  <td>
                    {grants.length ? (
                      grants.map((g) => (
                        <span key={g} className={`al-pill${g === "executor" ? " al-pill--warning" : ""}`}>
                          {g}
                        </span>
                      ))
                    ) : (
                      <span className="al-pill al-pill--negative">none — private</span>
                    )}
                  </td>
                  <td>
                    <span className={`al-pill${t.side === "confirm" ? " al-pill--warning" : ""}`}>{t.side ?? "read"}</span>
                  </td>
                  <td className="al-muted" style={{ fontSize: 11 }}>
                    {typeof t.execute === "function" ? "in-process" : "host"}
                  </td>
                  <td>{exposed.has(t.name) ? <span className="al-tone--positive">✓</span> : <span className="al-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {open ? (
        <section className="dev__section">
          <h2 className="dev__section-title">
            <code className="al-mono">{open}</code> — what the model sees
          </h2>
          <p className="dev__section-note">{registry.get(open)?.description}</p>
          <pre className="al-pre dev__code">{JSON.stringify(registry.get(open)?.inputSchema, null, 2)}</pre>
        </section>
      ) : null}

      <section className="dev__section">
        <h2 className="dev__section-title">Rendered tool specs</h2>
        <p className="dev__section-note">
          What <code className="al-mono">ToolRegistry.toSpecs()</code> hands the adapter for the current preset
          selection. The adapter then reshapes it per dialect — flat for Responses, nested under{" "}
          <code className="al-mono">function</code> for Chat Completions. See the wire panel.
        </p>
        <pre className="al-pre dev__code" style={{ maxHeight: 420 }}>
          {JSON.stringify(specs, null, 2)}
        </pre>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Import from MCP</h2>
        <p className="dev__section-note">
          <code className="al-mono">importMcpTools()</code> maps an MCP server&apos;s tool list onto{" "}
          <code className="al-mono">ToolDefinition</code>s — namespaced, with an executor that calls back through the
          server. Imported tools register with <strong>no preset</strong>, so they land as{" "}
          <em>private</em> in the table above: visible to nothing until a skill (or the allow toggle below, standing in
          for one) surfaces them. Import grants existence, never authority. The default URL is this playground&apos;s own
          mock MCP route — no key, real HTTP.
        </p>
        <div className="dev__row">
          <input
            className="dev__select"
            style={{ minWidth: "22ch" }}
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="/api/mcp"
          />
          <button type="button" className="al-btn al-btn--sm" disabled={importing || !mcpUrl.trim()} onClick={() => void importFromMcp()}>
            {importing ? "Connecting…" : imported.length ? "Re-import" : "Connect & import"}
          </button>
          {imported.length ? (
            <label className="dev__toggle" title="What a matched skill's `tools` list would do">
              <input type="checkbox" checked={allowImported} onChange={(e) => setAllowImported(e.target.checked)} />
              allow imported (as a skill would)
            </label>
          ) : null}
        </div>
        {importError ? (
          <p className="al-muted" style={{ color: "var(--al-negative, #c00)", fontSize: 12 }}>
            {importError}
          </p>
        ) : null}
        {imported.length ? (
          <p className="al-muted" style={{ fontSize: 12 }}>
            Imported {imported.length} tool{imported.length === 1 ? "" : "s"}:{" "}
            {imported.map((n) => (
              <code key={n} className="al-mono" style={{ marginRight: 6 }}>
                {n}
              </code>
            ))}
            — now toggle the allow switch and watch the Exposed column.
          </p>
        ) : null}
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Three ways a tool attaches a card</h2>
        <p className="dev__section-note">
          All three work, so a tool author never has to know which one the runtime checks. Whichever is used, the card
          reaches the UI and is stripped from the output before the next provider call.
        </p>
        <pre className="al-pre dev__code">{`// 1. explicit result field
return { output: { n: 1 }, card: { kind: "stats", items: [...] } };

// 2. embedded in the output
return { output: withCard({ n: 1 }, { kind: "stats", items: [...] }) };

// 3. emitted mid-execution — for progress on a long tool
ctx.emitCard?.({ kind: "progress", steps: [...] });

// and to ASK rather than assume — this suspends the run:
const answer = await ctx.requestCard?.({ kind: "confirm", title: "…", summary: [...] });`}</pre>
      </section>
    </div>
  );
}

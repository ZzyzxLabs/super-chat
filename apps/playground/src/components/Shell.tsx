"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Panels, not pages of an app. Each one isolates a single capability so a
// developer evaluating the framework can see what is available without reading
// the source — which is what they actually want from a demo.
const PANELS = [
  { href: "/", label: "Overview", hint: "What's in the box" },
  { href: "/cards", label: "Agent cards", hint: "23 kinds + their specs" },
  { href: "/agent-ui", label: "Agent surfaces", hint: "Thinking, orbs, composer" },
  { href: "/dev-ani", label: "Animations", hint: "Every motion, catalogued & replayable" },
  { href: "/skills", label: "Skills", hint: "Modes, matching, live scoring" },
  { href: "/tools", label: "Tools & presets", hint: "Schemas, capability gating" },
  { href: "/requests", label: "Wire requests", hint: "Responses vs Chat Completions" },
  { href: "/app-state", label: "App state", hint: "Agent reads & drives your UI" },
  { href: "/documents", label: "Documents", hint: "Previewer, quotes, edit refusals" },
  { href: "/run", label: "Run & events", hint: "Live chat + event stream" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="dev">
      <aside className="dev__nav">
        <div className="dev__brand">
          superchat
          <span>dev panels</span>
        </div>
        <nav>
          {PANELS.map((p) => {
            const active = p.href === "/" ? pathname === "/" : pathname.startsWith(p.href);
            return (
              <Link key={p.href} href={p.href} className={`dev__link${active ? " dev__link--on" : ""}`}>
                <span className="dev__link-label">{p.label}</span>
                <span className="dev__link-hint">{p.hint}</span>
              </Link>
            );
          })}
        </nav>
        <div className="dev__foot">
          <code className="sc-mono">@zzyzxlabs/super-chat-core</code>
          <code className="sc-mono">@zzyzxlabs/super-chat-react</code>
          <code className="sc-mono">@zzyzxlabs/super-chat-ui</code>
        </div>
      </aside>
      <main className="dev__main">{children}</main>
    </div>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="dev__head">
      <h1 className="dev__title">{title}</h1>
      {children ? <p className="dev__lede">{children}</p> : null}
    </header>
  );
}

/** Spec on the left, rendered result on the right — the pairing devs want. */
export function SpecSplit({ spec, children, label }: { spec: unknown; children: ReactNode; label?: string }) {
  return (
    <div className="dev__split">
      <div className="dev__spec">
        {label ? <div className="dev__spec-label">{label}</div> : null}
        <pre className="sc-pre dev__code">{JSON.stringify(spec, null, 2)}</pre>
      </div>
      <div className="dev__preview">{children}</div>
    </div>
  );
}

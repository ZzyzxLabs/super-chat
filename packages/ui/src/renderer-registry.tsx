"use client";

// The renderer half of the card system.
//
// `CardRenderer` looks a kind up in this registry. The unknown-kind path is a
// readable fallback, never a silent drop — a card that renders as raw JSON is a
// bug you can see, whereas a card that vanishes is a bug you find in a support
// ticket three weeks later.

import { Component, createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { Card, CardAction, CardSpec } from "@superchat/core";

export type CardRendererProps<S extends CardSpec = CardSpec> = {
  spec: S;
  card: Card;
  /** Present for interactive cards; absent means the card is read-only. */
  respond?: (action: Omit<CardAction, "at">) => void;
  /** True once the card has been answered — controls disable it. */
  answered?: boolean;
};

export type CardRendererMap = Record<string, ComponentType<CardRendererProps<never>>>;

const RendererContext = createContext<CardRendererMap>({});

export function CardRendererProvider({ renderers, children }: { renderers: CardRendererMap; children: ReactNode }) {
  const inherited = useContext(RendererContext);
  const value = useMemo(() => ({ ...inherited, ...renderers }), [inherited, renderers]);
  return <RendererContext.Provider value={value}>{children}</RendererContext.Provider>;
}

export function useCardRenderers(): CardRendererMap {
  return useContext(RendererContext);
}

/**
 * Isolates a render failure to one card.
 *
 * A malformed payload, a degenerate chart, a card component that throws — any
 * of them would otherwise blank the whole thread. Here the rest of the
 * conversation keeps rendering and the failure is stated inline.
 */
export class CardBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; message?: string }> {
  override state = { failed: false, message: undefined as string | undefined };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="sc-card sc-card--error" role="alert">
          <strong>{this.props.label ?? "This card"} couldn’t render.</strong>
          {this.state.message ? <div className="sc-muted sc-mono">{this.state.message}</div> : null}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Placeholder for a card whose data has not arrived.
 *
 * Deliberately delayed: a skeleton that appears for 80ms and vanishes is worse
 * than no skeleton at all, so it waits before showing itself. Hosts render this
 * directly — a card with no spec yet has no kind to dispatch on.
 */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <div className="sc-card sc-skeleton" aria-busy="true" aria-live="polite">
      <span className="sc-sr-only">Loading…</span>
      <div className="sc-skeleton__bar sc-skeleton__bar--title" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="sc-skeleton__bar" style={i === lines - 1 ? { width: "80%" } : undefined} />
      ))}
    </div>
  );
}

export function CardRenderer({ card, respond, answered }: { card: Card; respond?: CardRendererProps["respond"]; answered?: boolean }) {
  const renderers = useCardRenderers();
  const kind = (card.spec as { kind?: string }).kind ?? "unknown";

  if (card.expired) {
    // Large card payloads are trimmed out of persisted history. Say so — an
    // empty shell reads as a broken app.
    return (
      <div className="sc-card sc-card--muted">
        <div className="sc-muted">This {kind} result expired from saved history. Ask again to refresh it.</div>
      </div>
    );
  }

  const Renderer = renderers[kind];
  if (!Renderer) {
    return (
      <div className="sc-card sc-card--muted">
        <div className="sc-card__head">
          <span className="sc-pill sc-pill--warning">unrendered</span>
          <span className="sc-muted">No renderer registered for card kind “{kind}”.</span>
        </div>
        <pre className="sc-pre">{JSON.stringify(card.spec, null, 2)}</pre>
      </div>
    );
  }

  return (
    <CardBoundary label={`The ${kind} card`}>
      <Renderer spec={card.spec as never} card={card} respond={respond} answered={answered} />
    </CardBoundary>
  );
}
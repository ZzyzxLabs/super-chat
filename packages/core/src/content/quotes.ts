// Quoted document spans — what the user pointed at, carried into one request.
//
// The load-bearing decision is where a quote LIVES, and the obvious answer is
// wrong. A selection looks like screen state, so app-state seems to be its
// home. It is not:
//
//   - app-state answers "what is the user looking at now" and is re-read every
//     turn. A quote is pinned to ONE request; the turn after, the user has not
//     selected anything and it must be gone.
//   - It would go stale in history. Select A, send, select B — and the first
//     message, re-read later, would show B, because app-state has no memory of
//     what it said three turns ago.
//   - It is droppable. app-state losing its slot to budget pressure costs some
//     environment detail. A span the user deliberately highlighted losing its
//     slot loses part of what the user SAID — a correctness bug wearing a
//     budget optimisation's clothes.
//
// So a quote is part of the user's message: flattened into a text part for the
// model, and kept structurally on `Message.metadata`, which is documented as
// never reaching a provider. Nothing in the adapters changes.

/** A span of a document artifact, resolved to source offsets. */
export type DocumentQuoteRef = {
  docId: string;
  title: string;
  /** Revision the span was taken from — a later edit can detect the drift. */
  revision: number;
  /** Inclusive block index range. */
  blocks: [number, number];
  start: number;
  end: number;
  /** SOURCE markdown, not rendered text. */
  text: string;
};

/** Key under `Message.metadata` where quotes are stored for re-rendering. */
export const QUOTES_METADATA_KEY = "documentQuotes";

const fence = (text: string) => {
  // A quote can itself contain a ``` fence, so the wrapper grows past the
  // longest run inside it rather than truncating or escaping the content.
  const longest = [...text.matchAll(/`{3,}/g)].reduce((n, m) => Math.max(n, m[0].length), 2);
  return "`".repeat(longest + 1);
};

/**
 * Render quotes as the prefix of the user's message.
 *
 * Fenced rather than indented, and labelled with the document and block range,
 * so the model can tell quoted material from the user's own words — and can
 * name what it is about to change when the edit tools arrive.
 */
export function formatQuotes(quotes: readonly DocumentQuoteRef[]): string {
  if (!quotes.length) return "";
  return quotes
    .map((q) => {
      const [from, to] = q.blocks;
      const where = from === to ? `block ${from}` : `blocks ${from}–${to}`;
      const f = fence(q.text);
      return `Quoted from "${q.title}" (${q.docId} v${q.revision}, ${where}):\n${f}markdown\n${q.text}\n${f}`;
    })
    .join("\n\n");
}

/** Prefix `text` with the quotes, keeping a blank line between them. */
export function withQuotes(text: string, quotes: readonly DocumentQuoteRef[]): string {
  const prefix = formatQuotes(quotes);
  if (!prefix) return text;
  return text.trim() ? `${prefix}\n\n${text}` : prefix;
}

/** Read quotes back off a message, for re-rendering the chips in history. */
export function quotesOf(metadata: Record<string, unknown> | undefined): DocumentQuoteRef[] {
  const raw = metadata?.[QUOTES_METADATA_KEY];
  return Array.isArray(raw) ? (raw as DocumentQuoteRef[]) : [];
}

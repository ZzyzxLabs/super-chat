// Minimal markdown renderer for assistant text, markdown cards and document
// artifacts.
//
// Deliberately not a full parser — a chat message or card body is short, and
// pulling in a markdown library plus a sanitizer for this is disproportionate.
//
// It does now split into blocks before rendering, and that is not a stylistic
// change. A document previewer has to answer "the user selected this on screen;
// where is it in the source?", because that span is both what gets quoted into
// the next request and what an edit has to anchor against. The previous shape —
// escape the whole string, pull fences out into placeholders, then run a chain
// of global regexes — destroyed source positions in its first statement.
//
// So the order is inverted: split on the RAW source and record offsets, then
// escape and transform each block independently. Escaping per block rather than
// up front is load-bearing, not tidiness: `&` → `&amp;` changes the string
// length, so escaping first would shift every offset recorded afterwards. That
// failure is invisible on screen — the page renders perfectly and the anchors
// silently point at the wrong text — which is why markdown.test.ts asserts the
// offsets round-trip rather than trusting the output to look right.

import { splitBlocks, type MarkdownBlock } from "@zzyzxlabs/super-chat-core";

export type AnchoredMarkdown = {
  html: string;
  /** Index-aligned with the `data-sc-block` attribute on the rendered HTML. */
  blocks: MarkdownBlock[];
};

// Cheap pre-check carried over from main: with none of these characters
// present, no heading, emphasis, code, link or list rule below could match, so
// the whole regex chain is skippable. Applied per BLOCK rather than per
// document — one fenced snippet in an otherwise plain artifact should not cost
// the other forty paragraphs their shortcut.
const MARKDOWN_SIGNIFICANT = /[`*_#[\]>-]/;

// Quotes are escaped because link URLs are interpolated into href="…" — an
// unescaped quote in a URL would close the attribute and open a new one
// (browsers recover from the missing-whitespace parse error by reading
// `"onmouseover="…` as a fresh attribute).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderFence(raw: string): string {
  // Drop the opening fence line (which may carry a language) and the closing
  // one. Content is escaped but never sees an inline transform, so
  // "**not bold**" inside a fence stays literal.
  const firstBreak = raw.indexOf("\n");
  const body = firstBreak === -1 ? "" : raw.slice(firstBreak + 1);
  const inner = body.replace(/```[^\n]*$/, "").replace(/\n$/, "");
  return `<pre><code>${escapeHtml(inner)}</code></pre>`;
}

function renderText(raw: string): string {
  // Escaping still happens — safety is not what the shortcut skips.
  if (!MARKDOWN_SIGNIFICANT.test(raw)) {
    return `<p>${escapeHtml(raw).replace(/\n/g, "<br/>")}</p>`;
  }

  const html = escapeHtml(raw)
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // Only http(s) links — a javascript: URL must never survive.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");

  // A block that already produced markup keeps it; anything else is prose and
  // gets a paragraph, with single newlines preserved as breaks.
  return html.trim().startsWith("<") ? html : `<p>${html.replace(/\n/g, "<br/>")}</p>`;
}

const renderBlock = (src: string, block: MarkdownBlock): string => {
  const raw = src.slice(block.start, block.end);
  return block.kind === "fence" ? renderFence(raw) : renderText(raw);
};

/** Render for the transcript: no anchors, because chat prose is not addressed. */
export function renderMarkdown(src: string): string {
  const blocks = splitBlocks(src);
  return blocks.map((b) => renderBlock(src, b)).join("");
}

/**
 * Render for a document previewer: every block carries `data-sc-block`, so a
 * DOM selection resolves to a source span by walking up to the nearest one.
 *
 * Kept separate from renderMarkdown rather than added as an option, because
 * assistant prose has nothing to address and the extra attributes would be
 * noise in every message bubble.
 */
export function renderMarkdownWithAnchors(src: string): AnchoredMarkdown {
  const blocks = splitBlocks(src);
  const html = blocks
    .map((block, i) => {
      const rendered = renderBlock(src, block);
      // Every branch of renderBlock returns markup, so the first tag always
      // exists; the anchor rides on it instead of an extra wrapper element,
      // which keeps the DOM (and therefore .sc-prose's spacing rules) unchanged.
      return rendered.replace(/^(\s*<[a-z][a-z0-9]*)/i, `$1 data-sc-block="${i}"`);
    })
    .join("");
  return { html, blocks };
}

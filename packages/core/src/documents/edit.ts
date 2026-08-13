// Reading and rewriting a Markdown document, as pure functions.
//
// Everything here is string in, string out. That is deliberate: the hard parts
// of in-chat editing are addressing and refusal, both of which are decidable
// without a store, a model or a browser — so they are decided in code that a
// unit test can pin exactly.

import { splitBlocks, type MarkdownBlock } from "../content/blocks.js";
import type {
  AppliedEdit,
  DocumentEdit,
  DocumentOutlineEntry,
  EditResult,
} from "./types.js";

const headingLevel = (line: string): number | undefined => {
  const m = /^ {0,3}(#{1,6})\s/.exec(line);
  return m ? m[1]!.length : undefined;
};

/**
 * A map of the document, cheap enough to send every turn.
 *
 * Editing is a directed activity — "the third section", "the bit about
 * renewal" — not a similarity search, so the model needs to navigate rather
 * than retrieve. An outline costs a line per block and lets it ask for exactly
 * the span it wants; without one it either guesses or is handed the whole
 * document, and the whole document is what this design exists to avoid.
 */
export function outlineOf(markdown: string): DocumentOutlineEntry[] {
  return splitBlocks(markdown).map((block, i) => {
    const raw = markdown.slice(block.start, block.end);
    const firstLine = raw.split("\n", 1)[0] ?? "";
    const level = block.kind === "text" ? headingLevel(firstLine) : undefined;
    return {
      block: i,
      kind: block.kind,
      ...(level ? { level } : {}),
      preview: firstLine.trim().slice(0, 100),
      chars: raw.length,
    };
  });
}

/** Source text of a block range, inclusive. Out-of-range yields "". */
export function spanOf(markdown: string, from: number, to = from): string {
  const blocks = splitBlocks(markdown);
  const first = blocks[Math.max(0, from)];
  const last = blocks[Math.min(blocks.length - 1, to)];
  if (!first || !last || first.start > last.end) return "";
  return markdown.slice(first.start, last.end);
}

/** Blocks whose text contains `query`, case-insensitively. */
export function searchBlocks(markdown: string, query: string): DocumentOutlineEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const blocks = splitBlocks(markdown);
  return outlineOf(markdown).filter((entry) => {
    const b = blocks[entry.block]!;
    return markdown.slice(b.start, b.end).toLowerCase().includes(needle);
  });
}

/** Every index at which `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string, offset = 0): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    out.push(i + offset);
  }
  return out;
}

const blockOf = (blocks: MarkdownBlock[], index: number): number =>
  Math.max(
    0,
    blocks.findIndex((b) => index >= b.start && index < b.end),
  );

/**
 * Apply edits to a document, or refuse.
 *
 * Refusing is half the job and the more important half. A find that matches
 * nothing means the model is quoting text that is not there; a find that
 * matches twice means it has not said which one. Guessing either — taking the
 * first match, say — produces a change in the wrong place that the diff will
 * present as if it were intended, and the user approves it. So both are
 * rejections with a reason the model can act on, exactly as tools/repair.ts
 * treats malformed arguments: an invalid input to retry, not a result.
 *
 * Edits are resolved against the ORIGINAL text and applied back-to-front, so
 * earlier edits cannot shift the offsets of later ones. Two edits that overlap
 * are a contradiction rather than a merge, and are refused.
 */
export function applyEdits(markdown: string, edits: readonly DocumentEdit[]): EditResult {
  if (!edits.length) return { ok: true, markdown, applied: [] };

  const blocks = splitBlocks(markdown);
  const applied: AppliedEdit[] = [];

  for (const edit of edits) {
    if (!edit.find) {
      return { ok: false, reason: "not-found", message: "An edit needs a non-empty `find`.", edit };
    }

    let hits: number[];
    if (edit.block === undefined) {
      hits = occurrences(markdown, edit.find);
    } else {
      const block = blocks[edit.block];
      if (!block) {
        return {
          ok: false,
          reason: "no-such-block",
          message: `Block ${edit.block} does not exist; the document has ${blocks.length}.`,
          edit,
        };
      }
      hits = occurrences(markdown.slice(block.start, block.end), edit.find, block.start);
    }

    if (hits.length === 0) {
      return {
        ok: false,
        reason: "not-found",
        message:
          `Could not find that text${edit.block === undefined ? "" : ` in block ${edit.block}`}. ` +
          "Re-read the document and quote it exactly, whitespace included.",
        edit,
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        message:
          `That text appears ${hits.length} times. Include more surrounding text, or name the block.`,
        edit,
      };
    }

    const start = hits[0]!;
    const end = start + edit.find.length;
    const clash = applied.find((a) => start < a.end && end > a.start);
    if (clash) {
      return {
        ok: false,
        reason: "ambiguous",
        message: "Two edits target overlapping text. Send them as one edit instead.",
        edit,
      };
    }

    applied.push({ edit, start, end, block: blockOf(blocks, start) });
  }

  // Back to front: rewriting from the end leaves every earlier offset valid.
  let out = markdown;
  for (const a of [...applied].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, a.start) + a.edit.replace + out.slice(a.end);
  }

  return { ok: true, markdown: out, applied };
}

/** Line-level view of one edit, for the approval card. */
export type EditHunk = {
  index: number;
  block: number;
  removed: string[];
  added: string[];
};

/**
 * One hunk per edit, rather than a computed diff.
 *
 * The point of hunks here is that the user can accept some and reject others,
 * and an edit is already the smallest independently-applicable unit — it
 * carries its own anchor. Deriving hunks from a text diff instead would produce
 * regions that are not separately applicable, which is the wrong shape for the
 * question being asked.
 */
export function hunksOf(applied: readonly AppliedEdit[]): EditHunk[] {
  return applied.map((a, index) => ({
    index,
    block: a.block,
    removed: a.edit.find.split("\n"),
    added: a.edit.replace === "" ? [] : a.edit.replace.split("\n"),
  }));
}

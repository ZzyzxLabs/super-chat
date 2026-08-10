// Block structure of a Markdown source, addressed by offsets.
//
// This lives in core rather than beside the renderer because two very different
// consumers have to agree on it exactly: the previewer, which turns a DOM
// selection into a block index, and the edit protocol, which resolves that same
// index back to text it is allowed to rewrite. Two implementations would drift,
// and the drift would be silent — a quote pointing at block 4 and an edit
// landing in block 5 both look fine until someone reads the result.

export type MarkdownBlockKind = "fence" | "text";

/** A top-level block, addressed by its half-open span in the SOURCE string. */
export type MarkdownBlock = {
  start: number;
  end: number;
  kind: MarkdownBlockKind;
};

type Line = { text: string; start: number; end: number };

function scanLines(src: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i <= src.length; i += 1) {
    if (i === src.length || src[i] === "\n") {
      out.push({ text: src.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return out;
}

const isFence = (text: string) => text.startsWith("```");


/**
 * Top-level blocks in source order, with their spans.
 *
 * Blank lines separate blocks and belong to none of them, so a span always
 * slices back to exactly the block's own text. Fences are scanned as a unit
 * before the blank-line rule gets a say — a blank line inside a code block is
 * part of the code, not a block boundary.
 */
export function splitBlocks(src: string): MarkdownBlock[] {
  const lines = scanLines(src);
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text.trim() === "") {
      i += 1;
      continue;
    }

    if (isFence(line.text)) {
      let j = i + 1;
      while (j < lines.length && !isFence(lines[j]!.text)) j += 1;
      // An unterminated fence runs to the end of the source rather than
      // swallowing the rest as prose — a half-streamed code block is a normal
      // state to render, not a malformed document.
      const closing = j < lines.length ? lines[j]! : lines[lines.length - 1]!;
      blocks.push({ start: line.start, end: closing.end, kind: "fence" });
      i = j + 1;
      continue;
    }

    let j = i;
    while (j < lines.length && lines[j]!.text.trim() !== "" && !isFence(lines[j]!.text)) j += 1;
    blocks.push({ start: line.start, end: lines[j - 1]!.end, kind: "text" });
    i = j;
  }

  return blocks;
}

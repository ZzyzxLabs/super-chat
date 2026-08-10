import { describe, expect, it } from "vitest";
import { QUOTES_METADATA_KEY, formatQuotes, quotesOf, withQuotes, type DocumentQuoteRef } from "./quotes.js";

const quote = (over: Partial<DocumentQuoteRef> = {}): DocumentQuoteRef => ({
  docId: "doc_1",
  title: "Q3 plan",
  revision: 2,
  blocks: [1, 1],
  start: 10,
  end: 30,
  text: "The **liability** cap is 12 months.",
  ...over,
});

describe("document quotes", () => {
  it("carries the SOURCE markdown, not what the screen rendered", () => {
    // Quoting rendered text would hand the model "liability" where the
    // document says "**liability**" — and the same span has to work as an edit
    // anchor later, where that difference decides whether a find matches.
    const out = formatQuotes([quote()]);
    expect(out).toContain("**liability**");
  });

  it("names the document, revision and block range", () => {
    const out = formatQuotes([quote({ blocks: [2, 4] })]);
    expect(out).toContain('"Q3 plan"');
    expect(out).toContain("doc_1 v2");
    expect(out).toContain("blocks 2–4");
  });

  it("says 'block' rather than a range when the quote is one block", () => {
    expect(formatQuotes([quote({ blocks: [3, 3] })])).toContain("block 3");
  });

  // A quote is arbitrary document text, so it can contain a fence of its own.
  // Truncating or escaping it would corrupt the very thing being quoted.
  it("grows the wrapper past any fence inside the quoted text", () => {
    const out = formatQuotes([quote({ text: "before\n```js\ncode\n```\nafter" })]);
    expect(out).toContain("````markdown");
    expect(out).toContain("```js");
    expect(out.trimEnd().endsWith("````")).toBe(true);
  });

  it("puts the quote before the user's own words", () => {
    const out = withQuotes("tighten this", [quote()]);
    expect(out.indexOf("Quoted from")).toBeLessThan(out.indexOf("tighten this"));
  });

  it("is a no-op with no quotes", () => {
    expect(formatQuotes([])).toBe("");
    expect(withQuotes("hello", [])).toBe("hello");
  });

  it("stands alone when the user quotes without typing anything", () => {
    const out = withQuotes("   ", [quote()]);
    expect(out).toContain("Quoted from");
    expect(out.trimEnd().endsWith("```")).toBe(true);
  });

  it("reads back off message metadata, and tolerates a message with none", () => {
    const q = quote();
    expect(quotesOf({ [QUOTES_METADATA_KEY]: [q] })).toEqual([q]);
    expect(quotesOf(undefined)).toEqual([]);
    expect(quotesOf({})).toEqual([]);
    // A corrupted entry degrades to "no quotes", never a crash — same rule the
    // stores follow.
    expect(quotesOf({ [QUOTES_METADATA_KEY]: "nonsense" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { applyEdits, hunksOf, outlineOf, searchBlocks, spanOf } from "./edit.js";
import { buildEml, buildMailto, emlFilename, MAILTO_SAFE_LENGTH } from "./email.js";
import { createMemoryDocumentStore } from "./store.js";
import type { EmailCard } from "../cards/types.js";

const DOC = [
  "# Vendor review",
  "",
  "Two suppliers, scored against the March criteria.",
  "",
  "## Findings",
  "",
  "The cheaper option fails SSO. The cheaper option is not a saving.",
  "",
  "```",
  "renewal = 2027-03-01",
  "",
  "notice = 90d",
  "```",
].join("\n");

describe("outline", () => {
  it("gives a navigable map without the body", () => {
    const outline = outlineOf(DOC);
    expect(outline.map((o) => o.preview)).toEqual([
      "# Vendor review",
      "Two suppliers, scored against the March criteria.",
      "## Findings",
      "The cheaper option fails SSO. The cheaper option is not a saving.",
      "```",
    ]);
    expect(outline[0]!.level).toBe(1);
    expect(outline[2]!.level).toBe(2);
    // Prose is not a heading, and the fence is not prose.
    expect(outline[1]!.level).toBeUndefined();
    expect(outline[4]!.kind).toBe("fence");
  });

  it("reports size so the model can budget before asking for text", () => {
    for (const entry of outlineOf(DOC)) expect(entry.chars).toBeGreaterThan(0);
  });
});

describe("reading spans", () => {
  it("returns exactly the requested blocks", () => {
    expect(spanOf(DOC, 2)).toBe("## Findings");
    expect(spanOf(DOC, 0, 1)).toBe("# Vendor review\n\nTwo suppliers, scored against the March criteria.");
  });

  it("clamps rather than throwing on a range past the end", () => {
    expect(spanOf(DOC, 0, 99)).toBe(DOC);
    expect(spanOf("", 0)).toBe("");
  });

  it("finds blocks containing a phrase, case-insensitively", () => {
    expect(searchBlocks(DOC, "SSO").map((m) => m.block)).toEqual([3]);
    expect(searchBlocks(DOC, "findings").map((m) => m.block)).toEqual([2]);
    expect(searchBlocks(DOC, "")).toEqual([]);
  });
});

describe("applying edits", () => {
  it("replaces an anchored span and leaves the rest alone", () => {
    const out = applyEdits(DOC, [{ block: 2, find: "## Findings", replace: "## What we found" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("## What we found");
    expect(out.markdown).toContain("# Vendor review");
    expect(out.markdown).toContain("renewal = 2027-03-01");
  });

  // Refusing is the more important half. A first-match-wins fallback puts a
  // change somewhere nobody asked for and then presents it for approval as
  // though it were intended — the user says yes to a diff that reads fine.
  it("refuses an anchor that matches nothing, and says to re-read", () => {
    const out = applyEdits(DOC, [{ find: "## Conclusions", replace: "## Wrap-up" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not-found");
    expect(out.message).toMatch(/re-read/i);
  });

  it("refuses an anchor that matches twice rather than picking one", () => {
    const out = applyEdits(DOC, [{ find: "The cheaper option", replace: "Supplier A" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("ambiguous");
    expect(out.message).toMatch(/appears 2 times/);
  });

  it("accepts the same anchor once a block narrows it to one occurrence", () => {
    // Same text, disambiguated by naming where it lives — which is what the
    // block index on a quote is for.
    const doc = "The cap is 12 months.\n\nElsewhere: The cap is 12 months.";
    const out = applyEdits(doc, [{ block: 1, find: "The cap is 12 months.", replace: "The cap is 24 months." }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toBe("The cap is 12 months.\n\nElsewhere: The cap is 24 months.");
  });

  it("names a block that does not exist instead of silently searching everywhere", () => {
    const out = applyEdits(DOC, [{ block: 99, find: "SSO", replace: "single sign-on" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no-such-block");
  });

  // Offsets are resolved against the ORIGINAL text, so an earlier edit that
  // changes length must not move a later one.
  it("applies several edits without letting them shift each other", () => {
    const out = applyEdits(DOC, [
      { block: 0, find: "# Vendor review", replace: "# Supplier review — final, with a much longer title" },
      { block: 2, find: "## Findings", replace: "## Findings and risks" },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("# Supplier review — final, with a much longer title");
    expect(out.markdown).toContain("## Findings and risks");
  });

  it("refuses two edits that target overlapping text", () => {
    const doc = "alpha beta gamma";
    const out = applyEdits(doc, [
      { find: "alpha beta", replace: "A" },
      { find: "beta gamma", replace: "B" },
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/overlapping/);
  });

  it("treats an empty replacement as a deletion", () => {
    const out = applyEdits(DOC, [{ block: 3, find: " The cheaper option is not a saving.", replace: "" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("The cheaper option fails SSO.");
    expect(out.markdown).not.toContain("is not a saving");
  });

  // A block span stops at the blank line that ends it, so an anchor written to
  // straddle that boundary finds nothing. Worth pinning: the alternative — a
  // block-scoped search that quietly widens to the whole document — would make
  // the block argument decorative exactly when it is being used to disambiguate.
  it("does not let a block-scoped anchor reach past the end of its block", () => {
    const out = applyEdits(DOC, [{ block: 2, find: "## Findings\n\nThe cheaper", replace: "x" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not-found");
  });

  it("rejects an edit with no anchor at all", () => {
    const out = applyEdits(DOC, [{ find: "", replace: "x" }]);
    expect(out.ok).toBe(false);
  });

  it("is a no-op for an empty edit list", () => {
    const out = applyEdits(DOC, []);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toBe(DOC);
  });
});

describe("hunks", () => {
  it("gives one independently applicable hunk per edit", () => {
    const out = applyEdits(DOC, [
      { block: 0, find: "# Vendor review", replace: "# Supplier review" },
      { block: 2, find: "## Findings", replace: "## Findings and risks" },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const hunks = hunksOf(out.applied);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ index: 0, block: 0, removed: ["# Vendor review"], added: ["# Supplier review"] });
    expect(hunks[1]!.block).toBe(2);
  });

  it("shows a deletion as removed lines with nothing added", () => {
    const out = applyEdits("keep\n\ndrop me", [{ block: 1, find: "drop me", replace: "" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(hunksOf(out.applied)[0]!.added).toEqual([]);
  });
});

describe("DocumentStore", () => {
  it("mints revision 1 and bumps it on every write", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    expect(doc.revision).toBe(1);
    const next = await store.update(doc.id, "two", 1);
    expect(next.revision).toBe(2);
    expect(next.markdown).toBe("two");
  });

  // The whole reason revisions exist: the user can change the document between
  // the model reading it and proposing an edit.
  it("refuses a write against a stale revision", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    await expect(store.update(doc.id, "three", 1)).rejects.toThrow(/revision 2, not 1/);
  });

  it("keeps prior bodies so undo is a checkout, not a computed inverse", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    await store.update(doc.id, "three", 2);
    expect((await store.history(doc.id)).map((h) => h.markdown)).toEqual(["two", "one"]);
  });

  it("reports a missing document rather than creating one", async () => {
    const store = createMemoryDocumentStore();
    await expect(store.update("nope", "x", 1)).rejects.toThrow(/No document nope/);
  });
});

describe("email exits", () => {
  const email: EmailCard = {
    kind: "email",
    to: ["counsel@example.com"],
    cc: ["ops@example.com"],
    subject: "Vendor review — redline",
    body: "Hi,\n\nThe redline is attached.\n\nThanks",
  };

  it("builds a mailto with recipients, subject and body", () => {
    const { href } = buildMailto(email);
    expect(href.startsWith("mailto:counsel%40example.com")).toBe(true);
    expect(href).toContain("cc=ops%40example.com");
    expect(href).toContain("subject=Vendor%20review");
  });

  // Clients disagree about a bare %0A and all of them accept %0D%0A.
  it("encodes newlines as CRLF", () => {
    expect(buildMailto(email).href).toContain("%0D%0A");
  });

  // The failure this flags is silent in every mail client: the body is simply
  // cut off, and the user sends a letter missing its end without being told.
  it("flags a body long enough that a client may truncate it", () => {
    const long = buildMailto({ ...email, body: "x".repeat(MAILTO_SAFE_LENGTH + 100) });
    expect(long.mayTruncate).toBe(true);
    expect(buildMailto(email).mayTruncate).toBe(false);
  });

  it("builds an .eml with CRLF line endings and the headers a client needs", () => {
    const eml = buildEml(email);
    expect(eml).toContain("To: counsel@example.com");
    expect(eml).toContain("Cc: ops@example.com");
    expect(eml).toContain("MIME-Version: 1.0");
    expect(eml).toContain("The redline is attached.");
    expect(eml.split("\n").every((l) => l.endsWith("\r") || !l.includes("\r"))).toBe(true);
    expect(eml).not.toMatch(/(?<!\r)\n/);
  });

  // A draft has not been sent, so stamping it with a send time would be a
  // small lie that some clients then display as fact.
  it("leaves Date and Message-ID to the client that actually sends it", () => {
    const eml = buildEml(email);
    expect(eml).not.toContain("Date:");
    expect(eml).not.toContain("Message-ID:");
  });

  it("encodes a non-ASCII subject as an RFC 2047 word", () => {
    const eml = buildEml({ ...email, subject: "報價單" });
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("makes a filesystem-safe filename from the subject", () => {
    // The em dash is not filename-safe, so it goes; the spaces around it
    // collapse with it rather than leaving a double hyphen behind.
    expect(emlFilename(email)).toBe("Vendor-review-redline.eml");
    expect(emlFilename({ ...email, subject: "" })).toBe("draft.eml");
    expect(emlFilename({ ...email, subject: "../../etc/passwd" })).not.toContain("/");
  });
});

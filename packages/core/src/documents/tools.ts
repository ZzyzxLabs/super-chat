// The document tools.
//
// Storage is the host's — these take a DocumentStore and never assume one. What
// the framework keeps is the protocol (how a document is addressed and
// rewritten) and the approval surface (what the user sees before anything
// changes), which is the same line Transport draws around credentials.
//
// Returned rather than registered, exactly as MCP imports and app actions are:
// a tool that can rewrite the user's document must be given its authority
// explicitly by whoever wires it up, never by virtue of existing.

import type { CardSpec } from "../cards/types.js";
import type { JSONSchema } from "../providers/types.js";
import type { ToolDefinition, ToolExecutionContext } from "../tools/types.js";
import { applyEdits, hunksOf, outlineOf, searchBlocks, spanOf } from "./edit.js";
import type { DocumentEdit, DocumentSnapshot, DocumentStore } from "./types.js";

export type DocumentToolsOptions = {
  store: DocumentStore;
  /** Cap on what a single read returns, so one call cannot flood context. */
  maxSpanChars?: number;
  /**
   * Cap on how many documents `listDocuments` names at once.
   *
   * The list is the cheapest thing here per entry and the easiest to let grow
   * without noticing: a host that has accumulated four hundred documents would
   * otherwise spend a page of context on the index before the model has read a
   * word of any of them.
   */
  maxListed?: number;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

const documentSpec = (doc: DocumentSnapshot): CardSpec => ({
  kind: "document",
  docId: doc.id,
  title: doc.title,
  markdown: doc.markdown,
  revision: doc.revision,
});

const CREATE_SCHEMA: JSONSchema = {
  type: "object",
  required: ["title", "markdown"],
  properties: {
    title: { type: "string", description: "Short, human title. Becomes the filename on download." },
    markdown: { type: "string", description: "The document body, in Markdown." },
  },
};

const READ_SCHEMA: JSONSchema = {
  type: "object",
  required: ["docId"],
  properties: {
    docId: { type: "string" },
    mode: {
      type: "string",
      enum: ["outline", "span", "search"],
      description:
        "outline: block index + heading + size for the whole document — start here. span: the text of a block range. search: blocks containing a phrase.",
    },
    from: { type: "number", description: "First block, for mode=span." },
    to: { type: "number", description: "Last block, for mode=span. Defaults to `from`." },
    query: { type: "string", description: "Phrase to look for, for mode=search." },
  },
};

const EDIT_SCHEMA: JSONSchema = {
  type: "object",
  required: ["docId", "revision", "edits"],
  properties: {
    docId: { type: "string" },
    revision: {
      type: "number",
      description: "The revision you read. If the document has moved on, the edit is refused.",
    },
    summary: { type: "string", description: "One line on what these changes do." },
    edits: {
      type: "array",
      description:
        "Each edit finds exact text and replaces it. Never send the whole document. If `find` matches nothing or matches twice, the edit is refused rather than guessed at.",
      items: {
        type: "object",
        required: ["find", "replace"],
        properties: {
          block: { type: "number", description: "Restrict the search to this block. Send it whenever you know it." },
          find: { type: "string", description: "Exact existing text, whitespace included." },
          replace: { type: "string", description: "What replaces it. Empty string deletes." },
        },
      },
    },
  },
};

/**
 * Build the document tools against a host store.
 *
 * `editDocument` is `side: "confirm"` and does its own asking: it computes the
 * change, shows it as an edit review, and writes only what came back accepted.
 * There is no path that writes without that answer.
 *
 * `listDocuments` is what makes the rest of them reachable. A docId arrives in
 * a tool result and then lives only in the transcript — which compaction trims,
 * and which a new thread never had. Without an index, "a document outlives its
 * thread" is true of the store and false of the agent: the document survives
 * and nothing can name it. It returns titles and sizes, never bodies, so
 * carrying it costs a line per document.
 */
export function createDocumentTools(opts: DocumentToolsOptions): ToolDefinition[] {
  const { store, maxSpanChars = 6000, maxListed = 50 } = opts;

  const listDocuments: ToolDefinition = {
    name: "listDocuments",
    description:
      "List the documents that exist, newest first — id, title and size, never the body. Use it when the user refers to something they worked on before and you do not have its id.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional filter on the title, case-insensitive." },
      },
    },
    side: "read",
    async execute(input) {
      const i = (input ?? {}) as Record<string, unknown>;
      const needle = str(i["query"]).trim().toLowerCase();
      const all = await store.list();
      const matched = needle ? all.filter((d) => d.title.toLowerCase().includes(needle)) : all;
      return {
        output: {
          documents: matched.slice(0, maxListed).map((d) => ({
            docId: d.id,
            title: d.title,
            revision: d.revision,
            blocks: outlineOf(d.markdown).length,
            chars: d.markdown.length,
            updatedAt: d.updatedAt,
          })),
          // Reported rather than silent, for the same reason a truncated span
          // is: a model that believes it has seen every document will tell the
          // user theirs does not exist.
          total: matched.length,
          truncated: matched.length > maxListed,
        },
      };
    },
  };

  const createDocument: ToolDefinition = {
    name: "createDocument",
    description:
      "Create a document the user will keep and come back to — a draft, a report, notes. Use instead of a long reply when the result is a thing rather than an answer. Returns an id for reading and editing it later.",
    inputSchema: CREATE_SCHEMA,
    side: "write",
    async execute(input) {
      const i = (input ?? {}) as Record<string, unknown>;
      const doc = await store.create({ title: str(i["title"]) || "Untitled", markdown: str(i["markdown"]) });
      return {
        // The model gets the handle and the shape, never the body: the card
        // below carries the body for the user, and stripCardPayload keeps it
        // out of context from the next turn on.
        output: {
          docId: doc.id,
          revision: doc.revision,
          title: doc.title,
          blocks: outlineOf(doc.markdown).length,
        },
        card: documentSpec(doc),
      };
    },
  };

  const readDocument: ToolDefinition = {
    name: "readDocument",
    description:
      "Read part of a document. Ask for the outline first, then the spans you actually need — the whole body is never returned at once.",
    inputSchema: READ_SCHEMA,
    side: "read",
    async execute(input) {
      const i = (input ?? {}) as Record<string, unknown>;
      const doc = await store.get(str(i["docId"]));
      if (!doc) return { output: { error: `No document ${str(i["docId"])}.` }, failure: "not-found" as const };

      const mode = str(i["mode"]) || "outline";
      if (mode === "outline") {
        return { output: { docId: doc.id, title: doc.title, revision: doc.revision, outline: outlineOf(doc.markdown) } };
      }
      if (mode === "search") {
        return { output: { docId: doc.id, revision: doc.revision, matches: searchBlocks(doc.markdown, str(i["query"])) } };
      }

      const from = num(i["from"]) ?? 0;
      const to = num(i["to"]) ?? from;
      const text = spanOf(doc.markdown, from, to);
      return {
        output: {
          docId: doc.id,
          revision: doc.revision,
          from,
          to,
          // Truncation is REPORTED, not silent: a model that believes it has
          // read a whole section will quote text that is not there, and the
          // edit will then be refused for a reason that looks like its fault.
          truncated: text.length > maxSpanChars,
          text: text.slice(0, maxSpanChars),
        },
      };
    },
  };

  const editDocument: ToolDefinition = {
    name: "editDocument",
    description:
      "Propose changes to a document. The user sees them as a diff and accepts them one at a time; nothing is written until they do.",
    inputSchema: EDIT_SCHEMA,
    side: "confirm",
    async execute(input, ctx: ToolExecutionContext) {
      const i = (input ?? {}) as Record<string, unknown>;
      const docId = str(i["docId"]);
      const doc = await store.get(docId);
      if (!doc) return { output: { error: `No document ${docId}.` }, failure: "not-found" as const };

      const revision = num(i["revision"]);
      if (revision !== doc.revision) {
        return {
          output: {
            error: `Document is at revision ${doc.revision}, you read ${revision}. Re-read it and propose again.`,
            revision: doc.revision,
          },
          failure: "invalid-input" as const,
        };
      }

      const edits = Array.isArray(i["edits"]) ? (i["edits"] as DocumentEdit[]) : [];
      const result = applyEdits(doc.markdown, edits);
      if (!result.ok) {
        // A refusal the model can act on, not a thrown error: "not-found" means
        // re-read, "ambiguous" means widen the anchor. Guessing instead would
        // put a change somewhere nobody asked for and present it for approval
        // as though it were intended.
        return { output: { error: result.message, reason: result.reason, edit: result.edit }, failure: "invalid-input" as const };
      }

      const hunks = hunksOf(result.applied);
      const answer = (await ctx.requestCard?.({
        kind: "editreview",
        docId: doc.id,
        title: doc.title,
        revision: doc.revision,
        ...(str(i["summary"]) ? { summary: str(i["summary"]) } : {}),
        hunks,
      })) as { accepted?: number[] } | undefined;

      // No handler, or a cancel, both mean nothing was approved. Defaulting to
      // "apply everything" when the answer is missing would turn a broken wire
      // into an unreviewed write.
      const accepted = Array.isArray(answer?.accepted) ? answer.accepted : [];
      if (!accepted.length) {
        return { output: { applied: 0, revision: doc.revision, note: "The user accepted none of the changes." } };
      }

      const chosen = result.applied.filter((_, index) => accepted.includes(index)).map((a) => a.edit);
      // Recomputed against the current body rather than reusing the offsets:
      // between proposing and accepting, the user may have applied another
      // edit, and the store's revision check is the backstop for that.
      const partial = applyEdits(doc.markdown, chosen);
      if (!partial.ok) {
        return { output: { error: partial.message, reason: partial.reason }, failure: "invalid-input" as const };
      }

      const next = await store.update(doc.id, partial.markdown, doc.revision);
      return {
        output: {
          docId: next.id,
          revision: next.revision,
          applied: accepted.length,
          rejected: hunks.length - accepted.length,
        },
        card: documentSpec(next),
      };
    },
  };

  const undoDocument: ToolDefinition = {
    name: "undoDocument",
    description: "Restore a document's previous version.",
    inputSchema: {
      type: "object",
      required: ["docId"],
      properties: { docId: { type: "string" } },
    },
    side: "write",
    async execute(input) {
      const i = (input ?? {}) as Record<string, unknown>;
      const docId = str(i["docId"]);
      const doc = await store.get(docId);
      if (!doc) return { output: { error: `No document ${docId}.` }, failure: "not-found" as const };

      const [previous] = await store.history(docId);
      if (!previous) return { output: { error: "This document has no earlier version." }, failure: "not-found" as const };

      // Undo restores a stored body and mints a NEW revision — it does not roll
      // the number back. An inverse edit would have to be computed, and can be
      // computed wrongly; a checkout cannot. And keeping revisions monotonic
      // means an in-flight edit proposed against the undone body is refused
      // rather than silently applied to text that no longer exists.
      const next = await store.update(docId, previous.markdown, doc.revision);
      return { output: { docId: next.id, revision: next.revision, restoredFrom: previous.revision }, card: documentSpec(next) };
    },
  };

  return [listDocuments, createDocument, readDocument, editDocument, undoDocument];
}

const EMAIL_SCHEMA: JSONSchema = {
  type: "object",
  required: ["to", "subject", "body"],
  properties: {
    to: { type: "array", items: { type: "string" } },
    cc: { type: "array", items: { type: "string" } },
    bcc: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    body: { type: "string", description: "Plain text. Not Markdown — mail cannot carry it here." },
  },
};

/**
 * Draft an email for the user to send.
 *
 * `draft` tier, and the tier is the whole point: this produces something the
 * user approves and sends themselves. There is no send path and no credential,
 * which is what makes it safe to hand out.
 */
export function createEmailDraftTool(): ToolDefinition {
  return {
    name: "draftEmail",
    description:
      "Draft an email for the user to review and send. It is never sent for them — they get an editable draft with the message ready to open in their mail client.",
    inputSchema: EMAIL_SCHEMA,
    side: "write",
    execute(input) {
      const i = (input ?? {}) as Record<string, unknown>;
      const to = Array.isArray(i["to"]) ? (i["to"] as string[]).map(String) : [];
      const spec: CardSpec = {
        kind: "email",
        to,
        ...(Array.isArray(i["cc"]) ? { cc: (i["cc"] as string[]).map(String) } : {}),
        ...(Array.isArray(i["bcc"]) ? { bcc: (i["bcc"] as string[]).map(String) } : {}),
        subject: str(i["subject"]),
        body: str(i["body"]),
      };
      return {
        output: { drafted: true, to, subject: str(i["subject"]), note: "Shown to the user as an editable draft; not sent." },
        card: spec,
      };
    },
  };
}

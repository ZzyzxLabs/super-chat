// Reference DocumentStores.
//
// Mirrors JobStore/FileStore: an in-memory one for tests and a localStorage one
// for a browser, both defensive on read so a corrupted entry degrades to "that
// document is gone" rather than taking the page with it.
//
// History is kept as full snapshots, not as inverse edits. Undo is then a
// checkout of a previous body — which cannot be computed wrongly, whereas an
// inverse edit can, and does, precisely when the document has moved on.

import { AgentError } from "../errors.js";
import { getItemWithLegacy } from "../runtime/storage.js";
import type { DocumentSnapshot, DocumentStore } from "./types.js";

/** Bounded so a long editing session cannot fill a storage quota. */
const MAX_HISTORY = 20;

let counter = 0;
const mintId = () => `doc_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

const staleError = (id: string, expected: number, actual: number) =>
  new AgentError(
    "invalid-request",
    `Document ${id} is at revision ${actual}, not ${expected}. Re-read it before editing.`,
  );

export function createMemoryDocumentStore(): DocumentStore {
  const docs = new Map<string, DocumentSnapshot>();
  const past = new Map<string, DocumentSnapshot[]>();

  return {
    async list() {
      return [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      return docs.get(id);
    },
    async create({ title, markdown, id }) {
      const now = Date.now();
      const doc: DocumentSnapshot = {
        id: id ?? mintId(),
        title,
        markdown,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      docs.set(doc.id, doc);
      past.set(doc.id, []);
      return doc;
    },
    async update(id, markdown, expectedRevision) {
      const current = docs.get(id);
      if (!current) throw new AgentError("invalid-request", `No document ${id}.`);
      if (current.revision !== expectedRevision) {
        throw staleError(id, expectedRevision, current.revision);
      }
      past.set(id, [current, ...(past.get(id) ?? [])].slice(0, MAX_HISTORY));
      const next: DocumentSnapshot = {
        ...current,
        markdown,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      docs.set(id, next);
      return next;
    },
    async remove(id) {
      docs.delete(id);
      past.delete(id);
    },
    async history(id) {
      return past.get(id) ?? [];
    },
  };
}

export function createLocalDocumentStore(key = "superchat:documents"): DocumentStore {
  type Persisted = { docs: Record<string, DocumentSnapshot>; past: Record<string, DocumentSnapshot[]> };

  const read = (): Persisted => {
    try {
      const raw = getItemWithLegacy(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (typeof parsed !== "object" || parsed === null) return { docs: {}, past: {} };
      const p = parsed as Partial<Persisted>;
      return { docs: p.docs ?? {}, past: p.past ?? {} };
    } catch {
      return { docs: {}, past: {} };
    }
  };

  const write = (all: Persisted) => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(all));
    } catch {
      // Quota or private mode. A lost document is bad; a thrown exception in
      // the middle of an approved edit is worse — the user already said yes.
    }
  };

  return {
    async list() {
      return Object.values(read().docs).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      return read().docs[id];
    },
    async create({ title, markdown, id }) {
      const all = read();
      const now = Date.now();
      const doc: DocumentSnapshot = {
        id: id ?? mintId(),
        title,
        markdown,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      all.docs[doc.id] = doc;
      all.past[doc.id] = [];
      write(all);
      return doc;
    },
    async update(id, markdown, expectedRevision) {
      const all = read();
      const current = all.docs[id];
      if (!current) throw new AgentError("invalid-request", `No document ${id}.`);
      if (current.revision !== expectedRevision) {
        throw staleError(id, expectedRevision, current.revision);
      }
      all.past[id] = [current, ...(all.past[id] ?? [])].slice(0, MAX_HISTORY);
      const next: DocumentSnapshot = {
        ...current,
        markdown,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      all.docs[id] = next;
      write(all);
      return next;
    },
    async remove(id) {
      const all = read();
      delete all.docs[id];
      delete all.past[id];
      write(all);
    },
    async history(id) {
      return read().past[id] ?? [];
    },
  };
}

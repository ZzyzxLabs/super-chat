import { afterEach, describe, expect, it } from "vitest";
import { createLocalMemoryStore } from "../memory/memory.js";
import { createLocalFileStore } from "./files.js";
import { createLocalJobStore } from "./jobs.js";
import { getItemWithLegacy } from "./storage.js";
import { createLocalThreadStore, threadSnapshot } from "./threads.js";

function fakeLocalStorage() {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  return data;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("getItemWithLegacy (rename shim)", () => {
  it("reads the pre-rename key when the current one is absent, and promotes it", () => {
    const data = fakeLocalStorage();
    data.set("agentloom:memory", "kept");

    expect(getItemWithLegacy("superchat:memory")).toBe("kept");
    // Promoted, so the fallback is paid once per key per browser, not forever.
    expect(data.get("superchat:memory")).toBe("kept");
    expect(data.has("agentloom:memory")).toBe(false);
  });

  it("prefers the current key and never resurrects the legacy one", () => {
    const data = fakeLocalStorage();
    data.set("superchat:memory", "new");
    data.set("agentloom:memory", "stale");

    expect(getItemWithLegacy("superchat:memory")).toBe("new");
    expect(data.get("agentloom:memory")).toBe("stale"); // untouched, not read
  });

  it("leaves keys outside the superchat namespace alone", () => {
    const data = fakeLocalStorage();
    data.set("agentloom:custom", "x");
    // A host that passed its own key never pays for our rename.
    expect(getItemWithLegacy("myapp:custom")).toBeNull();
    expect(data.get("agentloom:custom")).toBe("x");
  });

  it("returns null with no localStorage at all (SSR)", () => {
    expect(getItemWithLegacy("superchat:memory")).toBeNull();
  });
});

// The point of the shim is that user data written by the pre-rename build is
// still there after upgrading. One case per store that owns real data.
describe("stores read pre-rename data", () => {
  it("memory store", async () => {
    const data = fakeLocalStorage();
    data.set("agentloom:memory", JSON.stringify({ tone: { key: "tone", value: "terse", updatedAt: 1 } }));
    expect(await createLocalMemoryStore().list()).toEqual([{ key: "tone", value: "terse", updatedAt: 1 }]);
  });

  it("file store", async () => {
    const data = fakeLocalStorage();
    const stored = {
      ref: { kind: "providerFile", id: "file_1", provider: "openai" },
      filename: "a.pdf",
      createdAt: 1,
    };
    data.set("agentloom:files", JSON.stringify({ file_1: stored }));
    expect(await createLocalFileStore().get("file_1")).toEqual(stored);
  });

  it("job store — index and per-job keys both migrate", async () => {
    const data = fakeLocalStorage();
    const stored = { handle: { id: "resp_1", provider: "openai", status: "queued" }, createdAt: 1 };
    data.set("agentloom:jobs:index", JSON.stringify(["resp_1"]));
    data.set("agentloom:jobs:resp_1", JSON.stringify(stored));

    const store = createLocalJobStore();
    expect(await store.get("resp_1")).toEqual(stored);
    expect((await store.list()).map((j) => j.handle.id)).toEqual(["resp_1"]);
  });

  it("thread store — index and per-thread keys both migrate", async () => {
    const data = fakeLocalStorage();
    const snap = threadSnapshot("t_1", [{ id: "u1", role: "user", parts: [{ type: "text", text: "before the rename" }] }]);
    data.set("agentloom:threads:index", JSON.stringify([snap.meta]));
    data.set("agentloom:threads:t_1", JSON.stringify(snap));

    const store = createLocalThreadStore();
    expect((await store.list()).map((m) => m.id)).toEqual(["t_1"]);
    expect((await store.load("t_1"))?.messages).toEqual(snap.messages);
    expect(data.has("agentloom:threads:t_1")).toBe(false);
  });

  it("the playground's own prefixed keys migrate too", async () => {
    const data = fakeLocalStorage();
    data.set("agentloom:playground:memory", JSON.stringify({ a: { key: "a", value: "b", updatedAt: 1 } }));
    const store = createLocalMemoryStore("superchat:playground:memory");
    expect(await store.list()).toEqual([{ key: "a", value: "b", updatedAt: 1 }]);
  });
});

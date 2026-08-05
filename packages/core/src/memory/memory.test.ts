import { afterEach, describe, expect, it } from "vitest";
import { ContextBuilder } from "../context/builder.js";
import { userMessage } from "../content/parts.js";
import {
  createLocalMemoryStore,
  createMemoryMemoryStore,
  createMemorySource,
  createRememberTool,
} from "./memory.js";

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("memory stores", () => {
  it("set/list/remove round-trips, keyed for updates not duplicates", async () => {
    const store = createMemoryMemoryStore();
    await store.set("lang", "TypeScript");
    await store.set("lang", "Rust"); // update, not duplicate
    await store.set("tone", "terse");
    expect((await store.list()).map((e) => `${e.key}=${e.value}`)).toEqual(["lang=Rust", "tone=terse"]);
    await store.remove("lang");
    expect(await store.list()).toHaveLength(1);
  });

  it("localStorage store is defensive about corrupted data", async () => {
    const data = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    };
    const store = createLocalMemoryStore("test:memory");
    await store.set("a", "1");
    data.set("test:memory", "{corrupted");
    expect(await store.list()).toEqual([]); // degraded, not thrown
  });
});

describe("createMemorySource + createRememberTool", () => {
  it("injects remembered facts as a budgeted, traced memory layer", async () => {
    const store = createMemoryMemoryStore();
    await store.set("preferred-language", "繁體中文");

    const builder = new ContextBuilder({
      identity: "Test agent.",
      contextWindow: 32_000,
      sources: [createMemorySource(store)],
    });
    const context = await builder.build({ messages: [userMessage("hello")], vars: {} });

    expect(context.system).toContain("preferred-language: 繁體中文");
    expect(context.trace.entries.some((e) => e.id === "memory" && e.status === "included")).toBe(true);
  });

  it("contributes nothing when memory is empty", async () => {
    const builder = new ContextBuilder({
      identity: "Test agent.",
      contextWindow: 32_000,
      sources: [createMemorySource(createMemoryMemoryStore())],
    });
    const context = await builder.build({ messages: [userMessage("hello")], vars: {} });
    expect(context.system).not.toContain("remember");
  });

  it("remember tool writes, updates and forgets through the same store the source reads", async () => {
    const store = createMemoryMemoryStore();
    const tool = createRememberTool(store);

    await tool.execute!({ key: "team", value: "growth" }, { vars: {}, callId: "c1" });
    expect(await store.list()).toEqual([expect.objectContaining({ key: "team", value: "growth" })]);

    await tool.execute!({ key: "team", value: null }, { vars: {}, callId: "c2" });
    expect(await store.list()).toEqual([]);

    const bad = await tool.execute!({}, { vars: {}, callId: "c3" });
    expect(bad).toMatchObject({ failure: "invalid-input" });
  });
});

// AgentClient persistence tests, against the same mocked-transport harness the
// core runtime tests use: real adapter, real run loop, no network.

import { describe, expect, it } from "vitest";
import {
  ContextBuilder,
  ToolRegistry,
  createMemoryThreadStore,
  createOpenAIProvider,
  type Transport,
  type TransportRequest,
} from "@agentloom/core";
import { AgentClient } from "./client.js";

function mockTransport(responses: unknown[]): Transport {
  let i = 0;
  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(): Promise<Response> {
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  } satisfies Transport & { fetch(req: TransportRequest): Promise<Response> };
}

const respondText = (text: string, id = "resp_1") => ({
  id,
  object: "response",
  created_at: 0,
  model: "gpt-5.2",
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

function makeClient(responses: unknown[], over: Partial<ConstructorParameters<typeof AgentClient>[0]> = {}) {
  return new AgentClient({
    provider: createOpenAIProvider({ transport: mockTransport(responses), dialect: "responses" }),
    model: "gpt-5.2",
    contextBuilder: new ContextBuilder({ identity: "You are a test agent.", contextWindow: 32_000 }),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
    mode: "sync",
    ...over,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("AgentClient + ThreadStore", () => {
  it("saves after the user turn and again after the assistant turn", async () => {
    const store = createMemoryThreadStore();
    const saves: number[] = [];
    const spyStore = {
      ...store,
      save: async (t: Parameters<typeof store.save>[0]) => {
        saves.push(t.messages.length);
        await store.save(t);
      },
    };
    const client = makeClient([respondText("Hello.")], { threadStore: spyStore });

    await client.send("hi there");
    await flush();

    // First save: just the user message (a reload mid-run keeps the turn).
    // Second: user + assistant after commit.
    expect(saves).toEqual([1, 2]);
    const metas = await store.list();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.title).toBe("hi there");
    const stored = await store.load(client.store.get().id);
    expect(stored?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("openThread hydrates messages and resets run state", async () => {
    const store = createMemoryThreadStore();
    const first = makeClient([respondText("Answer one.")], { threadStore: store });
    await first.send("question one");
    await flush();
    const threadId = first.store.get().id;

    // A different client (fresh page) opens the stored thread.
    const second = makeClient([respondText("unused")], { threadStore: store });
    expect(await second.openThread(threadId)).toBe(true);

    const s = second.store.get();
    expect(s.id).toBe(threadId);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(s.status).toBe("idle");
    expect(s.cards).toEqual([]);

    expect(await second.openThread("t_missing")).toBe(false);
    // A failed open leaves the current thread untouched.
    expect(second.store.get().id).toBe(threadId);
  });

  it("newThread mints a fresh id and persists nothing until the next send", async () => {
    const store = createMemoryThreadStore();
    const client = makeClient([respondText("Hi.")], { threadStore: store });
    await client.send("hello");
    await flush();
    const oldId = client.store.get().id;

    client.newThread();
    const newId = client.store.get().id;
    expect(newId).not.toBe(oldId);
    expect(client.store.get().messages).toEqual([]);
    await flush();
    expect((await store.list()).map((m) => m.id)).toEqual([oldId]);

    await client.send("second thread");
    await flush();
    const ids = (await store.list()).map((m) => m.id);
    expect(ids).toContain(oldId);
    expect(ids).toContain(newId);
    // The old thread's saved turns were not disturbed.
    expect((await store.load(oldId))?.messages).toHaveLength(2);
  });

  it("keeps createdAt stable when a hydrated client re-saves", async () => {
    const store = createMemoryThreadStore();
    const first = makeClient([respondText("one")], { threadStore: store });
    await first.send("hello");
    await flush();
    const threadId = first.store.get().id;
    const createdAt = (await store.load(threadId))!.meta.createdAt;

    // Fresh client hydrated via config, as a page reload would do.
    const stored = await store.load(threadId);
    const second = makeClient([respondText("two")], {
      threadStore: store,
      threadId: stored!.meta.id,
      initialMessages: stored!.messages,
    });
    await second.send("again");
    await flush();

    expect((await store.load(threadId))!.meta.createdAt).toBe(createdAt);
  });

  it("runs without a threadStore exactly as before", async () => {
    const client = makeClient([respondText("no store")]);
    await client.send("hi");
    expect(client.store.get().messages).toHaveLength(2);
  });
});

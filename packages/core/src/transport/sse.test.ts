import { describe, expect, it } from "vitest";
import { parseSSE, parseSSEJson } from "./sse.js";

/** Build a stream that emits the given byte chunks, to simulate arbitrary splits. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("parseSSE", () => {
  it("parses simple events", async () => {
    const events = await collect(parseSSE(streamOf(["event: ping\ndata: hello\n\n"])));
    expect(events).toEqual([{ event: "ping", data: "hello" }]);
  });

  it("reassembles events split mid-line across chunks", async () => {
    // The failure this guards: naive split("\n\n") on each chunk loses events.
    const events = await collect(parseSSE(streamOf(["event: msg\nda", "ta: par", "tial\n\n"])));
    expect(events).toEqual([{ event: "msg", data: "partial" }]);
  });

  it("handles a UTF-8 character split across a chunk boundary", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: 你好\n\n");
    // Split inside the multi-byte sequence for 你.
    const first = bytes.slice(0, 8);
    const second = bytes.slice(8);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const events = await collect(parseSSE(stream));
    expect(events[0]?.data).toBe("你好");
  });

  it("joins multiple data lines with a newline", async () => {
    const events = await collect(parseSSE(streamOf(["data: one\ndata: two\n\n"])));
    expect(events[0]?.data).toBe("one\ntwo");
  });

  it("ignores comment/heartbeat lines", async () => {
    const events = await collect(parseSSE(streamOf([": keep-alive\n\ndata: real\n\n"])));
    expect(events).toEqual([{ event: "message", data: "real" }]);
  });

  it("accepts CRLF and bare CR terminators", async () => {
    const crlf = await collect(parseSSE(streamOf(["data: a\r\n\r\n"])));
    expect(crlf[0]?.data).toBe("a");
    const cr = await collect(parseSSE(streamOf(["data: b\r\r"])));
    expect(cr[0]?.data).toBe("b");
  });

  it("waits on a trailing CR that might be half of CRLF", async () => {
    const events = await collect(parseSSE(streamOf(["data: x\r", "\ndata: y\r\n\r\n"])));
    expect(events.map((e) => e.data)).toEqual(["x\ny"]);
  });

  it("strips exactly one leading space after the colon", async () => {
    const events = await collect(parseSSE(streamOf(["data:  two-spaces\n\n"])));
    expect(events[0]?.data).toBe(" two-spaces");
  });

  it("flushes a trailing event with no final blank line", async () => {
    const events = await collect(parseSSE(streamOf(["data: last\n"])));
    expect(events[0]?.data).toBe("last");
  });

  it("keeps concurrent streams isolated", async () => {
    // Per-instance decoder state: interleaved reads must not bleed together.
    const a = parseSSE(streamOf(["data: A1\n\ndata: A2\n\n"]));
    const b = parseSSE(streamOf(["data: B1\n\ndata: B2\n\n"]));
    const [a1, b1, a2, b2] = [await a.next(), await b.next(), await a.next(), await b.next()];
    expect([a1.value?.data, b1.value?.data, a2.value?.data, b2.value?.data]).toEqual(["A1", "B1", "A2", "B2"]);
  });
});

describe("parseSSEJson", () => {
  it("parses JSON payloads and stops at [DONE]", async () => {
    const events = await collect(
      parseSSEJson<{ n: number }>(streamOf(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n'])),
    );
    expect(events.map((e) => e.data.n)).toEqual([1, 2]);
  });

  it("skips a malformed frame rather than killing the stream", async () => {
    const events = await collect(parseSSEJson<{ n: number }>(streamOf(['data: {broken\n\ndata: {"n":9}\n\n'])));
    expect(events.map((e) => e.data.n)).toEqual([9]);
  });
});

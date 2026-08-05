import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./binary.js";

const roundTrip = (bytes: Uint8Array) => base64ToBytes(bytesToBase64(bytes));

describe("base64", () => {
  it("matches the platform encoder on simple input", () => {
    const bytes = new TextEncoder().encode("hello world");
    expect(bytesToBase64(bytes)).toBe("aGVsbG8gd29ybGQ=");
  });

  it("round-trips every remainder length (padding cases)", () => {
    for (const len of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(len).map((_, i) => i * 37);
      expect([...roundTrip(bytes)]).toEqual([...bytes]);
    }
  });

  it("round-trips all 256 byte values", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect([...roundTrip(bytes)]).toEqual([...bytes]);
  });

  it("round-trips input large enough to cross the chunk boundary", () => {
    // 100k bytes exceeds the 0x8000-char flush threshold several times over —
    // the case where a naive `btoa(String.fromCharCode(...bytes))` blows the stack.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff;
    const back = roundTrip(bytes);
    expect(back.length).toBe(bytes.length);
    expect(back[99_999]).toBe(bytes[99_999]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("tolerates whitespace and padding in decode input", () => {
    expect(new TextDecoder().decode(base64ToBytes("aGVs\nbG8=\n"))).toBe("hello");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base64ToBytes("aGV!bG8=")).toThrow(/Invalid base64/);
  });
});

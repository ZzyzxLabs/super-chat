// Hand-rolled base64, because the built-ins both have sharp edges here:
// `Buffer` is Node-only (core is isomorphic), and `btoa(String.fromCharCode(
// ...bytes))` blows the call stack on anything bigger than a small image.
// A 20 MB upload through the proxy envelope is the sizing case.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out +=
      ALPHABET[b0 >> 2]! +
      ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]! +
      (i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=") +
      (i + 2 < bytes.length ? ALPHABET[b2 & 0x3f]! : "=");
    // Flush periodically so the accumulator never becomes one enormous rope.
    if (out.length >= 0x8000) {
      chunks.push(out);
      out = "";
    }
  }
  chunks.push(out);
  return chunks.join("");
}

export function base64ToBytes(s: string): Uint8Array {
  // Tolerate whitespace/newlines (some serializers wrap long values).
  const clean = s.replace(/[\s=]+/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outPos = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? REVERSE[code]! : -1;
    if (value < 0) throw new Error(`Invalid base64 character "${clean[i]}" at position ${i}.`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outPos] = (buffer >> bits) & 0xff;
      outPos += 1;
    }
  }
  return out.subarray(0, outPos);
}

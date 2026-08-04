// Tool-call repair.
//
// Models emit malformed tool arguments often enough that treating it as an
// exception is the wrong design — a turn that dies on a stray newline inside a
// JSON string is worse than a turn that fixes it and continues. Every fix here
// is *syntactic and lossless*: we never invent argument values, so a repair can
// change whether the call parses but not what it means.
//
// Observed failure modes, in the order we handle them:
//   1. empty string / "null" for a no-argument tool         → {}
//   2. markdown fences around the JSON (```json … ```)      → strip
//   3. double-encoded JSON ("\"{\\\"a\\\":1}\"")            → parse twice
//   4. raw control characters inside string literals        → escape them
//   5. trailing commas before } or ]                        → drop
//   6. Python literals (True/False/None) from local models  → JSON literals
//   7. single-quoted keys/values                            → double quotes
//   8. prose wrapped around a JSON object                   → extract the object

export type RepairResult = { value: unknown; repaired: boolean; error?: string };

/** Provider prefixes some routers prepend to tool names. Stripped before dispatch. */
const NAME_PREFIXES = [/^functions\./, /^mcp_/, /^default_api[:.]/, /^tool[:.]/];

/**
 * Normalize a tool name. Some OpenAI-compatible routers namespace tool names on
 * the way out but not on the way in, so the model calls `functions.getPrice`
 * for a tool we registered as `getPrice`.
 */
export function normalizeToolName(name: string): string {
  let out = name.trim();
  for (const re of NAME_PREFIXES) out = out.replace(re, "");
  return out;
}

/** Escape control characters that appear *inside* JSON string literals. */
function escapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < " ") {
      const map: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
      out += map[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Remove trailing commas before a closing brace/bracket, outside of strings. */
function dropTrailingCommas(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (!inString && ch === ",") {
      const rest = input.slice(i + 1);
      const nextNonSpace = rest.match(/^\s*(.)/)?.[1];
      if (nextNonSpace === "}" || nextNonSpace === "]") continue; // drop it
    }
    out += ch;
  }
  return out;
}

/** Extract the outermost balanced {...} from prose, respecting string literals. */
function extractJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse tool arguments, repairing what can be repaired losslessly.
 * Returns `{}` rather than throwing when nothing is salvageable — an empty
 * argument object lets the tool's own validation produce a message the model can
 * act on, which beats a parse error the model never sees.
 */
export function repairToolArguments(raw: unknown): RepairResult {
  if (raw == null) return { value: {}, repaired: false };
  if (typeof raw === "object") return { value: raw, repaired: false };
  if (typeof raw !== "string") return { value: {}, repaired: true, error: `Unexpected argument type ${typeof raw}` };

  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "{}") {
    return { value: {}, repaired: trimmed !== "{}" };
  }

  // Fast path: already valid.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // Double-encoded: valid JSON that yields a string which is itself JSON.
    if (typeof parsed === "string") {
      try {
        return { value: JSON.parse(parsed) as unknown, repaired: true };
      } catch {
        return { value: { value: parsed }, repaired: true };
      }
    }
    return { value: parsed, repaired: false };
  } catch {
    /* fall through to repairs */
  }

  const candidates: string[] = [];
  const defenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  candidates.push(defenced);
  candidates.push(escapeControlCharsInStrings(defenced));
  candidates.push(dropTrailingCommas(escapeControlCharsInStrings(defenced)));
  candidates.push(
    dropTrailingCommas(escapeControlCharsInStrings(defenced))
      // Python literals, only as standalone tokens so "None of the above" survives.
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null"),
  );
  // Single quotes last: it is the most destructive fix (an apostrophe inside a
  // value becomes a quote), so it only runs when everything else has failed.
  candidates.push(
    dropTrailingCommas(escapeControlCharsInStrings(defenced)).replace(/'([^'\\]*)'(\s*[:,}\]])/g, '"$1"$2'),
  );
  const extracted = extractJsonObject(defenced);
  if (extracted) {
    candidates.push(extracted, dropTrailingCommas(escapeControlCharsInStrings(extracted)));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return { value: parsed, repaired: true };
    } catch {
      continue;
    }
  }

  return { value: {}, repaired: true, error: `Could not parse tool arguments: ${trimmed.slice(0, 200)}` };
}

// Rename shim: `agentloom:` → `superchat:` storage keys.
//
// Before the framework was renamed, every default storage key was prefixed
// `agentloom:`. Those keys hold real user data — conversations, remembered
// facts, uploaded-file refs, background job handles — so flipping the prefix
// without a read-through would silently orphan all of it: the data is still on
// disk, the app just never looks there again.
//
// So each read of a `superchat:`-prefixed key falls back once to its
// `agentloom:` twin, promotes the value under the new key, and drops the old
// one. Prefix-swap rather than a registry of known keys, so it covers hosts
// that passed their own key too (the playground's `superchat:playground:*`).
//
// This is a removable shim, not architecture. Delete this file and its four
// call sites once the pre-rename keys are no longer worth carrying.

const LEGACY_PREFIX = "agentloom:";
const CURRENT_PREFIX = "superchat:";

/**
 * `localStorage.getItem`, with a one-time read-through of the pre-rename key.
 *
 * The promotion is what keeps this cheap: the fallback costs one extra read per
 * key per browser, not one on every call forever. Keys outside the
 * `superchat:` namespace read straight through — a host with its own naming
 * never pays for our rename.
 */
export function getItemWithLegacy(key: string): string | null {
  const store = globalThis.localStorage;
  if (!store) return null;

  const current = store.getItem(key);
  if (current != null) return current;
  if (!key.startsWith(CURRENT_PREFIX)) return current;

  const legacy = store.getItem(LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length));
  if (legacy == null) return current;

  try {
    store.setItem(key, legacy);
    store.removeItem(LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length));
  } catch {
    // Quota or private mode. The value is still returned; the promotion simply
    // gets retried on the next read.
  }
  return legacy;
}

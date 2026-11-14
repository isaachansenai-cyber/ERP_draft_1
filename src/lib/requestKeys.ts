// One request key per user intent, kept in sessionStorage until the outcome is
// known, so a reload during an uncertain write retries with the SAME key
// (CLAUDE.md §8, AC29). Storage can be unavailable; fall back to memory.

const PREFIX = 'rpc-intent:';
const memory = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* memory fallback already set */
  }
}

function storageRemove(key: string): void {
  memory.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function intentStorageKey(intentId: string): string {
  return PREFIX + intentId;
}

export function getOrCreateRequestKey(intentId: string): string {
  const k = intentStorageKey(intentId);
  const existing = storageGet(k);
  if (existing) return existing;
  const created = crypto.randomUUID();
  storageSet(k, created);
  return created;
}

export function peekRequestKey(intentId: string): string | null {
  return storageGet(intentStorageKey(intentId));
}

export function clearRequestKey(intentId: string): void {
  storageRemove(intentStorageKey(intentId));
}

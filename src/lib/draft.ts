// POS cart draft: kept in localStorage per location and always labeled as an
// UNSENT draft (CLAUDE.md §8). It has no stock or money effect; only
// accept_order creates an order. Storage may be unavailable; fall back to memory.

export interface DraftLine {
  item_id: string;
  quantity: number;
}

export interface PosDraft {
  draftId: string;
  lines: DraftLine[];
  customerId: string | null;
  customerName: string | null;
  pickupName: string;
  note: string;
  discountPercent: string;
  discountReason: string;
}

const memory = new Map<string, string>();
const key = (locationId: string) => `pos-draft:${locationId}`;

export function newDraft(): PosDraft {
  return {
    draftId: crypto.randomUUID(),
    lines: [],
    customerId: null,
    customerName: null,
    pickupName: '',
    note: '',
    discountPercent: '',
    discountReason: '',
  };
}

export function loadDraft(locationId: string): PosDraft {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(locationId));
  } catch {
    raw = memory.get(key(locationId)) ?? null;
  }
  if (!raw) return newDraft();
  try {
    const parsed = JSON.parse(raw) as PosDraft;
    if (!parsed.draftId || !Array.isArray(parsed.lines)) return newDraft();
    return { ...newDraft(), ...parsed };
  } catch {
    return newDraft();
  }
}

export function saveDraft(locationId: string, draft: PosDraft): void {
  const raw = JSON.stringify(draft);
  memory.set(key(locationId), raw);
  try {
    window.localStorage.setItem(key(locationId), raw);
  } catch {
    /* memory only */
  }
}

export function clearDraft(locationId: string): void {
  memory.delete(key(locationId));
  try {
    window.localStorage.removeItem(key(locationId));
  } catch {
    /* ignore */
  }
}

/** Add one unit of an item, or change a line's quantity (whole numbers 1–999; 0 removes). */
export function setLineQuantity(lines: DraftLine[], itemId: string, quantity: number): DraftLine[] {
  const q = Math.max(0, Math.min(999, Math.trunc(quantity)));
  const exists = lines.some((l) => l.item_id === itemId);
  if (q === 0) return lines.filter((l) => l.item_id !== itemId);
  if (!exists) return [...lines, { item_id: itemId, quantity: q }];
  return lines.map((l) => (l.item_id === itemId ? { ...l, quantity: q } : l));
}

export type ScanResult =
  | { kind: 'add'; itemId: string }
  | { kind: 'ingredient'; code: string }
  | { kind: 'unknown'; code: string }
  | { kind: 'unavailable'; itemId: string };

/** Interpret a keyboard-wedge scan (AC28): ingredients are never added to the POS. */
export function interpretScan(raw: string, menu: Array<{ item_id: string; is_available: boolean }>): ScanResult {
  const code = raw.trim().toUpperCase();
  if (/^ING-\d{3}$/.test(code)) return { kind: 'ingredient', code };
  const item = menu.find((m) => m.item_id === code);
  if (!item) return { kind: 'unknown', code };
  if (!item.is_available) return { kind: 'unavailable', itemId: item.item_id };
  return { kind: 'add', itemId: item.item_id };
}

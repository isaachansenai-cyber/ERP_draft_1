import type { MenuItem } from './webApi';

// The cart is a browser-side draft per pickup location. Nothing here is an
// order: prices, availability and limits always come from the ERP's menu.

export interface CartLine {
  item_id: string;
  quantity: number;
}

const clampQty = (q: number, max: number) => Math.max(0, Math.min(Math.trunc(q), max));

/** Add to (or create) a line, never above `max`. */
export function addToCart(lines: CartLine[], itemId: string, quantity: number, max: number): CartLine[] {
  const existing = lines.find((l) => l.item_id === itemId);
  const next = clampQty((existing?.quantity ?? 0) + quantity, max);
  if (next === 0) return lines.filter((l) => l.item_id !== itemId);
  return existing
    ? lines.map((l) => (l.item_id === itemId ? { ...l, quantity: next } : l))
    : [...lines, { item_id: itemId, quantity: next }];
}

/** Set a line's quantity (0 drops the line), never above `max`. */
export function setQuantity(lines: CartLine[], itemId: string, quantity: number, max: number): CartLine[] {
  const next = clampQty(quantity, max);
  return next === 0
    ? lines.filter((l) => l.item_id !== itemId)
    : lines.map((l) => (l.item_id === itemId ? { ...l, quantity: next } : l));
}

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

export type LineProblem = 'unknown_item' | 'sold_out' | 'too_many';

export interface PricedLine extends CartLine {
  item: MenuItem | undefined;
  lineCents: number | null;
  problem: LineProblem | null;
}

/** Join the cart with the latest menu: price each line and flag what cannot be ordered now. */
export function priceCart(
  lines: CartLine[],
  menu: MenuItem[],
): { lines: PricedLine[]; subtotalCents: number; ok: boolean } {
  const priced = lines.map((l): PricedLine => {
    const item = menu.find((m) => m.item_id === l.item_id);
    const problem: LineProblem | null = !item
      ? 'unknown_item'
      : !item.available || item.price_cents === null
        ? 'sold_out'
        : l.quantity > item.max_orderable
          ? 'too_many'
          : null;
    const lineCents = item?.price_cents != null ? item.price_cents * l.quantity : null;
    return { ...l, item, lineCents, problem };
  });
  return {
    lines: priced,
    subtotalCents: priced.reduce((sum, l) => sum + (l.problem === null && l.lineCents !== null ? l.lineCents : 0), 0),
    ok: priced.length > 0 && priced.every((l) => l.problem === null),
  };
}

const storageKey = (locationId: string) => `matw.cart.v1.${locationId}`;

function isLine(x: unknown): x is CartLine {
  if (typeof x !== 'object' || x === null) return false;
  const l = x as Record<string, unknown>;
  return typeof l.item_id === 'string' && Number.isInteger(l.quantity) && (l.quantity as number) > 0;
}

export function loadCart(locationId: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(storageKey(locationId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

export function saveCart(locationId: string, lines: CartLine[]): void {
  try {
    window.localStorage.setItem(storageKey(locationId), JSON.stringify(lines));
  } catch {
    /* storage unavailable: the cart lasts only for this page view */
  }
}

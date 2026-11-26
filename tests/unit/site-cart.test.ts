import { describe, expect, it } from 'vitest';
import { addToCart, cartCount, priceCart, setQuantity, type CartLine } from '../../site/src/lib/cart';
import { closedMessage, hoursSummary, prepNote } from '../../site/src/lib/describe';
import { formatCents } from '../../site/src/lib/money';
import { menuSchema, type MenuItem } from '../../site/src/lib/webApi';

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  item_id: 'FG-001',
  name: 'Brazilian Chicken Strogonoff',
  item_type: 'finished_dish',
  country: 'Brazil',
  description: 'Chicken in a creamy sauce.',
  image_path: null,
  allergen_note: null,
  price_cents: 1599,
  prep_lead_days: 0,
  prep_minutes: 25,
  available: true,
  max_orderable: 10,
  ...over,
});

describe('cart rules (browser-side draft)', () => {
  it('adds, merges and never goes above the limit', () => {
    let lines: CartLine[] = [];
    lines = addToCart(lines, 'FG-001', 2, 10);
    lines = addToCart(lines, 'FG-001', 3, 10);
    lines = addToCart(lines, 'RET-001', 20, 4);
    expect(lines).toEqual([
      { item_id: 'FG-001', quantity: 5 },
      { item_id: 'RET-001', quantity: 4 },
    ]);
    expect(cartCount(lines)).toBe(9);
  });

  it('sets whole quantities and drops a line at zero', () => {
    const lines = [{ item_id: 'FG-001', quantity: 5 }];
    expect(setQuantity(lines, 'FG-001', 2.7, 10)).toEqual([{ item_id: 'FG-001', quantity: 2 }]);
    expect(setQuantity(lines, 'FG-001', 0, 10)).toEqual([]);
    expect(setQuantity(lines, 'FG-001', 50, 10)).toEqual([{ item_id: 'FG-001', quantity: 10 }]);
  });

  it('prices lines from the live menu and flags sold-out, over-limit and unknown items', () => {
    const menu = [
      item(),
      item({ item_id: 'FG-003', available: false, max_orderable: 0 }),
      item({ item_id: 'RET-001', item_type: 'retail', price_cents: 699, max_orderable: 2 }),
    ];
    const cart = priceCart(
      [
        { item_id: 'FG-001', quantity: 2 },
        { item_id: 'FG-003', quantity: 1 },
        { item_id: 'RET-001', quantity: 3 },
        { item_id: 'FG-999', quantity: 1 },
      ],
      menu,
    );
    expect(cart.lines.map((l) => l.problem)).toEqual([null, 'sold_out', 'too_many', 'unknown_item']);
    expect(cart.subtotalCents).toBe(3198);
    expect(cart.ok).toBe(false);
    expect(priceCart([{ item_id: 'FG-001', quantity: 2 }], menu)).toMatchObject({ subtotalCents: 3198, ok: true });
    expect(priceCart([], menu).ok).toBe(false);
  });
});

describe('display helpers', () => {
  it('formats whole cents without floating point', () => {
    expect(formatCents(1599)).toBe('$15.99');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCents(-250)).toBe('-$2.50');
  });

  it('describes prep time and closed reasons in plain words', () => {
    expect(prepNote(item())).toBe('Ready in about 25 minutes.');
    expect(prepNote(item({ prep_minutes: 120 }))).toBe('Cooked fresh the same day: about 2 hours.');
    expect(prepNote(item({ prep_lead_days: 1, prep_minutes: 15 }))).toBe(
      'Prepared a day ahead: order by the day before.',
    );
    expect(prepNote(item({ item_type: 'retail', prep_minutes: null }))).toBeNull();
    expect(closedMessage('paused')).toMatch(/paused/);
    expect(closedMessage('posting_disabled')).toMatch(/isn't open/);
  });

  it('summarizes opening hours', () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, opens_at: '12:00', closes_at: '20:00' }));
    const loc = { location_id: 'LOC-PRO', name: 'Provo', ordering_open: true, status_reason: null, hours: daily };
    expect(hoursSummary(loc)).toBe('Open daily 12pm–8pm');
    expect(hoursSummary({ ...loc, hours: [{ weekday: 6, opens_at: '10:30', closes_at: '14:00' }] })).toBe(
      'Sat 10:30am–2pm',
    );
    expect(hoursSummary({ ...loc, hours: [] })).toBe('Hours not published yet');
  });
});

describe('web API contract', () => {
  it('accepts the ERP menu shape and rejects anything with cost or stock fields mistyped', () => {
    const ok = { location_id: 'LOC-SLC', ordering_open: true, status_reason: null, max_per_line: 10, items: [item()] };
    expect(menuSchema.safeParse(ok).success).toBe(true);
    expect(menuSchema.safeParse({ ...ok, items: [{ ...item(), price_cents: '15.99' }] }).success).toBe(false);
    expect(menuSchema.safeParse({ ...ok, items: [{ ...item(), item_type: 'ingredient' }] }).success).toBe(false);
  });
});

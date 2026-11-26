import { describe, expect, it } from 'vitest';
import { estimateOrder, formatRate } from '../../site/src/lib/money';
import { placeWithCheck } from '../../site/src/lib/placement';
import { groupByDay, localDayKey } from '../../site/src/lib/time';
import { WebApiError, type PlaceOrderInput, type WebOrder } from '../../site/src/lib/webApi';
import { kitchenSchedule } from '../../src/lib/webOrders';

const input: PlaceOrderInput = {
  requestKey: '11111111-1111-4111-8111-111111111111',
  locationId: 'LOC-SLC',
  lines: [{ item_id: 'FG-001', quantity: 2 }],
  contact: { name: 'Ana', phone: '801-555-0100', email: 'ana@example.com' },
  pickupAt: '2026-12-01T19:30:00.000Z',
  note: null,
};

const order: WebOrder = {
  ok: true,
  order_number: 'SLC-20261201-0001',
  pickup_code: 'SLC-0001',
  web_token: '22222222-2222-4222-8222-222222222222',
  status: 'accepted',
  requested_pickup_at: '2026-12-01T19:30:00+00:00',
  location: { location_id: 'LOC-SLC', name: 'Salt Lake City' },
  pickup_name: 'Ana',
  note: null,
  lines: [],
  gross_cents: 3198,
  discount_cents: 0,
  net_cents: 3198,
  tax_rate: '0.072500',
  tax_cents: 232,
  total_cents: 3430,
  tender_mode: 'SIMULATED',
  paid_cents: 3430,
  balance_due_cents: 0,
  payment: 'simulated',
  accepted_at: '2026-12-01T17:00:00+00:00',
};

describe('placing an order without ever guessing the outcome', () => {
  it('reports a placed order', async () => {
    const r = await placeWithCheck(input, { place: async () => order, check: async () => ({ status: 'not_found' }) });
    expect(r).toEqual({ kind: 'placed', order });
  });

  it('reports a definite refusal without checking (nothing was placed)', async () => {
    let checked = false;
    const r = await placeWithCheck(input, {
      place: async () => {
        throw new WebApiError('slot_unavailable');
      },
      check: async () => {
        checked = true;
        return { status: 'not_found' };
      },
    });
    expect(r).toEqual({ kind: 'rejected', code: 'slot_unavailable' });
    expect(checked).toBe(false);
  });

  it('a lost answer is checked with the same key: committed means placed', async () => {
    const keys: string[] = [];
    const r = await placeWithCheck(input, {
      place: async () => {
        throw new WebApiError('network', true);
      },
      check: async (key) => {
        keys.push(key);
        return { status: 'committed', rpc_name: 'web_place_order', result: order };
      },
    });
    expect(r).toEqual({ kind: 'placed', order });
    expect(keys).toEqual([input.requestKey]);
  });

  it('a lost answer with no record means not placed (safe to retry); a failed check stays unconfirmed', async () => {
    const lost = async () => {
      throw new WebApiError('network', true);
    };
    expect(await placeWithCheck(input, { place: lost, check: async () => ({ status: 'not_found' }) })).toEqual({
      kind: 'not_placed',
    });
    expect(
      await placeWithCheck(input, {
        place: lost,
        check: async () => {
          throw new WebApiError('network', true);
        },
      }),
    ).toEqual({ kind: 'unconfirmed' });
    expect(
      await placeWithCheck(input, {
        place: lost,
        check: async () => ({ status: 'in_progress', rpc_name: 'web_place_order', result: null }),
      }),
    ).toEqual({ kind: 'unconfirmed' });
  });
});

describe('checkout estimate (display mirror of the ERP money rules)', () => {
  it('rounds tax half up per line, then sums', () => {
    // 2 × $15.99 = 3198 → 231.855 → 232; 1 × $6.99 = 699 → 50.6775 → 51
    expect(
      estimateOrder(
        [
          { unitCents: 1599, quantity: 2 },
          { unitCents: 699, quantity: 1 },
        ],
        '0.072500',
      ),
    ).toEqual({ subtotalCents: 3897, taxCents: 283, totalCents: 4180 });
    // exactly half a cent rounds up: 1000 × 0.0725 = 72.5 → 73
    expect(estimateOrder([{ unitCents: 1000, quantity: 1 }], '0.0725').taxCents).toBe(73);
  });

  it('shows the rate as a percentage from exact text', () => {
    expect(formatRate('0.072500')).toBe('7.25%');
    expect(formatRate('0.080000')).toBe('8%');
  });
});

describe('pickup times in Mountain Time', () => {
  it('groups slots by the local day, not the UTC day', () => {
    // 2026-12-01 19:45 MST is 2026-12-02 02:45 UTC: still Tuesday locally.
    const slots = [
      { pickup_at: '2026-12-01T19:30:00Z' },
      { pickup_at: '2026-12-02T02:45:00Z' },
      { pickup_at: '2026-12-02T19:00:00Z' },
    ];
    expect(groupByDay(slots).map((g) => [g.day, g.slots.length])).toEqual([
      ['2026-12-01', 2],
      ['2026-12-02', 1],
    ]);
    expect(localDayKey('2026-12-02T02:45:00Z')).toBe('2026-12-01');
  });
});

describe('kitchen schedule for website orders', () => {
  const now = new Date('2026-12-01T19:00:00Z'); // Tue 12:00 MST
  it('starts by pickup minus the longest cook time and flags later days and prep-ahead dishes', () => {
    const s = kitchenSchedule(
      { channel: 'web', requested_pickup_at: '2026-12-02T21:00:00Z' }, // Wed 14:00 MST
      [
        { quantity: 1, prep_minutes: 120, prep_lead_days: 0 },
        { quantity: 2, prep_minutes: 15, prep_lead_days: 1 },
      ],
      now,
    );
    expect(s).toEqual({
      pickupAt: '2026-12-02T21:00:00Z',
      startBy: '2026-12-02T19:00:00.000Z',
      prepAhead: true,
      laterDay: true,
    });
  });

  it('till orders have no pickup time and stay in today’s queue', () => {
    expect(
      kitchenSchedule(
        { channel: 'pos', requested_pickup_at: null },
        [{ quantity: 1, prep_minutes: 25, prep_lead_days: 0 }],
        now,
      ),
    ).toEqual({ pickupAt: null, startBy: null, prepAhead: false, laterDay: false });
  });
});

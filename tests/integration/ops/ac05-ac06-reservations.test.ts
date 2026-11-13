// AC04 (consumption side), AC05 shared-ingredient aggregation and AC06
// concurrency, through the real API as signed-in staff.
import { describe, expect, it } from 'vitest';
import { as, balance, code, key, ok, sql, type OrderResult } from './helpers';
import { rpc } from '../helpers/stack';

describe('AC04 one FG-002 consumes three tortillas and half a lime', () => {
  it('reserves and then issues exactly 3 each of ING-012 and 0.5 each of ING-015', async () => {
    const e = await as('proEmployee');
    const tortillas = await balance('LOC-PRO', 'ING-012');
    const limes = await balance('LOC-PRO', 'ING-015');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: 'LOC-PRO',
      p_lines: [{ item_id: 'FG-002', quantity: 1 }],
    });
    expect((await balance('LOC-PRO', 'ING-012')).reserved).toBe((Number(tortillas.reserved) + 3).toFixed(6));
    expect((await balance('LOC-PRO', 'ING-015')).reserved).toBe((Number(limes.reserved) + 0.5).toFixed(6));
    await ok(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    const issued = await sql<{ item_id: string; q: string }>(
      `select item_id, sum(quantity)::text q from public.inventory_movements
        where source_id = $1 and item_id in ('ING-012','ING-015') group by item_id order by item_id`,
      [o.order_id],
    );
    expect(issued).toEqual([
      { item_id: 'ING-012', q: '-3.000000' },
      { item_id: 'ING-015', q: '-0.500000' },
    ]);
  });
});

describe('AC05 shared ingredients are aggregated across the whole order', () => {
  it('with 2,000 g chicken, 3 × FG-001 + 2 × FG-003 reserves 940 g, leaves 1,060 g and issues 940 g once', async () => {
    const e = await as('sfoEmployee');
    expect(await balance('LOC-SFO', 'ING-001')).toEqual({
      on_hand: '2000.000000',
      reserved: '0.000000',
      available: '2000.000000',
    });
    const lines = [
      { item_id: 'FG-001', quantity: 3 },
      { item_id: 'FG-003', quantity: 2 },
    ];
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: 'LOC-SFO',
      p_lines: lines,
    });
    expect(await balance('LOC-SFO', 'ING-001')).toEqual({
      on_hand: '2000.000000',
      reserved: '940.000000',
      available: '1060.000000',
    });
    const [req] = await sql<{ q: string }>(
      `select sum(r.required_qty)::text q from public.order_line_requirements r join public.order_lines l using (order_line_id)
        where l.order_id = $1 and r.component_item_id = 'ING-001'`,
      [o.order_id],
    );
    expect(req!.q).toBe('940.000000');

    const startKey = key();
    const started = await ok<OrderResult>(e, 'start_order_preparation', {
      p_request_key: startKey,
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    expect(started.status).toBe('preparing');
    expect(await balance('LOC-SFO', 'ING-001')).toEqual({
      on_hand: '1060.000000',
      reserved: '0.000000',
      available: '1060.000000',
    });

    // Retrying kitchen start with the same key does not issue again (AC07).
    const replay = await ok<OrderResult & { replayed: boolean }>(e, 'start_order_preparation', {
      p_request_key: startKey,
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    expect(replay.replayed).toBe(true);
    // Ready and pickup never issue ingredients again.
    const ready = await ok<OrderResult>(e, 'mark_order_ready', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: started.version,
    });
    await ok(e, 'record_tender', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_amount_cents: ready.total_cents,
      p_method: 'cash',
    });
    await ok(e, 'complete_order_pickup', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: ready.version,
    });
    const [issued] = await sql<{ q: string; n: number }>(
      `select sum(quantity)::text q, count(*)::int n from public.inventory_movements where source_id = $1 and item_id = 'ING-001'`,
      [o.order_id],
    );
    expect(issued).toEqual({ q: '-940.000000', n: 1 });
    expect((await balance('LOC-SFO', 'ING-001')).on_hand).toBe('1060.000000');
  });

  it('a short ingredient rejects the whole order with an actionable shortage and reserves nothing', async () => {
    const e = await as('sfoEmployee');
    const before = await balance('LOC-SFO', 'ING-001');
    const r = await rpc(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: 'LOC-SFO',
      p_lines: [
        { item_id: 'FG-005', quantity: 1 },
        { item_id: 'FG-001', quantity: 10 },
      ],
    });
    expect(r.code).toBe('insufficient_stock');
    const detail = JSON.parse(r.error!.details!);
    expect(detail.shortages).toEqual([
      expect.objectContaining({
        item_id: 'ING-001',
        required: '1800.000000',
        available: '1060.000000',
        shortfall: '740.000000',
      }),
    ]);
    expect(await balance('LOC-SFO', 'ING-001')).toEqual(before);
    const [active] = await sql<{ n: number }>(
      `select count(*)::int n from public.reservation_allocations where location_id = 'LOC-SFO' and status = 'active'`,
    );
    expect(active!.n).toBe(0);
  });
});

describe('AC06 two sessions competing for the last portion', () => {
  it('exactly one acceptance succeeds; the other gets insufficient_stock; nothing partial remains', async () => {
    const [a, b] = await Promise.all([as('slcEmployee'), as('slcEmployee2')]);
    expect(await balance('LOC-SLC', 'ING-001')).toEqual({
      on_hand: '180.000000',
      reserved: '0.000000',
      available: '180.000000',
    });
    const args = () => ({
      p_request_key: key(),
      p_location_id: 'LOC-SLC',
      p_lines: [{ item_id: 'FG-001', quantity: 1 }],
    });
    const results = await Promise.all([rpc(a, 'accept_order', args()), rpc(b, 'accept_order', args())]);
    const succeeded = results.filter((r) => r.code === null);
    const failed = results.filter((r) => r.code !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.code).toBe('insufficient_stock');
    expect(JSON.parse(failed[0]!.error!.details!).shortages[0].item_id).toBe('ING-001');
    expect(await balance('LOC-SLC', 'ING-001')).toEqual({
      on_hand: '180.000000',
      reserved: '180.000000',
      available: '0.000000',
    });
    const winner = succeeded[0]!.data as OrderResult;
    const [orders] = await sql<{ n: number }>(
      `select count(*)::int n from public.orders o
        where o.location_id = 'LOC-SLC' and exists (select 1 from public.reservation_allocations a where a.order_id = o.order_id and a.status = 'active')`,
    );
    expect(orders!.n).toBe(1);
    // Releasing the winner restores the portion; availability is never negative.
    await ok(a, 'cancel_order', {
      p_request_key: key(),
      p_order_id: winner.order_id,
      p_expected_version: winner.version,
      p_reason_code: 'OTHER',
      p_note: 'test release',
    });
    expect(await balance('LOC-SLC', 'ING-001')).toEqual({
      on_hand: '180.000000',
      reserved: '0.000000',
      available: '180.000000',
    });
    const [neg] = await sql<{ n: number }>(
      `select count(*)::int n from public.stock_balances where reserved > on_hand or on_hand < 0`,
    );
    expect(neg!.n).toBe(0);
  });

  it('a menu override can switch a dish off but never creates stock', async () => {
    const m = await as('slcManager');
    await ok(m, 'set_menu_availability', {
      p_request_key: key(),
      p_location_id: 'LOC-SLC',
      p_item_id: 'FG-004',
      p_available: false,
      p_reason: 'out of beef',
    });
    expect(
      await code(await as('slcEmployee'), 'accept_order', {
        p_request_key: key(),
        p_location_id: 'LOC-SLC',
        p_lines: [{ item_id: 'FG-004', quantity: 1 }],
      }),
    ).toBe('validation:item_unavailable');
    await ok(m, 'set_menu_availability', {
      p_request_key: key(),
      p_location_id: 'LOC-SLC',
      p_item_id: 'FG-004',
      p_available: true,
    });
    expect(
      await code(await as('slcEmployee'), 'set_menu_availability', {
        p_request_key: key(),
        p_location_id: 'LOC-SLC',
        p_item_id: 'FG-004',
        p_available: false,
        p_reason: 'nope',
      }),
    ).toBe('unauthorized');
  });
});

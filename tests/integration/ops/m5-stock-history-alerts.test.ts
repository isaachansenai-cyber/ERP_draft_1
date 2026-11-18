// Item stock history chart, manager reorder alerts and the narrower employee
// scope (migration 0023; docs/decisions/0033, 0034), through the real API as
// signed-in local users in a pilot database.
import { afterAll, describe, expect, it } from 'vitest';
import { as, balance, code, key, ok, sql } from './helpers';

const PRO = 'LOC-PRO';
const SFO = 'LOC-SFO';
const ALERT_ITEM = 'ING-030';

interface History {
  item_id: string;
  days: number;
  date_from: string;
  date_to: string;
  on_hand_now: string;
  available_now: string;
  reorder_point: string | null;
  series: Array<{ date: string; on_hand: string; used: string; wasted: string; received: string }>;
}

interface Alerts {
  locations: Array<{
    location_id: string;
    items: Array<{ item_id: string; available: string; reorder_point: string }>;
  }>;
}

async function setReorderPoint(locationId: string, itemId: string, rop: number | null) {
  await sql(
    `insert into public.location_item_settings (location_id, item_id, reorder_applicable, reorder_point_base, provenance)
     values ($1, $2, $3, $4, 'pilot_operator_entered')
     on conflict (location_id, item_id) do update
       set reorder_applicable = excluded.reorder_applicable, reorder_point_base = excluded.reorder_point_base`,
    [locationId, itemId, rop !== null, rop],
  );
}

afterAll(async () => {
  await sql(`delete from public.location_item_settings where location_id = $1 and item_id = $2`, [SFO, ALERT_ITEM]);
});

describe('item stock history (chart)', () => {
  it('returns one row per day ending today, and today matches the live stock balance', async () => {
    const m = await as('proManager');
    for (const days of [7, 30, 90]) {
      const h = await ok<History>(m, 'get_item_stock_history', {
        p_location_id: PRO,
        p_item_id: 'ING-001',
        p_days: days,
      });
      expect(h.series).toHaveLength(days);
      expect(h.series[0]!.date).toBe(h.date_from);
      expect(h.series.at(-1)!.date).toBe(h.date_to);
      const dates = h.series.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
    }
    const h = await ok<History>(m, 'get_item_stock_history', { p_location_id: PRO, p_item_id: 'ING-001', p_days: 30 });
    const live = await balance(PRO, 'ING-001');
    expect(Number(h.series.at(-1)!.on_hand)).toBe(Number(live.on_hand));
    expect(Number(h.on_hand_now)).toBe(Number(live.on_hand));
    expect(Number(h.available_now)).toBe(Number(live.available));
    // ING-001 has been received and issued by earlier suites in this pilot database.
    expect(h.series.some((d) => Number(d.received) > 0 || Number(d.used) > 0)).toBe(true);
  });

  it('accepts only 7, 30 or 90 days and stocked items', async () => {
    const m = await as('proManager');
    expect(await code(m, 'get_item_stock_history', { p_location_id: PRO, p_item_id: 'ING-001', p_days: 14 })).toBe(
      'validation:days',
    );
    expect(await code(m, 'get_item_stock_history', { p_location_id: PRO, p_item_id: 'FG-001', p_days: 30 })).toBe(
      'validation:item_not_stocked',
    );
  });

  it('is refused to employees and to managers of another location; the owner may read it', async () => {
    const args = { p_location_id: PRO, p_item_id: 'ING-001', p_days: 30 };
    expect(await code(await as('proEmployee'), 'get_item_stock_history', args)).toBe('unauthorized');
    expect(await code(await as('sfoManager'), 'get_item_stock_history', args)).toBe('unauthorized');
    const owner = await ok<History>(await as('owner'), 'get_item_stock_history', args);
    expect(owner.series).toHaveLength(30);
  });
});

describe('reorder alerts (Overview card)', () => {
  it('a location manager sees an item once its available stock is below the reorder point, and not after', async () => {
    const m = await as('sfoManager');
    await setReorderPoint(SFO, ALERT_ITEM, 999_999_999);
    const a = await ok<Alerts>(m, 'get_reorder_alerts', {});
    expect(a.locations.map((l) => l.location_id)).toEqual([SFO]);
    const hit = a.locations[0]!.items.find((i) => i.item_id === ALERT_ITEM);
    expect(hit).toBeDefined();
    expect(Number(hit!.available)).toBe(Number((await balance(SFO, ALERT_ITEM)).available));
    expect(Number(hit!.reorder_point)).toBe(999_999_999);

    await setReorderPoint(SFO, ALERT_ITEM, 0);
    const cleared = await ok<Alerts>(m, 'get_reorder_alerts', {});
    expect(cleared.locations[0]!.items.find((i) => i.item_id === ALERT_ITEM)).toBeUndefined();
  });

  it('managers are alerted only for their own location', async () => {
    await setReorderPoint(SFO, ALERT_ITEM, 999_999_999);
    const pro = await ok<Alerts>(await as('proManager'), 'get_reorder_alerts', {});
    expect(pro.locations.map((l) => l.location_id)).toEqual([PRO]);
    expect(pro.locations.flatMap((l) => l.items).some((i) => i.item_id === ALERT_ITEM)).toBe(false);
  });

  it('the owner is not notified at any location', async () => {
    await setReorderPoint(SFO, ALERT_ITEM, 999_999_999);
    const o = await ok<Alerts>(await as('owner'), 'get_reorder_alerts', {});
    expect(o.locations).toEqual([]);
  });

  it('employees are refused', async () => {
    expect(await code(await as('sfoEmployee'), 'get_reorder_alerts', {})).toBe('unauthorized');
  });
});

describe('employee scope', () => {
  it('employees can no longer read the sales summary (or its export) or the stock overview', async () => {
    const e = await as('proEmployee');
    const today = (await ok<{ business_date: string }>(e, 'get_my_context', {})).business_date;
    expect(await code(e, 'get_sales_summary', { p_from: today, p_to: today })).toBe('unauthorized');
    expect(await code(e, 'get_sales_summary', { p_from: today, p_to: today, p_location_ids: [PRO] })).toBe(
      'unauthorized',
    );
    expect(await code(e, 'get_stock_overview', { p_location_id: PRO })).toBe('unauthorized');
    // Managers keep both.
    const m = await as('proManager');
    await ok(m, 'get_sales_summary', { p_from: today, p_to: today, p_location_ids: [PRO] });
    await ok(m, 'get_stock_overview', { p_location_id: PRO });
  });

  it('employees cannot read raw stock tables; managers still can', async () => {
    const e = await as('proEmployee');
    for (const table of ['stock_balances', 'lots', 'reservation_allocations']) {
      const { data, error } = await e.from(table).select('location_id').eq('location_id', PRO).limit(5);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const m = await as('proManager');
    const { data } = await m.from('stock_balances').select('location_id').eq('location_id', PRO).limit(5);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('employees get item names for waste reports without quantities, and can still submit one', async () => {
    const e = await as('sfoEmployee');
    const items = await ok<Array<Record<string, unknown>>>(e, 'list_stock_items', { p_location_id: SFO });
    expect(items.length).toBeGreaterThan(0);
    expect(Object.keys(items[0]!).sort()).toEqual(['base_unit', 'category', 'item_id', 'item_type', 'name']);
    expect(items.some((i) => i.item_type === 'finished_dish')).toBe(false);
    expect(await code(e, 'list_stock_items', { p_location_id: PRO })).toBe('unauthorized');

    const before = await balance(SFO, 'ING-035');
    const w = await ok<{ status: string }>(e, 'submit_waste_report', {
      p_request_key: key(),
      p_location_id: SFO,
      p_lines: [{ item_id: 'ING-035', quantity: 1 }],
      p_reason_code: 'SPOILAGE',
    });
    expect(w.status).toBe('submitted');
    expect(await balance(SFO, 'ING-035')).toEqual(before);
  });
});

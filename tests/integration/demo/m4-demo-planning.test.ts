// AC23 (demo side): the synthetic history is an explicit, labeled alternative
// forecast and EOQ source in the demo only; AC22 EOQ from demo settings.
import { describe, expect, inject, it } from 'vitest';
import { localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const creds = inject('demoCredentials');
const as = (id: string) => signIn(stack, creds[id]!.email, creds[id]!.password);
const q = <T = Record<string, string>>(text: string, params: unknown[] = []) =>
  withDb(stack.dbUrl, async (db) => (await db.query(text, params)).rows as T[]);

describe('demo forecast from synthetic history', () => {
  it('same-weekday mean over the 8 weeks before the as-of date, labeled demo historical', async () => {
    const m = await as('DEMO-LOC-PRO-MAN-1');
    const r = await rpc(m, 'get_demand_forecast', {
      p_location_id: 'LOC-PRO',
      p_as_of: '2026-11-01',
      p_days: 7,
      p_source: 'historical',
    });
    expect(r.code).toBeNull();
    expect(r.data.data_label).toBe('demo historical (synthetic)');
    const d = r.data.items
      .find((i: { item_id: string }) => i.item_id === 'FG-001')
      .days.find((x: { date: string }) => x.date === '2026-11-01');
    const [expected] = await q<{ n: string; mean: string }>(`
      with days as (
        select g::date d from generate_series('2026-09-06'::date, '2026-10-31'::date, interval '1 day') g
        where extract(dow from g) = extract(dow from '2026-11-01'::date)
          and not exists (select 1 from public.location_closures c where c.location_id = 'LOC-PRO' and c.business_date = g::date))
      select count(*)::text n, round(avg(coalesce((select sum(h.quantity_fulfilled) from public.historical_sales_lines h
               where h.location_id = 'LOC-PRO' and h.item_id = 'FG-001' and h.business_date = days.d), 0)), 2)::text mean
      from days`);
    expect(d.method).toBe('same_weekday_8w');
    expect(d.observations).toBe(Number(expected!.n));
    expect(Number(d.base_qty)).toBe(Number(expected!.mean));
    expect(d.window_to).toBe('2026-10-31');

    // The operational source has no history before the as-of date: synthetic rows are never treated as operational demand.
    const op = await rpc(m, 'get_demand_forecast', { p_location_id: 'LOC-PRO', p_as_of: '2026-11-01', p_days: 3 });
    expect(op.data.data_label).toBe('demo operational');
    expect(
      op.data.items.every((i: { days: Array<{ method: string }> }) =>
        i.days.every((x) => x.method === 'manager_required'),
      ),
    ).toBe(true);
  });

  it('EOQ demand from the history is the fulfilled component use per observed open day × 365', async () => {
    const m = await as('DEMO-LOC-PRO-MAN-1');
    const r = await rpc(m, 'get_eoq_inputs', {
      p_location_id: 'LOC-PRO',
      p_item_id: 'ING-001',
      p_source: 'historical',
    });
    expect(r.code).toBeNull();
    const [today] = await q<{ d: string }>(`select private.business_date()::text d`);
    const [x] = await q<{ open: string; total: string }>(
      `with w as (select g::date d from generate_series(greatest($1::date - 180, '2026-05-01'::date),
                  least($1::date - 1, (select max(business_date) from public.historical_sales_orders where location_id = 'LOC-PRO')),
                  interval '1 day') g
                  where not exists (select 1 from public.location_closures c where c.location_id = 'LOC-PRO' and c.business_date = g::date))
       select (select count(*) from w)::text open,
              (select sum(h.quantity_fulfilled * c.quantity_per_serving) from public.historical_sales_lines h
                 join public.recipe_versions v on v.parent_item_id = h.item_id and v.status = 'active'
                 join public.recipe_components c on c.recipe_version_id = v.recipe_version_id and c.component_item_id = 'ING-001'
                where h.location_id = 'LOC-PRO' and h.business_date between $1::date - 180 and $1::date - 1)::text total`,
      [today!.d],
    );
    expect(r.data.demand_status).toBe('estimated');
    expect(r.data.open_days_observed).toBe(Number(x!.open));
    expect(Number(r.data.estimated_annual_demand)).toBeCloseTo((Number(x!.total) / Number(x!.open)) * 365, 2);
    if (r.data.settings?.ordering_cost_cents != null && Number(r.data.settings.holding_cost) > 0) {
      expect(Number(r.data.eoq.eoq)).toBeGreaterThan(0);
    }
  });
});

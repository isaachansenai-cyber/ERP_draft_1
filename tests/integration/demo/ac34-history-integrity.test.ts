// AC34 Historical import integrity.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { verifyHistory } from '../../../scripts/import/import-demo-history';
import { snapshotPublicTables } from '../helpers/snapshot';
import { localStack, ROOT, runScript, withDb } from '../helpers/stack';

const stack = localStack();
const summary = JSON.parse(readFileSync(join(ROOT, 'data/demo/seed_summary.json'), 'utf8'));

describe('AC34 historical import integrity', () => {
  it('covers all 184 days at all three locations with the expected counts', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const v = await verifyHistory(db, 'demo-2026-v1');
      expect(v.orders).toBe(summary.historical_orders);
      expect(v.lines).toBe(summary.historical_lines);
      expect(v.days).toBe(184);
      expect(v.location_days).toBe(552);
      expect([v.first_date, v.last_date]).toEqual(['2026-05-01', '2026-10-31']);
      const perLocation = await db.query(
        `select location_id, count(distinct business_date)::int days from public.historical_sales_orders group by 1 order by 1`,
      );
      expect(perLocation.rows).toEqual([
        { location_id: 'LOC-PRO', days: 184 },
        { location_id: 'LOC-SFO', days: 184 },
        { location_id: 'LOC-SLC', days: 184 },
      ]);
    });
  });

  it('line totals equal order totals for all five monetary aggregates', async () => {
    await withDb(stack.dbUrl, async (db) => {
      expect((await verifyHistory(db, 'demo-2026-v1')).order_total_mismatches).toBe(0);
    });
  });

  it('references only known customers and sellable products; walk-ins stay anonymous', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const v = await verifyHistory(db, 'demo-2026-v1');
      expect(v.unknown_customers).toBe(0);
      expect(v.unknown_items).toBe(0);
      const { rows } = await db.query(`
        select count(*) filter (where customer_id is null)::int walk_ins,
               count(distinct customer_id)::int customers
          from public.historical_sales_orders`);
      expect(rows[0].walk_ins).toBeGreaterThan(0);
      expect(rows[0].customers).toBe(10);
    });
  });

  it('matches the expected synthetic net sales (and records only simulated payments)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      expect((await verifyHistory(db, 'demo-2026-v1')).net_sales_cents).toBe(summary.historical_net_sales_cents);
      const { rows } = await db.query(`select distinct payment_mode from public.historical_sales_orders`);
      expect(rows).toEqual([{ payment_mode: 'SIMULATED' }]);
    });
  });

  it('reimport is idempotent and changes nothing else in the database (no operational stock or orders)', async () => {
    const env = inject('demoEnv');
    await withDb(stack.dbUrl, async (db) => {
      const before = await snapshotPublicTables(db);
      const r = runScript('scripts/import/import-demo-history.ts', env);
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.inserted).toEqual({ orders: 0, lines: 0 });
      expect(out.changed).toBe(false);
      expect(await snapshotPublicTables(db)).toEqual(before);
    });
  });

  it('history snapshots are immutable', async () => {
    await withDb(stack.dbUrl, async (db) => {
      await expect(
        db.query(
          `update public.historical_sales_orders set refund_net_cents = 0 where historical_order_id = 'H-20260501-LOC-PRO-001'`,
        ),
      ).rejects.toThrow('immutable:historical_sales_orders');
      await expect(
        db.query(`delete from public.historical_sales_lines where historical_order_id = 'H-20260501-LOC-PRO-001'`),
      ).rejects.toThrow('immutable:historical_sales_lines');
    });
  });
});

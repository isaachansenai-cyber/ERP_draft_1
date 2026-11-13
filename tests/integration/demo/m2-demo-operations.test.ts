// Milestone 2 in the DEMO database: synthetic opening stock through the ledger,
// retail-only orders with simulated tenders (AC17), and the historical data
// source kept separate from operational sales (PRD §12).
import { describe, expect, inject, it } from 'vitest';
import { localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const creds = inject('demoCredentials');
const as = (id: string) => signIn(stack, creds[id]!.email, creds[id]!.password);

describe('demo opening stock', () => {
  it('posts all 126 synthetic opening rows through the ledger with weighted-average valuation', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`
        select (select count(*) from public.opening_count_lines)::int lines,
               (select count(*) from public.opening_counts)::int counts,
               (select count(*) from public.inventory_movements where movement_type = 'opening')::int movements,
               (select count(*) from public.lots where provenance ilike 'synthetic%')::int synthetic_lots,
               (select count(*) from public.lots l join public.items i using (item_id) where i.item_type = 'finished_dish')::int dish_lots`);
      expect(rows[0]).toEqual({ lines: 126, counts: 3, movements: 126, synthetic_lots: 126, dish_lots: 0 });
      const { rows: chicken } = await db.query(`
        select b.on_hand::text, v.avg_unit_cost::text from public.stock_balances b
          join public.item_valuation v on v.location_id = b.location_id and v.item_id = b.item_id
         where b.location_id = 'LOC-PRO' and b.item_id = 'ING-001'`);
      expect(chicken[0]).toEqual({ on_hand: '20000.000000', avg_unit_cost: '0.00520000' });
    });
  });
});

describe('AC17 demo tenders are simulated; retail units are consumed at handover', () => {
  it('a retail-only order goes accepted → ready → simulated payment → completed and issues the bottle once', async () => {
    const e = await as('DEMO-LOC-SFO-EMP-1');
    const stockBefore = await withDb(
      stack.dbUrl,
      async (db) =>
        (
          await db.query(
            `select sum(on_hand)::text q from public.stock_balances where location_id = 'LOC-SFO' and item_id = 'RET-002'`,
          )
        ).rows[0].q,
    );
    const accepted = await rpc(e, 'accept_order', {
      p_request_key: crypto.randomUUID(),
      p_location_id: 'LOC-SFO',
      p_lines: [{ item_id: 'RET-002', quantity: 2 }],
    });
    expect(accepted.code).toBeNull();
    expect(accepted.data.tender_mode).toBe('SIMULATED');
    expect(
      await rpc(e, 'start_order_preparation', {
        p_request_key: crypto.randomUUID(),
        p_order_id: accepted.data.order_id,
        p_expected_version: 1,
      }),
    ).toMatchObject({ code: 'invalid_state:accepted->preparing' });
    const ready = await rpc(e, 'mark_order_ready', {
      p_request_key: crypto.randomUUID(),
      p_order_id: accepted.data.order_id,
      p_expected_version: 1,
    });
    expect(ready.data.status).toBe('ready');
    await rpc(e, 'record_tender', {
      p_request_key: crypto.randomUUID(),
      p_order_id: accepted.data.order_id,
      p_amount_cents: accepted.data.total_cents,
      p_method: 'card_external',
    });
    const done = await rpc(e, 'complete_order_pickup', {
      p_request_key: crypto.randomUUID(),
      p_order_id: accepted.data.order_id,
      p_expected_version: ready.data.version,
    });
    expect(done.data.status).toBe('completed');
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`select tender_type from public.tenders where order_id = $1`, [
        accepted.data.order_id,
      ]);
      expect(rows).toEqual([{ tender_type: 'SIMULATED' }]);
      const { rows: moves } = await db.query(
        `select movement_type, sum(quantity)::text q from public.inventory_movements where source_id = $1 group by movement_type`,
        [accepted.data.order_id],
      );
      expect(moves).toEqual([{ movement_type: 'retail_issue', q: '-2.000000' }]);
      const after = (
        await db.query(
          `select sum(on_hand)::text q from public.stock_balances where location_id = 'LOC-SFO' and item_id = 'RET-002'`,
        )
      ).rows[0].q;
      expect(Number(stockBefore) - Number(after)).toBe(2);
    });
  });
});

describe('historical demo data stays a separate, labeled source', () => {
  it('the historical source reconciles to the imported synthetic history and never mixes with operational sales', async () => {
    const owner = await as('DEMO-OWNER');
    const hist = await rpc(owner, 'get_sales_summary', {
      p_from: '2026-05-01',
      p_to: '2026-10-31',
      p_source: 'historical',
    });
    expect(hist.data.data_label).toMatch(/demo historical/);
    const net = hist.data.locations.reduce((s: number, l: { net_sales_cents: number }) => s + l.net_sales_cents, 0);
    expect(net).toBe(30682004);
    const op = await rpc(owner, 'get_sales_summary', {
      p_from: '2026-05-01',
      p_to: '2026-10-31',
      p_source: 'operational',
    });
    expect(op.data.data_label).toBe('demo operational');
    expect(op.data.locations.every((l: { completed_orders: number }) => l.completed_orders === 0)).toBe(true);
  });
});

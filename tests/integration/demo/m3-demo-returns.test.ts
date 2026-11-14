// AC14 retail returns and exchanges, AC15 demo restock cost reversal, in the
// DEMO database (retail sauces exist only in demo data).
import { describe, expect, inject, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const creds = inject('demoCredentials');
const as = (id: string) => signIn(stack, creds[id]!.email, creds[id]!.password);
const LOC = 'LOC-PRO';
const MGR = 'DEMO-LOC-PRO-MAN-1';
const EMP = 'DEMO-LOC-PRO-EMP-1';
const k = () => crypto.randomUUID();

async function q<T = Record<string, string>>(text: string, params: unknown[] = []): Promise<T[]> {
  return withDb(stack.dbUrl, async (db) => (await db.query(text, params)).rows as T[]);
}

async function okRpc<T = Record<string, unknown>>(c: SupabaseClient, name: string, args: Record<string, unknown>) {
  const r = await rpc(c, name, args);
  if (r.code || r.data?.ok === false)
    throw new Error(`${name}: ${r.code ?? JSON.stringify(r.data)} ${r.error?.details ?? ''}`);
  return r.data as T;
}

async function errCode(c: SupabaseClient, name: string, args: Record<string, unknown>) {
  const r = await rpc(c, name, args);
  return r.code ?? (r.data?.ok === false ? (r.data.error as string) : null);
}

const onHand = async (item: string) =>
  Number(
    (
      await q(
        `select coalesce(sum(on_hand), 0)::text q from public.stock_balances where location_id = $1 and item_id = $2`,
        [LOC, item],
      )
    )[0]!.q,
  );

/** Completed retail order with a simulated payment. */
async function sellRetail(c: SupabaseClient, item: string, quantity: number) {
  const a = await okRpc<{ order_id: string; version: number; total_cents: number }>(c, 'accept_order', {
    p_request_key: k(),
    p_location_id: LOC,
    p_lines: [{ item_id: item, quantity }],
  });
  const r = await okRpc<{ version: number }>(c, 'mark_order_ready', {
    p_request_key: k(),
    p_order_id: a.order_id,
    p_expected_version: a.version,
  });
  await okRpc(c, 'record_tender', {
    p_request_key: k(),
    p_order_id: a.order_id,
    p_amount_cents: a.total_cents,
    p_method: 'cash',
  });
  await okRpc(c, 'complete_order_pickup', {
    p_request_key: k(),
    p_order_id: a.order_id,
    p_expected_version: r.version,
  });
  const [line] = await q<{ order_line_id: string; net_cents: string; tax_cents: string }>(
    `select order_line_id, net_cents::text, tax_cents::text from public.order_lines where order_id = $1`,
    [a.order_id],
  );
  return { orderId: a.order_id, lineId: line!.order_line_id, totalCents: a.total_cents, line: line! };
}

describe('AC14 retail returns', () => {
  it('a return respects the sold quantity, goes to custody outside stock, and refunds the original snapshot', async () => {
    const m = await as(MGR);
    const sale = await sellRetail(m, 'RET-001', 3);
    const stockBefore = await onHand('RET-001');
    const r = await okRpc<{ return_id: string; refund_amount_cents: number }>(m, 'process_return', {
      p_request_key: k(),
      p_order_id: sale.orderId,
      p_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'unopened_intact' }],
      p_reason_code: 'CUSTOMER_COMPLAINT',
      p_refund_method: 'cash',
    });
    expect(r.refund_amount_cents).toBe(Math.round(sale.totalCents / 3));
    expect(await onHand('RET-001')).toBe(stockBefore); // custody is outside valued on-hand
    const [cust] = await q(
      `select c.status, c.quantity::text, f.refund_mode from public.return_custody c
         join public.return_lines rl using (return_line_id) join public.refunds f on f.return_id = rl.return_id
        where rl.return_id = $1`,
      [r.return_id],
    );
    expect(cust).toEqual({ status: 'held', quantity: '1', refund_mode: 'SIMULATED' });
    expect(
      await errCode(m, 'process_return', {
        p_request_key: k(),
        p_order_id: sale.orderId,
        p_lines: [{ order_line_id: sale.lineId, quantity: 3, condition: 'unopened_intact' }],
        p_reason_code: 'CUSTOMER_COMPLAINT',
      }),
    ).toBe('validation:return_exceeds_sold');
  });

  it('returns outside the policy window, or by an employee without a manager PIN, are refused', async () => {
    const m = await as(MGR);
    const e = await as(EMP);
    const sale = await sellRetail(m, 'RET-001', 1);
    const args = {
      p_order_id: sale.orderId,
      p_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'unopened_intact' }],
      p_reason_code: 'CUSTOMER_COMPLAINT',
    };
    expect(await errCode(e, 'process_return', { p_request_key: k(), ...args })).toBe('approval_required');
    // Test-only: age the sale past the 30-day synthetic policy window, then restore it.
    await q(`update public.orders set completed_business_date = completed_business_date - 31 where order_id = $1`, [
      sale.orderId,
    ]);
    try {
      expect(await errCode(m, 'process_return', { p_request_key: k(), ...args })).toBe(
        'validation:return_window_expired',
      );
    } finally {
      await q(`update public.orders set completed_business_date = completed_business_date + 31 where order_id = $1`, [
        sale.orderId,
      ]);
    }
  });
});

describe('AC15 demo restock restores the original issue cost and reverses COGS once', () => {
  it('restock of an unopened unit; an opened unit can only be disposed', async () => {
    const m = await as(MGR);
    const sale = await sellRetail(m, 'RET-001', 2);
    const [issue] = await q<{ unit: string }>(
      `select (issued_cost / issued_qty)::numeric(18,8)::text unit from public.order_issue_costs where order_id = $1 and purpose = 'retail'`,
      [sale.orderId],
    );
    const ret = await okRpc<{ return_id: string }>(m, 'process_return', {
      p_request_key: k(),
      p_order_id: sale.orderId,
      p_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'unopened_intact' }],
      p_reason_code: 'CUSTOMER_COMPLAINT',
      p_refund_method: 'cash',
    });
    const opened = await okRpc<{ return_id: string }>(m, 'process_return', {
      p_request_key: k(),
      p_order_id: sale.orderId,
      p_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'opened' }],
      p_reason_code: 'CUSTOMER_COMPLAINT',
      p_refund_method: 'cash',
    });
    const custodyOf = async (returnId: string) =>
      (
        await q<{ custody_id: string }>(
          `select c.custody_id from public.return_custody c join public.return_lines rl using (return_line_id) where rl.return_id = $1`,
          [returnId],
        )
      )[0]!.custody_id;
    const intact = await custodyOf(ret.return_id);
    const open = await custodyOf(opened.return_id);

    const stockBefore = await onHand('RET-001');
    const restockKey = k();
    await okRpc(m, 'decide_return_custody', { p_request_key: restockKey, p_custody_id: intact, p_decision: 'restock' });
    await okRpc(m, 'decide_return_custody', { p_request_key: restockKey, p_custody_id: intact, p_decision: 'restock' }); // retry
    expect(
      await errCode(m, 'decide_return_custody', { p_request_key: k(), p_custody_id: intact, p_decision: 'restock' }),
    ).toBe('invalid_state:restocked->restock');
    expect(await onHand('RET-001')).toBe(stockBefore + 1);
    const [mv] = await q(
      `select count(*)::text n, min(unit_cost)::text unit_cost from public.inventory_movements
        where movement_type = 'return_restock' and source_id = $1`,
      [intact],
    );
    expect(mv).toEqual({ n: '1', unit_cost: issue!.unit });
    const [rev] = await q(
      `select count(*)::text n, sum(cost)::numeric(18,8)::text cost from public.cogs_reversals where order_id = $1`,
      [sale.orderId],
    );
    expect(rev).toEqual({ n: '1', cost: issue!.unit });

    expect(
      await errCode(m, 'decide_return_custody', { p_request_key: k(), p_custody_id: open, p_decision: 'restock' }),
    ).toBe('validation:not_resaleable');
    await okRpc(m, 'decide_return_custody', {
      p_request_key: k(),
      p_custody_id: open,
      p_decision: 'dispose',
      p_note: 'Opened bottle discarded',
    });
    expect(await onHand('RET-001')).toBe(stockBefore + 1);

    // The sales summary shows the reversal and nets it out of COGS.
    const today = (await q<{ d: string }>(`select private.business_date()::text d`))[0]!.d;
    const s = await okRpc<{ locations: Array<Record<string, number>> }>(m, 'get_sales_summary', {
      p_from: today,
      p_to: today,
      p_location_ids: [LOC],
    });
    expect(s.locations[0]!.cogs_reversed_cents).toBeGreaterThan(0);
  });
});

describe('AC14 exchanges are atomic', () => {
  it('an exchange returns, credits and sells the replacement in one transaction', async () => {
    const m = await as(MGR);
    const sale = await sellRetail(m, 'RET-001', 1);
    const before = await onHand('RET-001');
    const x = await okRpc<{
      amount_due_cents: number;
      credit_cents: number;
      new_order: { status: string; order_id: string };
    }>(m, 'process_exchange', {
      p_request_key: k(),
      p_order_id: sale.orderId,
      p_return_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'damaged' }],
      p_new_lines: [{ item_id: 'RET-001', quantity: 1 }],
      p_reason_code: 'DAMAGED_SEAL',
    });
    expect(x.credit_cents).toBe(sale.totalCents);
    expect(x.amount_due_cents).toBe(0);
    expect(x.new_order.status).toBe('completed');
    expect(await onHand('RET-001')).toBe(before - 1); // replacement issued; returned unit is in custody
    const [t] = await q(`select method, amount_cents::text from public.tenders where order_id = $1`, [
      x.new_order.order_id,
    ]);
    expect(t).toEqual({ method: 'exchange_credit', amount_cents: String(sale.totalCents) });
  });

  it('if the replacement is short, nothing posts at all', async () => {
    const m = await as(MGR);
    const sale = await sellRetail(m, 'RET-001', 1);
    const counts = () =>
      q(`select (select count(*) from public.returns)::text r, (select count(*) from public.refunds)::text f,
                (select count(*) from public.orders)::text o, (select count(*) from public.return_custody)::text c,
                (select count(*) from public.inventory_movements)::text mv`);
    const before = await counts();
    expect(
      await errCode(m, 'process_exchange', {
        p_request_key: k(),
        p_order_id: sale.orderId,
        p_return_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'unopened_intact' }],
        p_new_lines: [{ item_id: 'RET-002', quantity: 999 }],
        p_reason_code: 'WRONG_ITEM',
      }),
    ).toBe('insufficient_stock');
    expect(await counts()).toEqual(before);
  });

  it('meals cannot be exchanged', async () => {
    const m = await as(MGR);
    const sale = await sellRetail(m, 'RET-001', 1);
    expect(
      await errCode(m, 'process_exchange', {
        p_request_key: k(),
        p_order_id: sale.orderId,
        p_return_lines: [{ order_line_id: sale.lineId, quantity: 1, condition: 'unopened_intact' }],
        p_new_lines: [{ item_id: 'FG-001', quantity: 1 }],
        p_reason_code: 'WRONG_ITEM',
      }),
    ).toBe('validation:exchange_retail_only');
  });
});

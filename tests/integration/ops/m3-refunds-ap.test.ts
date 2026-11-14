// AC16 refund limits, AC07/AC09 refund parts, AC14 (meals are refunded, never
// restocked; pilot returns gated), AC17 recorded-money-only for refunds and AP,
// AC18 supplier invoices and payments, AC19 invoices never touch stock or cost,
// AC20 money reconciliation with refunds and waste, through the real API in a
// pilot database.
import { describe, expect, inject, it } from 'vitest';
import { as, balance, code, employeeId, key, ok, runOrderToCompletion, sql, type OrderResult } from './helpers';
import { withDb } from '../helpers/stack';
import { stack } from './helpers';

const PRO = 'LOC-PRO';
const pins = () => inject('opsPins');

interface Line {
  order_line_id: string;
  item_id: string;
  quantity: number;
  net_cents: string;
  tax_cents: string;
}

async function lines(orderId: string): Promise<Line[]> {
  return sql<Line>(
    `select l.order_line_id, l.item_id, l.quantity, l.net_cents::text, l.tax_cents::text
       from public.order_lines l join public.orders o on o.order_id = l.order_id and o.revision = l.revision
      where l.order_id = $1 order by l.line_no`,
    [orderId],
  );
}

/** A completed PRO order with a 10% manager-approved discount and a full recorded payment. */
async function completedDiscountedOrder(items: Array<{ item_id: string; quantity: number }>) {
  const e = await as('proEmployee');
  let o = await ok<OrderResult>(e, 'accept_order', {
    p_request_key: key(),
    p_location_id: PRO,
    p_lines: items,
    p_discount_percent: 10,
    p_discount_reason: 'Regular customer',
    p_approver_employee_id: employeeId('proManager'),
    p_pin: pins().proManager,
  });
  o = await ok<OrderResult>(e, 'start_order_preparation', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_expected_version: o.version,
  });
  o = await ok<OrderResult>(e, 'mark_order_ready', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_expected_version: o.version,
  });
  await ok(e, 'record_tender', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_amount_cents: o.total_cents,
    p_method: 'card_external',
  });
  return ok<OrderResult>(e, 'complete_order_pickup', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_expected_version: o.version,
  });
}

describe('AC16 refund limits', () => {
  it('employees cannot refund without a manager PIN; a wrong PIN is rejected', async () => {
    const e = await as('proEmployee');
    const o = await runOrderToCompletion(e, PRO, [{ item_id: 'FG-002', quantity: 1 }]);
    const [l] = await lines(o.order_id);
    const base = {
      p_order_id: o.order_id,
      p_lines: [{ order_line_id: l!.order_line_id, quantity: 1 }],
      p_method: 'cash',
      p_reason_code: 'CUSTOMER_COMPLAINT',
    };
    expect(await code(e, 'record_refund', { p_request_key: key(), ...base })).toBe('approval_required');
    expect(
      await code(e, 'record_refund', {
        p_request_key: key(),
        ...base,
        p_approver_employee_id: employeeId('proManager'),
        p_pin: '0000000',
      }),
    ).toBe('pin_invalid');
    const [n] = await sql<{ n: number }>(`select count(*)::int n from public.refunds where order_id = $1`, [
      o.order_id,
    ]);
    expect(n!.n).toBe(0);
    // A manager at another location cannot refund this order at all.
    expect(await code(await as('sfoManager'), 'record_refund', { p_request_key: key(), ...base })).toBe('unauthorized');
  });

  it('per-unit refunds follow the original discount and tax allocation; the last unit takes the exact remainder', async () => {
    const m = await as('proManager');
    const o = await completedDiscountedOrder([
      { item_id: 'FG-001', quantity: 3 },
      { item_id: 'FG-002', quantity: 1 },
    ]);
    const [fg1, fg2] = await lines(o.order_id);
    const refunds: Array<{ net_cents: number; tax_cents: number }> = [];
    for (let i = 0; i < 3; i++) {
      refunds.push(
        await ok(m, 'record_refund', {
          p_request_key: key(),
          p_order_id: o.order_id,
          p_lines: [{ order_line_id: fg1!.order_line_id, quantity: 1 }],
          p_method: 'card_external',
          p_reason_code: 'CUSTOMER_COMPLAINT',
        }),
      );
    }
    const lineNet = Number(fg1!.net_cents);
    const lineTax = Number(fg1!.tax_cents);
    expect(refunds[0]!.net_cents).toBe(Math.round(lineNet / 3));
    expect(refunds.reduce((s, r) => s + r.net_cents, 0)).toBe(lineNet);
    expect(refunds.reduce((s, r) => s + r.tax_cents, 0)).toBe(lineTax);
    // Nothing left on that line.
    expect(
      await code(m, 'record_refund', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_lines: [{ order_line_id: fg1!.order_line_id, quantity: 1 }],
        p_method: 'cash',
        p_reason_code: 'CUSTOMER_COMPLAINT',
      }),
    ).toBe('validation:refund_exceeds_line');
    // An amount-based refund cannot exceed the remaining line net either.
    expect(
      await code(m, 'record_refund', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_lines: [{ order_line_id: fg2!.order_line_id, net_cents: Number(fg2!.net_cents) + 1 }],
        p_method: 'cash',
        p_reason_code: 'CUSTOMER_COMPLAINT',
      }),
    ).toBe('validation:refund_exceeds_line');
    await ok(m, 'record_refund', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_lines: [{ order_line_id: fg2!.order_line_id, net_cents: Number(fg2!.net_cents) }],
      p_method: 'cash',
      p_reason_code: 'WRONG_ITEM',
    });
    const [tot] = await sql<{ refunded: string; tendered: string }>(
      `select (select sum(amount_cents) from public.refunds where order_id = $1)::text refunded,
              (select sum(amount_cents) from public.tenders where order_id = $1)::text tendered`,
      [o.order_id],
    );
    expect(tot!.refunded).toBe(tot!.tendered); // fully refunded, never more than recorded payment
  });

  it('refunds cannot exceed what was recorded as paid', async () => {
    const m = await as('proManager');
    const o = await ok<OrderResult>(m, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-005', quantity: 1 }],
      p_discount_percent: 100,
      p_discount_reason: 'Complimentary meal',
    });
    let s = await ok<OrderResult>(m, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    s = await ok<OrderResult>(m, 'mark_order_ready', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: s.version,
    });
    await ok(m, 'complete_order_pickup', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: s.version,
    });
    const [l] = await lines(o.order_id);
    expect(
      await code(m, 'record_refund', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_lines: [{ order_line_id: l!.order_line_id, net_cents: 1 }],
        p_method: 'cash',
        p_reason_code: 'CUSTOMER_COMPLAINT',
      }),
    ).toBe('validation:refund_exceeds_line');
  });

  it('only completed orders are refunded; open orders are cancelled instead', async () => {
    const m = await as('proManager');
    const o = await ok<OrderResult>(m, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-002', quantity: 1 }],
    });
    const [l] = await lines(o.order_id);
    expect(
      await code(m, 'record_refund', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_lines: [{ order_line_id: l!.order_line_id, quantity: 1 }],
        p_method: 'cash',
        p_reason_code: 'CUSTOMER_COMPLAINT',
      }),
    ).toBe('invalid_state:accepted->refund');
    await ok(m, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'WRONG_ITEM',
    });
  });
});

describe('AC07 / AC09 / AC14 / AC17 refund records', () => {
  it('a refund retried with the same key records one refund (AC07)', async () => {
    const m = await as('proManager');
    const o = await runOrderToCompletion(m, PRO, [{ item_id: 'FG-004', quantity: 1 }]);
    const [l] = await lines(o.order_id);
    const args = {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_lines: [{ order_line_id: l!.order_line_id, quantity: 1 }],
      p_method: 'cash',
      p_reason_code: 'CUSTOMER_COMPLAINT',
    };
    const first = await ok<{ refund_id: string }>(m, 'record_refund', args);
    const again = await ok<{ refund_id: string; replayed: boolean }>(m, 'record_refund', args);
    expect(again.refund_id).toBe(first.refund_id);
    expect(again.replayed).toBe(true);
    const [n] = await sql<{ n: number; lines: number }>(
      `select count(*)::int n, (select count(*)::int from public.refund_lines rl join public.refunds f using (refund_id) where f.order_id = $1) lines
         from public.refunds where order_id = $1`,
      [o.order_id],
    );
    expect(n).toEqual({ n: 1, lines: 1 });
  });

  it('a meal refund restocks nothing and is a MANUAL_EXTERNAL record in the pilot (AC14, AC17)', async () => {
    const m = await as('proManager');
    const o = await runOrderToCompletion(m, PRO, [{ item_id: 'FG-003', quantity: 1 }]);
    const [l] = await lines(o.order_id);
    const before = await balance(PRO, 'ING-001');
    const [mv] = await sql<{ n: number }>(`select count(*)::int n from public.inventory_movements`);
    const r = await ok<{ refund_mode: string; amount_cents: number }>(m, 'record_refund', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_lines: [{ order_line_id: l!.order_line_id, quantity: 1 }],
      p_method: 'card_external',
      p_reason_code: 'CUSTOMER_COMPLAINT',
      p_external_reference: 'terminal slip 4411',
    });
    expect(r.refund_mode).toBe('MANUAL_EXTERNAL');
    expect(r.amount_cents).toBe(o.total_cents);
    expect(await balance(PRO, 'ING-001')).toEqual(before);
    const [mv2] = await sql<{ n: number }>(`select count(*)::int n from public.inventory_movements`);
    expect(mv2!.n).toBe(mv!.n);
  });

  it('refunds use the line snapshots even after prices and tax change (AC09)', async () => {
    const m = await as('proManager');
    const o = await runOrderToCompletion(m, PRO, [{ item_id: 'FG-002', quantity: 2 }]);
    const [l] = await lines(o.order_id);
    const bypass = async (delta: number, rate: string) =>
      withDb(stack.dbUrl, async (db) => {
        await db.query('begin');
        await db.query('alter table public.location_item_prices disable trigger location_item_prices_append_only');
        await db.query('alter table public.location_tax_rates disable trigger location_tax_rates_append_only');
        await db.query('update public.location_item_prices set price_cents = price_cents + $2 where location_id = $1', [
          PRO,
          delta,
        ]);
        await db.query('update public.location_tax_rates set rate = $2 where location_id = $1', [PRO, rate]);
        await db.query('alter table public.location_item_prices enable trigger location_item_prices_append_only');
        await db.query('alter table public.location_tax_rates enable trigger location_tax_rates_append_only');
        await db.query('commit');
      });
    await bypass(700, '0.0999');
    try {
      const r = await ok<{ net_cents: number; tax_cents: number }>(m, 'record_refund', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_lines: [{ order_line_id: l!.order_line_id, quantity: 2 }],
        p_method: 'cash',
        p_reason_code: 'CUSTOMER_COMPLAINT',
      });
      expect(r.net_cents).toBe(Number(l!.net_cents));
      expect(r.tax_cents).toBe(Number(l!.tax_cents));
    } finally {
      await bypass(-700, '0.0725');
    }
  });

  it('cancelling an order with a recorded payment records the refund in the same transaction', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-002', quantity: 1 }],
    });
    await ok(e, 'record_tender', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_amount_cents: 500,
      p_method: 'cash',
    });
    const base = { p_order_id: o.order_id, p_expected_version: o.version, p_reason_code: 'CUSTOMER_COMPLAINT' };
    expect(await code(e, 'cancel_order', { p_request_key: key(), ...base })).toBe('validation:refund_method_required');
    expect(await code(e, 'cancel_order', { p_request_key: key(), ...base, p_refund_method: 'cash' })).toBe(
      'approval_required',
    );
    const c = await ok<{ status: string; refunded_cents: number }>(e, 'cancel_order', {
      p_request_key: key(),
      ...base,
      p_refund_method: 'cash',
      p_approver_employee_id: employeeId('proManager'),
      p_pin: pins().proManager,
    });
    expect(c).toMatchObject({ status: 'cancelled', refunded_cents: 500 });
    const [f] = await sql<{ kind: string; amount_cents: string; refund_mode: string; approved_by: string }>(
      `select kind, amount_cents::text, refund_mode, approved_by from public.refunds where order_id = $1`,
      [o.order_id],
    );
    expect(f).toEqual({
      kind: 'cancellation',
      amount_cents: '500',
      refund_mode: 'MANUAL_EXTERNAL',
      approved_by: employeeId('proManager'),
    });
  });

  it('pilot retail returns stay closed until the owner configures a return policy; meals are never returned', async () => {
    const m = await as('proManager');
    const owner = await as('owner');
    const o = await runOrderToCompletion(m, PRO, [{ item_id: 'FG-001', quantity: 1 }]);
    const [l] = await lines(o.order_id);
    const ret = {
      p_order_id: o.order_id,
      p_lines: [{ order_line_id: l!.order_line_id, quantity: 1, condition: 'unopened_intact' }],
      p_reason_code: 'CUSTOMER_COMPLAINT',
    };
    expect(await code(m, 'process_return', { p_request_key: key(), ...ret })).toBe(
      'setup_gate_closed:return_policy_configured',
    );
    const [gate] = await sql<{ gate_id: string }>(
      `select gate_id from public.pilot_setup_gates where gate_key = 'return_policy_configured'`,
    );
    expect(
      await code(owner, 'confirm_setup_gate', {
        p_request_key: key(),
        p_gate_id: gate!.gate_id,
        p_evidence_note: 'Policy reviewed',
      }),
    ).toBe('setup_gate_precondition:return_policy_configured');
    expect(
      await code(m, 'set_return_policy', { p_request_key: key(), p_window_days: 14, p_allow_customer_restock: false }),
    ).toBe('unauthorized');
    await ok(owner, 'set_return_policy', { p_request_key: key(), p_window_days: 14, p_allow_customer_restock: false });
    await ok(owner, 'confirm_setup_gate', {
      p_request_key: key(),
      p_gate_id: gate!.gate_id,
      p_evidence_note: 'Policy reviewed: 14 days, no customer restock',
    });
    expect(await code(m, 'process_return', { p_request_key: key(), ...ret })).toBe(
      'validation:meals_are_refunded_not_returned',
    );
    const [p] = await sql<{ allow_customer_restock: boolean; provenance: string }>(
      `select allow_customer_restock, provenance from public.return_policy`,
    );
    expect(p).toEqual({ allow_customer_restock: false, provenance: 'pilot_operator_entered' });
  });
});

// ---------------------------------------------------------------------------
// Supplier AP
// ---------------------------------------------------------------------------
async function receiveOne(itemId: string, packs = 1) {
  const m = await as('proManager');
  const [si] = await sql<{ supplier_item_id: string; supplier_id: string }>(
    `select supplier_item_id, supplier_id from public.supplier_items where item_id = $1 and is_primary`,
    [itemId],
  );
  const po = await ok<{ po_id: string; version: number }>(m, 'create_purchase_order', {
    p_request_key: key(),
    p_location_id: PRO,
    p_supplier_id: si!.supplier_id,
    p_expected_date: null,
    p_lines: [{ supplier_item_id: si!.supplier_item_id, packs }],
  });
  const sub = await ok<{ version: number }>(m, 'submit_purchase_order', {
    p_request_key: key(),
    p_po_id: po.po_id,
    p_expected_version: po.version,
  });
  const [pol] = await sql<{ po_line_id: string }>(
    `select po_line_id from public.purchase_order_lines where po_id = $1`,
    [po.po_id],
  );
  const r = await ok<{ receipt_id: string }>(m, 'receive_purchase_order', {
    p_request_key: key(),
    p_po_id: po.po_id,
    p_expected_version: sub.version,
    p_packing_slip_ref: null,
    p_lines: [{ po_line_id: pol!.po_line_id, packs }],
  });
  const [rl] = await sql<{ receipt_line_id: string; base_quantity: string; unit_cost: string }>(
    `select receipt_line_id, base_quantity::text, unit_cost::text from public.receipt_lines where receipt_id = $1`,
    [r.receipt_id],
  );
  return { supplierId: si!.supplier_id, receiptLine: rl! };
}

interface Invoice {
  invoice_id: string;
  status: string;
  version: number;
  revision: number;
  total_cents: number;
  balance_cents: number;
  paid_cents: number;
  due_date: string;
  has_discrepancy: boolean;
  discrepancy_accepted: boolean;
}

const daysAgo = (n: number) => {
  const d = new Date(`${inject('opsToday')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe('AC18 supplier invoices and payments', () => {
  it('a normalized duplicate invoice number is rejected even with a new request key', async () => {
    const m = await as('proManager');
    const { supplierId, receiptLine } = await receiveOne('ING-010');
    const line = {
      receipt_line_id: receiptLine.receipt_line_id,
      quantity: receiptLine.base_quantity,
      unit_price: receiptLine.unit_cost,
    };
    await ok(m, 'create_supplier_invoice', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: supplierId,
      p_invoice_number: 'INV-7001',
      p_invoice_date: daysAgo(1),
      p_lines: [line],
    });
    expect(
      await code(m, 'create_supplier_invoice', {
        p_request_key: key(),
        p_location_id: PRO,
        p_supplier_id: supplierId,
        p_invoice_number: '  inv-7001 ',
        p_invoice_date: daysAgo(1),
        p_lines: [line],
      }),
    ).toBe('duplicate_business_key:invoice_number');
  });

  it('partial payment reduces only that invoice; overpayment fails; retries pay once; reversal restores', async () => {
    const m = await as('proManager');
    const { supplierId, receiptLine } = await receiveOne('ING-027');
    const mk = (n: string) =>
      ok<Invoice>(m, 'create_supplier_invoice', {
        p_request_key: key(),
        p_location_id: PRO,
        p_supplier_id: supplierId,
        p_invoice_number: n,
        p_invoice_date: daysAgo(2),
        p_lines: [{ description: 'Freight', quantity: 1, unit_price: 25 }],
        p_tax_cents: 0,
        p_due_date: daysAgo(0),
      });
    const a = await mk('PAY-A-1');
    const b = await mk('PAY-B-1');
    expect(a.total_cents).toBe(2500);
    expect(receiptLine).toBeTruthy();

    const payArgs = { p_request_key: key(), p_invoice_id: a.invoice_id, p_amount_cents: 1000, p_method: 'check' };
    const paid = await ok<Invoice & { payment_id: string; record_mode: string }>(m, 'record_supplier_payment', payArgs);
    expect(paid).toMatchObject({ status: 'partially_paid', balance_cents: 1500, record_mode: 'MANUAL_EXTERNAL' });
    const replay = await ok<{ replayed: boolean }>(m, 'record_supplier_payment', payArgs);
    expect(replay.replayed).toBe(true);
    const [pc] = await sql<{ n: number }>(
      `select count(*)::int n from public.supplier_payments where invoice_id = $1`,
      [a.invoice_id],
    );
    expect(pc!.n).toBe(1);
    const bNow = await ok<Invoice>(m, 'get_supplier_invoice', { p_invoice_id: b.invoice_id });
    expect(bNow.balance_cents).toBe(2500);

    expect(
      await code(m, 'record_supplier_payment', {
        p_request_key: key(),
        p_invoice_id: a.invoice_id,
        p_amount_cents: 1501,
        p_method: 'check',
      }),
    ).toBe('validation:overpayment');
    expect(
      await code(m, 'void_supplier_invoice', {
        p_request_key: key(),
        p_invoice_id: a.invoice_id,
        p_expected_version: paid.version,
        p_reason: 'Entered twice',
      }),
    ).toBe('invalid_state:payments_or_credits_applied');

    const rev = await ok<Invoice>(m, 'reverse_supplier_payment', {
      p_request_key: key(),
      p_payment_id: paid.payment_id,
      p_reason: 'Check was voided',
    });
    expect(rev).toMatchObject({ status: 'open', balance_cents: 2500 });
    expect(
      await code(m, 'reverse_supplier_payment', {
        p_request_key: key(),
        p_payment_id: paid.payment_id,
        p_reason: 'Again',
      }),
    ).toBe('invalid_state:already_reversed');

    const credited = await ok<Invoice & { credit_id: string }>(m, 'record_supplier_credit', {
      p_request_key: key(),
      p_invoice_id: a.invoice_id,
      p_amount_cents: 500,
      p_reason: 'Short-dated case credited',
      p_credit_memo_ref: 'CM-55',
    });
    expect(credited.balance_cents).toBe(2000);
    const finalPay = await ok<Invoice>(m, 'record_supplier_payment', {
      p_request_key: key(),
      p_invoice_id: a.invoice_id,
      p_amount_cents: 2000,
      p_method: 'ach_external',
    });
    expect(finalPay).toMatchObject({ status: 'paid', balance_cents: 0 });
    // The posted payment row itself cannot be edited.
    await expect(
      withDb(stack.dbUrl, (db) =>
        db.query(`update public.supplier_payments set amount_cents = 1 where invoice_id = $1`, [a.invoice_id]),
      ),
    ).rejects.toThrow();
  });

  it('due dates default from verified supplier terms; overdue uses the due date and local business date', async () => {
    const m = await as('proManager');
    const { supplierId } = await receiveOne('ING-028');
    const old = await ok<Invoice>(m, 'create_supplier_invoice', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: supplierId,
      p_invoice_number: 'DUE-OLD',
      p_invoice_date: daysAgo(40),
      p_lines: [{ description: 'Flour', quantity: 1, unit_price: 10 }],
    });
    expect(old.due_date).toBe(daysAgo(10)); // invoice date + 30-day terms
    const fresh = await ok<Invoice>(m, 'create_supplier_invoice', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: supplierId,
      p_invoice_number: 'DUE-TODAY',
      p_invoice_date: daysAgo(3),
      p_lines: [{ description: 'Flour', quantity: 1, unit_price: 10 }],
      p_due_date: daysAgo(0),
    });
    const list = await ok<{
      business_date: string;
      invoices: Array<Invoice & { overdue: boolean; days_overdue: number | null }>;
    }>(m, 'get_supplier_invoices', { p_location_ids: [PRO] });
    expect(list.business_date).toBe(inject('opsToday'));
    const byId = new Map(list.invoices.map((i) => [i.invoice_id, i]));
    expect(byId.get(old.invoice_id)).toMatchObject({ overdue: true, days_overdue: 10 });
    expect(byId.get(fresh.invoice_id)).toMatchObject({ overdue: false });
  });

  it('employees and other-location managers see no AP and cannot record payments', async () => {
    const e = await as('proEmployee');
    const sm = await as('sfoManager');
    expect(await code(e, 'get_supplier_invoices', {})).toBe('unauthorized');
    const { data } = await e.from('supplier_invoices').select('invoice_id');
    expect(data).toEqual([]);
    expect(await code(sm, 'get_supplier_invoices', { p_location_ids: [PRO] })).toBe('unauthorized');
    const [inv] = await sql<{ invoice_id: string }>(
      `select invoice_id from public.supplier_invoices where location_id = $1 and status <> 'paid' limit 1`,
      [PRO],
    );
    expect(
      await code(sm, 'record_supplier_payment', {
        p_request_key: key(),
        p_invoice_id: inv!.invoice_id,
        p_amount_cents: 1,
        p_method: 'check',
      }),
    ).toBe('unauthorized');
  });
});

describe('AC19 invoices never add stock or rewrite cost; discrepancies stay traceable', () => {
  it('a price discrepancy blocks payment until a manager accepts it; revisions keep the old lines', async () => {
    const m = await as('proManager');
    const e = await as('proEmployee');
    const { supplierId, receiptLine } = await receiveOne('ING-033');
    const snapshot = async () =>
      sql(
        `select (select count(*)::int from public.inventory_movements) movements,
                (select valued_qty::text || '@' || avg_unit_cost::text from public.item_valuation
                  where location_id = $1 and item_id = 'ING-033') valuation,
                (select sum(issued_cost)::text from public.order_issue_costs) cogs`,
        [PRO],
      );
    const before = await snapshot();
    const higher = (Number(receiptLine.unit_cost) * 1.2).toFixed(8);
    const inv = await ok<Invoice>(m, 'create_supplier_invoice', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: supplierId,
      p_invoice_number: 'VAR-1',
      p_invoice_date: daysAgo(0),
      p_lines: [
        { receipt_line_id: receiptLine.receipt_line_id, quantity: receiptLine.base_quantity, unit_price: higher },
      ],
    });
    expect(inv).toMatchObject({ has_discrepancy: true, discrepancy_accepted: false });
    expect(await snapshot()).toEqual(before);

    expect(
      await code(m, 'record_supplier_payment', {
        p_request_key: key(),
        p_invoice_id: inv.invoice_id,
        p_amount_cents: 100,
        p_method: 'check',
      }),
    ).toBe('invalid_state:discrepancy_not_accepted');
    expect(
      await code(e, 'accept_invoice_discrepancy', {
        p_request_key: key(),
        p_invoice_id: inv.invoice_id,
        p_expected_version: inv.version,
        p_note: 'ok',
      }),
    ).toBe('unauthorized');
    const acc = await ok<Invoice>(m, 'accept_invoice_discrepancy', {
      p_request_key: key(),
      p_invoice_id: inv.invoice_id,
      p_expected_version: inv.version,
      p_note: 'Supplier price rise confirmed by phone',
    });
    expect(acc.discrepancy_accepted).toBe(true);

    // Editing the invoice adds a revision, keeps the old lines and lapses the acceptance.
    const revised = await ok<Invoice>(m, 'revise_supplier_invoice', {
      p_request_key: key(),
      p_invoice_id: inv.invoice_id,
      p_expected_version: acc.version,
      p_lines: [
        {
          receipt_line_id: receiptLine.receipt_line_id,
          quantity: receiptLine.base_quantity,
          unit_price: (Number(receiptLine.unit_cost) * 1.1).toFixed(8),
        },
      ],
      p_note: 'Corrected invoice received',
    });
    expect(revised).toMatchObject({ revision: 2, has_discrepancy: true, discrepancy_accepted: false });
    const revs = await sql<{ revision: number; price_variance_cents: string }>(
      `select revision, price_variance_cents::text from public.supplier_invoice_lines where invoice_id = $1 order by revision`,
      [inv.invoice_id],
    );
    expect(revs.map((r) => r.revision)).toEqual([1, 2]);
    expect(Number(revs[0]!.price_variance_cents)).toBeGreaterThan(Number(revs[1]!.price_variance_cents));
    expect(await snapshot()).toEqual(before);
    const audit = await sql<{ action: string }>(
      `select action from public.audit_log where object_id = $1 order by occurred_at`,
      [inv.invoice_id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'supplier_invoice.create',
      'supplier_invoice.accept_discrepancy',
      'supplier_invoice.revise',
    ]);
  });

  it('a matched invoice equal to the receipt has no discrepancy', async () => {
    const m = await as('proManager');
    const { supplierId, receiptLine } = await receiveOne('ING-034');
    const inv = await ok<Invoice>(m, 'create_supplier_invoice', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: supplierId,
      p_invoice_number: 'MATCH-1',
      p_invoice_date: daysAgo(0),
      p_lines: [
        {
          receipt_line_id: receiptLine.receipt_line_id,
          quantity: receiptLine.base_quantity,
          unit_price: receiptLine.unit_cost,
        },
      ],
    });
    expect(inv.has_discrepancy).toBe(false);
  });
});

describe('AC20 money reconciliation with refunds and waste', () => {
  it('gross − discounts − refunds = net; tax separate; waste counts each cost once', async () => {
    const m = await as('proManager');
    const today = inject('opsToday');
    // One posted waste report of our own so the waste-report component is non-zero.
    const w = await ok<{ waste_report_id: string; version: number }>(await as('proEmployee'), 'submit_waste_report', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'ING-032', quantity: 200 }],
      p_reason_code: 'SPOILAGE',
    });
    await ok(m, 'decide_waste_report', {
      p_request_key: key(),
      p_waste_report_id: w.waste_report_id,
      p_expected_version: w.version,
      p_decision: 'post',
    });
    const s = await ok<{ locations: Array<Record<string, number | null | Record<string, number>>> }>(
      m,
      'get_sales_summary',
      { p_from: today, p_to: today, p_location_ids: [PRO] },
    );
    const row = s.locations[0]!;
    const [db] = await sql<Record<string, string>>(
      `select
         (select coalesce(sum(gross_cents),0) from public.orders where location_id = $1 and status = 'completed' and completed_business_date = $2)::text gross,
         (select coalesce(sum(discount_cents),0) from public.orders where location_id = $1 and status = 'completed' and completed_business_date = $2)::text disc,
         (select coalesce(sum(tax_cents),0) from public.orders where location_id = $1 and status = 'completed' and completed_business_date = $2)::text tax,
         (select coalesce(sum(net_cents),0) from public.refunds where location_id = $1 and kind = 'sale' and business_date = $2)::text refund_net,
         (select coalesce(sum(tax_cents),0) from public.refunds where location_id = $1 and kind = 'sale' and business_date = $2)::text refund_tax,
         (select coalesce(sum(paid_out_cents),0) from public.refunds where location_id = $1 and business_date = $2)::text paid_out,
         (select round(coalesce(sum(issued_cost),0) * 100) from public.order_cancellation_waste where location_id = $1 and business_date = $2)::text w_cancel,
         (select round(coalesce(sum(total_cost),0) * 100) from public.waste_reports where location_id = $1 and status = 'posted' and business_date = $2)::text w_reports,
         (select round(coalesce(sum(r.lost_cost),0) * 100) from public.transfer_receipts r join public.transfer_lines l using (transfer_line_id)
            join public.transfers t using (transfer_id) where t.from_location_id = $1 and r.business_date = $2)::text w_transit`,
      [PRO, today],
    );
    expect(Number(db!.refund_net)).toBeGreaterThan(0);
    expect(row.gross_sales_cents).toBe(Number(db!.gross));
    expect(row.discount_cents).toBe(Number(db!.disc));
    expect(row.refund_cents).toBe(Number(db!.refund_net));
    expect(row.net_sales_cents).toBe(Number(db!.gross) - Number(db!.disc) - Number(db!.refund_net));
    expect(row.tax_cents).toBe(Number(db!.tax) - Number(db!.refund_tax));
    expect(row.recorded_refunds_cents).toBe(Number(db!.paid_out));
    const wb = row.waste_breakdown as Record<string, number>;
    expect(wb.post_start_cancellations_cents).toBe(Number(db!.w_cancel));
    expect(wb.waste_reports_cents).toBe(Number(db!.w_reports));
    expect(wb.transit_loss_cents).toBe(Number(db!.w_transit));
    expect(row.waste_cost_cents).toBe(Number(db!.w_cancel) + Number(db!.w_reports) + Number(db!.w_transit));
    expect(Number(db!.w_reports)).toBeGreaterThan(0);
    // A waste-report item never also appears as COGS: waste movements carry no order.
    const [overlap] = await sql<{ n: number }>(
      `select count(*)::int n from public.inventory_movements where movement_type = 'waste' and source_type = 'order'`,
    );
    expect(overlap!.n).toBe(0);
    expect(row.supplier_outstanding_cents).toBeGreaterThan(0);
    expect(row.supplier_overdue_cents).toBeGreaterThan(0);
  });
});

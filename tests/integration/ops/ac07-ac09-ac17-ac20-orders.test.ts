// AC07 retries, AC08 cancellation, AC09 snapshots, AC17 recorded money only and
// AC20 money reconciliation, through the real API in a pilot database.
import { describe, expect, inject, it } from 'vitest';
import { allocateDiscount, lineTax } from '../../../src/lib/money';
import { as, balance, code, employeeId, key, ok, runOrderToCompletion, sql, type OrderResult } from './helpers';
import { rpc, withDb } from '../helpers/stack';
import { stack } from './helpers';

const LOC = 'LOC-PRO';
const pins = () => inject('opsPins');

describe('AC07 retries return the original result without duplicates', () => {
  it('order acceptance retried with the same key returns the same order and one reservation set', async () => {
    const e = await as('proEmployee');
    const k = key();
    const args = { p_request_key: k, p_location_id: LOC, p_lines: [{ item_id: 'FG-003', quantity: 1 }] };
    const before = await balance(LOC, 'ING-001');
    const first = await ok<OrderResult>(e, 'accept_order', args);
    const second = await ok<OrderResult & { replayed: boolean }>(e, 'accept_order', args);
    expect(second.order_id).toBe(first.order_id);
    expect(second.replayed).toBe(true);
    expect(Number((await balance(LOC, 'ING-001')).reserved) - Number(before.reserved)).toBe(200);
    const [n] = await sql<{ n: number }>(`select count(*)::int n from public.orders where order_id = $1`, [
      first.order_id,
    ]);
    expect(n!.n).toBe(1);
  });

  it('a recorded payment retried with the same key creates one tender', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-002', quantity: 2 }],
    });
    const k = key();
    const args = { p_request_key: k, p_order_id: o.order_id, p_amount_cents: 1000, p_method: 'cash' };
    await ok(e, 'record_tender', args);
    const again = await ok<{ replayed: boolean; balance_due_cents: number }>(e, 'record_tender', args);
    expect(again.replayed).toBe(true);
    const [t] = await sql<{ n: number; s: string }>(
      `select count(*)::int n, sum(amount_cents)::text s from public.tenders where order_id = $1`,
      [o.order_id],
    );
    expect(t).toEqual({ n: 1, s: '1000' });
  });

  it('a stale version cannot overwrite a newer order state', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-005', quantity: 1 }],
    });
    await ok(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    expect(
      await code(e, 'mark_order_ready', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_expected_version: o.version,
      }),
    ).toBe('conflict:stale_version');
  });

  it('an accepted order can be edited: reservations are replaced atomically under a new revision', async () => {
    const e = await as('proEmployee');
    const before = await balance(LOC, 'ING-001');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-001', quantity: 1 }],
    });
    const edited = await ok<OrderResult & { revision: number }>(e, 'edit_accepted_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_lines: [
        { item_id: 'FG-001', quantity: 2 },
        { item_id: 'FG-003', quantity: 1 },
      ],
    });
    expect(edited.revision).toBe(2);
    expect(Number((await balance(LOC, 'ING-001')).reserved) - Number(before.reserved)).toBe(560);
    expect(
      await code(e, 'edit_accepted_order', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_expected_version: o.version,
        p_lines: [{ item_id: 'FG-001', quantity: 1 }],
      }),
    ).toBe('conflict:stale_version');
  });
});

describe('AC08 order cancellation', () => {
  it('before kitchen start any staff member can cancel and the reservation is released', async () => {
    const e = await as('proEmployee');
    const before = await balance(LOC, 'ING-001');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-001', quantity: 2 }],
    });
    expect(Number((await balance(LOC, 'ING-001')).reserved) - Number(before.reserved)).toBe(360);
    await ok(e, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'OTHER',
      p_note: 'guest left',
    });
    expect(await balance(LOC, 'ING-001')).toEqual(before);
    const [w] = await sql<{ n: number }>(
      `select count(*)::int n from public.order_cancellation_waste where order_id = $1`,
      [o.order_id],
    );
    expect(w!.n).toBe(0);
  });

  it('after kitchen start a manager approval is required; waste records the issued cost; nothing is restocked or issued twice', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-004', quantity: 1 }],
    });
    const started = await ok<OrderResult>(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    const stockAfterStart = await balance(LOC, 'ING-001');
    const beef = await balance(LOC, 'ING-003');
    const cancelArgs = { p_order_id: o.order_id, p_expected_version: started.version, p_reason_code: 'BURNT' };

    expect(await code(e, 'cancel_order', { ...cancelArgs, p_request_key: key() })).toBe('approval_required');
    expect(
      await code(e, 'cancel_order', {
        ...cancelArgs,
        p_request_key: key(),
        p_approver_employee_id: employeeId('proEmployee'),
        p_pin: '4829137',
      }),
    ).toBe('approver_not_authorized');
    expect(
      await code(e, 'cancel_order', {
        ...cancelArgs,
        p_request_key: key(),
        p_approver_employee_id: employeeId('proManager'),
        p_pin: '1111119',
      }),
    ).toBe('pin_invalid');
    const [attempts] = await sql<{ n: number }>(
      `select failed_attempts n from private.manager_pins where employee_id = $1`,
      [employeeId('proManager')],
    );
    expect(attempts!.n).toBe(1); // the failed attempt persisted although the action was refused

    const cancelled = await ok<OrderResult>(e, 'cancel_order', {
      ...cancelArgs,
      p_request_key: key(),
      p_approver_employee_id: employeeId('proManager'),
      p_pin: pins().proManager,
    });
    expect(cancelled.status).toBe('cancelled');
    const [waste] = await sql<{ cost: string; approved_by: string }>(
      `select issued_cost::text cost, approved_by from public.order_cancellation_waste where order_id = $1`,
      [o.order_id],
    );
    const [issued] = await sql<{ cost: string }>(
      `select sum(issued_cost)::text cost from public.order_issue_costs where order_id = $1`,
      [o.order_id],
    );
    expect(waste!.cost).toBe(issued!.cost);
    expect(waste!.approved_by).toBe(employeeId('proManager'));
    expect(await balance(LOC, 'ING-003')).toEqual(beef);
    expect(await balance(LOC, 'ING-001')).toEqual(stockAfterStart);
    const [moves] = await sql<{ n: number }>(
      `select count(*)::int n from public.inventory_movements where source_id = $1 and quantity > 0`,
      [o.order_id],
    );
    expect(moves!.n).toBe(0);
    const [audit] = await sql(
      `select actor_employee_id, approver_employee_id from public.audit_log where object_id = $1 and action = 'order.cancelled'`,
      [o.order_id],
    );
    expect(audit).toEqual({
      actor_employee_id: employeeId('proEmployee'),
      approver_employee_id: employeeId('proManager'),
    });
  });
});

describe('AC09 accepted and completed orders keep their snapshots', () => {
  it('recipe, price and tax changes after acceptance do not change the order', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-001', quantity: 1 }],
    });
    const done = await runOrderToCompletion(e, LOC, [{ item_id: 'FG-002', quantity: 1 }]);
    const snapshot = await sql(
      `select order_id, gross_cents, discount_cents, tax_cents, total_cents, tax_rate::text from public.orders where order_id in ($1, $2) order by order_id`,
      [o.order_id, done.order_id],
    );

    await withDb(stack.dbUrl, async (db) => {
      await db.query('begin');
      // New recipe version for FG-001 (owner workflow arrives later; done directly here).
      await db.query(
        `update public.recipe_versions set status = 'superseded', superseded_at = now() where parent_item_id = 'FG-001' and status = 'active'`,
      );
      const { rows } = await db.query(
        `insert into public.recipe_versions (parent_item_id, version_no, basis, source, provenance) values ('FG-001', 2, 'test v2', 'test', 'source') returning recipe_version_id`,
      );
      await db.query(
        `insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
                      select $1, line_no, component_item_id, unit, case when component_item_id = 'ING-001' then 999 else quantity_per_serving end, 'test', 'test'
                      from public.recipe_components c join public.recipe_versions v using (recipe_version_id) where v.parent_item_id = 'FG-001' and v.version_no = 1`,
        [rows[0].recipe_version_id],
      );
      await db.query(
        `update public.recipe_versions set status = 'active', activated_at = now() where recipe_version_id = $1`,
        [rows[0].recipe_version_id],
      );
      // Simulate a master-data price/tax correction by bypassing append-only (test only).
      await db.query(`alter table public.location_item_prices disable trigger location_item_prices_append_only`);
      await db.query(`alter table public.location_tax_rates disable trigger location_tax_rates_append_only`);
      await db.query(`update public.location_item_prices set price_cents = price_cents + 500 where location_id = $1`, [
        LOC,
      ]);
      await db.query(`update public.location_tax_rates set rate = 0.0999 where location_id = $1`, [LOC]);
      await db.query(`alter table public.location_item_prices enable trigger location_item_prices_append_only`);
      await db.query(`alter table public.location_tax_rates enable trigger location_tax_rates_append_only`);
      await db.query('commit');
    });
    try {
      const after = await sql(
        `select order_id, gross_cents, discount_cents, tax_cents, total_cents, tax_rate::text from public.orders where order_id in ($1, $2) order by order_id`,
        [o.order_id, done.order_id],
      );
      expect(after).toEqual(snapshot);
      // Kitchen start consumes the snapshotted 180 g, not the new version's 999 g.
      const started = await ok<OrderResult>(e, 'start_order_preparation', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_expected_version: o.version,
      });
      expect(started.status).toBe('preparing');
      const [issued] = await sql<{ q: string }>(
        `select sum(quantity)::text q from public.inventory_movements where source_id = $1 and item_id = 'ING-001'`,
        [o.order_id],
      );
      expect(issued!.q).toBe('-180.000000');
    } finally {
      await withDb(stack.dbUrl, async (db) => {
        await db.query('begin');
        for (const [t, trg] of [
          ['location_item_prices', 'location_item_prices_append_only'],
          ['location_tax_rates', 'location_tax_rates_append_only'],
          ['recipe_versions', 'recipe_versions_guard'],
        ]) {
          await db.query(`alter table public.${t} disable trigger ${trg}`);
        }
        await db.query(
          `update public.location_item_prices set price_cents = price_cents - 500 where location_id = $1`,
          [LOC],
        );
        await db.query(`update public.location_tax_rates set rate = 0.0725 where location_id = $1`, [LOC]);
        await db.query(
          `update public.recipe_versions set status = 'superseded', superseded_at = now() where parent_item_id = 'FG-001' and version_no = 2`,
        );
        await db.query(
          `update public.recipe_versions set status = 'active', superseded_at = null where parent_item_id = 'FG-001' and version_no = 1`,
        );
        for (const [t, trg] of [
          ['location_item_prices', 'location_item_prices_append_only'],
          ['location_tax_rates', 'location_tax_rates_append_only'],
          ['recipe_versions', 'recipe_versions_guard'],
        ]) {
          await db.query(`alter table public.${t} enable trigger ${trg}`);
        }
        await db.query('commit');
      });
    }
  });
});

describe('AC17 recorded money only', () => {
  it('pilot tenders are MANUAL_EXTERNAL records; pickup needs a zero balance; overpayment fails', async () => {
    const e = await as('proEmployee');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: [{ item_id: 'FG-003', quantity: 1 }],
    });
    expect(o.tender_mode).toBe('MANUAL_EXTERNAL');
    const s = await ok<OrderResult>(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    const r = await ok<OrderResult>(e, 'mark_order_ready', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: s.version,
    });
    expect(
      await code(e, 'complete_order_pickup', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_expected_version: r.version,
      }),
    ).toBe('validation:balance_due');
    expect(
      await code(e, 'record_tender', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_amount_cents: o.total_cents + 1,
        p_method: 'cash',
      }),
    ).toBe('validation:amount_exceeds_balance');
    await ok(e, 'record_tender', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_amount_cents: 500,
      p_method: 'card_external',
      p_external_reference: 'TERM-0001',
    });
    await ok(e, 'record_tender', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_amount_cents: o.total_cents - 500,
      p_method: 'cash',
    });
    const done = await ok<OrderResult>(e, 'complete_order_pickup', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: r.version,
    });
    expect(done.balance_due_cents).toBe(0);
    const tenders = await sql<{ tender_type: string }>(`select distinct tender_type from public.tenders`);
    expect(tenders).toEqual([{ tender_type: 'MANUAL_EXTERNAL' }]);
  });

  it('a 100% complimentary order needs manager approval and completes with no tender', async () => {
    const e = await as('proEmployee');
    const lines = [{ item_id: 'FG-002', quantity: 1 }];
    expect(
      await code(e, 'accept_order', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: lines,
        p_discount_percent: 100,
        p_discount_reason: 'complimentary meal',
      }),
    ).toBe('approval_required');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: lines,
      p_discount_percent: 100,
      p_discount_reason: 'complimentary meal',
      p_approver_employee_id: employeeId('proManager'),
      p_pin: pins().proManager,
    });
    expect(o.total_cents).toBe(0);
    const s = await ok<OrderResult>(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    const r = await ok<OrderResult>(e, 'mark_order_ready', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: s.version,
    });
    expect(
      (
        await ok<OrderResult>(e, 'complete_order_pickup', {
          p_request_key: key(),
          p_order_id: o.order_id,
          p_expected_version: r.version,
        })
      ).status,
    ).toBe('completed');
    const [row] = await sql(`select discount_approved_by from public.orders where order_id = $1`, [o.order_id]);
    expect(row).toEqual({ discount_approved_by: employeeId('proManager') });
  });

  it('discounts are allocated by largest remainder and taxed per line, matching the display mirror', async () => {
    const m = await as('proManager');
    const lines = [
      { item_id: 'FG-001', quantity: 1 },
      { item_id: 'FG-002', quantity: 1 },
      { item_id: 'FG-003', quantity: 1 },
    ];
    const o = await ok<OrderResult>(m, 'accept_order', {
      p_request_key: key(),
      p_location_id: LOC,
      p_lines: lines,
      p_discount_percent: 12.5,
      p_discount_reason: 'service recovery',
    });
    const db = await sql<{ gross_cents: string; discount_cents: string; tax_cents: string }>(
      `select gross_cents::text, discount_cents::text, tax_cents::text from public.order_lines where order_id = $1 order by line_no`,
      [o.order_id],
    );
    const gross = db.map((l) => Number(l.gross_cents));
    const disc = allocateDiscount(gross, '12.5');
    expect(db.map((l) => Number(l.discount_cents))).toEqual(disc);
    expect(db.map((l) => Number(l.tax_cents))).toEqual(gross.map((g, i) => lineTax(g - disc[i]!, '0.0725')));
    expect(o.discount_cents).toBe(Math.round(gross.reduce((a, b) => a + b, 0) * 0.125));
    await ok(m, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'OTHER',
      p_note: 'test cleanup',
    });
  });
});

describe('AC20 money reconciliation in the sales summary', () => {
  it('gross − discounts − refunds = net; tax separate; COGS from issue snapshots; post-start cancellations only in waste', async () => {
    const m = await as('proManager');
    await runOrderToCompletion(await as('proEmployee'), LOC, [
      { item_id: 'FG-001', quantity: 2 },
      { item_id: 'FG-005', quantity: 1 },
    ]);
    const today = inject('opsToday');
    const summary = await ok<{ locations: Array<Record<string, number | null | string>>; data_label: string }>(
      m,
      'get_sales_summary',
      { p_from: today, p_to: today, p_location_ids: [LOC] },
    );
    expect(summary.data_label).toBe('pilot operational');
    const row = summary.locations[0]!;
    const [truth] = await sql<Record<string, string>>(
      `
      select count(*)::text orders, sum(gross_cents)::text gross, sum(discount_cents)::text disc, sum(tax_cents)::text tax,
             round(coalesce(sum((select sum(c.issued_cost) from public.order_issue_costs c where c.order_id = o.order_id)), 0) * 100)::text cogs
        from public.orders o where location_id = $1 and status = 'completed' and completed_business_date = $2`,
      [LOC, today],
    );
    const [waste] = await sql<{ w: string }>(
      `select round(coalesce(sum(issued_cost), 0) * 100)::text w from public.order_cancellation_waste where location_id = $1 and business_date = $2`,
      [LOC, today],
    );
    expect(row.completed_orders).toBe(Number(truth!.orders));
    expect(row.gross_sales_cents).toBe(Number(truth!.gross));
    expect(row.discount_cents).toBe(Number(truth!.disc));
    // Refunds (Milestone 3) reduce net sales and tax by their original line snapshots.
    const [refund] = await sql<{ net: string; tax: string }>(
      `select coalesce(sum(net_cents), 0)::text net, coalesce(sum(tax_cents), 0)::text tax from public.refunds
        where location_id = $1 and kind = 'sale' and business_date = $2`,
      [LOC, today],
    );
    expect(row.refund_cents).toBe(Number(refund!.net));
    expect(row.net_sales_cents).toBe(Number(truth!.gross) - Number(truth!.disc) - Number(refund!.net));
    expect(row.tax_cents).toBe(Number(truth!.tax) - Number(refund!.tax));
    expect(row.cogs_cents).toBe(Number(truth!.cogs));
    expect(row.gross_margin_cents).toBe(Number(row.net_sales_cents) - Number(row.cogs_cents));
    // Total waste also includes posted waste reports and transit losses (Milestone 3).
    expect((row.waste_breakdown as unknown as Record<string, number>).post_start_cancellations_cents).toBe(
      Number(waste!.w),
    );
    expect(Number(waste!.w)).toBeGreaterThan(0);
    // The cancelled order's cost is not also in COGS.
    const [overlap] = await sql<{ n: number }>(
      `select count(*)::int n from public.order_cancellation_waste w join public.orders o using (order_id) where o.status = 'completed'`,
    );
    expect(overlap!.n).toBe(0);
  });

  it('role limits: employees get a daily summary without costs; managers see only totals for other locations', async () => {
    const today = inject('opsToday');
    const e = await as('proEmployee');
    const emp = await ok<{ locations: Array<Record<string, unknown>> }>(e, 'get_sales_summary', {
      p_from: today,
      p_to: today,
    });
    expect(emp.locations.map((l) => l.location_id)).toEqual([LOC]);
    expect(emp.locations[0]!.cogs_cents).toBeNull();
    expect(emp.locations[0]!.gross_margin_cents).toBeNull();
    expect(await code(e, 'get_sales_summary', { p_from: '2026-01-01', p_to: today })).toBe(
      'validation:employee_daily_summary_only',
    );
    expect(await code(e, 'get_sales_summary', { p_from: today, p_to: today, p_location_ids: ['LOC-SLC'] })).toBe(
      'unauthorized',
    );

    const m = await as('proManager');
    const all = await ok<{ locations: Array<Record<string, unknown>> }>(m, 'get_sales_summary', {
      p_from: today,
      p_to: today,
    });
    const slc = all.locations.find((l) => l.location_id === 'LOC-SLC')!;
    expect(Object.keys(slc).sort()).toEqual([
      'access',
      'completed_orders',
      'location_id',
      'location_name',
      'net_sales_cents',
    ]);
    expect(await code(m, 'get_sales_summary', { p_from: today, p_to: today, p_source: 'historical' })).toBe(
      'validation:source',
    );
  });

  it('managers cannot operate or read another location’s orders, costs or purchasing', async () => {
    const slc = await as('slcEmployee');
    const o = await ok<OrderResult>(slc, 'accept_order', {
      p_request_key: key(),
      p_location_id: 'LOC-SLC',
      p_lines: [{ item_id: 'FG-002', quantity: 1 }],
    });
    const m = await as('proManager');
    expect(
      await code(m, 'start_order_preparation', {
        p_request_key: key(),
        p_order_id: o.order_id,
        p_expected_version: o.version,
      }),
    ).toBe('unauthorized');
    expect(
      await code(m, 'accept_order', {
        p_request_key: key(),
        p_location_id: 'LOC-SLC',
        p_lines: [{ item_id: 'FG-002', quantity: 1 }],
      }),
    ).toBe('unauthorized');
    for (const table of ['orders', 'inventory_movements', 'item_valuation', 'order_issue_costs', 'receipts']) {
      const { data } = await m
        .from(table)
        .select('*')
        .eq(
          table === 'order_issue_costs' ? 'order_id' : 'location_id',
          table === 'order_issue_costs' ? o.order_id : 'LOC-SLC',
        );
      expect(data, table).toEqual([]);
    }
    const e = await as('proEmployee');
    for (const table of [
      'item_valuation',
      'inventory_movements',
      'order_issue_costs',
      'order_cancellation_waste',
      'purchase_orders',
    ]) {
      expect((await e.from(table).select('*')).data, table).toEqual([]);
    }
    expect(
      await code(e, 'post_opening_count', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: [{ item_id: 'ING-001', quantity_base: '1', unit_cost: '0' }],
      }),
    ).toBe('unauthorized');
    expect(
      await code(await as('proManager'), 'post_opening_count', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: [{ item_id: 'ING-001', quantity_base: '1', unit_cost: '0', use_by_date: today2() }],
      }),
    ).toBe('invalid_state:opening_already_posted');
    await ok(slc, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'OTHER',
      p_note: 'test cleanup',
    });
  });
});

function today2() {
  return inject('opsToday');
}

describe('direct API cannot bypass the order rules', () => {
  it('ingredients cannot be sold and quantities must be whole servings', async () => {
    const e = await as('proEmployee');
    expect(
      await code(e, 'accept_order', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: [{ item_id: 'ING-001', quantity: 1 }],
      }),
    ).toBe('validation:item_not_sellable');
    expect(
      await code(e, 'accept_order', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: [{ item_id: 'FG-001', quantity: 1.5 }],
      }),
    ).toBe('validation:quantity');
    expect(
      await code(e, 'accept_order', {
        p_request_key: key(),
        p_location_id: LOC,
        p_lines: [{ item_id: 'FG-001', quantity: 0 }],
      }),
    ).toBe('validation:quantity');
    const direct = await e.from('orders').insert({ location_id: LOC });
    expect(direct.error?.code).toBe('42501');
    const r = await rpc(e, 'get_request_result', { p_request_key: key() });
    expect(r.data.status).toBe('not_found');
  });
});

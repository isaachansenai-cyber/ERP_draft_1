// AC04 Unit precision (receiving side) and AC10 Partial receipts, in a pilot
// database set up through the real setup gates.
import { describe, expect, inject, it } from 'vitest';
import { as, balance, code, employeeId, key, ok, sql } from './helpers';

const LOC = 'LOC-PRO';

async function supplierItem(itemId: string) {
  const [row] = await sql<{ supplier_item_id: string; supplier_id: string }>(
    `select supplier_item_id, supplier_id from public.supplier_items where item_id = $1 and is_primary`,
    [itemId],
  );
  return row!;
}

async function submittedPo(itemId: string, packs: number) {
  const m = await as('proManager');
  const si = await supplierItem(itemId);
  const po = await ok<{ po_id: string; version: number }>(m, 'create_purchase_order', {
    p_request_key: key(),
    p_location_id: LOC,
    p_supplier_id: si.supplier_id,
    p_expected_date: null,
    p_lines: [{ supplier_item_id: si.supplier_item_id, packs }],
  });
  const sub = await ok<{ version: number }>(m, 'submit_purchase_order', {
    p_request_key: key(),
    p_po_id: po.po_id,
    p_expected_version: po.version,
  });
  const [line] = await sql<{ po_line_id: string }>(
    `select po_line_id from public.purchase_order_lines where po_id = $1`,
    [po.po_id],
  );
  return { poId: po.po_id, version: sub.version, poLineId: line!.po_line_id };
}

const useBy = () => {
  // Relative to the America/Denver business date, not the UTC date (they differ in the evening).
  const d = new Date(`${inject('opsToday')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 20);
  return d.toISOString().slice(0, 10);
};

describe('AC04 receiving uses the pack conversion and verified units only', () => {
  it('receiving two 10,000 g packs adds 20,000 g (not 2 g)', async () => {
    const m = await as('proManager');
    const before = await balance(LOC, 'ING-001');
    const po = await submittedPo('ING-001', 2);
    const r = await ok<{ receipt_id: string }>(m, 'receive_purchase_order', {
      p_request_key: key(),
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: po.poLineId, packs: 2, use_by_date: useBy() }],
    });
    const after = await balance(LOC, 'ING-001');
    expect(Number(after.on_hand) - Number(before.on_hand)).toBe(20000);
    const [line] = await sql(
      `select base_quantity::text, pack_base_qty_snapshot::text, unit_cost::text from public.receipt_lines where receipt_id = $1`,
      [r.receipt_id],
    );
    expect(line).toEqual({
      base_quantity: '20000.000000',
      pack_base_qty_snapshot: '10000.000000',
      unit_cost: '0.00600000',
    });
  });

  it('a mass quantity in kg converts exactly to grams', async () => {
    const m = await as('proManager');
    const before = await balance(LOC, 'ING-002');
    const po = await submittedPo('ING-002', 1);
    await ok(m, 'receive_purchase_order', {
      p_request_key: key(),
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: po.poLineId, quantity: 2.5, unit: 'kg', use_by_date: useBy() }],
    });
    expect(Number((await balance(LOC, 'ING-002')).on_hand) - Number(before.on_hand)).toBe(2500);
  });

  it('an unverified cross-dimension conversion (ml for a gram item) is rejected and posts nothing', async () => {
    const m = await as('proManager');
    const before = await balance(LOC, 'ING-001');
    const po = await submittedPo('ING-001', 1);
    expect(
      await code(m, 'receive_purchase_order', {
        p_request_key: key(),
        p_po_id: po.poId,
        p_expected_version: po.version,
        p_packing_slip_ref: null,
        p_lines: [{ po_line_id: po.poLineId, quantity: 500, unit: 'ml', use_by_date: useBy() }],
      }),
    ).toBe('validation:unverified_conversion');
    expect(await balance(LOC, 'ING-001')).toEqual(before);
  });

  it('pilot receipts of refrigerated items require a use-by date', async () => {
    const m = await as('proManager');
    const po = await submittedPo('ING-001', 1);
    expect(
      await code(m, 'receive_purchase_order', {
        p_request_key: key(),
        p_po_id: po.poId,
        p_expected_version: po.version,
        p_packing_slip_ref: null,
        p_lines: [{ po_line_id: po.poLineId, packs: 1 }],
      }),
    ).toBe('validation:use_by_required');
  });

  it('weighted average cost = (old qty × old cost + received qty × receipt cost) / new qty', async () => {
    const m = await as('proManager');
    const [before] = await sql<{ q: string; c: string }>(
      `select valued_qty::text q, avg_unit_cost::text c from public.item_valuation where location_id = $1 and item_id = 'ING-003'`,
      [LOC],
    );
    const po = await submittedPo('ING-003', 1);
    await ok(m, 'receive_purchase_order', {
      p_request_key: key(),
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: po.poLineId, packs: 1, pack_cost_cents: 8000, use_by_date: useBy() }],
    });
    const [expected] = await sql<{ v: string }>(
      `select round(($1::numeric * $2::numeric + 10000 * 0.008) / ($1::numeric + 10000), 8)::text v`,
      [before!.q, before!.c],
    );
    const [after] = await sql<{ c: string }>(
      `select avg_unit_cost::text c from public.item_valuation where location_id = $1 and item_id = 'ING-003'`,
      [LOC],
    );
    expect(after!.c).toBe(expected!.v);
  });
});

describe('AC10 partial receipts, retries and over-receipt', () => {
  it('receiving 6 of 10 packs adds six packs and leaves four open; a retry adds nothing', async () => {
    const m = await as('proManager');
    const before = await balance(LOC, 'ING-004');
    const po = await submittedPo('ING-004', 10);
    const k = key();
    const args = {
      p_request_key: k,
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: `SLIP-${k.slice(0, 8)}`,
      p_lines: [{ po_line_id: po.poLineId, packs: 6, use_by_date: useBy() }],
    };
    const first = await ok<{ receipt_id: string; po_status: string }>(m, 'receive_purchase_order', args);
    expect(first.po_status).toBe('partially_received');
    const [packSize] = await sql<{ p: string }>(
      `select pack_base_qty::text p from public.purchase_order_lines where po_line_id = $1`,
      [po.poLineId],
    );
    const afterFirst = await balance(LOC, 'ING-004');
    expect(Number(afterFirst.on_hand) - Number(before.on_hand)).toBe(6 * Number(packSize!.p));
    const [line] = await sql(
      `select ordered_packs::text o, received_packs::text r from public.purchase_order_lines where po_line_id = $1`,
      [po.poLineId],
    );
    expect(line).toEqual({ o: '10.000000', r: '6.000000' });

    // Same request key: original result, no second receipt or movement.
    const replay = await ok<{ receipt_id: string; replayed: boolean }>(m, 'receive_purchase_order', args);
    expect(replay.receipt_id).toBe(first.receipt_id);
    expect(replay.replayed).toBe(true);
    expect(await balance(LOC, 'ING-004')).toEqual(afterFirst);
    const [count] = await sql<{ n: number }>(`select count(*)::int n from public.receipts where po_id = $1`, [po.poId]);
    expect(count!.n).toBe(1);

    // A new key cannot bypass the packing-slip reference uniqueness.
    expect(
      await code(m, 'receive_purchase_order', { ...args, p_request_key: key(), p_expected_version: po.version + 1 }),
    ).toBe('duplicate_business_key:packing_slip_ref');
    // A stale version is refused.
    expect(await code(m, 'receive_purchase_order', { ...args, p_request_key: key(), p_packing_slip_ref: null })).toBe(
      'conflict:stale_version',
    );
  });

  it('an over-receipt needs an explicit, audited manager acknowledgement', async () => {
    const m = await as('proManager');
    const po = await submittedPo('ING-005', 2);
    const base = {
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: po.poLineId, packs: 3, use_by_date: useBy() }],
    };
    expect(await code(m, 'receive_purchase_order', { ...base, p_request_key: key() })).toBe(
      'validation:over_receipt_requires_acknowledgement',
    );
    const r = await ok<{ receipt_id: string; over_receipt: boolean; po_status: string }>(m, 'receive_purchase_order', {
      ...base,
      p_request_key: key(),
      p_acknowledge_over_receipt: true,
    });
    expect(r.over_receipt).toBe(true);
    expect(r.po_status).toBe('received');
    const [audit] = await sql(
      `select action, actor_employee_id, approver_employee_id from public.audit_log where object_id = $1`,
      [r.receipt_id],
    );
    expect(audit).toEqual({
      action: 'receipt.post_over_receipt',
      actor_employee_id: employeeId('proManager'),
      approver_employee_id: employeeId('proManager'),
    });
  });

  it('cancelling the open balance closes the PO without touching received stock', async () => {
    const m = await as('proManager');
    const po = await submittedPo('ING-006', 5);
    const rec = await ok<{ po_version: number }>(m, 'receive_purchase_order', {
      p_request_key: key(),
      p_po_id: po.poId,
      p_expected_version: po.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: po.poLineId, packs: 2, use_by_date: useBy() }],
    });
    const stockBefore = await balance(LOC, 'ING-006');
    const closed = await ok<{ status: string }>(m, 'cancel_purchase_order_balance', {
      p_request_key: key(),
      p_po_id: po.poId,
      p_expected_version: rec.po_version,
      p_reason: 'supplier short-shipped',
    });
    expect(closed.status).toBe('received');
    const [line] = await sql(
      `select received_packs::text r, cancelled_packs::text c from public.purchase_order_lines where po_line_id = $1`,
      [po.poLineId],
    );
    expect(line).toEqual({ r: '2.000000', c: '3.000000' });
    expect(await balance(LOC, 'ING-006')).toEqual(stockBefore);
  });

  it('employees cannot create, submit or receive purchase orders', async () => {
    const e = await as('proEmployee');
    const si = await supplierItem('ING-001');
    expect(
      await code(e, 'create_purchase_order', {
        p_request_key: key(),
        p_location_id: LOC,
        p_supplier_id: si.supplier_id,
        p_expected_date: null,
        p_lines: [{ supplier_item_id: si.supplier_item_id, packs: 1 }],
      }),
    ).toBe('unauthorized');
    const po = await submittedPo('ING-001', 1);
    expect(
      await code(e, 'receive_purchase_order', {
        p_request_key: key(),
        p_po_id: po.poId,
        p_expected_version: po.version,
        p_packing_slip_ref: null,
        p_lines: [{ po_line_id: po.poLineId, packs: 1 }],
      }),
    ).toBe('unauthorized');
    expect((await e.from('purchase_orders').select('po_id')).data).toEqual([]);
  });
});

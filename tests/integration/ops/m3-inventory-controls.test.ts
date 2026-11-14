// AC11 count conflict, AC12 lot eligibility (quarantine, expiry reassignment),
// AC13 transfer reconciliation, and waste reports, through the real API in a
// pilot database.
import { describe, expect, inject, it } from 'vitest';
import { as, balance, code, key, ok, sql, type OrderResult } from './helpers';
import { withDb } from '../helpers/stack';
import { stack } from './helpers';

const PRO = 'LOC-PRO';
const SFO = 'LOC-SFO';

const dayOffset = (n: number) => {
  // Relative to the America/Denver business date, not the UTC date (they differ in the evening).
  const d = new Date(`${inject('opsToday')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Test-only: move a lot's use-by date (lots are immutable to every application role). */
async function setUseBy(lotId: string, date: string) {
  await withDb(stack.dbUrl, async (db) => {
    await db.query('alter table public.lots disable trigger lots_immutable');
    try {
      await db.query('update public.lots set use_by_date = $2 where lot_id = $1', [lotId, date]);
    } finally {
      await db.query('alter table public.lots enable trigger lots_immutable');
    }
  });
}

async function countLines(countId: string) {
  return sql<{ lot_id: string; condition: string; expected_qty: string }>(
    `select lot_id, condition, expected_qty::text from public.stock_count_lines where count_id = $1 order by lot_id`,
    [countId],
  );
}

async function postWaste(locationId: string, itemId: string, quantity: number, reason = 'SPOILAGE') {
  const e = await as(locationId === PRO ? 'proEmployee' : 'sfoEmployee');
  const m = await as(locationId === PRO ? 'proManager' : 'sfoManager');
  const w = await ok<{ waste_report_id: string; version: number }>(e, 'submit_waste_report', {
    p_request_key: key(),
    p_location_id: locationId,
    p_lines: [{ item_id: itemId, quantity }],
    p_reason_code: reason,
  });
  return ok<{ total_cost: string; status: string }>(m, 'decide_waste_report', {
    p_request_key: key(),
    p_waste_report_id: w.waste_report_id,
    p_expected_version: w.version,
    p_decision: 'post',
  });
}

describe('AC11 physical counts', () => {
  it('a count is rejected if stock moved after its snapshot; a fresh count posts with a reason', async () => {
    const m = await as('proManager');
    const stale = await ok<{ count_id: string; version: number }>(m, 'start_stock_count', {
      p_request_key: key(),
      p_location_id: PRO,
      p_item_ids: ['ING-030'],
    });
    const [line] = await countLines(stale.count_id);
    await postWaste(PRO, 'ING-030', 25); // a movement after the snapshot
    expect(
      await code(m, 'post_stock_count', {
        p_request_key: key(),
        p_count_id: stale.count_id,
        p_expected_version: stale.version,
        p_counts: [{ lot_id: line!.lot_id, condition: line!.condition, counted_qty: 1 }],
      }),
    ).toBe('conflict:stock_changed_since_count');

    const before = await balance(PRO, 'ING-030');
    const fresh = await ok<{ count_id: string; version: number }>(m, 'start_stock_count', {
      p_request_key: key(),
      p_location_id: PRO,
      p_item_ids: ['ING-030'],
    });
    const [l] = await countLines(fresh.count_id);
    expect(l!.expected_qty).toBe(Number(before.on_hand).toFixed(6));
    const k = key();
    const args = {
      p_request_key: k,
      p_count_id: fresh.count_id,
      p_expected_version: fresh.version,
      p_counts: [{ lot_id: l!.lot_id, condition: l!.condition, counted_qty: Number(l!.expected_qty) - 50 }],
      p_reason_code: 'COUNT_VARIANCE',
      p_note: 'Monthly count',
    };
    const posted = await ok<{ adjusted_lines: number }>(m, 'post_stock_count', args);
    expect(posted.adjusted_lines).toBe(1);
    const replay = await ok<{ replayed: boolean }>(m, 'post_stock_count', args);
    expect(replay.replayed).toBe(true);
    expect(Number((await balance(PRO, 'ING-030')).on_hand)).toBe(Number(before.on_hand) - 50);
    const moves = await sql<{ n: number; reason_code: string; qty: string }>(
      `select count(*)::int n, min(reason_code) reason_code, sum(quantity)::text qty from public.inventory_movements
        where source_type = 'stock_count' and source_id = $1`,
      [fresh.count_id],
    );
    expect(moves[0]).toEqual({ n: 1, reason_code: 'COUNT_VARIANCE', qty: '-50.000000' });
  });

  it('a count cannot drop a lot below its reserved quantity, and reservations survive a count', async () => {
    const e = await as('proEmployee');
    const m = await as('proManager');
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-003', quantity: 1 }],
    });
    const [alloc] = await sql<{ lot_id: string; qty: string }>(
      `select lot_id, quantity::text qty from public.reservation_allocations
        where order_id = $1 and item_id = 'ING-001' and status = 'active'`,
      [o.order_id],
    );
    const c = await ok<{ count_id: string; version: number }>(m, 'start_stock_count', {
      p_request_key: key(),
      p_location_id: PRO,
      p_item_ids: ['ING-001'],
    });
    const [bal] = await sql<{ on_hand: string; reserved: string }>(
      `select on_hand::text, reserved::text from public.stock_balances where lot_id = $1 and condition = 'sellable'`,
      [alloc!.lot_id],
    );
    expect(
      await code(m, 'post_stock_count', {
        p_request_key: key(),
        p_count_id: c.count_id,
        p_expected_version: c.version,
        p_counts: [{ lot_id: alloc!.lot_id, condition: 'sellable', counted_qty: Number(bal!.reserved) - 1 }],
      }),
    ).toBe('validation:count_below_reserved');
    await ok(m, 'post_stock_count', {
      p_request_key: key(),
      p_count_id: c.count_id,
      p_expected_version: c.version,
      p_counts: [{ lot_id: alloc!.lot_id, condition: 'sellable', counted_qty: Number(bal!.on_hand) - 10 }],
    });
    const [after] = await sql<{ on_hand: string; reserved: string }>(
      `select on_hand::text, reserved::text from public.stock_balances where lot_id = $1 and condition = 'sellable'`,
      [alloc!.lot_id],
    );
    expect(after!.reserved).toBe(bal!.reserved);
    expect(Number(after!.on_hand)).toBe(Number(bal!.on_hand) - 10);
    await ok(e, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'WRONG_ITEM',
    });
  });

  it('employees cannot run counts', async () => {
    const e = await as('proEmployee');
    expect(
      await code(e, 'start_stock_count', { p_request_key: key(), p_location_id: PRO, p_item_ids: ['ING-030'] }),
    ).toBe('unauthorized');
  });
});

describe('Waste reports (AC20 waste part feeds from these)', () => {
  it('employees submit, only managers post; posting removes stock at weighted-average cost', async () => {
    const e = await as('proEmployee');
    const m = await as('proManager');
    const before = await balance(PRO, 'ING-035');
    const [val] = await sql<{ c: string }>(
      `select avg_unit_cost::text c from public.item_valuation where location_id = $1 and item_id = 'ING-035'`,
      [PRO],
    );
    const w = await ok<{ waste_report_id: string; version: number; status: string }>(e, 'submit_waste_report', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'ING-035', quantity: 40 }],
      p_reason_code: 'SPOILAGE',
    });
    expect(w.status).toBe('submitted');
    expect(await balance(PRO, 'ING-035')).toEqual(before); // a report alone moves nothing
    expect(
      await code(e, 'decide_waste_report', {
        p_request_key: key(),
        p_waste_report_id: w.waste_report_id,
        p_expected_version: w.version,
        p_decision: 'post',
      }),
    ).toBe('unauthorized');
    const posted = await ok<{ total_cost: string }>(m, 'decide_waste_report', {
      p_request_key: key(),
      p_waste_report_id: w.waste_report_id,
      p_expected_version: w.version,
      p_decision: 'post',
    });
    expect(Number(posted.total_cost)).toBeCloseTo(40 * Number(val!.c), 6);
    expect(Number((await balance(PRO, 'ING-035')).on_hand)).toBe(Number(before.on_hand) - 40);
  });

  it('OTHER needs a note; a rejection needs a reason and moves nothing', async () => {
    const e = await as('proEmployee');
    const m = await as('proManager');
    expect(
      await code(e, 'submit_waste_report', {
        p_request_key: key(),
        p_location_id: PRO,
        p_lines: [{ item_id: 'ING-035', quantity: 5 }],
        p_reason_code: 'OTHER',
      }),
    ).toBe('validation:note_required');
    const before = await balance(PRO, 'ING-035');
    const w = await ok<{ waste_report_id: string; version: number }>(e, 'submit_waste_report', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'ING-035', quantity: 5 }],
      p_reason_code: 'BURNT',
    });
    expect(
      await code(m, 'decide_waste_report', {
        p_request_key: key(),
        p_waste_report_id: w.waste_report_id,
        p_expected_version: w.version,
        p_decision: 'reject',
      }),
    ).toBe('validation:reason');
    await ok(m, 'decide_waste_report', {
      p_request_key: key(),
      p_waste_report_id: w.waste_report_id,
      p_expected_version: w.version,
      p_decision: 'reject',
      p_note: 'Recounted, nothing burnt',
    });
    expect(await balance(PRO, 'ING-035')).toEqual(before);
  });
});

describe('AC12 lot eligibility', () => {
  it('quarantined stock stays on hand but leaves availability until released', async () => {
    const m = await as('proManager');
    const [lot] = await sql<{ lot_id: string }>(
      `select b.lot_id from public.stock_balances b where b.location_id = $1 and b.item_id = 'ING-029'
        and b.condition = 'sellable' and b.on_hand - b.reserved >= 100 order by b.lot_id limit 1`,
      [PRO],
    );
    const before = await balance(PRO, 'ING-029');
    await ok(m, 'change_stock_condition', {
      p_request_key: key(),
      p_lot_id: lot!.lot_id,
      p_quantity: 100,
      p_to_condition: 'quarantined',
      p_reason_code: 'DAMAGED_SEAL',
    });
    const held = await balance(PRO, 'ING-029');
    expect(held.on_hand).toBe(before.on_hand);
    expect(Number(held.available)).toBe(Number(before.available) - 100);
    await ok(m, 'change_stock_condition', {
      p_request_key: key(),
      p_lot_id: lot!.lot_id,
      p_quantity: 100,
      p_to_condition: 'sellable',
    });
    expect(await balance(PRO, 'ING-029')).toEqual(before);
  });

  it('a reserved lot that expires before kitchen start is reassigned atomically to an eligible lot', async () => {
    const m = await as('proManager');
    const e = await as('proEmployee');
    const [si] = await sql<{ supplier_item_id: string; supplier_id: string }>(
      `select supplier_item_id, supplier_id from public.supplier_items where item_id = 'ING-001' and is_primary`,
    );
    const po = await ok<{ po_id: string; version: number }>(m, 'create_purchase_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: si!.supplier_id,
      p_expected_date: null,
      p_lines: [{ supplier_item_id: si!.supplier_item_id, packs: 1 }],
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
    const rcv = await ok<{ receipt_id: string }>(m, 'receive_purchase_order', {
      p_request_key: key(),
      p_po_id: po.po_id,
      p_expected_version: sub.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: pol!.po_line_id, packs: 1, use_by_date: dayOffset(1) }], // earliest use-by → FEFO first
    });
    const [rl] = await sql<{ lot_id: string }>(`select lot_id from public.receipt_lines where receipt_id = $1`, [
      rcv.receipt_id,
    ]);
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-003', quantity: 1 }],
    });
    const [first] = await sql<{ lot_id: string }>(
      `select lot_id from public.reservation_allocations where order_id = $1 and item_id = 'ING-001' and status = 'active'`,
      [o.order_id],
    );
    expect(first!.lot_id).toBe(rl!.lot_id);

    const availBefore = Number((await balance(PRO, 'ING-001')).available);
    await setUseBy(rl!.lot_id, dayOffset(-1)); // the reserved lot is now expired
    const availExpired = Number((await balance(PRO, 'ING-001')).available);
    expect(availExpired).toBe(availBefore - (10000 - 200)); // its unreserved 9,800 g left availability

    await ok(e, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
    const issued = await sql<{ lot_id: string; qty: string }>(
      `select lot_id, sum(-quantity)::text qty from public.inventory_movements
        where source_type = 'order' and source_id = $1 and item_id = 'ING-001' and movement_type = 'kitchen_issue'
        group by lot_id`,
      [o.order_id],
    );
    expect(issued).toHaveLength(1);
    expect(issued[0]!.lot_id).not.toBe(rl!.lot_id);
    expect(Number(issued[0]!.qty)).toBe(200);
    const [{ n }] = (await sql<{ n: number }>(
      `select count(*)::int n from public.reservation_allocations where order_id = $1 and status = 'active'`,
      [o.order_id],
    )) as [{ n: number }];
    expect(n).toBe(0);
  });

  it('if no eligible lot remains, kitchen start is blocked and nothing is issued', async () => {
    const e = await as('sfoEmployee');
    const lots = await sql<{ lot_id: string; use_by_date: string }>(
      `select l.lot_id, l.use_by_date::text from public.lots l
        join public.stock_balances b on b.lot_id = l.lot_id and b.condition = 'sellable'
       where l.location_id = $1 and l.item_id = 'ING-001' and b.on_hand > 0`,
      [SFO],
    );
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: SFO,
      p_lines: [{ item_id: 'FG-003', quantity: 1 }],
    });
    try {
      for (const l of lots) await setUseBy(l.lot_id, dayOffset(-1));
      expect(
        await code(e, 'start_order_preparation', {
          p_request_key: key(),
          p_order_id: o.order_id,
          p_expected_version: o.version,
        }),
      ).toBe('insufficient_stock');
      const [mv] = await sql<{ n: number }>(
        `select count(*)::int n from public.inventory_movements where source_type = 'order' and source_id = $1`,
        [o.order_id],
      );
      expect(mv!.n).toBe(0);
    } finally {
      for (const l of lots) await setUseBy(l.lot_id, l.use_by_date);
    }
    await ok(e, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'WRONG_ITEM',
    });
  });
});

describe('AC13 transfers reconcile source, transit and destination', () => {
  it('dispatch → partial receive → final receive with a reason-coded loss', async () => {
    const pm = await as('proManager');
    const sm = await as('sfoManager');
    const srcBefore = await balance(PRO, 'ING-036');
    const dstBefore = await balance(SFO, 'ING-036');
    const t = await ok<{ transfer_id: string; version: number }>(pm, 'create_transfer', {
      p_request_key: key(),
      p_from_location_id: PRO,
      p_to_location_id: SFO,
      p_lines: [{ item_id: 'ING-036', quantity: 1000 }],
    });
    expect(
      await code(sm, 'dispatch_transfer', {
        p_request_key: key(),
        p_transfer_id: t.transfer_id,
        p_expected_version: 1,
      }),
    ).toBe('unauthorized');
    const d = await ok<{ version: number }>(pm, 'dispatch_transfer', {
      p_request_key: key(),
      p_transfer_id: t.transfer_id,
      p_expected_version: t.version,
    });
    expect(Number((await balance(PRO, 'ING-036')).on_hand)).toBe(Number(srcBefore.on_hand) - 1000);
    expect(await balance(SFO, 'ING-036')).toEqual(dstBefore); // in transit: nobody's available stock

    const [line] = await sql<{ transfer_line_id: string; unit_cost: string }>(
      `select transfer_line_id, unit_cost::text from public.transfer_lines where transfer_id = $1`,
      [t.transfer_id],
    );
    expect(
      await code(pm, 'receive_transfer', {
        p_request_key: key(),
        p_transfer_id: t.transfer_id,
        p_expected_version: d.version,
        p_lines: [{ transfer_line_id: line!.transfer_line_id, received_qty: 600 }],
      }),
    ).toBe('unauthorized'); // only the destination manager receives
    const r1 = await ok<{ status: string; version: number }>(sm, 'receive_transfer', {
      p_request_key: key(),
      p_transfer_id: t.transfer_id,
      p_expected_version: d.version,
      p_lines: [{ transfer_line_id: line!.transfer_line_id, received_qty: 600 }],
    });
    expect(r1.status).toBe('partially_received');
    expect(Number((await balance(SFO, 'ING-036')).on_hand)).toBe(Number(dstBefore.on_hand) + 600);
    const [mid] = await sql<{ in_transit_qty: string }>(
      `select in_transit_qty::text from public.transfer_lines where transfer_line_id = $1`,
      [line!.transfer_line_id],
    );
    expect(mid!.in_transit_qty).toBe('400.000000');

    expect(
      await code(sm, 'receive_transfer', {
        p_request_key: key(),
        p_transfer_id: t.transfer_id,
        p_expected_version: r1.version,
        p_lines: [{ transfer_line_id: line!.transfer_line_id, received_qty: 401 }],
      }),
    ).toBe('validation:exceeds_in_transit');
    expect(
      await code(sm, 'receive_transfer', {
        p_request_key: key(),
        p_transfer_id: t.transfer_id,
        p_expected_version: r1.version,
        p_lines: [{ transfer_line_id: line!.transfer_line_id, received_qty: 350, lost_qty: 50 }],
      }),
    ).toBe('validation:reason_code');
    const r2 = await ok<{ status: string }>(sm, 'receive_transfer', {
      p_request_key: key(),
      p_transfer_id: t.transfer_id,
      p_expected_version: r1.version,
      p_lines: [
        {
          transfer_line_id: line!.transfer_line_id,
          received_qty: 350,
          lost_qty: 50,
          loss_reason_code: 'TRANSIT_LOSS',
          note: 'Bag split',
        },
      ],
    });
    expect(r2.status).toBe('received');

    const srcAfter = Number((await balance(PRO, 'ING-036')).on_hand);
    const dstAfter = Number((await balance(SFO, 'ING-036')).on_hand);
    expect(Number(srcBefore.on_hand) - srcAfter).toBe(1000);
    expect(dstAfter - Number(dstBefore.on_hand)).toBe(950);
    const [rec] = await sql<{
      received: string;
      lost: string;
      transit: string;
      rcost: string;
      lcost: string;
      dcost: string;
    }>(
      `select l.received_qty::text received, l.lost_qty::text lost, l.in_transit_qty::text transit,
              (select sum(r.received_cost) from public.transfer_receipts r where r.transfer_line_id = l.transfer_line_id)::numeric(28,8)::text rcost,
              (select sum(r.lost_cost) from public.transfer_receipts r where r.transfer_line_id = l.transfer_line_id)::numeric(28,8)::text lcost,
              (l.dispatched_qty * l.unit_cost)::numeric(28,8)::text dcost
         from public.transfer_lines l where l.transfer_line_id = $1`,
      [line!.transfer_line_id],
    );
    expect({ received: rec!.received, lost: rec!.lost, transit: rec!.transit }).toEqual({
      received: '950.000000',
      lost: '50.000000',
      transit: '0.000000',
    });
    expect(Number(rec!.rcost) + Number(rec!.lcost)).toBeCloseTo(Number(rec!.dcost), 8);
    const [loss] = await sql<{ reason: string }>(
      `select loss_reason_code reason from public.transfer_receipts where transfer_line_id = $1 and lost_qty > 0`,
      [line!.transfer_line_id],
    );
    expect(loss!.reason).toBe('TRANSIT_LOSS');
  });
});

describe('AC03 cost and custody visibility', () => {
  it('employees see their own waste reports but never their cost; managers see the cost', async () => {
    const e = await as('proEmployee');
    const m = await as('proManager');
    const { error } = await e.from('waste_reports').select('total_cost');
    expect(error?.code).toBe('42501');
    const { data, error: plainError } = await e.from('waste_reports').select('report_number, status');
    expect(plainError).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    const mine = await ok<Array<{ total_cost: string | null }>>(e, 'list_waste_reports', { p_location_id: PRO });
    expect(mine.every((r) => r.total_cost === null)).toBe(true);
    const all = await ok<Array<{ status: string; total_cost: string | null }>>(m, 'list_waste_reports', {
      p_location_id: PRO,
    });
    expect(all.some((r) => r.status === 'posted' && r.total_cost !== null)).toBe(true);
  });

  it('only managers of the location see returned-goods custody and refunds', async () => {
    expect(await code(await as('proEmployee'), 'list_return_custody', { p_location_id: PRO })).toBe('unauthorized');
    expect(await code(await as('sfoManager'), 'list_return_custody', { p_location_id: PRO })).toBe('unauthorized');
    const { data } = await (await as('proEmployee')).from('refunds').select('refund_id');
    expect(data).toEqual([]);
  });
});

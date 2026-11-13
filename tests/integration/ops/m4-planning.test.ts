// AC21 MRP reservations, AC22 EOQ units, AC23 forecast provenance, AC24
// availability explanation, through the real API in a pilot database.
import { describe, expect, inject, it } from 'vitest';
import { as, code, key, ok, runOrderToCompletion, sql, type OrderResult } from './helpers';

const PRO = 'LOC-PRO';
const SFO = 'LOC-SFO';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface ForecastDay {
  date: string;
  method: string;
  observations: number;
  window_from: string | null;
  window_to: string | null;
  base_qty: string | null;
  override_qty: number | null;
  forecast_qty: string | null;
  fulfilled_qty: number;
  in_progress_qty: number;
  accepted_qty: number;
  residual_qty: string | null;
}
interface Forecast {
  data_label: string;
  items: Array<{ item_id: string; item_type: string; days: ForecastDay[] }>;
}
interface PlanItem {
  item_id: string;
  available_now: string;
  days: Array<{ date: string; receipts: string; requirement: string; projected: string; forecast_missing: boolean }>;
  late_receipts: Array<{ po_number: string; expected_date: string | null }>;
  shortage_date: string | null;
  proposed_order_date: string | null;
  proposed_order_late: boolean;
}

const day = (f: Forecast, item: string, date: string) =>
  f.items.find((i) => i.item_id === item)!.days.find((d) => d.date === date)!;

describe('AC23 forecast provenance', () => {
  it('uses only dates before the as-of date; with no prior history the pilot requires a manager forecast', async () => {
    const m = await as('proManager');
    const today = inject('opsToday');
    const f = await ok<Forecast>(m, 'get_demand_forecast', { p_location_id: PRO, p_as_of: today, p_days: 14 });
    expect(f.data_label).toBe('pilot operational');
    // Every order in this pilot was completed today, which is not before the as-of date.
    for (const item of f.items) for (const d of item.days) expect(['manager_required', 'closed']).toContain(d.method);
    expect(day(f, 'FG-001', today).base_qty).toBeNull();

    // As of tomorrow, today's completed orders are one observation: fewer than two
    // same-weekday instances, so the trailing 28-day mean applies.
    await runOrderToCompletion(await as('proEmployee'), PRO, [{ item_id: 'FG-001', quantity: 2 }]);
    const tomorrow = addDays(today, 1);
    const f2 = await ok<Forecast>(m, 'get_demand_forecast', { p_location_id: PRO, p_as_of: tomorrow, p_days: 7 });
    const [sold] = await sql<{ q: string }>(
      `select coalesce(sum(l.quantity), 0)::text q from public.orders o
         join public.order_lines l on l.order_id = o.order_id and l.revision = o.revision
        where o.location_id = $1 and o.status = 'completed' and o.completed_business_date = $2 and l.item_id = 'FG-001'`,
      [PRO, today],
    );
    const d = day(f2, 'FG-001', addDays(today, 7 - 1));
    expect(d.method).toBe('trailing_28d');
    expect(d.observations).toBe(1);
    expect(Number(d.base_qty)).toBe(Number(sold!.q));
    expect(d.window_to).toBe(today);
  });

  it('synthetic history is not a source in the pilot, and employees cannot read forecasts', async () => {
    const m = await as('proManager');
    expect(await code(m, 'get_demand_forecast', { p_location_id: PRO, p_source: 'historical' })).toBe(
      'validation:source',
    );
    expect(await code(await as('proEmployee'), 'get_demand_forecast', { p_location_id: PRO })).toBe('unauthorized');
    expect(await code(await as('sfoManager'), 'get_demand_forecast', { p_location_id: PRO })).toBe('unauthorized');
  });
});

describe('AC21 MRP netting', () => {
  it('accepted orders reduce the residual forecast before the BOM explosion; receipts count only on their expected date', async () => {
    const m = await as('proManager');
    const e = await as('proEmployee');
    const today = inject('opsToday');
    await ok(m, 'set_forecast_override', {
      p_request_key: key(),
      p_location_id: PRO,
      p_item_id: 'FG-004',
      p_business_date: today,
      p_quantity: 10,
      p_reason: 'Catering pickup expected',
    });
    const o = await ok<OrderResult>(e, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: 'FG-004', quantity: 3 }],
    });
    // A future PO and a late one for beef chuck (ING-003).
    const [si] = await sql<{ supplier_item_id: string; supplier_id: string; pack: string }>(
      `select supplier_item_id, supplier_id, pack_base_qty::text pack from public.supplier_items where item_id = 'ING-003' and is_primary`,
    );
    for (const expected of [addDays(today, 3), addDays(today, -2)]) {
      const po = await ok<{ po_id: string; version: number }>(m, 'create_purchase_order', {
        p_request_key: key(),
        p_location_id: PRO,
        p_supplier_id: si!.supplier_id,
        p_expected_date: expected,
        p_lines: [{ supplier_item_id: si!.supplier_item_id, packs: 2 }],
      });
      await ok(m, 'submit_purchase_order', { p_request_key: key(), p_po_id: po.po_id, p_expected_version: po.version });
    }

    const f = await ok<Forecast>(m, 'get_demand_forecast', { p_location_id: PRO, p_days: 14 });
    const fg4 = day(f, 'FG-004', today);
    expect(fg4.override_qty).toBe(10);
    expect(fg4.accepted_qty).toBeGreaterThanOrEqual(3);
    const residual = Math.max(0, 10 - fg4.fulfilled_qty - fg4.in_progress_qty - fg4.accepted_qty);
    expect(Number(fg4.residual_qty)).toBe(residual);

    const plan = await ok<{ items: PlanItem[] }>(m, 'get_replenishment_plan', { p_location_id: PRO, p_days: 14 });
    const beef = plan.items.find((i) => i.item_id === 'ING-003')!;
    // Expected day-0 requirement: residual forecasts of every dish × its recipe quantity.
    const residuals = new Map(f.items.map((i) => [i.item_id, i.days.find((d) => d.date === today)!.residual_qty]));
    const comps = await sql<{ parent: string; q: string }>(
      `select v.parent_item_id parent, c.quantity_per_serving::text q from public.recipe_versions v
         join public.recipe_components c using (recipe_version_id) where v.status = 'active' and c.component_item_id = 'ING-003'`,
    );
    const expectedReq = comps.reduce((s, c) => s + Number(residuals.get(c.parent) ?? 0) * Number(c.q), 0);
    const d0 = beef.days[0]!;
    expect(Number(d0.requirement)).toBeCloseTo(expectedReq, 6);
    // Available already excludes the accepted order's reservation: it is not subtracted again.
    expect(Number(d0.projected)).toBeCloseTo(Number(beef.available_now) + Number(d0.receipts) - expectedReq, 6);

    const receiptDays = beef.days.filter((d) => Number(d.receipts) > 0).map((d) => d.date);
    expect(receiptDays).toEqual([addDays(today, 3)]);
    expect(Number(beef.days[3]!.receipts)).toBe(2 * Number(si!.pack));
    expect(beef.late_receipts.some((l) => l.expected_date === addDays(today, -2))).toBe(true);
    expect(beef.days[1]!.forecast_missing).toBe(true); // no override or history for tomorrow

    await ok(e, 'cancel_order', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'WRONG_ITEM',
    });
  });

  it('a projected shortage proposes an order date offset by the supplier lead time, flagged when already late', async () => {
    const m = await as('sfoManager');
    const today = inject('opsToday');
    // SFO holds little chicken: forecast 100 FG-001 for day 2 to force a shortage.
    await ok(m, 'set_forecast_override', {
      p_request_key: key(),
      p_location_id: SFO,
      p_item_id: 'FG-001',
      p_business_date: addDays(today, 2),
      p_quantity: 100,
      p_reason: 'Festival weekend',
    });
    const plan = await ok<{ items: PlanItem[] }>(m, 'get_replenishment_plan', { p_location_id: SFO, p_days: 7 });
    const chicken = plan.items.find((i) => i.item_id === 'ING-001')!;
    const [lead] = await sql<{ d: number }>(
      `select coalesce(si.procurement_lead_days, i.procurement_lead_days, 0) d from public.items i
         left join public.supplier_items si on si.item_id = i.item_id and si.is_primary where i.item_id = 'ING-001'`,
    );
    expect(chicken.shortage_date).toBe(addDays(today, 2));
    expect(chicken.proposed_order_date).toBe(addDays(today, 2 - lead!.d));
    expect(chicken.proposed_order_late).toBe(2 - lead!.d < 0);
  });
});

describe('AC22 EOQ units', () => {
  it('D=10,000, S=$20, H=$2 gives 447.214, or 450 with 25-unit packs; H<=0 and negatives are rejected', async () => {
    const m = await as('proManager');
    const r = await ok<{
      eoq: string;
      actionable_quantity: string;
      actionable_packs: string;
      units: Record<string, string>;
    }>(m, 'calculate_eoq', {
      p_annual_demand: 10000,
      p_ordering_cost_cents: 2000,
      p_holding_cost: 2,
      p_pack_base_qty: 25,
    });
    expect(r.eoq).toBe('447.214');
    expect(Number(r.actionable_quantity)).toBe(450);
    expect(Number(r.actionable_packs)).toBe(18);
    expect(r.units.holding_cost).toBe('USD per base unit per year');
    expect(
      await code(m, 'calculate_eoq', { p_annual_demand: 10000, p_ordering_cost_cents: 2000, p_holding_cost: 0 }),
    ).toBe('validation:eoq_holding_cost_not_positive');
    expect(
      await code(m, 'calculate_eoq', { p_annual_demand: -1, p_ordering_cost_cents: 2000, p_holding_cost: 2 }),
    ).toBe('validation:eoq_demand_negative');
    const zero = await ok<{ eoq: string }>(m, 'calculate_eoq', {
      p_annual_demand: 0,
      p_ordering_cost_cents: 2000,
      p_holding_cost: 2,
    });
    expect(Number(zero.eoq)).toBe(0);
    const capped = await ok<{ warnings: string[] }>(m, 'calculate_eoq', {
      p_annual_demand: 10000,
      p_ordering_cost_cents: 2000,
      p_holding_cost: 2,
      p_pack_base_qty: 25,
      p_max_cover_days: 7,
    });
    expect(capped.warnings.some((w) => w.startsWith('exceeds_max_cover_days'))).toBe(true);
  });

  it('settings save only after the planning gate, are stored with units, and feed the EOQ; demand under 28 days is insufficient', async () => {
    const m = await as('proManager');
    const owner = await as('owner');
    const args = {
      p_location_id: PRO,
      p_item_id: 'ING-010',
      p_reorder_point: 6000,
      p_safety_stock: 2000,
      p_ordering_cost_cents: 2000,
      p_holding_cost: 0.002,
      p_max_cover_days: 30,
    };
    expect(await code(m, 'set_location_item_settings', { p_request_key: key(), ...args })).toBe(
      'setup_gate_closed:planning_inputs_confirmed',
    );
    const [gate] = await sql<{ gate_id: string }>(
      `select gate_id from public.pilot_setup_gates where gate_key = 'planning_inputs_confirmed' and scope_id = $1`,
      [PRO],
    );
    await ok(owner, 'confirm_setup_gate', {
      p_request_key: key(),
      p_gate_id: gate!.gate_id,
      p_evidence_note: 'Ordering and holding cost basis reviewed with the owner',
    });
    expect(await code(await as('proEmployee'), 'set_location_item_settings', { p_request_key: key(), ...args })).toBe(
      'unauthorized',
    );
    expect(await code(m, 'set_location_item_settings', { p_request_key: key(), ...args, p_holding_cost: 0 })).toBe(
      'validation:eoq_holding_cost_not_positive',
    );
    await ok(m, 'set_location_item_settings', { p_request_key: key(), ...args });
    const inputs = await ok<{
      demand_status: string;
      eoq: unknown;
      settings: { reorder_point: string; units: Record<string, string>; provenance: string };
    }>(m, 'get_eoq_inputs', { p_location_id: PRO, p_item_id: 'ING-010' });
    expect(inputs.demand_status).toBe('insufficient'); // the pilot has under 28 observed days
    expect(inputs.eoq).toBeNull(); // so no EOQ without a manager demand input
    expect(Number(inputs.settings.reorder_point)).toBe(6000);
    expect(inputs.settings.units).toEqual({
      quantity: 'item base unit',
      ordering_cost: 'USD cents per replenishment order',
      holding_cost: 'USD per base unit per year',
      annual_demand: 'item base units per year',
    });
    expect(inputs.settings.provenance).toBe('pilot_manager_approved');

    await ok(m, 'set_location_item_settings', { p_request_key: key(), ...args, p_annual_demand_override: 10000 });
    const withDemand = await ok<{ annual_demand_source: string; eoq: { eoq: string; actionable_quantity: string } }>(
      m,
      'get_eoq_inputs',
      { p_location_id: PRO, p_item_id: 'ING-010' },
    );
    expect(withDemand.annual_demand_source).toBe('manager input');
    // sqrt(2 × 10,000 × 20 / 0.002) = 14,142.136 g; 10,000 g packs → 20,000 g.
    expect(withDemand.eoq.eoq).toBe('14142.136');
    expect(Number(withDemand.eoq.actionable_quantity)).toBe(20000);
    const [audit] = await sql<{ n: number }>(
      `select count(*)::int n from public.audit_log where action = 'planning.settings' and object_id = 'LOC-PRO:ING-010'`,
    );
    expect(audit!.n).toBe(2);
  });
});

describe('AC24 What can we serve', () => {
  it('shows each dish’s independent potential and its limiting ingredient', async () => {
    const m = await as('proManager');
    const v = await ok<{
      note: string;
      dishes: Array<{
        item_id: string;
        portions_now: number;
        bottleneck_item_id: string;
        planned_today: string | null;
      }>;
    }>(m, 'get_serve_view', { p_location_id: PRO });
    expect(v.note).toMatch(/cannot be added together/);
    const expected = await sql<{ parent: string; portions: string; bottleneck: string }>(
      `select distinct on (v.parent_item_id) v.parent_item_id parent,
              floor(private.available_qty($1, c.component_item_id) / c.quantity_per_serving)::text portions,
              c.component_item_id bottleneck
         from public.recipe_versions v join public.recipe_components c using (recipe_version_id)
        where v.status = 'active'
        order by v.parent_item_id, floor(private.available_qty($1, c.component_item_id) / c.quantity_per_serving), c.component_item_id`,
      [PRO],
    );
    expect(v.dishes).toHaveLength(5);
    for (const e of expected) {
      const d = v.dishes.find((x) => x.item_id === e.parent)!;
      expect(d.portions_now).toBe(Number(e.portions));
      expect(d.bottleneck_item_id).toBe(e.bottleneck);
    }
    // Employees see availability but not planned demand.
    const ev = await ok<{ dishes: Array<{ planned_today: string | null }> }>(
      await as('proEmployee'),
      'get_serve_view',
      {
        p_location_id: PRO,
      },
    );
    expect(ev.dishes.every((d) => d.planned_today === null)).toBe(true);
  });

  it('a menu-mix simulation aggregates shared chicken and garlic and previews replenishment without saving', async () => {
    const m = await as('sfoManager');
    const counts = () =>
      sql(`select (select count(*) from public.purchase_orders)::text po, (select count(*) from public.inventory_movements)::text mv,
                  (select count(*) from public.reservation_allocations)::text ra`);
    const before = await counts();
    const r = await ok<{
      preview_only: boolean;
      feasible: boolean;
      components: Array<{
        item_id: string;
        required: string;
        available: string;
        shortfall: string;
        shared: boolean;
        proposed_quantity: string | null;
        proposed_packs: string | null;
        used_by: Array<{ dish: string }>;
      }>;
    }>(m, 'simulate_menu_mix', {
      p_location_id: SFO,
      p_mix: [
        { item_id: 'FG-001', quantity: 20 },
        { item_id: 'FG-003', quantity: 20 },
      ],
    });
    expect(r.preview_only).toBe(true);
    const chicken = r.components.find((c) => c.item_id === 'ING-001')!;
    expect(Number(chicken.required)).toBe(20 * 180 + 20 * 200); // 7,600 g across both dishes
    expect(chicken.shared).toBe(true);
    expect(chicken.used_by.map((u) => u.dish).sort()).toEqual(['FG-001', 'FG-003']);
    const short = Number(chicken.required) - Number(chicken.available);
    expect(short).toBeGreaterThan(0);
    expect(r.feasible).toBe(false);
    expect(Number(chicken.shortfall)).toBe(short);
    expect(Number(chicken.proposed_packs)).toBe(Math.ceil(short / 10000));

    const [garlicQ] = await sql<{ q: string }>(
      `select sum(20 * c.quantity_per_serving)::text q from public.recipe_versions v join public.recipe_components c using (recipe_version_id)
        where v.status = 'active' and v.parent_item_id in ('FG-001', 'FG-003') and c.component_item_id = 'ING-006'`,
    );
    const garlic = r.components.find((c) => c.item_id === 'ING-006')!;
    expect(Number(garlic.required)).toBe(Number(garlicQ!.q));
    expect(await counts()).toEqual(before); // a preview writes nothing
    expect(
      await code(await as('sfoEmployee'), 'simulate_menu_mix', {
        p_location_id: SFO,
        p_mix: [{ item_id: 'FG-001', quantity: 1 }],
      }),
    ).toBe('unauthorized');
  });
});

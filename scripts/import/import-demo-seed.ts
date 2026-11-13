// Import the synthetic demo seed (PRD §16) into a DEMO database only.
//
// Usage: DATABASE_URL=... DEMO_PROJECT_REF_ALLOWLIST=<ref>[,local] npm run import:demo
//
// Refuses unless the target ref is allowlisted AND the database reports
// data_mode = 'demo'. Database triggers independently reject synthetic rows in
// a pilot database. Insert-only and idempotent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { assertDemoTarget, connect, isMain, requireEnv, runCli } from '../lib/target.ts';
import { importSourceMaster, loadSourceMaster } from './import-source-master.ts';

export const DEMO_SEED_PATH = fileURLToPath(new URL('../../data/demo/demo_seed.json', import.meta.url));

interface DemoItem {
  item_id: string;
  name: string;
  item_type: string;
  category: string;
  base_unit: string;
  storage_note: string | null;
  source_note: string | null;
  source: string;
  primary_supplier_id: string | null;
  procurement_lead_days: number | null;
  prep_lead_days: number | null;
  lead_time_basis: string | null;
  lead_time_note: string | null;
  purchase_pack_base_qty: number | null;
  purchase_pack_cost_cents: number | null;
  demo_unit_cost: number | null;
  demo_reference_price_per_base: number | null;
  sale_price_cents: number | null;
  value_provenance: Record<string, string>;
}
export interface DemoSeed {
  dataset_id: string;
  dataset_class: string;
  demo_as_of_date: string;
  history_start: string;
  history_end: string;
  items: DemoItem[];
  suppliers: Array<{
    supplier_id: string;
    demo_payment_terms_days: number;
    demo_contact_email: string;
    payment_terms_provenance: string;
  }>;
  locations: Array<{ location_id: string; demo_tax_rate: string; tax_provenance: string }>;
  customers: Array<{
    customer_id: string;
    display_name: string;
    email: string | null;
    phone: string | null;
    provenance: string;
  }>;
  employees: Array<{
    employee_id: string;
    display_name: string;
    role: string;
    location_id: string | null;
    provenance: string;
  }>;
  location_item_settings: Array<{
    location_id: string;
    item_id: string;
    daily_demand_example: number;
    reorder_point_base: number;
    safety_stock_base: number;
    ordering_cost_cents: number;
    annual_holding_cost_per_base: number;
    reorder_applicable: boolean;
    provenance: string;
  }>;
  opening_inventory: Array<{
    location_id: string;
    item_id: string;
    quantity_base: number;
    unit_cost: number;
    internal_lot_id: string;
    use_by_date: string | null;
    provenance: string;
  }>;
}

export function loadDemoSeed(path = DEMO_SEED_PATH): DemoSeed {
  const seed = JSON.parse(readFileSync(path, 'utf8')) as DemoSeed;
  if (seed.dataset_class !== 'synthetic_demo_only')
    throw new Error('demo seed dataset_class must be synthetic_demo_only');
  const expect = (label: string, actual: number, expected: number) => {
    if (actual !== expected) throw new Error(`demo seed ${label}: expected ${expected}, found ${actual}`);
  };
  expect('items', seed.items.length, 47);
  expect('customers', seed.customers.length, 10);
  expect('employees', seed.employees.length, 10);
  expect('location_item_settings', seed.location_item_settings.length, 141);
  expect('opening_inventory', seed.opening_inventory.length, 126);
  expect('locations', seed.locations.length, 3);
  return seed;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

export async function importDemoSeed(client: pg.Client, seed = loadDemoSeed()) {
  const { rows } = await client.query<{ data_mode: string; dataset_id: string }>(
    'select data_mode, dataset_id from public.app_settings',
  );
  if (rows[0].data_mode !== 'demo') throw new Error('database is not in demo mode');
  if (rows[0].dataset_id !== seed.dataset_id) {
    throw new Error(`database dataset_id "${rows[0].dataset_id}" does not match seed "${seed.dataset_id}"`);
  }

  // Source master first (idempotent); the 45 shared items must match the source exactly.
  const source = loadSourceMaster();
  await importSourceMaster(client, source);
  const sourceIds = new Set(source.items.map((i) => i.item_id));
  for (const item of seed.items.filter((i) => sourceIds.has(i.item_id))) {
    const src = source.items.find((s) => s.item_id === item.item_id)!;
    if (src.name !== item.name || src.base_unit !== item.base_unit) {
      throw new Error(`demo seed item ${item.item_id} disagrees with source master`);
    }
  }

  const inserted: Record<string, number> = {};
  const count = (key: string, r: pg.QueryResult) => {
    inserted[key] = (inserted[key] ?? 0) + (r.rowCount ?? 0);
  };
  const effectiveFrom = seed.history_start;

  await client.query('begin');
  try {
    // Synthetic retail items (RET-001/002).
    for (const i of seed.items.filter((x) => !sourceIds.has(x.item_id))) {
      count(
        'retail_items',
        await client.query(
          `insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, requires_use_by,
           requires_use_by_basis, barcode, storage_note, source_note, primary_supplier_id, procurement_lead_days,
           prep_lead_days, lead_time_basis, lead_time_note, source, provenance, provenance_detail)
         values ($1,$2,$3,$4,$5,true,false,'synthetic_demo_shelf_stable',$1,$6,$7,$8,$9,$10,$11,$12,$13,
           'synthetic_demo_fixture',$14)
         on conflict (item_id) do nothing`,
          [
            i.item_id,
            i.name,
            i.item_type,
            i.category,
            i.base_unit,
            i.storage_note,
            i.source_note,
            i.primary_supplier_id,
            i.procurement_lead_days,
            i.prep_lead_days,
            i.lead_time_basis,
            i.lead_time_note,
            i.source,
            JSON.stringify(i.value_provenance),
          ],
        ),
      );
    }

    // Demo standard/reference costs for all 47 items.
    for (const i of seed.items) {
      count(
        'item_standard_costs',
        await client.query(
          `insert into public.item_standard_costs (item_id, standard_unit_cost, reference_price_per_base, cost_basis, provenance)
         values ($1, $2::numeric, $3::numeric, 'synthetic_demo_assumption', 'synthetic_demo_assumption')
         on conflict (item_id) do nothing`,
          [i.item_id, num(i.demo_unit_cost), num(i.demo_reference_price_per_base)],
        ),
      );
    }

    // Demo supplier terms and non-routable contact emails (real contacts untouched).
    for (const s of seed.suppliers) {
      count(
        'supplier_demo_terms',
        await client.query(
          `update public.suppliers
            set contact_email = $2, contact_email_provenance = 'synthetic_demo_contact_non_routable',
                payment_terms_days = $3, payment_terms_provenance = $4, updated_at = now()
          where supplier_id = $1 and contact_email is null and payment_terms_days is null`,
          [s.supplier_id, s.demo_contact_email, s.demo_payment_terms_days, s.payment_terms_provenance],
        ),
      );
    }

    // Demo packs/costs on primary supplier links; retail supplier links.
    for (const i of seed.items.filter((x) => x.primary_supplier_id)) {
      if (sourceIds.has(i.item_id)) {
        count(
          'supplier_item_demo_packs',
          await client.query(
            `update public.supplier_items
              set pack_description = $3, pack_base_qty = $4::numeric, pack_cost_cents = $5, unit_cost = $6::numeric,
                  cost_basis = 'synthetic_demo_assumption', effective_date = $7::date, updated_at = now()
            where supplier_id = $1 and item_id = $2 and is_primary and cost_basis is null`,
            [
              i.primary_supplier_id,
              i.item_id,
              `${i.purchase_pack_base_qty} ${i.base_unit} demo pack`,
              num(i.purchase_pack_base_qty),
              i.purchase_pack_cost_cents,
              num(i.demo_unit_cost),
              effectiveFrom,
            ],
          ),
        );
      } else {
        count(
          'retail_supplier_items',
          await client.query(
            `insert into public.supplier_items (supplier_id, item_id, is_primary, pack_description, pack_base_qty,
             pack_cost_cents, unit_cost, cost_basis, procurement_lead_days, lead_time_basis, effective_date, source, provenance)
           values ($1,$2,true,$3,$4::numeric,$5,$6::numeric,'synthetic_demo_assumption',$7,$8,$9::date,
             'generated_demo_fixture','synthetic_demo_fixture')
           on conflict do nothing`,
            [
              i.primary_supplier_id,
              i.item_id,
              `${i.purchase_pack_base_qty} ${i.base_unit} demo case`,
              num(i.purchase_pack_base_qty),
              i.purchase_pack_cost_cents,
              num(i.demo_unit_cost),
              i.procurement_lead_days,
              i.lead_time_basis,
              effectiveFrom,
            ],
          ),
        );
      }
    }

    // Synthetic tax rate and menu prices, effective from the first history date.
    for (const l of seed.locations) {
      count(
        'location_tax_rates',
        await client.query(
          `insert into public.location_tax_rates (location_id, effective_from, rate, provenance)
         values ($1, $2::date, $3::numeric, $4) on conflict do nothing`,
          [l.location_id, effectiveFrom, l.demo_tax_rate, l.tax_provenance],
        ),
      );
      for (const i of seed.items.filter((x) => x.sale_price_cents !== null)) {
        count(
          'location_item_prices',
          await client.query(
            `insert into public.location_item_prices (location_id, item_id, price_cents, effective_from, provenance)
           values ($1,$2,$3,$4::date,'synthetic_demo_assumption') on conflict do nothing`,
            [l.location_id, i.item_id, i.sale_price_cents, effectiveFrom],
          ),
        );
      }
    }

    for (const s of seed.location_item_settings) {
      count(
        'location_item_settings',
        await client.query(
          `insert into public.location_item_settings (location_id, item_id, reorder_applicable, reorder_point_base,
           safety_stock_base, ordering_cost_cents, annual_holding_cost_per_base, daily_demand_example_base, provenance)
         values ($1,$2,$3,$4::numeric,$5::numeric,$6,$7::numeric,$8::numeric,$9) on conflict do nothing`,
          [
            s.location_id,
            s.item_id,
            s.reorder_applicable,
            num(s.reorder_point_base),
            num(s.safety_stock_base),
            s.ordering_cost_cents,
            num(s.annual_holding_cost_per_base),
            num(s.daily_demand_example),
            s.provenance,
          ],
        ),
      );
    }

    for (const c of seed.customers) {
      count(
        'customers',
        await client.query(
          `insert into public.customers (customer_id, display_name, email, phone, provenance)
         values ($1,$2,$3,$4,$5) on conflict do nothing`,
          [c.customer_id, c.display_name, c.email, c.phone, c.provenance],
        ),
      );
    }

    // Role fixtures: staff records + memberships. No Auth users or passwords here.
    for (const e of seed.employees) {
      count(
        'employees',
        await client.query(
          `insert into public.employees (employee_id, display_name, provenance) values ($1,$2,$3) on conflict do nothing`,
          [e.employee_id, e.display_name, e.provenance],
        ),
      );
      count(
        'memberships',
        await client.query(
          `insert into public.memberships (employee_id, role, location_id, provenance)
         select $1, $2, $3, $4
         where not exists (select 1 from public.memberships m where m.employee_id = $1 and m.active
                           and coalesce(m.location_id, '*') = coalesce($3, '*'))`,
          [e.employee_id, e.role, e.location_id, e.provenance],
        ),
      );
    }

    // Synthetic opening stock, posted once per location through the stock ledger
    // (lots, movements, balances and weighted-average valuation).
    for (const locationId of [...new Set(seed.opening_inventory.map((o) => o.location_id))].sort()) {
      const exists = await client.query('select 1 from public.opening_counts where location_id = $1', [locationId]);
      if (exists.rowCount) continue;
      const lines = seed.opening_inventory
        .filter((o) => o.location_id === locationId)
        .map((o) => ({
          item_id: o.item_id,
          quantity_base: String(o.quantity_base),
          unit_cost: String(o.unit_cost),
          lot_code: o.internal_lot_id,
          use_by_date: o.use_by_date,
        }));
      await client.query(
        `select private.post_opening_count($1, $2::jsonb, null, 'synthetic_demo_opening', null,
           'Synthetic demo opening stock (not a physical count)')`,
        [locationId, JSON.stringify(lines)],
      );
      inserted.opening_stock_rows = (inserted.opening_stock_rows ?? 0) + lines.length;
    }

    // Synthetic demo return policy: 30-day window; unopened shelf-stable retail
    // units may be restocked (demo only; the pilot starts with no policy).
    count(
      'return_policy',
      await client.query(
        `insert into public.return_policy (singleton, window_days, allow_customer_restock, provenance)
         values (true, 30, true, 'synthetic_demo_policy') on conflict do nothing`,
      ),
    );

    // Gates for the new retail supply links, then mark every gate synthetic-confirmed.
    count(
      'setup_gates',
      await client.query(
        `insert into public.pilot_setup_gates (gate_key, scope_type, scope_id)
       select 'pack_conversions_verified', 'supplier_item', si.supplier_item_id::text
         from public.supplier_items si where si.archived_at is null
       on conflict do nothing`,
      ),
    );
    const confirmed = await client.query<{ n: number }>('select private.confirm_gates_for_demo() as n');
    inserted.gates_confirmed_synthetic = confirmed.rows[0].n;

    const changed = Object.values(inserted).some((n) => n > 0);
    if (changed) {
      await client.query(
        `select private.write_audit(null, 'import.demo_seed', 'dataset', $1, null, null, null, $2::jsonb,
           'Synthetic demo seed import', null, 'operator_tooling')`,
        [seed.dataset_id, JSON.stringify(inserted)],
      );
    }
    await client.query('commit');

    return {
      dataset_id: seed.dataset_id,
      inserted,
      changed,
      totals: await demoTotals(client),
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

export async function demoTotals(client: pg.Client) {
  const { rows } = await client.query(`
    select (select count(*) from public.items)::int as items,
           (select count(*) from public.customers)::int as customers,
           (select count(*) from public.employees)::int as employee_fixtures,
           (select count(*) from public.memberships where active)::int as memberships,
           (select count(*) from public.locations)::int as locations,
           (select count(*) from public.location_item_settings)::int as location_item_settings,
           (select count(*) from public.location_item_prices)::int as location_item_prices,
           (select count(*) from public.location_tax_rates)::int as location_tax_rates,
           (select count(*) from public.pilot_setup_gates where status = 'open')::int as open_gates,
           (select count(*) from public.opening_count_lines)::int as opening_stock_rows,
           (select count(*) from public.inventory_movements where movement_type = 'opening')::int as opening_movements`);
  return rows[0];
}

if (isMain(import.meta.url)) {
  await runCli('import-demo-seed', async () => {
    const databaseUrl = requireEnv('DATABASE_URL');
    const client = await connect(databaseUrl);
    try {
      await assertDemoTarget(client, databaseUrl, process.env.SUPABASE_URL);
      return await importDemoSeed(client);
    } finally {
      await client.end();
    }
  });
}

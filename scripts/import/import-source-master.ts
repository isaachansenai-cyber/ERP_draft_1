// Import the source-only master data (PRD §3, AC01) into a pilot or demo database.
//
// Usage: DATABASE_URL=... npm run import:source
//
// Insert-only and idempotent: existing rows are never overwritten (operator
// edits made after import are preserved). After inserting, every source field in
// the database is compared with the file; any difference fails the import.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { connect, isMain, requireEnv, runCli } from '../lib/target.ts';

export const SOURCE_PATH = fileURLToPath(new URL('../../data/source/source_master_data.json', import.meta.url));

export interface SourceItem {
  item_id: string;
  name: string;
  item_type: 'ingredient' | 'finished_dish';
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
}
export interface SourceRecipeLine {
  parent_item_id: string;
  component_item_id: string;
  quantity_per_serving: number;
  unit: string;
  basis: string;
  source: string;
}
export interface SourceSupplier {
  supplier_id: string;
  name: string;
  supplier_type: string | null;
  based_in: string | null;
  phone: string | null;
  address: string | null;
  what_we_buy: string | null;
  source_note: string | null;
  payment_terms: unknown;
  contact_verification: string;
  source: string;
}
export interface SourceMasterData {
  source_files: string[];
  items: SourceItem[];
  recipes: SourceRecipeLine[];
  suppliers: SourceSupplier[];
}

const UNIT_MAP: Record<string, string> = { g: 'g', ml: 'ml', mL: 'ml', ML: 'ml', each: 'each', serving: 'serving' };

/** Normalize source unit spellings (mL → ml) without touching quantities. */
export function normalizeUnit(unit: string): string {
  const normalized = UNIT_MAP[unit];
  if (!normalized) throw new Error(`unknown unit "${unit}" in source data`);
  return normalized;
}

export const REFRIGERATED_NOTE = 'Refrigerated / frozen storage';

/** CLAUDE.md D8: use-by required for refrigerated/frozen ingredients (owner confirms in pilot). */
export function deriveRequiresUseBy(item: Pick<SourceItem, 'item_type' | 'storage_note'>): {
  value: boolean;
  basis: string;
} {
  if (item.item_type === 'finished_dish') return { value: false, basis: 'not_applicable_made_to_order' };
  return item.storage_note === REFRIGERATED_NOTE
    ? { value: true, basis: 'derived_from_storage_note' }
    : { value: false, basis: 'derived_from_storage_note' };
}

export function loadSourceMaster(path = SOURCE_PATH): SourceMasterData {
  const data = JSON.parse(readFileSync(path, 'utf8')) as SourceMasterData;
  const ingredients = data.items.filter((i) => i.item_type === 'ingredient');
  const dishes = data.items.filter((i) => i.item_type === 'finished_dish');
  const expect = (label: string, actual: number, expected: number) => {
    if (actual !== expected) throw new Error(`source file ${label}: expected ${expected}, found ${actual}`);
  };
  expect('ingredients', ingredients.length, 40);
  expect('finished dishes', dishes.length, 5);
  expect('recipe lines', data.recipes.length, 66);
  expect('suppliers', data.suppliers.length, 15);
  expect('primary supplier links', ingredients.filter((i) => i.primary_supplier_id).length, 40);
  return data;
}

export interface ImportSummary {
  inserted: Record<string, number>;
  totals: Record<string, number>;
  changed: boolean;
}

const RECIPE_BASIS_FALLBACK = 'Source illustrative recipe; not kitchen-tested';

export async function importSourceMaster(client: pg.Client, data = loadSourceMaster()): Promise<ImportSummary> {
  const inserted: Record<string, number> = {
    suppliers: 0,
    items: 0,
    recipe_versions: 0,
    recipe_components: 0,
    supplier_items: 0,
    setup_gates: 0,
  };

  await client.query('begin');
  try {
    for (const s of data.suppliers) {
      const r = await client.query(
        `insert into public.suppliers (supplier_id, name, supplier_type, based_in, phone, address, what_we_buy,
           source_note, contact_verification, source, provenance)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'source')
         on conflict (supplier_id) do nothing`,
        [
          s.supplier_id,
          s.name,
          s.supplier_type,
          s.based_in,
          s.phone,
          s.address,
          s.what_we_buy,
          s.source_note,
          s.contact_verification,
          s.source,
        ],
      );
      inserted.suppliers += r.rowCount ?? 0;
    }

    for (const i of data.items) {
      const useBy = deriveRequiresUseBy(i);
      const r = await client.query(
        `insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, requires_use_by,
           requires_use_by_basis, barcode, storage_note, source_note, primary_supplier_id, procurement_lead_days,
           prep_lead_days, lead_time_basis, lead_time_note, source, provenance, provenance_detail)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$1,$9,$10,$11,$12,$13,$14,$15,$16,'source',$17)
         on conflict (item_id) do nothing`,
        [
          i.item_id,
          i.name,
          i.item_type,
          i.category,
          normalizeUnit(i.base_unit),
          i.item_type !== 'ingredient',
          useBy.value,
          useBy.basis,
          i.storage_note,
          i.source_note,
          i.primary_supplier_id,
          i.procurement_lead_days,
          i.prep_lead_days,
          i.lead_time_basis,
          i.lead_time_note,
          i.source,
          JSON.stringify({
            name_units_ids_recipes: 'uploaded source',
            barcode: 'internal Code 128 of the source item ID',
            lead_times: 'source estimate, not a supplier quote',
          }),
        ],
      );
      inserted.items += r.rowCount ?? 0;
    }

    // Recipes: version 1 per dish, created as draft, components added, then activated.
    const dishes = data.items.filter((i) => i.item_type === 'finished_dish');
    for (const dish of dishes) {
      const existing = await client.query(
        'select 1 from public.recipe_versions where parent_item_id = $1 and version_no = 1',
        [dish.item_id],
      );
      if (existing.rowCount) continue;
      const lines = data.recipes.filter((r) => r.parent_item_id === dish.item_id);
      const v = await client.query<{ recipe_version_id: string }>(
        `insert into public.recipe_versions (parent_item_id, version_no, status, basis, source, provenance)
         values ($1, 1, 'draft', $2, $3, 'source') returning recipe_version_id`,
        [
          dish.item_id,
          lines[0]?.basis ?? RECIPE_BASIS_FALLBACK,
          lines[0]?.source ?? 'ERP_IngredientsList.xlsx / Recipe BOM',
        ],
      );
      const versionId = v.rows[0].recipe_version_id;
      inserted.recipe_versions += 1;
      let lineNo = 0;
      for (const line of lines) {
        lineNo += 1;
        await client.query(
          `insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit,
             quantity_per_serving, basis, source)
           values ($1,$2,$3,$4,$5::numeric,$6,$7)`,
          // quantities are passed as strings so no binary floating point touches them
          [
            versionId,
            lineNo,
            line.component_item_id,
            normalizeUnit(line.unit),
            String(line.quantity_per_serving),
            line.basis,
            line.source,
          ],
        );
        inserted.recipe_components += 1;
      }
      await client.query(
        `update public.recipe_versions set status = 'active', activated_at = now() where recipe_version_id = $1`,
        [versionId],
      );
    }

    // Primary supplier links with source lead times. Pack size/cost unknown (pilot gate).
    for (const i of data.items.filter((x) => x.primary_supplier_id)) {
      const r = await client.query(
        `insert into public.supplier_items (supplier_id, item_id, is_primary, procurement_lead_days, lead_time_basis,
           source, provenance)
         values ($1,$2,true,$3,$4,'ERP_Supplier_List.xlsx / Ingredients; ERP_IngredientsList.xlsx / Lead Times','source')
         on conflict do nothing`,
        [i.primary_supplier_id, i.item_id, i.procurement_lead_days, i.lead_time_basis],
      );
      inserted.supplier_items += r.rowCount ?? 0;
    }

    // Setup gates for the records that just arrived (never confirmed here).
    const gates = await client.query(
      `with new_gates as (
         insert into public.pilot_setup_gates (gate_key, scope_type, scope_id)
         select 'supplier_master_verified', 'supplier', s.supplier_id from public.suppliers s
         union all
         select 'pack_conversions_verified', 'supplier_item', si.supplier_item_id::text
           from public.supplier_items si where si.archived_at is null
         union all
         select 'recipes_verified', 'item', i.item_id from public.items i where i.item_type = 'finished_dish'
         on conflict do nothing
         returning 1)
       select count(*)::int as n from new_gates`,
    );
    inserted.setup_gates = gates.rows[0].n;

    const changed = Object.values(inserted).some((n) => n > 0);
    if (changed) {
      await client.query(
        `select private.write_audit(null, 'import.source_master', 'dataset', 'source_master_data.json', null, null,
           null, $1::jsonb, 'Source master import (insert-only)', null, 'operator_tooling')`,
        [JSON.stringify(inserted)],
      );
    }

    await verifySourceMaster(client, data);
    await client.query('commit');
    return { inserted, totals: await sourceTotals(client), changed };
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

/** Compare every source field in the database with the file. Throws on any difference. */
export async function verifySourceMaster(client: pg.Client, data: SourceMasterData): Promise<void> {
  const problems: string[] = [];

  const items = await client.query(
    `select item_id, name, item_type, category, base_unit, storage_note, source_note, source, primary_supplier_id,
            procurement_lead_days, prep_lead_days, lead_time_basis, lead_time_note
       from public.items where provenance = 'source'`,
  );
  const dbItems = new Map(items.rows.map((r) => [r.item_id as string, r]));
  for (const i of data.items) {
    const row = dbItems.get(i.item_id);
    if (!row) {
      problems.push(`item ${i.item_id} missing`);
      continue;
    }
    const expected = { ...i, base_unit: normalizeUnit(i.base_unit) } as Record<string, unknown>;
    for (const key of Object.keys(expected)) {
      if ((row[key] ?? null) !== (expected[key] ?? null)) problems.push(`item ${i.item_id}.${key} differs`);
    }
  }

  const recipes = await client.query(
    `select v.parent_item_id, c.component_item_id, c.unit, c.quantity_per_serving::text as qty
       from public.recipe_components c
       join public.recipe_versions v on v.recipe_version_id = c.recipe_version_id
      where v.version_no = 1`,
  );
  const dbLines = new Map(recipes.rows.map((r) => [`${r.parent_item_id}|${r.component_item_id}`, r]));
  if (dbLines.size !== data.recipes.length)
    problems.push(`recipe v1 has ${dbLines.size} lines, source has ${data.recipes.length}`);
  for (const line of data.recipes) {
    const row = dbLines.get(`${line.parent_item_id}|${line.component_item_id}`);
    if (!row) {
      problems.push(`recipe line ${line.parent_item_id}/${line.component_item_id} missing`);
      continue;
    }
    if (row.unit !== normalizeUnit(line.unit))
      problems.push(`recipe line ${line.parent_item_id}/${line.component_item_id} unit differs`);
    if (Number(row.qty) !== line.quantity_per_serving || !sameDecimal(row.qty, String(line.quantity_per_serving))) {
      problems.push(
        `recipe line ${line.parent_item_id}/${line.component_item_id} quantity ${row.qty} != ${line.quantity_per_serving}`,
      );
    }
  }

  const suppliers = await client.query(
    `select supplier_id, name, supplier_type, based_in, phone, address, what_we_buy, source_note, contact_verification, source
       from public.suppliers`,
  );
  const dbSuppliers = new Map(suppliers.rows.map((r) => [r.supplier_id as string, r]));
  for (const s of data.suppliers) {
    const row = dbSuppliers.get(s.supplier_id);
    if (!row) {
      problems.push(`supplier ${s.supplier_id} missing`);
      continue;
    }
    for (const key of Object.keys(row)) {
      if ((row[key] ?? null) !== ((s as unknown as Record<string, unknown>)[key] ?? null)) {
        problems.push(`supplier ${s.supplier_id}.${key} differs`);
      }
    }
  }

  const links = await client.query(
    `select item_id, supplier_id from public.supplier_items where is_primary and archived_at is null and item_id like 'ING-%'`,
  );
  const dbLinks = new Map(links.rows.map((r) => [r.item_id as string, r.supplier_id as string]));
  for (const i of data.items.filter((x) => x.primary_supplier_id)) {
    if (dbLinks.get(i.item_id) !== i.primary_supplier_id)
      problems.push(`primary supplier link for ${i.item_id} differs`);
  }

  if (problems.length) {
    throw new Error(`source master verification failed (${problems.length}): ${problems.slice(0, 20).join('; ')}`);
  }
}

/** Decimal string equality ignoring trailing zeros ("180.000000" == "180"). */
export function sameDecimal(a: string, b: string): boolean {
  const norm = (s: string) => {
    const [int, frac = ''] = s.trim().split('.');
    const f = frac.replace(/0+$/, '');
    return `${String(BigInt(int))}${f ? '.' + f : ''}`;
  };
  return norm(a) === norm(b);
}

export async function sourceTotals(client: pg.Client): Promise<Record<string, number>> {
  const { rows } = await client.query(`
    select
      (select count(*) from public.items where item_type = 'ingredient' and provenance = 'source')::int as ingredients,
      (select count(*) from public.items where item_type = 'finished_dish')::int as finished_dishes,
      (select count(*) from public.recipe_components c join public.recipe_versions v using (recipe_version_id)
         where v.status = 'active')::int as active_recipe_lines,
      (select count(*) from public.suppliers)::int as suppliers,
      (select count(*) from public.supplier_items where is_primary and item_id like 'ING-%')::int as primary_ingredient_links`);
  return rows[0];
}

if (isMain(import.meta.url)) {
  await runCli('import-source-master', async () => {
    const client = await connect(requireEnv('DATABASE_URL'));
    try {
      return await importSourceMaster(client);
    } finally {
      await client.end();
    }
  });
}

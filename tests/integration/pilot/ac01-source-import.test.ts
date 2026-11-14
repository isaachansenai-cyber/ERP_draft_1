// AC01 Source import — run against a PILOT database (source master only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeUnit,
  sameDecimal,
  verifySourceMaster,
  type SourceMasterData,
} from '../../../scripts/import/import-source-master';
import { snapshotPublicTables } from '../helpers/snapshot';
import { localStack, ROOT, runScript, withDb } from '../helpers/stack';

const stack = localStack();
const source = JSON.parse(readFileSync(join(ROOT, 'data/source/source_master_data.json'), 'utf8')) as SourceMasterData;

describe('AC01 source import preserves the supplied master data', () => {
  it('imports 40 ingredients and 5 dishes with their source IDs, names and units', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(
        `select item_type, count(*)::int n from public.items where provenance = 'source' group by 1 order by 1`,
      );
      expect(rows).toEqual([
        { item_type: 'finished_dish', n: 5 },
        { item_type: 'ingredient', n: 40 },
      ]);
      const ids = (await db.query(`select item_id from public.items order by item_id`)).rows.map((r) => r.item_id);
      expect(ids).toEqual(source.items.map((i) => i.item_id).sort());
      const barcodes = await db.query(
        `select count(*)::int n from public.items where barcode = item_id and barcode_type = 'CODE128_INTERNAL'`,
      );
      expect(barcodes.rows[0].n).toBe(45);
    });
  });

  it('imports all 66 BOM lines (12/16/14/17/7) with exactly the source quantities', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const perDish = await db.query(
        `select v.parent_item_id, count(*)::int n from public.recipe_components c
           join public.recipe_versions v using (recipe_version_id) where v.status = 'active' group by 1 order by 1`,
      );
      expect(perDish.rows.map((r) => r.n)).toEqual([12, 16, 14, 17, 7]);
      const lines = await db.query(
        `select v.parent_item_id, c.component_item_id, c.unit, c.quantity_per_serving::text q
           from public.recipe_components c join public.recipe_versions v using (recipe_version_id) where v.status = 'active'`,
      );
      expect(lines.rowCount).toBe(66);
      for (const s of source.recipes) {
        const row = lines.rows.find(
          (r) => r.parent_item_id === s.parent_item_id && r.component_item_id === s.component_item_id,
        );
        expect(row, `${s.parent_item_id}/${s.component_item_id}`).toBeDefined();
        expect(sameDecimal(row.q, String(s.quantity_per_serving))).toBe(true);
        expect(row.unit).toBe(normalizeUnit(s.unit));
      }
    });
  });

  it('keeps fractional "each" quantities and shared ingredients exactly (FG-002 limes, chicken)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const q = async (dish: string, item: string) =>
        (
          await db.query(
            `select c.quantity_per_serving::text q, c.unit from public.recipe_components c
             join public.recipe_versions v using (recipe_version_id) where v.parent_item_id = $1 and c.component_item_id = $2`,
            [dish, item],
          )
        ).rows[0];
      expect(await q('FG-002', 'ING-012')).toEqual({ q: '3.000000', unit: 'each' });
      expect(await q('FG-002', 'ING-015')).toEqual({ q: '0.500000', unit: 'each' });
      expect(await q('FG-001', 'ING-001')).toEqual({ q: '180.000000', unit: 'g' });
      expect(await q('FG-003', 'ING-001')).toEqual({ q: '200.000000', unit: 'g' });
    });
  });

  it('imports 15 supplier IDs, keeps the 5 missing phones empty and marks contacts unverified', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(
        `select supplier_id, phone, contact_verification, contact_email, payment_terms_days from public.suppliers order by 1`,
      );
      expect(rows.map((r) => r.supplier_id)).toEqual(source.suppliers.map((s) => s.supplier_id).sort());
      expect(rows.filter((r) => r.phone === null).map((r) => r.supplier_id)).toEqual([
        'SUP-06',
        'SUP-08',
        'SUP-15',
        'SUP-16',
        'SUP-17',
      ]);
      expect(rows.every((r) => r.contact_verification === 'not independently verified')).toBe(true);
      expect(rows.every((r) => r.contact_email === null && r.payment_terms_days === null)).toBe(true);
    });
  });

  it('imports the 40 primary ingredient-to-supplier links with source lead times and labels', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(
        `select si.item_id, si.supplier_id, si.procurement_lead_days, si.lead_time_basis, si.pack_base_qty, si.cost_basis
           from public.supplier_items si where si.is_primary order by 1`,
      );
      expect(rows).toHaveLength(40);
      for (const i of source.items.filter((x) => x.item_type === 'ingredient')) {
        const row = rows.find((r) => r.item_id === i.item_id);
        expect(row?.supplier_id).toBe(i.primary_supplier_id);
        expect(row?.procurement_lead_days).toBe(i.procurement_lead_days);
      }
      const basis = rows.reduce<Record<string, number>>(
        (acc, r) => ({ ...acc, [r.lead_time_basis]: (acc[r.lead_time_basis] ?? 0) + 1 }),
        {},
      );
      expect(basis).toEqual({ Benchmark: 21, Assumption: 19 });
      // Pilot: pack size and cost are unknown until verified (setup gate), never invented.
      expect(rows.every((r) => r.pack_base_qty === null && r.cost_basis === null)).toBe(true);
    });
  });

  it('derives the use-by requirement for the 15 refrigerated/frozen ingredients (owner confirms in pilot)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(
        `select count(*) filter (where requires_use_by)::int yes, count(*) filter (where requires_use_by_basis = 'derived_from_storage_note')::int derived
           from public.items where item_type = 'ingredient'`,
      );
      expect(rows[0]).toEqual({ yes: 15, derived: 40 });
    });
  });

  it('normalizes mL to ml without changing quantities', async () => {
    expect(normalizeUnit('mL')).toBe('ml');
    expect(normalizeUnit('ml')).toBe('ml');
    expect(() => normalizeUnit('cup')).toThrow();
    // A copy of the source written with "mL" verifies as identical to what is stored.
    const withMl: SourceMasterData = JSON.parse(JSON.stringify(source));
    for (const r of withMl.recipes) if (r.unit === 'ml') r.unit = 'mL';
    for (const i of withMl.items) if (i.base_unit === 'ml') i.base_unit = 'mL';
    expect(withMl.recipes.filter((r) => r.unit === 'mL').length).toBe(11);
    await withDb(stack.dbUrl, async (db) => {
      await expect(verifySourceMaster(db, withMl)).resolves.toBeUndefined();
      const units = await db.query(`select distinct unit from public.recipe_components order by 1`);
      expect(units.rows.map((r) => r.unit)).toEqual(['each', 'g', 'ml']);
    });
  });

  it('creates open setup gates for every supplier, supplier link and recipe (nothing auto-confirmed)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(
        `select gate_key, count(*)::int n, count(*) filter (where status = 'confirmed')::int confirmed
           from public.pilot_setup_gates group by 1 order by 1`,
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.gate_key, r]));
      expect(byKey.supplier_master_verified?.n).toBe(15);
      expect(byKey.pack_conversions_verified?.n).toBe(40);
      expect(byKey.recipes_verified?.n).toBe(5);
      expect(rows.every((r) => r.gate_key === 'tax_rate_confirmed' || r.confirmed === 0)).toBe(true);
    });
  });

  it('is idempotent: re-running the import changes nothing at all', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const before = await snapshotPublicTables(db);
      const r = runScript('scripts/import/import-source-master.ts', { DATABASE_URL: stack.dbUrl });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).changed).toBe(false);
      expect(await snapshotPublicTables(db)).toEqual(before);
    });
  });
});

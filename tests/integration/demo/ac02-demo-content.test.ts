// AC02 Demo segregation — the DEMO side: complete synthetic fixtures, visibly
// labeled, reproducible, with source records untouched (AC01 holds in demo too).
import { describe, expect, inject, it } from 'vitest';
import { loadSourceMaster, verifySourceMaster } from '../../../scripts/import/import-source-master';
import { anonClient, localStack, withDb } from '../helpers/stack';

const stack = localStack();

describe('AC02 demo database content', () => {
  it('reports demo mode publicly so the banner can show it before sign-in', async () => {
    const { data } = await anonClient(stack).rpc('get_public_app_mode');
    expect(data.data_mode).toBe('demo');
  });

  it('contains 47 items, 10 customers, 3 locations, 10 linked role fixtures and the 141 settings', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`
        select (select count(*) from public.items)::int items,
               (select count(*) from public.items where provenance = 'source')::int source_items,
               (select count(*) from public.items where item_type = 'retail' and provenance ilike 'synthetic%')::int synthetic_retail,
               (select count(*) from public.customers where provenance ilike 'synthetic%')::int customers,
               (select count(*) from public.locations)::int locations,
               (select count(*) from public.employees where auth_user_id is not null and provenance ilike 'synthetic%')::int linked_fixtures,
               (select count(*) from public.location_item_settings)::int settings,
               (select count(*) from public.location_item_prices)::int prices`);
      expect(rows[0]).toEqual({
        items: 47,
        source_items: 45,
        synthetic_retail: 2,
        customers: 10,
        locations: 3,
        linked_fixtures: 10,
        settings: 141,
        prices: 21,
      });
      const roles = await db.query(
        `select role, count(*)::int n from public.memberships where active group by 1 order by 1`,
      );
      expect(roles.rows).toEqual([
        { role: 'employee', n: 6 },
        { role: 'manager', n: 3 },
        { role: 'owner', n: 1 },
      ]);
    });
  });

  it('covers six complete months of synthetic sales (May–October 2026)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`
        select to_char(business_date, 'YYYY-MM') m, count(distinct business_date)::int days,
               extract(day from (date_trunc('month', min(business_date)) + interval '1 month - 1 day'))::int month_days
          from public.historical_sales_orders group by 1 order by 1`);
      expect(rows.map((r) => r.m)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
      expect(rows.every((r) => r.days === r.month_days)).toBe(true);
    });
  });

  it('labels every generated value as synthetic and keeps real contact gaps empty', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`
        select (select count(*) from public.location_tax_rates where provenance not ilike 'synthetic%')::int unlabeled_taxes,
               (select count(*) from public.location_item_prices where provenance not ilike 'synthetic%')::int unlabeled_prices,
               (select count(*) from public.supplier_items where cost_basis <> 'synthetic_demo_assumption')::int unlabeled_packs,
               (select count(*) from public.suppliers where contact_email not like '%@example.invalid')::int routable_emails,
               (select count(*) from public.suppliers where payment_terms_provenance not ilike 'synthetic%')::int unlabeled_terms,
               (select count(*) from public.suppliers where phone is null)::int missing_phones,
               (select count(*) from public.pilot_setup_gates where status <> 'confirmed' or provenance <> 'synthetic_demo_seed')::int non_synthetic_gates,
               (select posting_enabled from public.app_settings) posting_enabled`);
      expect(rows[0]).toEqual({
        unlabeled_taxes: 0,
        unlabeled_prices: 0,
        unlabeled_packs: 0,
        routable_emails: 0,
        unlabeled_terms: 0,
        missing_phones: 5,
        non_synthetic_gates: 0,
        posting_enabled: true,
      });
    });
  });

  it('leaves every source record identical to the source file (AC01 in demo)', async () => {
    await withDb(stack.dbUrl, async (db) => {
      await expect(verifySourceMaster(db, loadSourceMaster())).resolves.toBeUndefined();
    });
  });

  it('is reproducible: a reset rebuilds exactly the same content', () => {
    const { first, afterReset } = inject('demoReproducibility');
    expect(Object.keys(first).length).toBeGreaterThan(15);
    expect(afterReset).toEqual(first);
  });
});

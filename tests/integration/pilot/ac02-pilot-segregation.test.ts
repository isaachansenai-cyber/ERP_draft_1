// AC02 Demo segregation — the PILOT side: no synthetic data, and every demo tool refuses.
import { describe, expect, it } from 'vitest';
import { snapshotPublicTables } from '../helpers/snapshot';
import { anonClient, localStack, runScript, withDb } from '../helpers/stack';

const stack = localStack();
const DEMO_SCRIPTS = [
  'scripts/import/import-demo-seed.ts',
  'scripts/import/import-demo-history.ts',
  'scripts/demo/create-demo-users.ts',
  'scripts/demo/reset-demo.ts',
  'scripts/perf/load-test.ts',
];

describe('AC02 pilot database contains no synthetic data', () => {
  it('reports pilot mode with posting disabled', async () => {
    const { data } = await anonClient(stack).rpc('get_public_app_mode');
    expect(data.data_mode).toBe('pilot');
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query('select data_mode, dataset_id, posting_enabled from public.app_settings');
      expect(rows[0]).toEqual({ data_mode: 'pilot', dataset_id: null, posting_enabled: false });
    });
  });

  it('has no synthetic staff, customers, history, opening rows, prices, taxes, costs or settings', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`
        select
          (select count(*) from public.customers)::int customers,
          (select count(*) from public.employees where employee_id like 'DEMO-%' or provenance ilike 'synthetic%')::int demo_staff,
          (select count(*) from public.historical_sales_orders)::int history_orders,
          (select count(*) from public.historical_sales_lines)::int history_lines,
          (select count(*) from public.items where item_type = 'retail' or provenance <> 'source')::int non_source_items,
          (select count(*) from public.location_item_prices where provenance ilike 'synthetic%')::int prices,
          (select count(*) from public.location_tax_rates where provenance ilike 'synthetic%')::int synthetic_taxes,
          (select count(*) from public.item_standard_costs)::int standard_costs,
          (select count(*) from public.location_item_settings)::int planning_settings,
          (select count(*) from public.supplier_items where cost_basis is not null)::int supplier_costs,
          (select count(*) from public.suppliers where contact_email is not null or payment_terms_days is not null)::int supplier_demo_terms,
          (select count(*) from public.pilot_setup_gates where provenance ilike 'synthetic%')::int synthetic_gates`);
      expect(rows[0]).toEqual({
        customers: 0,
        demo_staff: 0,
        history_orders: 0,
        history_lines: 0,
        non_source_items: 0,
        prices: 0,
        synthetic_taxes: 0,
        standard_costs: 0,
        planning_settings: 0,
        supplier_costs: 0,
        supplier_demo_terms: 0,
        synthetic_gates: 0,
      });
    });
  });
});

describe('AC02 demo tooling cannot target the pilot', () => {
  it.each(DEMO_SCRIPTS)('%s refuses a pilot database even when its ref is allowlisted', (script) => {
    const r = runScript(script, {
      DATABASE_URL: stack.dbUrl,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      SUPABASE_ANON_KEY: stack.anonKey,
      DEMO_CREDENTIALS_PATH: '/nonexistent/credentials.md',
      DEMO_PROJECT_REF_ALLOWLIST: 'local',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('REFUSED');
    expect(r.stderr).toContain('data_mode="pilot"');
  });

  it.each(DEMO_SCRIPTS)('%s refuses a project that is not on the allowlist', (script) => {
    const r = runScript(script, {
      DATABASE_URL: stack.dbUrl,
      SUPABASE_URL: stack.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      SUPABASE_ANON_KEY: stack.anonKey,
      DEMO_CREDENTIALS_PATH: '/nonexistent/credentials.md',
      DEMO_PROJECT_REF_ALLOWLIST: 'abcdefghijklmnopqrst',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not in DEMO_PROJECT_REF_ALLOWLIST');
  });

  it('refuses before connecting when DATABASE_URL and SUPABASE_URL name different projects', () => {
    const r = runScript('scripts/import/import-demo-seed.ts', {
      DATABASE_URL: stack.dbUrl,
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DEMO_PROJECT_REF_ALLOWLIST: 'local,abcdefghijklmnopqrst',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('point at different projects');
  });

  it('the database itself refuses to switch a used pilot to demo mode', () => {
    const r = runScript('scripts/demo/init-demo-database.ts', {
      DATABASE_URL: stack.dbUrl,
      DEMO_PROJECT_REF_ALLOWLIST: 'local',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('forbidden:database_not_pristine');
  });

  it('refused runs leave the pilot database completely unchanged', async () => {
    await withDb(stack.dbUrl, async (db) => {
      const before = await snapshotPublicTables(db);
      for (const script of DEMO_SCRIPTS) {
        runScript(script, {
          DATABASE_URL: stack.dbUrl,
          SUPABASE_URL: stack.apiUrl,
          SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
          DEMO_PROJECT_REF_ALLOWLIST: 'local',
        });
      }
      expect(await snapshotPublicTables(db)).toEqual(before);
    });
  });
});

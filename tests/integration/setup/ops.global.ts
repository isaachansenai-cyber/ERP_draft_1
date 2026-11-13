// Global setup for the PILOT OPERATIONS suite (Milestone 2). A fresh pilot
// database is taken through the real pilot setup path with operator-entered
// test values — exactly the RPCs an owner/manager would use — until posting is
// enabled. No synthetic demo data or demo tooling is involved.
import type { GlobalSetupContext } from 'vitest/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAuthUser, key, localStack, resetLocalDatabase, runScript, withDb } from '../helpers/stack';

export interface OpsUser {
  email: string;
  password: string;
  employeeId: string;
}

export type OpsUserName =
  'owner' | 'proManager' | 'proEmployee' | 'sfoManager' | 'sfoEmployee' | 'slcManager' | 'slcEmployee' | 'slcEmployee2';

declare module 'vitest' {
  export interface ProvidedContext {
    opsUsers: Record<OpsUserName, OpsUser>;
    opsPins: Record<string, string>;
    opsToday: string;
  }
}

// Test operating values (pilot test database only).
export const TEST_TAX_RATE = 0.0725;
export const TEST_PRICES: Record<string, number> = {
  'FG-001': 1599,
  'FG-002': 1399,
  'FG-003': 1549,
  'FG-004': 1999,
  'FG-005': 2299,
};
export const PACK_BY_UNIT: Record<string, number> = { g: 10000, ml: 5000, each: 100 };
export const OPENING_UNIT_COST = '0.005';

async function must<T>(label: string, p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = (await p) as { data: T; error: unknown };
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false)
    throw new Error(`${label}: ${JSON.stringify(data)}`);
  return data;
}

export default async function setup({ provide }: GlobalSetupContext) {
  await resetLocalDatabase();
  const stack = localStack();
  const imported = runScript('scripts/import/import-source-master.ts', { DATABASE_URL: stack.dbUrl });
  if (imported.status !== 0) throw new Error(`source import failed: ${imported.stderr}`);

  const suffix = Date.now().toString(36);
  const ownerAuth = await createAuthUser(stack, `ops-owner.${suffix}@test.local`);
  const ownerId = await withDb(
    stack.dbUrl,
    async (db) =>
      (await db.query<{ id: string }>('select private.bootstrap_owner($1, $2) as id', [ownerAuth.email, 'Ops Owner']))
        .rows[0]!.id,
  );
  const signIn = async (email: string, password: string) => {
    const c = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await c.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return c;
  };
  const owner = await signIn(ownerAuth.email, ownerAuth.password);

  const users: Partial<Record<OpsUserName, OpsUser>> = {
    owner: { email: ownerAuth.email, password: ownerAuth.password, employeeId: ownerId },
  };
  const provision = async (name: OpsUserName, role: 'manager' | 'employee', locationId: string) => {
    const auth = await createAuthUser(stack, `${name.toLowerCase()}.${suffix}@test.local`);
    const created = await must<{ employee_id: string }>(
      `create ${name}`,
      owner.rpc('create_employee', { p_request_key: key(), p_display_name: `Ops ${name}` }),
    );
    await must(
      'link',
      owner.rpc('link_employee_auth_user', {
        p_request_key: key(),
        p_employee_id: created.employee_id,
        p_email: auth.email,
      }),
    );
    await must(
      'grant',
      owner.rpc('grant_membership', {
        p_request_key: key(),
        p_employee_id: created.employee_id,
        p_role: role,
        p_location_id: locationId,
      }),
    );
    users[name] = { email: auth.email, password: auth.password, employeeId: created.employee_id };
  };
  await provision('proManager', 'manager', 'LOC-PRO');
  await provision('proEmployee', 'employee', 'LOC-PRO');
  await provision('sfoManager', 'manager', 'LOC-SFO');
  await provision('sfoEmployee', 'employee', 'LOC-SFO');
  await provision('slcManager', 'manager', 'LOC-SLC');
  await provision('slcEmployee', 'employee', 'LOC-SLC');
  await provision('slcEmployee2', 'employee', 'LOC-SLC');

  // Manager PINs for approval tests.
  const pins: Record<string, string> = { proManager: '4829137', owner: '5938241' };
  await must('owner pin', owner.rpc('set_manager_pin', { p_request_key: key(), p_new_pin: pins.owner }));
  const proManager = await signIn(users.proManager!.email, users.proManager!.password);
  await must('pro pin', proManager.rpc('set_manager_pin', { p_request_key: key(), p_new_pin: pins.proManager }));

  const today = (await must<{ business_date: string }>('ctx', owner.rpc('get_my_context'))).business_date;

  // Owner: supplier terms and pack conversions (operator-entered test values).
  const { data: suppliers } = await owner.from('suppliers').select('supplier_id');
  for (const s of suppliers ?? []) {
    await must(
      'terms',
      owner.rpc('set_supplier_terms', { p_request_key: key(), p_supplier_id: s.supplier_id, p_payment_terms_days: 30 }),
    );
  }
  const { data: supplierItems } = await owner
    .from('supplier_items')
    .select('supplier_item_id, item_id, items(base_unit)');
  for (const si of (supplierItems ?? []) as unknown as Array<{
    supplier_item_id: string;
    item_id: string;
    items: { base_unit: string };
  }>) {
    const base = PACK_BY_UNIT[si.items.base_unit]!;
    await must(
      'pack',
      owner.rpc('set_supplier_item_pack', {
        p_request_key: key(),
        p_supplier_item_id: si.supplier_item_id,
        p_pack_description: `case of ${base} ${si.items.base_unit}`,
        p_pack_base_qty: base,
        p_pack_cost_cents: si.item_id === 'ING-001' ? 6000 : 5000,
        p_cost_basis: 'estimated',
      }),
    );
  }

  // Owner: tax and prices at every location.
  for (const loc of ['LOC-PRO', 'LOC-SFO', 'LOC-SLC']) {
    await must(
      'tax',
      owner.rpc('set_location_tax_rate', {
        p_request_key: key(),
        p_location_id: loc,
        p_rate: TEST_TAX_RATE,
        p_effective_from: today,
      }),
    );
    for (const [item, cents] of Object.entries(TEST_PRICES)) {
      await must(
        'price',
        owner.rpc('set_location_item_price', {
          p_request_key: key(),
          p_location_id: loc,
          p_item_id: item,
          p_price_cents: cents,
          p_effective_from: today,
        }),
      );
    }
  }

  // Gates that do not depend on opening stock.
  const confirmAll = async (client: SupabaseClient, keys: string[]) => {
    const { data: gates } = await client
      .from('pilot_setup_gates')
      .select('gate_id, gate_key, status')
      .in('gate_key', keys)
      .eq('status', 'open');
    for (const g of gates ?? []) {
      await must(
        `confirm ${g.gate_key}`,
        client.rpc('confirm_setup_gate', {
          p_request_key: key(),
          p_gate_id: g.gate_id,
          p_evidence_note: 'Verified for the integration test pilot',
        }),
      );
    }
  };
  await confirmAll(owner, [
    'supplier_master_verified',
    'pack_conversions_verified',
    'recipes_verified',
    'menu_prices_confirmed',
    'tax_rate_confirmed',
    'perishables_confirmed',
    'roles_verified',
    'backup_restore_tested',
    'acceptance_suite_passed',
  ]);

  // Managers: opening counts. Use-by dates are mandatory for refrigerated items in the pilot.
  const { data: items } = await owner
    .from('items')
    .select('item_id, base_unit, requires_use_by')
    .eq('item_type', 'ingredient');
  const useBy = new Date(`${today}T12:00:00Z`);
  useBy.setUTCDate(useBy.getUTCDate() + 30);
  const useByDate = useBy.toISOString().slice(0, 10);
  const opening = (special: Record<string, string>) =>
    (items ?? []).map((i) => ({
      item_id: i.item_id,
      quantity_base: special[i.item_id] ?? (i.base_unit === 'each' ? '1000' : '100000'),
      unit_cost: i.item_id === 'ING-001' ? '0.006' : OPENING_UNIT_COST,
      use_by_date: i.requires_use_by ? useByDate : undefined,
    }));
  const managerFor: Record<string, OpsUserName> = {
    'LOC-PRO': 'proManager',
    'LOC-SFO': 'sfoManager',
    'LOC-SLC': 'slcManager',
  };
  const special: Record<string, Record<string, string>> = {
    'LOC-PRO': {},
    'LOC-SFO': { 'ING-001': '2000' }, // AC05: exactly 2,000 g chicken
    'LOC-SLC': { 'ING-001': '180' }, // AC06: exactly one FG-001 portion of chicken
  };
  for (const loc of ['LOC-PRO', 'LOC-SFO', 'LOC-SLC']) {
    const u = users[managerFor[loc]!]!;
    const c = await signIn(u.email, u.password);
    await must(
      `opening ${loc}`,
      c.rpc('post_opening_count', { p_request_key: key(), p_location_id: loc, p_lines: opening(special[loc]!) }),
    );
  }
  await confirmAll(owner, ['opening_counts_posted']);
  await must(
    'enable posting',
    owner.rpc('enable_posting', { p_request_key: key(), p_evidence_note: 'Integration test pilot ready for posting' }),
  );

  provide('opsUsers', users as Record<OpsUserName, OpsUser>);
  provide('opsPins', pins);
  provide('opsToday', today);
}

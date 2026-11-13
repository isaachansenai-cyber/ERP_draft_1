// AC03 Permission enforcement through the real API (PostgREST + RLS + RPC
// authorization), signed in as real local Auth users. Milestone 1 scope:
// memberships, location scoping, master data/cost visibility and setup controls.
// Refund/discount/invoice permissions are added with those modules.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { anonClient, key, localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const users = inject('pilotUsers');
const c: Record<string, SupabaseClient> = {};

beforeAll(async () => {
  for (const [name, u] of Object.entries(users)) c[name] = await signIn(stack, u.email, u.password);
});

async function rows(client: SupabaseClient, table: string, select = '*') {
  const { data, error } = await client.from(table).select(select);
  if (error) throw error;
  return data as unknown as Record<string, unknown>[];
}

describe('AC03 unauthenticated access', () => {
  it('anon can read only the public app mode', async () => {
    const anon = anonClient(stack);
    expect((await anon.rpc('get_public_app_mode')).data.data_mode).toBe('pilot');
    for (const table of ['items', 'employees', 'memberships', 'locations', 'app_settings', 'suppliers', 'audit_log']) {
      const { data, error } = await anon.from(table).select('*');
      expect(error?.code, table).toBe('42501');
      expect(data).toBeNull();
    }
    const ctx = await rpc(anon, 'get_my_context');
    expect(ctx.code).toMatch(/^42501/);
    const write = await rpc(anon, 'create_employee', { p_request_key: key(), p_display_name: 'Intruder' });
    expect(write.code).toMatch(/^42501/);
  });
});

describe('AC03 employee', () => {
  it('cannot change memberships, staff, gates, taxes, prices or posting', async () => {
    const e = c.proEmployee!;
    const attempts = [
      rpc(e, 'create_employee', { p_request_key: key(), p_display_name: 'X' }),
      rpc(e, 'grant_membership', {
        p_request_key: key(),
        p_employee_id: users.proEmployee.employeeId,
        p_role: 'manager',
        p_location_id: 'LOC-PRO',
      }),
      rpc(e, 'link_employee_auth_user', {
        p_request_key: key(),
        p_employee_id: users.unlinked.employeeId,
        p_email: 'x@test.local',
      }),
      rpc(e, 'set_employee_active', {
        p_request_key: key(),
        p_employee_id: users.proManager.employeeId,
        p_active: false,
        p_reason: 'test',
      }),
      rpc(e, 'confirm_setup_gate', {
        p_request_key: key(),
        p_gate_id: '00000000-0000-0000-0000-000000000000',
        p_evidence_note: 'not allowed at all',
      }),
      rpc(e, 'enable_posting', { p_request_key: key(), p_evidence_note: 'not allowed at all' }),
      rpc(e, 'set_location_tax_rate', {
        p_request_key: key(),
        p_location_id: 'LOC-PRO',
        p_rate: 0.07,
        p_effective_from: '2030-01-01',
      }),
      rpc(e, 'set_location_item_price', {
        p_request_key: key(),
        p_location_id: 'LOC-PRO',
        p_item_id: 'FG-001',
        p_price_cents: 1,
        p_effective_from: '2030-01-01',
      }),
      rpc(e, 'set_manager_pin', { p_request_key: key(), p_new_pin: '482913' }),
      rpc(e, 'list_staff_access'),
    ];
    for (const r of await Promise.all(attempts)) expect(r.code).toBe('unauthorized');
  });

  it('cannot write tables directly', async () => {
    const e = c.proEmployee!;
    const insert = await e.from('memberships').insert({ employee_id: users.proEmployee.employeeId, role: 'owner' });
    expect(insert.error?.code).toBe('42501');
    const update = await e
      .from('employees')
      .update({ display_name: 'hacked' })
      .eq('employee_id', users.proEmployee.employeeId);
    expect(update.error?.code).toBe('42501');
    const settings = await e.from('app_settings').update({ posting_enabled: true }).eq('singleton', true);
    expect(settings.error?.code).toBe('42501');
  });

  it('sees no costs, suppliers, customers, audit or other staff', async () => {
    const e = c.proEmployee!;
    for (const table of [
      'suppliers',
      'supplier_items',
      'item_standard_costs',
      'customers',
      'audit_log',
      'location_item_settings',
      'historical_sales_orders',
    ]) {
      expect(await rows(e, table), table).toHaveLength(0);
    }
    expect((await rows(e, 'employees', 'employee_id')).map((r) => r.employee_id)).toEqual([
      users.proEmployee.employeeId,
    ]);
    expect(
      (await rows(e, 'memberships', 'employee_id, location_id')).every(
        (r) => r.employee_id === users.proEmployee.employeeId,
      ),
    ).toBe(true);
    // Item names and the active menu are readable for the job.
    expect((await rows(e, 'items', 'item_id')).length).toBe(45);
  });

  it('gets context only for the assigned location', async () => {
    const ctx = await rpc(c.proEmployee!, 'get_my_context');
    expect(ctx.data.is_owner).toBe(false);
    expect(ctx.data.roles).toEqual([
      { location_id: 'LOC-PRO', location_name: 'Provo', short_code: 'PRO', role: 'employee' },
    ]);
  });

  it('a signed-in account with no role sees no location-scoped data', async () => {
    const ctx = await rpc(c.unlinked!, 'get_my_context');
    expect(ctx.data.roles).toEqual([]);
    expect(await rows(c.unlinked!, 'location_tax_rates')).toHaveLength(0);
    expect((await rpc(c.unlinked!, 'list_staff_access')).code).toBe('unauthorized');
  });
});

describe('AC03 location manager', () => {
  it('cannot change memberships, staff, gates, taxes or posting', async () => {
    const m = c.proManager!;
    const attempts = [
      rpc(m, 'create_employee', { p_request_key: key(), p_display_name: 'X' }),
      rpc(m, 'grant_membership', {
        p_request_key: key(),
        p_employee_id: users.proEmployee.employeeId,
        p_role: 'manager',
        p_location_id: 'LOC-PRO',
      }),
      rpc(m, 'grant_membership', {
        p_request_key: key(),
        p_employee_id: users.proManager.employeeId,
        p_role: 'owner',
        p_location_id: null,
      }),
      rpc(m, 'confirm_setup_gate', {
        p_request_key: key(),
        p_gate_id: '00000000-0000-0000-0000-000000000000',
        p_evidence_note: 'not allowed at all',
      }),
      rpc(m, 'enable_posting', { p_request_key: key(), p_evidence_note: 'not allowed at all' }),
      rpc(m, 'set_location_tax_rate', {
        p_request_key: key(),
        p_location_id: 'LOC-PRO',
        p_rate: 0.07,
        p_effective_from: '2030-01-01',
      }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.code).toBe('unauthorized');
  });

  it('cannot write another location (client-supplied location ID grants nothing)', async () => {
    const r = await rpc(c.proManager!, 'set_location_item_price', {
      p_request_key: key(),
      p_location_id: 'LOC-SLC',
      p_item_id: 'FG-001',
      p_price_cents: 1599,
      p_effective_from: '2030-01-01',
    });
    expect(r.code).toBe('unauthorized');
    await withDb(stack.dbUrl, async (db) => {
      const { rows: n } = await db.query(
        `select count(*)::int n from public.location_item_prices where location_id = 'LOC-SLC'`,
      );
      expect(n[0].n).toBe(0);
    });
  });

  it('can set a menu price at their own location (audited, effective-dated)', async () => {
    const r = await rpc(c.proManager!, 'set_location_item_price', {
      p_request_key: key(),
      p_location_id: 'LOC-PRO',
      p_item_id: 'FG-001',
      p_price_cents: 1650,
      p_effective_from: '2030-01-01',
    });
    expect(r.code).toBeNull();
    await withDb(stack.dbUrl, async (db) => {
      const { rows: a } = await db.query(
        `select actor_employee_id, location_id from public.audit_log where action = 'price.set' order by audit_id desc limit 1`,
      );
      expect(a[0]).toEqual({ actor_employee_id: users.proManager.employeeId, location_id: 'LOC-PRO' });
    });
  });

  it('sees only staff, memberships, prices and audit for their own location', async () => {
    const m = c.proManager!;
    const staff = (await rows(m, 'employees', 'employee_id')).map((r) => r.employee_id).sort();
    expect(staff).toEqual([users.proEmployee.employeeId, users.proManager.employeeId].sort());
    expect((await rows(m, 'memberships', 'location_id')).every((r) => r.location_id === 'LOC-PRO')).toBe(true);
    expect((await rows(m, 'location_item_prices', 'location_id')).every((r) => r.location_id === 'LOC-PRO')).toBe(true);
    expect((await rows(m, 'audit_log', 'location_id')).every((r) => r.location_id === 'LOC-PRO')).toBe(true);
    const listed = await rpc(m, 'list_staff_access');
    expect(listed.data.map((s: { employee_id: string }) => s.employee_id).sort()).toEqual(staff);
    expect(listed.data.every((s: { email: string | null }) => s.email === null)).toBe(true);
  });

  it('a manager at another location cannot see Provo staff', async () => {
    const ids = (await rows(c.slcManager!, 'employees', 'employee_id')).map((r) => r.employee_id);
    expect(ids).toEqual([users.slcManager.employeeId]);
  });

  it('can set their own manager PIN; weak PINs are rejected', async () => {
    expect((await rpc(c.proManager!, 'set_manager_pin', { p_request_key: key(), p_new_pin: '123456' })).code).toBe(
      'validation:pin_too_simple',
    );
    expect((await rpc(c.proManager!, 'set_manager_pin', { p_request_key: key(), p_new_pin: '48a913' })).code).toBe(
      'validation:pin_format',
    );
    expect(
      (await rpc(c.proManager!, 'set_manager_pin', { p_request_key: key(), p_new_pin: '4829137' })).code,
    ).toBeNull();
    expect((await rpc(c.proManager!, 'get_my_context')).data.has_manager_pin).toBe(true);
  });
});

describe('AC03 owner', () => {
  it('sees every location and all staff with sign-in emails', async () => {
    const ctx = await rpc(c.owner!, 'get_my_context');
    expect(ctx.data.roles.map((r: { location_id: string }) => r.location_id).sort()).toEqual([
      'LOC-PRO',
      'LOC-SFO',
      'LOC-SLC',
    ]);
    const listed = await rpc(c.owner!, 'list_staff_access');
    const ids = listed.data.map((s: { employee_id: string }) => s.employee_id);
    for (const u of Object.values(users)) expect(ids).toContain(u.employeeId);
    expect(
      listed.data
        .filter((s: { auth_linked: boolean }) => s.auth_linked)
        .every((s: { email: string | null }) => typeof s.email === 'string'),
    ).toBe(true);
  });

  it('grants and revokes memberships; the last owner cannot be removed', async () => {
    const o = c.owner!;
    const granted = await rpc(o, 'grant_membership', {
      p_request_key: key(),
      p_employee_id: users.unlinked.employeeId,
      p_role: 'employee',
      p_location_id: 'LOC-SFO',
    });
    expect(granted.code).toBeNull();
    const dup = await rpc(o, 'grant_membership', {
      p_request_key: key(),
      p_employee_id: users.unlinked.employeeId,
      p_role: 'manager',
      p_location_id: 'LOC-SFO',
    });
    expect(dup.code).toBe('conflict:membership_exists');
    const ownerWithLocation = await rpc(o, 'grant_membership', {
      p_request_key: key(),
      p_employee_id: users.unlinked.employeeId,
      p_role: 'owner',
      p_location_id: 'LOC-PRO',
    });
    expect(ownerWithLocation.code).toBe('validation:location_id');
    const revoked = await rpc(o, 'revoke_membership', {
      p_request_key: key(),
      p_membership_id: granted.data.membership_id,
      p_reason: 'test cleanup',
    });
    expect(revoked.code).toBeNull();

    const ownerMembership = await withDb(
      stack.dbUrl,
      async (db) =>
        (await db.query(`select membership_id from public.memberships where role = 'owner' and active`)).rows[0]
          .membership_id,
    );
    const last = await rpc(o, 'revoke_membership', {
      p_request_key: key(),
      p_membership_id: ownerMembership,
      p_reason: 'should fail',
    });
    expect(last.code).toBe('validation:last_owner');
  });

  it('even the owner cannot write tables directly', async () => {
    const r = await c.owner!.from('app_settings').update({ data_mode: 'demo' }).eq('singleton', true);
    expect(r.error?.code).toBe('42501');
  });
});

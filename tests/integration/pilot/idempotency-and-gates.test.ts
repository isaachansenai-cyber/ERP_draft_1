// Request-key retry safety (AC07/AC29 groundwork) and the pilot setup-gate
// lifecycle (CLAUDE.md §7) through the real API.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { key, localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const users = inject('pilotUsers');
let owner: SupabaseClient;
let manager: SupabaseClient;

beforeAll(async () => {
  owner = await signIn(stack, users.owner.email, users.owner.password);
  manager = await signIn(stack, users.proManager.email, users.proManager.password);
});

const countEmployees = () =>
  withDb(
    stack.dbUrl,
    async (db) => (await db.query(`select count(*)::int n from public.employees`)).rows[0].n as number,
  );

describe('request keys', () => {
  it('a retry with the same key returns the original result and creates nothing new', async () => {
    const k = key();
    const before = await countEmployees();
    const first = await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Retry Test' });
    const second = await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Retry Test' });
    expect(first.code).toBeNull();
    expect(second.data.employee_id).toBe(first.data.employee_id);
    expect(second.data.replayed).toBe(true);
    expect(await countEmployees()).toBe(before + 1);
  });

  it('two concurrent submissions with the same key produce exactly one record', async () => {
    const k = key();
    const before = await countEmployees();
    const [a, b] = await Promise.all([
      rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Concurrent Test' }),
      rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Concurrent Test' }),
    ]);
    const ids = [a, b].filter((r) => r.code === null).map((r) => r.data.employee_id);
    expect(new Set(ids).size).toBe(1);
    expect(await countEmployees()).toBe(before + 1);
  });

  it('get_request_result reports committed results and not_found for unknown keys', async () => {
    const k = key();
    const created = await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Lookup Test' });
    const found = await rpc(owner, 'get_request_result', { p_request_key: k });
    expect(found.data.status).toBe('committed');
    expect(found.data.result.employee_id).toBe(created.data.employee_id);
    expect((await rpc(owner, 'get_request_result', { p_request_key: key() })).data.status).toBe('not_found');
    // Request keys are scoped per actor: another user learns nothing.
    expect((await rpc(manager, 'get_request_result', { p_request_key: k })).data.status).toBe('not_found');
  });

  it('a key cannot be reused for a different action', async () => {
    const k = key();
    await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Key Reuse Test' });
    const reused = await rpc(owner, 'set_location_tax_rate', {
      p_request_key: k,
      p_location_id: 'LOC-SFO',
      p_rate: 0.07,
      p_effective_from: '2031-01-01',
    });
    expect(reused.code).toBe('conflict:request_key_reused');
  });

  it('a new key never bypasses business uniqueness', async () => {
    const args = { p_location_id: 'LOC-SFO', p_rate: 0.0715, p_effective_from: '2032-01-01' };
    expect((await rpc(owner, 'set_location_tax_rate', { ...args, p_request_key: key() })).code).toBeNull();
    expect((await rpc(owner, 'set_location_tax_rate', { ...args, p_request_key: key() })).code).toBe(
      'duplicate_business_key:tax_rate_effective_date',
    );
  });

  it('a rejected request leaves no stored result, so the same key can be used after fixing the input', async () => {
    const k = key();
    const bad = await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: '   ' });
    expect(bad.code).toBe('validation:display_name');
    expect((await rpc(owner, 'get_request_result', { p_request_key: k })).data.status).toBe('not_found');
    expect((await rpc(owner, 'create_employee', { p_request_key: k, p_display_name: 'Fixed Name' })).code).toBeNull();
  });
});

describe('pilot setup gates', () => {
  const gateId = (gateKey: string, scope: string | null) =>
    withDb(
      stack.dbUrl,
      async (db) =>
        (
          await db.query(
            `select gate_id from public.pilot_setup_gates where gate_key = $1 and coalesce(scope_id,'') = coalesce($2,'')`,
            [gateKey, scope],
          )
        ).rows[0].gate_id as string,
    );

  it('cannot be confirmed until the underlying value exists', async () => {
    const id = await gateId('tax_rate_confirmed', 'LOC-SLC');
    const r = await rpc(owner, 'confirm_setup_gate', {
      p_request_key: key(),
      p_gate_id: id,
      p_evidence_note: 'Checked with the tax commission',
    });
    expect(r.code).toBe('setup_gate_precondition:tax_rate_confirmed');
    expect(r.error?.details).toContain('no_confirmed_tax_rate_effective_today');
  });

  it('requires an evidence note, records who confirmed it, and can be reopened with a reason', async () => {
    const today = (await rpc(owner, 'get_my_context')).data.business_date as string;
    expect(
      (
        await rpc(owner, 'set_location_tax_rate', {
          p_request_key: key(),
          p_location_id: 'LOC-SLC',
          p_rate: 0.0775,
          p_effective_from: today,
        })
      ).code,
    ).toBeNull();
    const id = await gateId('tax_rate_confirmed', 'LOC-SLC');
    expect(
      (await rpc(owner, 'confirm_setup_gate', { p_request_key: key(), p_gate_id: id, p_evidence_note: 'short' })).code,
    ).toBe('validation:evidence_note');
    expect(
      (
        await rpc(owner, 'confirm_setup_gate', {
          p_request_key: key(),
          p_gate_id: id,
          p_evidence_note: 'Rate checked against the state tax table',
        })
      ).code,
    ).toBeNull();
    await withDb(stack.dbUrl, async (db) => {
      const { rows } = await db.query(`select status, confirmed_by from public.pilot_setup_gates where gate_id = $1`, [
        id,
      ]);
      expect(rows[0]).toEqual({ status: 'confirmed', confirmed_by: users.owner.employeeId });
    });
    expect(
      (await rpc(owner, 'reopen_setup_gate', { p_request_key: key(), p_gate_id: id, p_reason: 'rate changed' })).code,
    ).toBeNull();
  });

  it('gates for workflows delivered in later milestones cannot be confirmed yet', async () => {
    const id = await gateId('opening_counts_posted', 'LOC-PRO');
    const r = await rpc(owner, 'confirm_setup_gate', {
      p_request_key: key(),
      p_gate_id: id,
      p_evidence_note: 'Counted everything carefully',
    });
    expect(r.code).toBe('setup_gate_precondition:opening_counts_posted');
  });

  it('posting stays disabled until roles, backup/restore and acceptance gates are confirmed', async () => {
    const r = await rpc(owner, 'enable_posting', { p_request_key: key(), p_evidence_note: 'Trying to enable early' });
    expect(r.code).toBe('setup_gate_closed:posting_prerequisites');
    expect(r.error?.details).toContain('acceptance_suite_passed');
  });
});

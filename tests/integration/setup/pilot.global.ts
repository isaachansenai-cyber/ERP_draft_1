// Global setup for the PILOT integration suite: fresh migrated database (pilot
// mode), source master import, and real local Auth users for each role. Staff
// access is provisioned through the owner RPCs, exactly as in production.
import type { GlobalSetupContext } from 'vitest/node';
import { createClient } from '@supabase/supabase-js';
import { createAuthUser, key, localStack, resetLocalDatabase, runScript, withDb } from '../helpers/stack';

export interface PilotUser {
  email: string;
  password: string;
  employeeId: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    pilotUsers: Record<'owner' | 'proManager' | 'proEmployee' | 'slcManager' | 'sfoEmployee' | 'unlinked', PilotUser>;
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  await resetLocalDatabase();
  const stack = localStack();

  const imported = runScript('scripts/import/import-source-master.ts', { DATABASE_URL: stack.dbUrl });
  if (imported.status !== 0) throw new Error(`source import failed: ${imported.stderr}`);

  const suffix = Date.now().toString(36);
  const owner = await createAuthUser(stack, `owner.${suffix}@test.local`);
  const ownerEmployeeId = await withDb(stack.dbUrl, async (db) => {
    const { rows } = await db.query<{ id: string }>('select private.bootstrap_owner($1, $2) as id', [
      owner.email,
      'Pilot Test Owner',
    ]);
    return rows[0].id;
  });

  const ownerClient = createClient(stack.apiUrl, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await ownerClient.auth.signInWithPassword({ email: owner.email, password: owner.password });
  if (signed.error) throw signed.error;

  async function provision(label: string, role: 'manager' | 'employee' | null, locationId: string | null) {
    const user = await createAuthUser(stack, `${label}.${suffix}@test.local`);
    const created = await ownerClient.rpc('create_employee', { p_request_key: key(), p_display_name: `Test ${label}` });
    if (created.error) throw created.error;
    const employeeId = (created.data as { employee_id: string }).employee_id;
    const linked = await ownerClient.rpc('link_employee_auth_user', {
      p_request_key: key(),
      p_employee_id: employeeId,
      p_email: user.email,
    });
    if (linked.error) throw linked.error;
    if (role) {
      const granted = await ownerClient.rpc('grant_membership', {
        p_request_key: key(),
        p_employee_id: employeeId,
        p_role: role,
        p_location_id: locationId,
      });
      if (granted.error) throw granted.error;
    }
    return { email: user.email, password: user.password, employeeId };
  }

  provide('pilotUsers', {
    owner: { email: owner.email, password: owner.password, employeeId: ownerEmployeeId },
    proManager: await provision('pro-manager', 'manager', 'LOC-PRO'),
    proEmployee: await provision('pro-employee', 'employee', 'LOC-PRO'),
    slcManager: await provision('slc-manager', 'manager', 'LOC-SLC'),
    sfoEmployee: await provision('sfo-employee', 'employee', 'LOC-SFO'),
    unlinked: await provision('no-role', null, null),
  });
}

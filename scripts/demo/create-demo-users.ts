// Create (or re-key) Supabase Auth users for the 10 demo role fixtures and link
// them to their staff records (CLAUDE.md D4). DEMO DATABASES ONLY.
//
// Usage:
//   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   DEMO_PROJECT_REF_ALLOWLIST=<ref> npm run demo:users
//
// A fresh random password is generated for every user on every run and written
// only to DEMO_CREDENTIALS.local.md (gitignored; override with
// DEMO_CREDENTIALS_PATH). Nothing is printed to stdout except emails.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { assertDemoTarget, connect, isMain, RefusalError, requireEnv, runCli } from '../lib/target.ts';

export const DEFAULT_CREDENTIALS_PATH = fileURLToPath(new URL('../../DEMO_CREDENTIALS.local.md', import.meta.url));

export function demoEmail(employeeId: string): string {
  return `${employeeId.toLowerCase()}@example.invalid`;
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url'); // 24 chars, ~144 bits
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | undefined> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

export async function createDemoUsers() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) throw new RefusalError('missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');
  const credentialsPath = process.env.DEMO_CREDENTIALS_PATH ?? DEFAULT_CREDENTIALS_PATH;

  const db = await connect(databaseUrl);
  try {
    await assertDemoTarget(db, databaseUrl, supabaseUrl);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { rows: fixtures } = await db.query<{
      employee_id: string;
      display_name: string;
      role: string;
      location_id: string | null;
    }>(
      `select e.employee_id, e.display_name, m.role, m.location_id
         from public.employees e
         join public.memberships m on m.employee_id = e.employee_id and m.active
        where e.employee_id like 'DEMO-%' and e.provenance ilike 'synthetic%'
        order by (m.role = 'owner') desc, m.location_id nulls first, m.role, e.employee_id`,
    );
    if (fixtures.length !== 10) throw new Error(`expected 10 demo role fixtures, found ${fixtures.length}`);

    const credentials: Array<{
      employee_id: string;
      role: string;
      location_id: string | null;
      email: string;
      password: string;
    }> = [];
    for (const f of fixtures) {
      const email = demoEmail(f.employee_id);
      const password = generatePassword();
      let user = await findUserByEmail(admin, email);
      if (user) {
        const { error } = await admin.auth.admin.updateUserById(user.id, { password });
        if (error) throw error;
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { demo_fixture: f.employee_id },
        });
        if (error) throw error;
        user = data.user;
      }
      const linked = await db.query(
        `update public.employees set auth_user_id = $1, updated_at = now()
          where employee_id = $2 and (auth_user_id is null or auth_user_id = $1)`,
        [user.id, f.employee_id],
      );
      if (linked.rowCount !== 1) throw new Error(`could not link ${f.employee_id}: already linked to a different user`);
      credentials.push({ employee_id: f.employee_id, role: f.role, location_id: f.location_id, email, password });
    }

    const lines = [
      '# Demo credentials (LOCAL FILE — never commit, never share publicly)',
      '',
      `Generated ${new Date().toISOString()} for the demo database. Re-running \`npm run demo:users\``,
      'replaces every password below. These accounts exist only in the demo project.',
      '',
      '| Employee | Role | Location | Email | Password |',
      '|---|---|---|---|---|',
      ...credentials.map(
        (c) => `| ${c.employee_id} | ${c.role} | ${c.location_id ?? 'all'} | ${c.email} | \`${c.password}\` |`,
      ),
      '',
    ];
    writeFileSync(credentialsPath, lines.join('\n'), { mode: 0o600 });
    return { users: credentials.map((c) => c.email), credentials_file: credentialsPath };
  } finally {
    await db.end();
  }
}

if (isMain(import.meta.url)) {
  await runCli('create-demo-users', createDemoUsers);
}

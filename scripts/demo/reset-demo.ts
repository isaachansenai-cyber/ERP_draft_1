// Reset a DEMO database to a reproducible state: wipe demo data, re-import the
// source master, demo seed and history, and (if a service key is present)
// re-key the demo users.
//
// Usage: DATABASE_URL=... DEMO_PROJECT_REF_ALLOWLIST=<ref> [SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...] npm run demo:reset
//
// The project is taken only from the environment and must be allowlisted; the
// database function private.reset_demo_data() also refuses unless the database
// reports data_mode = 'demo'. There is no API endpoint for reset in any project.
import { assertDemoTarget, connect, isMain, requireEnv, runCli } from '../lib/target.ts';
import { importDemoSeed } from '../import/import-demo-seed.ts';
import { importDemoHistory } from '../import/import-demo-history.ts';
import { createDemoUsers } from './create-demo-users.ts';

export async function resetDemo() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const client = await connect(databaseUrl);
  let seed;
  let history;
  try {
    await assertDemoTarget(client, databaseUrl, process.env.SUPABASE_URL);
    await client.query('select private.reset_demo_data()');
    seed = await importDemoSeed(client);
    history = await importDemoHistory(client);
  } finally {
    await client.end();
  }
  const haveKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
  const users =
    haveKey && process.env.SUPABASE_URL
      ? await createDemoUsers()
      : { skipped: 'no SUPABASE_URL/service key; run npm run demo:users' };
  return { seed: seed.totals, history: history.verification, users };
}

if (isMain(import.meta.url)) {
  await runCli('reset-demo', resetDemo);
}

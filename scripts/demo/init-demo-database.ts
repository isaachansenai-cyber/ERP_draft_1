// Switch a freshly migrated, still-empty database to demo mode (one way).
//
// Usage: DATABASE_URL=... DEMO_PROJECT_REF_ALLOWLIST=<ref> npx tsx scripts/demo/init-demo-database.ts
//
// Guards: the project ref must be allowlisted, and the database itself refuses
// (forbidden:database_not_pristine) if it holds any staff, customers, history,
// prices, taxes, confirmed gates or non-import audit rows, so a pilot that has
// been used can never become a resettable demo.
import { assertAllowlisted, connect, isMain, requireEnv, runCli } from '../lib/target.ts';
import { loadDemoSeed } from '../import/import-demo-seed.ts';

export async function initDemoDatabase(databaseUrl: string) {
  const ref = assertAllowlisted(databaseUrl, process.env.SUPABASE_URL);
  const seed = loadDemoSeed();
  const client = await connect(databaseUrl);
  try {
    await client.query('select private.enable_demo_mode($1)', [seed.dataset_id]);
    const { rows } = await client.query('select data_mode, dataset_id from public.app_settings');
    return { project_ref: ref, ...rows[0] };
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  await runCli('init-demo-database', () => initDemoDatabase(requireEnv('DATABASE_URL')));
}

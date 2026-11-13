// Prepare a local DEMO database + demo users, build the app under the GitHub Pages
// base path, and serve it with `vite preview`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStack, resetLocalDatabase, ROOT, runScript } from '../integration/helpers/stack';

export const BASE_PATH = '/ERP_draft_1/';

export default async function globalSetup() {
  resetLocalDatabase();
  const stack = localStack();
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  const credentialsPath = join(dir, 'DEMO_CREDENTIALS.local.md');
  const env = { DATABASE_URL: stack.dbUrl, SUPABASE_URL: stack.apiUrl, DEMO_PROJECT_REF_ALLOWLIST: 'local' };
  for (const [label, script, extra] of [
    ['init', 'scripts/demo/init-demo-database.ts', {}],
    ['seed', 'scripts/import/import-demo-seed.ts', {}],
    [
      'users',
      'scripts/demo/create-demo-users.ts',
      { SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey, DEMO_CREDENTIALS_PATH: credentialsPath },
    ],
  ] as const) {
    const r = runScript(script, { ...env, ...extra });
    if (r.status !== 0) throw new Error(`${label} failed: ${r.stderr}`);
  }
  process.env.E2E_CREDENTIALS_PATH = credentialsPath;

  const build = spawnSync('npx', ['vite', 'build', '--mode', 'e2e'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: stack.apiUrl,
      VITE_SUPABASE_ANON_KEY: stack.anonKey,
      VITE_BASE_PATH: BASE_PATH,
    },
  });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);

  const server = spawn('npx', ['vite', 'preview', '--mode', 'e2e'], {
    cwd: ROOT,
    env: { ...process.env, VITE_BASE_PATH: BASE_PATH },
    stdio: 'ignore',
    detached: true,
  });
  writeFileSync(join(dir, 'server.pid'), String(server.pid));
  process.env.E2E_SERVER_PID_FILE = join(dir, 'server.pid');
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:4173${BASE_PATH}`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
}

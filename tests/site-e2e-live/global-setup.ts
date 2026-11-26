// Live website tests: a fresh local DEMO database (demo seed incl. website
// settings), then the public site built (and pre-rendered) against it at the
// domain root, as on Vercel, and served with `vite preview`. No staff users are needed: visitors never sign in.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStack, resetLocalDatabase, ROOT, runScript } from '../integration/helpers/stack';

export const SITE_BASE_PATH = '/';
export const LIVE_PORT = 4175;

export default async function globalSetup() {
  await resetLocalDatabase();
  const stack = localStack();
  const env = { DATABASE_URL: stack.dbUrl, SUPABASE_URL: stack.apiUrl, DEMO_PROJECT_REF_ALLOWLIST: 'local' };
  for (const [label, script] of [
    ['init', 'scripts/demo/init-demo-database.ts'],
    ['seed', 'scripts/import/import-demo-seed.ts'],
  ] as const) {
    const r = runScript(script, env);
    if (r.status !== 0) throw new Error(`${label} failed: ${r.stderr || r.stdout}`);
  }

  const build = spawnSync('npm', ['run', 'site:build'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: stack.apiUrl,
      VITE_SUPABASE_ANON_KEY: stack.anonKey,
      VITE_SITE_BASE_PATH: SITE_BASE_PATH,
    },
  });
  if (build.status !== 0) throw new Error(`site build failed: ${build.stderr || build.stdout}`);

  const dir = mkdtempSync(join(tmpdir(), 'site-live-'));
  const server = spawn(
    'npx',
    ['vite', 'preview', '--config', 'site/vite.config.ts', '--port', String(LIVE_PORT), '--strictPort'],
    { cwd: ROOT, env: { ...process.env, VITE_SITE_BASE_PATH: SITE_BASE_PATH }, stdio: 'ignore', detached: true },
  );
  writeFileSync(join(dir, 'server.pid'), String(server.pid));
  process.env.E2E_SERVER_PID_FILE = join(dir, 'server.pid');
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${LIVE_PORT}${SITE_BASE_PATH}`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
}

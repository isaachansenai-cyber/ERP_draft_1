// Global setup for the DEMO integration suite: fresh database switched to demo
// mode by the operator script, then source master, demo seed, history and demo
// users created through the same scripts an operator runs.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalSetupContext } from 'vitest/node';
import { contentFingerprint } from '../helpers/snapshot';
import { localStack, resetLocalDatabase, runScript, withDb } from '../helpers/stack';

declare module 'vitest' {
  export interface ProvidedContext {
    demoCredentials: Record<string, { email: string; password: string; role: string; location: string }>;
    demoEnv: Record<string, string>;
    demoReproducibility: { first: Record<string, string>; afterReset: Record<string, string> };
  }
}

function must(label: string, r: { status: number | null; stderr: string; stdout: string }) {
  if (r.status !== 0) throw new Error(`${label} failed (${r.status}): ${r.stderr || r.stdout}`);
}

export default async function setup({ provide }: GlobalSetupContext) {
  await resetLocalDatabase();
  const stack = localStack();
  const credentialsPath = join(mkdtempSync(join(tmpdir(), 'demo-creds-')), 'DEMO_CREDENTIALS.local.md');
  const env = {
    DATABASE_URL: stack.dbUrl,
    SUPABASE_URL: stack.apiUrl,
    DEMO_PROJECT_REF_ALLOWLIST: 'local',
  };

  must('init demo database', runScript('scripts/demo/init-demo-database.ts', env));
  must('import demo seed', runScript('scripts/import/import-demo-seed.ts', env));
  must('import demo history', runScript('scripts/import/import-demo-history.ts', env));
  must(
    'create demo users',
    runScript('scripts/demo/create-demo-users.ts', {
      ...env,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      DEMO_CREDENTIALS_PATH: credentialsPath,
    }),
  );

  // A fresh demo must be reproducible (PRD §2): reset and rebuild, then compare content.
  const first = await withDb(stack.dbUrl, contentFingerprint);
  must(
    'reset demo',
    runScript('scripts/demo/reset-demo.ts', {
      ...env,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      DEMO_CREDENTIALS_PATH: credentialsPath,
    }),
  );
  const afterReset = await withDb(stack.dbUrl, contentFingerprint);
  provide('demoReproducibility', { first, afterReset });

  const creds: Record<string, { email: string; password: string; role: string; location: string }> = {};
  for (const line of readFileSync(credentialsPath, 'utf8').split('\n')) {
    const m = line.match(/^\| (DEMO-[A-Z0-9-]+) \| (\w+) \| ([\w-]+) \| (\S+) \| `([^`]+)` \|$/);
    if (m) creds[m[1]!] = { role: m[2]!, location: m[3]!, email: m[4]!, password: m[5]! };
  }
  if (Object.keys(creds).length !== 10) throw new Error('expected 10 demo credentials');
  provide('demoCredentials', creds);
  provide('demoEnv', env);
}

// Target resolution and demo-safety guards for operator tooling.
// The target project is derived only from DATABASE_URL / SUPABASE_URL in the
// environment, never from a command-line argument (CLAUDE.md §7).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export class RefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusalError';
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal']);
const PROJECT_REF = /^[a-z0-9]{20}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new RefusalError(`missing required environment variable ${name}`);
  }
  return value.trim();
}

/** Supabase project ref for a Postgres connection string, or "local". */
export function projectRefFromDatabaseUrl(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new RefusalError('DATABASE_URL is not a valid connection URL');
  }
  if (LOCAL_HOSTS.has(url.hostname)) return 'local';
  const direct = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  if (direct) return direct[1];
  const pooled = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{20})$/);
  if (pooled && url.hostname.endsWith('.pooler.supabase.com')) return pooled[1];
  throw new RefusalError(`cannot derive a Supabase project ref from DATABASE_URL host "${url.hostname}"`);
}

/** Supabase project ref for an API URL, or "local". */
export function projectRefFromSupabaseUrl(supabaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new RefusalError('SUPABASE_URL is not a valid URL');
  }
  if (LOCAL_HOSTS.has(url.hostname)) return 'local';
  const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (match && PROJECT_REF.test(match[1])) return match[1];
  throw new RefusalError(`cannot derive a Supabase project ref from SUPABASE_URL host "${url.hostname}"`);
}

export function demoAllowlist(): string[] {
  return (process.env.DEMO_PROJECT_REF_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Refuse unless the target ref is allowlisted (does not check data mode). */
export function assertAllowlisted(databaseUrl: string, supabaseUrl?: string): string {
  const ref = projectRefFromDatabaseUrl(databaseUrl);
  if (supabaseUrl) {
    const apiRef = projectRefFromSupabaseUrl(supabaseUrl);
    if (apiRef !== ref) {
      throw new RefusalError(`SUPABASE_URL (${apiRef}) and DATABASE_URL (${ref}) point at different projects`);
    }
  }
  const allow = demoAllowlist();
  if (!allow.includes(ref)) {
    throw new RefusalError(
      `project ref "${ref}" is not in DEMO_PROJECT_REF_ALLOWLIST (${allow.length ? allow.join(', ') : 'empty'})`,
    );
  }
  return ref;
}

/** Refuse unless the target is allowlisted AND the database reports demo mode. */
export async function assertDemoTarget(
  client: pg.Client,
  databaseUrl: string,
  supabaseUrl?: string,
): Promise<{ ref: string; datasetId: string }> {
  const ref = assertAllowlisted(databaseUrl, supabaseUrl);
  const { rows } = await client.query<{ data_mode: string; dataset_id: string | null }>(
    'select data_mode, dataset_id from public.app_settings',
  );
  const settings = rows[0];
  if (!settings || settings.data_mode !== 'demo' || !settings.dataset_id) {
    throw new RefusalError(
      `database reports data_mode="${settings?.data_mode ?? 'unknown'}"; demo tooling only runs against a demo database`,
    );
  }
  return { ref, datasetId: settings.dataset_id };
}

export async function connect(databaseUrl: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: 'meats-erp-tooling' });
  await client.connect();
  return client;
}

/** Standard CLI wrapper: refusals exit 2, other failures exit 1. */
export async function runCli(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof RefusalError) {
      console.error(`REFUSED (${name}): ${err.message}`);
      process.exit(2);
    }
    console.error(`FAILED (${name}):`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && importMetaUrl === pathToFileURL(resolve(entry)).href;
}

// Helpers for integration tests against the LOCAL Supabase stack only (CLAUDE.md D7).
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  dbUrl: string;
}

export function localStack(): LocalStack {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const json = JSON.parse(out.slice(out.indexOf('{')));
  const stack = { apiUrl: json.API_URL, anonKey: json.ANON_KEY, serviceKey: json.SERVICE_ROLE_KEY, dbUrl: json.DB_URL };
  for (const [k, v] of Object.entries(stack)) if (!v) throw new Error(`supabase status did not return ${k}`);
  const host = new URL(stack.dbUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error('integration tests only run against the local stack');
  return stack;
}

export function resetLocalDatabase(): void {
  const r = spawnSync('npx', ['supabase', 'db', 'reset', '--local'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`supabase db reset failed: ${r.stderr}`);
}

export interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run an operator script exactly as an operator would (separate process, env only). */
export function runScript(script: string, env: Record<string, string | undefined>): ScriptResult {
  const r = spawnSync('npx', ['tsx', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export async function withDb<T>(dbUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function anonClient(stack: LocalStack): SupabaseClient {
  return createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function adminClient(stack: LocalStack): SupabaseClient {
  return createClient(stack.apiUrl, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signIn(stack: LocalStack, email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient(stack);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

export function randomPassword(): string {
  return randomBytes(18).toString('base64url');
}

export async function createAuthUser(
  stack: LocalStack,
  email: string,
): Promise<{ id: string; email: string; password: string }> {
  const password = randomPassword();
  const { data, error } = await adminClient(stack).auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

export const key = () => randomUUID();

/** Call an RPC and return { data, code } where code is the stable error message (or null). */
export async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  return {
    data,
    code: error ? (error.code === 'P0001' ? error.message : `${error.code}:${error.message}`) : null,
    error,
  };
}

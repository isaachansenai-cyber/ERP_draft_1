// Backup/restore drill (PRD §15; AC31).
//
// Modes:
//   drill   (default, LOCAL STACK ONLY): pg_dump the local database inside the
//           Supabase Postgres container, restore it into a new disposable
//           database in the same cluster, verify, then drop the copy.
//   compare: read-only verification of two databases you restored yourself,
//           for example a hosted pilot and a disposable restore project:
//           SOURCE_DATABASE_URL=... RESTORED_DATABASE_URL=... DRILL_MODE=compare
//
// Verification: identical row counts and content hashes for every table in
// public and private (plus auth.users count), identical ledger and document
// totals, the ledger still reconciles in the copy, and the security controls
// (RLS, append-only triggers, no API write grants) are present in the copy.
// Writes docs/acceptance/evidence/backup-restore-drill.{json,md}. No data rows
// or credentials are written to the report.
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { isMain, RefusalError, requireEnv, runCli } from '../lib/target.ts';

const OUT_DIR = fileURLToPath(new URL('../../docs/acceptance/evidence/', import.meta.url));
const CONTAINER = process.env.DRILL_DB_CONTAINER ?? 'supabase_db_meats-erp';

async function query<T = Record<string, unknown>>(url: string, sql: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url, application_name: 'meats-erp-drill' });
  await c.connect();
  try {
    return (await c.query(sql)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Row count and order-independent content hash for every base table in public and private. */
async function tableHashes(url: string) {
  const tables = await query<{ s: string; t: string }>(
    url,
    `select table_schema s, table_name t from information_schema.tables
      where table_schema in ('public', 'private') and table_type = 'BASE TABLE' order by 1, 2`,
  );
  const out: Record<string, string> = {};
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const { s, t } of tables) {
      const { rows } = await c.query(
        `select count(*)::int n, coalesce(md5(string_agg(r::text, '|' order by r::text)), '-') h from ${s}."${t}" r`,
      );
      out[`${s}.${t}`] = `${rows[0].n}:${rows[0].h}`;
    }
    const { rows } = await c.query(`select count(*)::int n from auth.users`);
    out['auth.users(count)'] = String(rows[0].n);
  } finally {
    await c.end();
  }
  return out;
}

/** Business totals that must survive a restore unchanged. */
async function totals(url: string) {
  const [r] = await query<Record<string, string>>(
    url,
    `select
      (select count(*) from public.inventory_movements)::text movements,
      (select coalesce(sum(quantity), 0)::text from public.inventory_movements) movement_qty,
      (select coalesce(round(sum(extended_cost), 6), 0)::text from public.inventory_movements) movement_value,
      (select coalesce(sum(on_hand), 0)::text from public.stock_balances) on_hand,
      (select coalesce(sum(reserved), 0)::text from public.stock_balances) reserved,
      (select coalesce(round(sum(valued_qty * avg_unit_cost), 6), 0)::text from public.item_valuation) inventory_value,
      (select count(*) || ':' || coalesce(sum(total_cents), 0) from public.orders where status = 'completed') completed_orders,
      (select coalesce(sum(amount_cents), 0)::text from public.tenders) tenders_cents,
      (select coalesce(sum(amount_cents), 0)::text from public.refunds) refunds_cents,
      (select count(*) || ':' || coalesce(sum(total_cents), 0) from public.supplier_invoices) invoices,
      (select coalesce(sum(amount_cents), 0)::text from public.supplier_payments) supplier_payments_cents,
      (select count(*)::text from public.time_entries) time_entries,
      (select count(*)::text from public.audit_log) audit_rows,
      (select count(*) || ':' || coalesce(sum(net_before_refund_cents - refund_net_cents), 0) from public.historical_sales_orders) history,
      (select data_mode || ':' || posting_enabled from public.app_settings) settings`,
  );
  return r!;
}

/** Ledger reconciliation and security controls inside one database. */
async function integrity(url: string) {
  const [r] = await query<Record<string, unknown>>(
    url,
    `select
      (select count(*) from (select b.lot_id, b.condition, b.on_hand,
          (select coalesce(sum(m.quantity), 0) from public.inventory_movements m where m.lot_id = b.lot_id and m.condition = b.condition) mv
          from public.stock_balances b) x where x.on_hand <> x.mv)::int balances_not_matching_ledger,
      (select count(*) from public.stock_balances where reserved > on_hand or on_hand < 0)::int invalid_balances,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int public_tables_without_rls,
      (select count(*) from pg_trigger g join pg_proc p on p.oid = g.tgfoid where p.proname = 'forbid_update_delete' and not g.tgisinternal)::int append_only_triggers,
      has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT,UPDATE,DELETE') api_can_write_movements,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private'))::int functions`,
  );
  // The append-only guard must still fire in the copy.
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  let guard = 'not tested (no movements)';
  try {
    await c.query('begin');
    const { rowCount } = await c.query(
      `update public.inventory_movements set quantity = quantity where movement_id = (select movement_id from public.inventory_movements limit 1)`,
    );
    guard = rowCount ? 'FAILED: update succeeded' : guard;
  } catch (err) {
    guard = `refused (${(err as Error).message})`;
  } finally {
    await c.query('rollback').catch(() => undefined);
    await c.end();
  }
  return { ...(r as Record<string, unknown>), movement_update_guard: guard };
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

async function pipeToFile(cmd: string, args: string[], file: string) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(file, { mode: 0o600 });
    let err = '';
    p.stdout.pipe(out);
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 500)}`)),
    );
  });
}

async function pipeFromFile(cmd: string, args: string[], file: string) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    createReadStream(file).pipe(p.stdin);
    p.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 500)}`)),
    );
  });
}

async function verify(sourceUrl: string, restoredUrl: string) {
  const [h1, h2, t1, t2, i2] = await Promise.all([
    tableHashes(sourceUrl),
    tableHashes(restoredUrl),
    totals(sourceUrl),
    totals(restoredUrl),
    integrity(restoredUrl),
  ]);
  const tableMismatches = diff(h1, h2);
  const totalMismatches = diff(t1, t2);
  const pass =
    tableMismatches.length === 0 &&
    totalMismatches.length === 0 &&
    i2.balances_not_matching_ledger === 0 &&
    i2.invalid_balances === 0 &&
    i2.public_tables_without_rls === 0 &&
    i2.api_can_write_movements === false &&
    String(i2.movement_update_guard).startsWith('refused');
  return {
    tables_compared: Object.keys(h1).length,
    tableMismatches,
    totals: t1,
    totalMismatches,
    restored_integrity: i2,
    pass,
  };
}

export async function runDrill(databaseUrl: string) {
  const host = new URL(databaseUrl).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    throw new RefusalError(
      `drill mode runs only against the local stack (got host ${host}); use DRILL_MODE=compare for hosted projects`,
    );
  }
  const dbName = `restore_drill_${Date.now().toString(36)}`;
  const restoredUrl = Object.assign(new URL(databaseUrl), { pathname: `/${dbName}` }).toString();
  const dir = mkdtempSync(join(tmpdir(), 'erp-drill-'));
  const dumpFile = join(dir, 'backup.dump');
  const t0 = performance.now();
  await pipeToFile('docker', ['exec', CONTAINER, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc'], dumpFile);
  const dumpSeconds = (performance.now() - t0) / 1000;
  const dumpBytes = statSync(dumpFile).size;
  execFileSync('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-qc',
    `create database ${dbName} template template0`,
  ]);
  try {
    const t1 = performance.now();
    const warnings = await pipeFromFile(
      'docker',
      ['exec', '-i', CONTAINER, 'pg_restore', '-U', 'supabase_admin', '-d', dbName],
      dumpFile,
    );
    const restoreSeconds = (performance.now() - t1) / 1000;
    const t2 = performance.now();
    const result = await verify(databaseUrl, restoredUrl);
    return {
      mode: 'drill',
      measured_at: new Date().toISOString(),
      environment: `local Supabase stack; full pg_dump (custom format) of database "postgres" restored into disposable database "${dbName}" in the same cluster`,
      dump_seconds: Math.round(dumpSeconds * 10) / 10,
      dump_megabytes: Math.round((dumpBytes / 1048576) * 10) / 10,
      restore_seconds: Math.round(restoreSeconds * 10) / 10,
      verify_seconds: Math.round(((performance.now() - t2) / 1000) * 10) / 10,
      restore_warnings: warnings.trim() ? warnings.trim().split('\n').length : 0,
      recovery_target: 'restore within 4 hours (PRD §15)',
      ...result,
    };
  } finally {
    if (process.env.DRILL_KEEP !== '1') {
      execFileSync('docker', [
        'exec',
        CONTAINER,
        'psql',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '-qc',
        `drop database if exists ${dbName}`,
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function markdown(r: Record<string, unknown> & { pass: boolean; totals: Record<string, string> }) {
  const i = r.restored_integrity as Record<string, unknown>;
  return [
    '# AC31 backup/restore drill (generated)',
    '',
    `Run ${r.measured_at} by \`scripts/ops/backup-restore-drill.ts\` (mode: ${r.mode}). ${r.environment ?? ''}`,
    '',
    r.mode === 'drill'
      ? `- Backup: ${r.dump_megabytes} MB in ${r.dump_seconds} s. Restore: ${r.restore_seconds} s (target: within 4 hours). Verification: ${r.verify_seconds} s. Restore warnings: ${r.restore_warnings}.`
      : '- Compared two databases supplied by the operator.',
    `- Tables compared (public + private, row counts and content hashes): **${r.tables_compared}**, mismatches: **${(r.tableMismatches as string[]).length}**.`,
    `- Business totals compared: **${Object.keys(r.totals).length}**, mismatches: **${(r.totalMismatches as string[]).length}**.`,
    `- Restored copy: ledger balances not matching movements = ${i.balances_not_matching_ledger}; invalid balances = ${i.invalid_balances}; public tables without RLS = ${i.public_tables_without_rls}; append-only triggers = ${i.append_only_triggers}; API roles can write movements = ${i.api_can_write_movements}; updating a movement: ${i.movement_update_guard}.`,
    `- Result: **${r.pass ? 'PASS — the copy is identical and its controls are intact' : 'FAIL'}**.`,
    '',
    '## Totals (identical in source and copy)',
    '',
    '| Total | Value |',
    '|---|---|',
    ...Object.entries(r.totals).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    'A hosted drill (pilot backup restored into a disposable Supabase project) follows `docs/ops/backup-restore.md` and is an operator action.',
    '',
  ].join('\n');
}

if (isMain(import.meta.url)) {
  await runCli('backup-restore-drill', async () => {
    const mode = process.env.DRILL_MODE ?? 'drill';
    const report =
      mode === 'compare'
        ? {
            mode,
            measured_at: new Date().toISOString(),
            ...(await verify(requireEnv('SOURCE_DATABASE_URL'), requireEnv('RESTORED_DATABASE_URL'))),
          }
        : await runDrill(requireEnv('DATABASE_URL'));
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}backup-restore-drill.json`, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(`${OUT_DIR}backup-restore-drill.md`, markdown(report as never));
    if (!report.pass)
      throw new Error('drill verification failed; see docs/acceptance/evidence/backup-restore-drill.md');
    return { pass: report.pass, tables_compared: report.tables_compared };
  });
}

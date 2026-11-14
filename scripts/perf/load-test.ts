// 20-session load and latency measurement (PRD §15; AC33). DEMO DATABASES ONLY.
//
// Usage (local stack):
//   DATABASE_URL=... SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... \
//   DEMO_PROJECT_REF_ALLOWLIST=local DEMO_CREDENTIALS_PATH=./DEMO_CREDENTIALS.local.md \
//   npx tsx scripts/perf/load-test.ts
//
// 1. Volume fixture (optional, PERF_VOLUME_LINES, default 50000): bulk-inserts
//    completed synthetic orders (provenance `synthetic_perf_volume`) so the
//    database holds the PRD's 50,000 operational order lines plus the demo
//    history. Read-path volume only: these rows post no stock movements.
// 2. Signs in 20 sessions (the 10 demo role users, two sessions each) and runs
//    role-shaped scenarios concurrently through the real API: POS menu, order
//    acceptance, payment, kitchen steps, pickup, stock, sales summary, forecast,
//    projection, serve view, invoices, hours.
// 3. Reports p50/p95/max per operation against the targets (95% of ordinary
//    screen queries ≤ 2 s; order acceptance ≤ 3 s) and checks ledger invariants.
//    Writes docs/acceptance/evidence/perf-AC33.{json,md}.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertDemoTarget, connect, isMain, requireEnv, runCli } from '../lib/target.ts';

const LOCATIONS = ['LOC-PRO', 'LOC-SFO', 'LOC-SLC'] as const;
const DISHES = ['FG-001', 'FG-002', 'FG-003', 'FG-004', 'FG-005'];
const RETAIL = ['RET-001', 'RET-002'];
const OUT_DIR = fileURLToPath(new URL('../../docs/acceptance/evidence/', import.meta.url));

type Kind = 'query' | 'accept' | 'write';
interface Sample {
  op: string;
  kind: Kind;
  ms: number;
  outcome: 'ok' | 'business_refusal' | 'error';
  code?: string;
}

function credentials(path: string): Array<{ employeeId: string; email: string; password: string }> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.match(/^\| (\S+) \|.*\| (\S+@\S+) \| `([^`]+)` \|$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ employeeId: m[1]!, email: m[2]!, password: m[3]! }));
}

/** Insert completed synthetic orders until the operational order-line count reaches the target. */
export async function ensureVolume(db: import('pg').Client, targetLines: number) {
  const { rows } = await db.query<{ n: number }>('select count(*)::int n from public.order_lines');
  const missing = targetLines - rows[0]!.n;
  if (missing <= 0) return { inserted_lines: 0, total_lines: rows[0]!.n };
  const orders = Math.ceil(missing / 2);
  await db.query('begin');
  try {
    await db.query(
      `create temporary table perf_plan on commit drop as
       select g, ln, (array['FG-001','FG-002','FG-003','FG-004','FG-005','RET-001','RET-002'])[1 + ((g * 7 + ln * 3) % 7)] item_id,
              1 + ((g + ln) % 3) qty,
              (array['LOC-PRO','LOC-SFO','LOC-SLC'])[1 + (g % 3)] loc,
              (current_date - 1 - (g % 150))::date d
         from generate_series(1, $1::int) g, generate_series(1, 2) ln`,
      [orders],
    );
    await db.query(`alter table perf_plan add column price bigint, add column recipe uuid, add column item_type text`);
    await db.query(`update perf_plan p set price = coalesce((select pr.price_cents from public.location_item_prices pr
                      where pr.location_id = p.loc and pr.item_id = p.item_id order by pr.effective_from desc limit 1), 999),
                      recipe = (select v.recipe_version_id from public.recipe_versions v where v.parent_item_id = p.item_id and v.status = 'active'),
                      item_type = (select i.item_type from public.items i where i.item_id = p.item_id)
                    where true`);
    const seq = Date.now().toString(36);
    await db.query(
      `insert into public.orders (order_id, order_number, location_id, business_date, pickup_code, status, has_kitchen_items,
         tender_mode, tax_rate, gross_cents, discount_cents, net_cents, tax_cents, total_cents, accepted_at, accepted_by,
         started_at, started_by, ready_at, completed_at, completed_by, completed_business_date, provenance)
       select md5('perf' || $1 || t.g)::uuid, 'PERF-' || $1 || '-' || t.g, t.loc, t.d, 'PF' || $1 || t.g, 'completed', true,
              'SIMULATED', 0.0725, t.gross, 0, t.gross, t.tax, t.gross + t.tax,
              (t.d + time '12:00') at time zone 'America/Denver', 'DEMO-LOC-PRO-EMP-1',
              (t.d + time '12:05') at time zone 'America/Denver', 'DEMO-LOC-PRO-EMP-1',
              (t.d + time '12:20') at time zone 'America/Denver', (t.d + time '12:25') at time zone 'America/Denver',
              'DEMO-LOC-PRO-EMP-1', t.d, 'synthetic_perf_volume'
         from (select g, loc, d, sum(qty * price) gross, sum(round(qty * price * 0.0725)::bigint) tax
                 from perf_plan group by g, loc, d) t`,
      [seq],
    );
    await db.query(
      `insert into public.order_lines (order_id, revision, line_no, item_id, item_type, quantity, unit_price_cents,
         price_effective_from, gross_cents, discount_cents, net_cents, tax_cents, recipe_version_id)
       select md5('perf' || $1 || p.g)::uuid, 1, p.ln, p.item_id, p.item_type, p.qty, p.price, p.d, p.qty * p.price, 0,
              p.qty * p.price, round(p.qty * p.price * 0.0725)::bigint, p.recipe
         from perf_plan p`,
      [seq],
    );
    await db.query(
      `insert into public.tenders (order_id, location_id, tender_type, method, amount_cents, recorded_by, recorded_at, business_date)
       select o.order_id, o.location_id, 'SIMULATED', 'cash', o.total_cents, o.accepted_by, o.completed_at, o.completed_business_date
         from public.orders o where o.order_number like 'PERF-' || $1 || '-%'`,
      [seq],
    );
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
  const after = await db.query<{ n: number }>('select count(*)::int n from public.order_lines');
  return { inserted_lines: orders * 2, total_lines: after.rows[0]!.n };
}

async function timed(
  samples: Sample[],
  op: string,
  kind: Kind,
  fn: () => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const t0 = performance.now();
  const r = (await fn()) as { data: unknown; error: { code?: string; message?: string } | null };
  const ms = performance.now() - t0;
  const code = r.error ? (r.error.code === 'P0001' ? r.error.message : r.error.code) : undefined;
  const business =
    code === 'insufficient_stock' || code?.startsWith('invalid_state') || code === 'conflict:stale_version';
  samples.push({ op, kind, ms, outcome: r.error ? (business ? 'business_refusal' : 'error') : 'ok', code });
  return r;
}

const pick = <T>(arr: readonly T[], i: number) => arr[i % arr.length]!;

async function employeeLoop(c: SupabaseClient, loc: string, iterations: number, seed: number, samples: Sample[]) {
  const today = (await c.rpc('get_my_context')).data?.business_date as string;
  for (let i = 0; i < iterations; i++) {
    await timed(samples, 'get_pos_menu', 'query', () => c.rpc('get_pos_menu', { p_location_id: loc }));
    const lines = [{ item_id: pick([...DISHES, ...RETAIL], seed + i), quantity: 1 + ((seed + i) % 2) }];
    const acc = await timed(samples, 'accept_order', 'accept', () =>
      c.rpc('accept_order', { p_request_key: crypto.randomUUID(), p_location_id: loc, p_lines: lines }),
    );
    const o = acc.data as { order_id: string; version: number; total_cents: number } | null;
    if (!acc.error && o) {
      await timed(samples, 'kitchen_queue', 'query', () =>
        c
          .from('orders')
          .select(
            'order_id, pickup_code, status, version, total_cents, order_lines(line_no, quantity, item_id), tenders(amount_cents)',
          )
          .eq('location_id', loc)
          .in('status', ['accepted', 'preparing', 'ready'])
          .order('accepted_at'),
      );
      let v = o.version;
      if (lines[0]!.item_id.startsWith('FG-')) {
        const s = await timed(samples, 'start_order_preparation', 'write', () =>
          c.rpc('start_order_preparation', {
            p_request_key: crypto.randomUUID(),
            p_order_id: o.order_id,
            p_expected_version: v,
          }),
        );
        v = (s.data as { version: number } | null)?.version ?? v;
      }
      const r = await timed(samples, 'mark_order_ready', 'write', () =>
        c.rpc('mark_order_ready', {
          p_request_key: crypto.randomUUID(),
          p_order_id: o.order_id,
          p_expected_version: v,
        }),
      );
      v = (r.data as { version: number } | null)?.version ?? v;
      await timed(samples, 'record_tender', 'write', () =>
        c.rpc('record_tender', {
          p_request_key: crypto.randomUUID(),
          p_order_id: o.order_id,
          p_amount_cents: o.total_cents,
          p_method: 'cash',
        }),
      );
      await timed(samples, 'complete_order_pickup', 'write', () =>
        c.rpc('complete_order_pickup', {
          p_request_key: crypto.randomUUID(),
          p_order_id: o.order_id,
          p_expected_version: v,
        }),
      );
    }
    if (i % 3 === 0) {
      await timed(samples, 'get_serve_view', 'query', () => c.rpc('get_serve_view', { p_location_id: loc }));
      await timed(samples, 'get_sales_summary_day', 'query', () =>
        c.rpc('get_sales_summary', { p_from: today, p_to: today, p_location_ids: [loc] }),
      );
    }
  }
}

async function managerLoop(c: SupabaseClient, loc: string, iterations: number, samples: Sample[]) {
  const today = (await c.rpc('get_my_context')).data?.business_date as string;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < iterations; i++) {
    await timed(samples, 'get_stock_overview', 'query', () => c.rpc('get_stock_overview', { p_location_id: loc }));
    await timed(samples, 'get_sales_summary_30d', 'query', () =>
      c.rpc('get_sales_summary', { p_from: monthAgo, p_to: today, p_location_ids: [loc] }),
    );
    await timed(samples, 'get_demand_forecast', 'query', () => c.rpc('get_demand_forecast', { p_location_id: loc }));
    await timed(samples, 'get_replenishment_plan', 'query', () =>
      c.rpc('get_replenishment_plan', { p_location_id: loc }),
    );
    await timed(samples, 'get_serve_view', 'query', () => c.rpc('get_serve_view', { p_location_id: loc }));
    await timed(samples, 'get_supplier_invoices', 'query', () =>
      c.rpc('get_supplier_invoices', { p_location_ids: [loc] }),
    );
    await timed(samples, 'get_hours_report', 'query', () =>
      c.rpc('get_hours_report', { p_location_id: loc, p_from: monthAgo, p_to: today }),
    );
  }
}

async function ownerLoop(c: SupabaseClient, iterations: number, samples: Sample[]) {
  const today = (await c.rpc('get_my_context')).data?.business_date as string;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < iterations; i++) {
    await timed(samples, 'get_sales_summary_all_30d', 'query', () =>
      c.rpc('get_sales_summary', { p_from: monthAgo, p_to: today }),
    );
    await timed(samples, 'get_sales_summary_historical_184d', 'query', () =>
      c.rpc('get_sales_summary', { p_from: '2026-05-01', p_to: '2026-10-31', p_source: 'historical' }),
    );
    await timed(samples, 'get_demand_forecast_historical', 'query', () =>
      c.rpc('get_demand_forecast', { p_location_id: pick(LOCATIONS, i), p_source: 'historical' }),
    );
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

export async function runLoad(opts: {
  databaseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  credentialsPath: string;
  iterations: number;
  volumeLines: number;
}) {
  const db = await connect(opts.databaseUrl);
  let volume;
  let counts;
  try {
    await assertDemoTarget(db, opts.databaseUrl, opts.supabaseUrl);
    volume = await ensureVolume(db, opts.volumeLines);
    counts = (
      await db.query(`select (select count(*) from public.order_lines)::int operational_order_lines,
                             (select count(*) from public.orders)::int operational_orders,
                             (select count(*) from public.historical_sales_lines)::int historical_lines,
                             (select count(*) from public.inventory_movements)::int movements`)
    ).rows[0];
  } finally {
    await db.end();
  }

  const users = credentials(opts.credentialsPath);
  if (users.length < 10) throw new Error(`expected 10 demo users in ${opts.credentialsPath}, found ${users.length}`);
  const sessions: Array<{ user: (typeof users)[number]; client: SupabaseClient }> = [];
  for (const user of users) {
    for (let k = 0; k < 2; k++) {
      const client = createClient(opts.supabaseUrl, opts.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw new Error(`sign-in failed for ${user.employeeId}: ${error.message}`);
      sessions.push({ user, client });
    }
  }

  const samples: Sample[] = [];
  const started = performance.now();
  await Promise.all(
    sessions.map(({ user, client }, idx) => {
      const loc = LOCATIONS.find((l) => user.employeeId.includes(l));
      if (user.employeeId === 'DEMO-OWNER') return ownerLoop(client, opts.iterations, samples);
      if (user.employeeId.includes('-MAN-')) return managerLoop(client, loc!, opts.iterations, samples);
      return employeeLoop(client, loc!, opts.iterations, idx * 5, samples);
    }),
  );
  const wallSeconds = (performance.now() - started) / 1000;

  const db2 = await connect(opts.databaseUrl);
  let invariants;
  try {
    invariants = (
      await db2.query(`select
        (select count(*) from public.stock_balances where on_hand < 0 or reserved < 0 or reserved > on_hand)::int bad_balances,
        (select count(*) from (select b.lot_id, b.condition, b.on_hand,
                                      (select coalesce(sum(m.quantity), 0) from public.inventory_movements m
                                        where m.lot_id = b.lot_id and m.condition = b.condition) mv
                                 from public.stock_balances b) x where x.on_hand <> x.mv)::int balances_not_matching_ledger,
        (select count(*) from public.orders o where o.status = 'completed' and o.provenance <> 'synthetic_perf_volume'
           and o.total_cents > coalesce((select sum(t.amount_cents) from public.tenders t where t.order_id = o.order_id), 0))::int completed_with_balance_due,
        (select count(*) from (select location_id, business_date, pickup_code from public.orders
           group by 1, 2, 3 having count(*) > 1) d)::int duplicate_pickup_codes,
        (select count(*) from public.reservation_allocations a join public.orders o using (order_id)
          where a.status = 'active' and o.status in ('completed', 'cancelled'))::int leaked_reservations`)
    ).rows[0];
  } finally {
    await db2.end();
  }

  const ops = [...new Set(samples.map((s) => s.op))].sort();
  const table = ops.map((op) => {
    const s = samples.filter((x) => x.op === op);
    const ms = s.map((x) => x.ms);
    return {
      op,
      kind: s[0]!.kind,
      calls: s.length,
      ok: s.filter((x) => x.outcome === 'ok').length,
      business_refusals: s.filter((x) => x.outcome === 'business_refusal').length,
      errors: s.filter((x) => x.outcome === 'error').length,
      error_codes: [...new Set(s.filter((x) => x.outcome === 'error').map((x) => x.code))],
      p50_ms: Math.round(percentile(ms, 50)!),
      p95_ms: Math.round(percentile(ms, 95)!),
      max_ms: Math.round(Math.max(...ms)),
    };
  });
  const queryMs = samples.filter((s) => s.kind === 'query').map((s) => s.ms);
  const acceptMs = samples.filter((s) => s.kind === 'accept').map((s) => s.ms);
  const queryWithin2s = queryMs.filter((m) => m <= 2000).length / queryMs.length;
  const acceptP95 = percentile(acceptMs, 95)!;
  const report = {
    measured_at: new Date().toISOString(),
    environment: 'local Supabase stack (Docker) on the build machine; API over HTTP to localhost; not a hosted project',
    sessions: sessions.length,
    iterations_per_session: opts.iterations,
    wall_seconds: Math.round(wallSeconds * 10) / 10,
    volume,
    data_volume: counts,
    targets: { screen_queries: '95% within 2,000 ms', order_acceptance: 'within 3,000 ms (p95 checked)' },
    results: {
      screen_query_calls: queryMs.length,
      screen_queries_within_2s_pct: Math.round(queryWithin2s * 1000) / 10,
      screen_query_p95_ms: Math.round(percentile(queryMs, 95)!),
      order_acceptance_calls: acceptMs.length,
      order_acceptance_p95_ms: Math.round(acceptP95),
      order_acceptance_max_ms: Math.round(Math.max(...acceptMs)),
      unexpected_errors: samples.filter((s) => s.outcome === 'error').length,
      pass: queryWithin2s >= 0.95 && acceptP95 <= 3000 && samples.every((s) => s.outcome !== 'error'),
    },
    invariants,
    operations: table,
  };
  return report;
}

function markdown(r: Awaited<ReturnType<typeof runLoad>>) {
  const lines = [
    '# AC33 performance measurement (generated)',
    '',
    `Measured ${r.measured_at} by \`scripts/perf/load-test.ts\`. Environment: ${r.environment}.`,
    '',
    `- Sessions: **${r.sessions}** concurrent (10 demo role users × 2), ${r.iterations_per_session} scenario iterations each, ${r.wall_seconds} s wall time.`,
    `- Data volume: ${r.data_volume.operational_order_lines.toLocaleString('en-US')} operational order lines (${r.data_volume.operational_orders.toLocaleString('en-US')} orders) plus ${r.data_volume.historical_lines.toLocaleString('en-US')} demo history lines; ${r.data_volume.movements.toLocaleString('en-US')} stock movements at the start of the run.`,
    `- Screen queries: ${r.results.screen_query_calls} calls, **${r.results.screen_queries_within_2s_pct}% within 2 s** (target 95%), p95 ${r.results.screen_query_p95_ms} ms.`,
    `- Order acceptance: ${r.results.order_acceptance_calls} calls, **p95 ${r.results.order_acceptance_p95_ms} ms**, max ${r.results.order_acceptance_max_ms} ms (target 3,000 ms).`,
    `- Unexpected errors: ${r.results.unexpected_errors}. Business refusals (for example \`insufficient_stock\` when a dish runs out) are expected outcomes and are counted separately.`,
    `- Result: **${r.results.pass ? 'targets met' : 'targets NOT met'}** in this environment.`,
    '',
    '## Invariants after the run',
    '',
    '| Check | Count (must be 0) |',
    '|---|---|',
    ...Object.entries(r.invariants).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Per operation',
    '',
    '| Operation | Kind | Calls | OK | Business refusals | Errors | p50 ms | p95 ms | max ms |',
    '|---|---|---|---|---|---|---|---|---|',
    ...r.operations.map(
      (o) =>
        `| ${o.op} | ${o.kind} | ${o.calls} | ${o.ok} | ${o.business_refusals} | ${o.errors} | ${o.p50_ms} | ${o.p95_ms} | ${o.max_ms} |`,
    ),
    '',
    'These are measurements on a local machine, not claims about a hosted Supabase project. Repeat the run against the hosted demo project before go-live (operator action).',
    '',
  ];
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  await runCli('perf-load-test', async () => {
    const report = await runLoad({
      databaseUrl: requireEnv('DATABASE_URL'),
      supabaseUrl: requireEnv('SUPABASE_URL'),
      anonKey: requireEnv('SUPABASE_ANON_KEY'),
      credentialsPath: requireEnv('DEMO_CREDENTIALS_PATH'),
      iterations: Number(process.env.PERF_ITERATIONS ?? 12),
      volumeLines: Number(process.env.PERF_VOLUME_LINES ?? 50000),
    });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}perf-AC33.json`, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(`${OUT_DIR}perf-AC33.md`, markdown(report));
    return report.results;
  });
}

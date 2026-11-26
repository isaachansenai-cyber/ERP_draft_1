// 20 concurrent website visitors against the ERP (website W5; PRD §15 targets).
// DEMO DATABASES ONLY: it places real (demo) web orders.
//
// Usage (local stack):
//   DATABASE_URL=... SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... \
//   DEMO_PROJECT_REF_ALLOWLIST=local npx tsx scripts/perf/web-load-test.ts
//
// Each visitor uses the public anon key (no sign-in) and repeats what a customer
// does: list locations, read the menu, read pickup slots, place an order. It
// reports p50/p95/max per operation against the targets (95% of reads ≤ 2 s;
// placement p95 ≤ 3 s), then checks invariants in the database, and writes
// docs/acceptance/evidence/perf-web.{json,md}.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertDemoTarget, connect, isMain, requireEnv, runCli } from '../lib/target.ts';

const LOCATIONS = ['LOC-PRO', 'LOC-SFO', 'LOC-SLC'] as const;
const ITEMS = ['FG-001', 'FG-003', 'FG-005', 'RET-001', 'RET-002'];
const OUT_DIR = fileURLToPath(new URL('../../docs/acceptance/evidence/', import.meta.url));
const READ_TARGET_MS = 2000;
const PLACE_TARGET_MS = 3000;

type Kind = 'read' | 'place';
interface Sample {
  op: string;
  kind: Kind;
  ms: number;
  outcome: 'ok' | 'business_refusal' | 'error';
  code?: string;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

async function timed<T>(
  samples: Sample[],
  op: string,
  kind: Kind,
  run: () => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>,
): Promise<T | null> {
  const start = performance.now();
  const { data, error } = await run();
  const ms = performance.now() - start;
  if (!error) {
    samples.push({ op, kind, ms, outcome: 'ok' });
    return data as T;
  }
  samples.push({ op, kind, ms, outcome: error.code === 'P0001' ? 'business_refusal' : 'error', code: error.message });
  return null;
}

async function visitor(client: SupabaseClient, n: number, iterations: number, samples: Sample[]) {
  for (let i = 0; i < iterations; i++) {
    const location = LOCATIONS[(n + i) % LOCATIONS.length]!;
    const item = ITEMS[(n * 7 + i) % ITEMS.length]!;
    await timed(samples, 'web_get_locations', 'read', () => client.rpc('web_get_locations'));
    await timed(samples, 'web_get_menu', 'read', () => client.rpc('web_get_menu', { p_location_id: location }));
    const slots = await timed<{ slots: Array<{ pickup_at: string; available: boolean }> }>(
      samples,
      'web_get_pickup_slots',
      'read',
      () => client.rpc('web_get_pickup_slots', { p_location_id: location, p_lines: [{ item_id: item, quantity: 1 }] }),
    );
    const open = (slots?.slots ?? []).filter((s) => s.available);
    if (open.length === 0) continue;
    // Spread visitors over the first open times, as real customers would.
    const slot = open[(n + i) % Math.min(open.length, 12)]!;
    await timed(samples, 'web_place_order', 'place', () =>
      client.rpc('web_place_order', {
        p_request_key: randomUUID(),
        p_location_id: location,
        p_lines: [{ item_id: item, quantity: 1 }],
        p_contact: {
          name: `Load ${n}-${i}`,
          phone: `801-555-${String(1000 + n * 50 + i).padStart(4, '0')}`,
          email: `load${n}.${i}@example.com`,
        },
        p_pickup_at: slot.pickup_at,
        p_note: null,
      }),
    );
  }
}

export async function runWebLoad(opts: {
  databaseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  visitors?: number;
  iterations?: number;
}) {
  const db = await connect(opts.databaseUrl);
  try {
    await assertDemoTarget(db, opts.databaseUrl, opts.supabaseUrl);
    const visitors = opts.visitors ?? 20;
    const iterations = opts.iterations ?? 6;
    const samples: Sample[] = [];
    const clients = Array.from({ length: visitors }, () =>
      createClient(opts.supabaseUrl, opts.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    const started = performance.now();
    await Promise.all(clients.map((c, n) => visitor(c, n, iterations, samples)));
    const wallMs = performance.now() - started;

    const { rows: invariants } = await db.query<{ check: string; n: number }>(`
      select 'slots_over_capacity' as check, count(*)::int n from (
        select o.location_id, o.requested_pickup_at, count(*) c, max(w.orders_per_slot) cap
        from public.orders o join public.web_ordering_settings w using (location_id)
        where o.channel = 'web' and o.status <> 'cancelled'
        group by o.location_id, o.requested_pickup_at having count(*) > max(w.orders_per_slot)) x
      union all
      select 'web_orders_without_contact', count(*)::int from public.orders o
        where o.channel = 'web' and not exists (select 1 from public.web_order_contacts c where c.order_id = o.order_id)
      union all
      select 'demo_web_orders_not_fully_paid', count(*)::int from public.orders o
        where o.channel = 'web' and o.tender_mode = 'SIMULATED' and o.status <> 'cancelled'
          and o.total_cents <> coalesce((select sum(t.amount_cents) from public.tenders t where t.order_id = o.order_id), 0)
      union all
      select 'reservations_above_on_hand', count(*)::int from public.stock_balances b where b.reserved > b.on_hand
      union all
      select 'duplicate_pickup_codes', count(*)::int from (
        select location_id, business_date, pickup_code from public.orders group by 1, 2, 3 having count(*) > 1) d`);

    const ops = [...new Set(samples.map((s) => s.op))].sort();
    const perOp = ops.map((op) => {
      const xs = samples.filter((s) => s.op === op);
      const ms = xs.map((s) => s.ms);
      return {
        op,
        kind: xs[0]!.kind,
        calls: xs.length,
        ok: xs.filter((s) => s.outcome === 'ok').length,
        business_refusals: xs.filter((s) => s.outcome === 'business_refusal').length,
        errors: xs.filter((s) => s.outcome === 'error').length,
        p50_ms: Math.round(percentile(ms, 50)),
        p95_ms: Math.round(percentile(ms, 95)),
        max_ms: Math.round(Math.max(...ms)),
      };
    });
    const reads = samples.filter((s) => s.kind === 'read');
    const places = samples.filter((s) => s.kind === 'place');
    const readsWithin = reads.filter((s) => s.ms <= READ_TARGET_MS).length / Math.max(1, reads.length);
    const placeP95 = percentile(
      places.map((s) => s.ms),
      95,
    );
    const errors = samples.filter((s) => s.outcome === 'error');
    const refusals = samples.filter((s) => s.outcome === 'business_refusal');
    const met =
      readsWithin >= 0.95 && placeP95 <= PLACE_TARGET_MS && errors.length === 0 && invariants.every((r) => r.n === 0);

    const report = {
      measured_at: new Date().toISOString(),
      environment: 'local Supabase stack (Docker); API over HTTP to localhost; not a hosted project',
      visitors,
      iterations,
      wall_ms: Math.round(wallMs),
      reads: {
        calls: reads.length,
        within_2s: readsWithin,
        p95_ms: Math.round(
          percentile(
            reads.map((s) => s.ms),
            95,
          ),
        ),
      },
      placements: {
        calls: places.length,
        ok: places.filter((s) => s.outcome === 'ok').length,
        p95_ms: Math.round(placeP95),
      },
      refusal_codes: Object.fromEntries(
        [...new Set(refusals.map((s) => s.code!))].map((c) => [c, refusals.filter((s) => s.code === c).length]),
      ),
      unexpected_errors: errors.map((e) => `${e.op}: ${e.code}`),
      invariants: Object.fromEntries(invariants.map((r) => [r.check, r.n])),
      per_operation: perOp,
      targets_met: met,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}perf-web.json`, JSON.stringify(report, null, 2) + '\n');
    const md = [
      '# Website load measurement (generated)',
      '',
      `Measured ${report.measured_at} by \`scripts/perf/web-load-test.ts\`. Environment: ${report.environment}.`,
      '',
      `- Visitors: **${visitors}** concurrent, anon key, no sign-in; ${iterations} customer journeys each (locations, menu, pickup slots, place order), ${(wallMs / 1000).toFixed(1)} s wall time.`,
      `- Reads: ${reads.length} calls, **${(readsWithin * 100).toFixed(1)}% within 2 s** (target 95%), p95 ${report.reads.p95_ms} ms.`,
      `- Order placements: ${places.length} calls (${report.placements.ok} placed), **p95 ${report.placements.p95_ms} ms** (target 3,000 ms).`,
      `- Business refusals (expected, e.g. a slot filling up or a dish running out): ${refusals.length} ${
        refusals.length
          ? `(${Object.entries(report.refusal_codes)
              .map(([c, n]) => `${c} × ${n}`)
              .join(', ')})`
          : ''
      }.`,
      `- Unexpected errors: ${errors.length}.`,
      `- Result: **${met ? 'targets met' : 'targets NOT met'}** in this environment.`,
      '',
      '## Invariants after the run',
      '',
      '| Check | Count (must be 0) |',
      '|---|---|',
      ...invariants.map((r) => `| ${r.check} | ${r.n} |`),
      '',
      '## Per operation',
      '',
      '| Operation | Calls | OK | Business refusals | Errors | p50 ms | p95 ms | max ms |',
      '|---|---|---|---|---|---|---|---|',
      ...perOp.map(
        (o) =>
          `| ${o.op} | ${o.calls} | ${o.ok} | ${o.business_refusals} | ${o.errors} | ${o.p50_ms} | ${o.p95_ms} | ${o.max_ms} |`,
      ),
      '',
    ].join('\n');
    writeFileSync(`${OUT_DIR}perf-web.md`, md);
    return {
      targets_met: met,
      reads: report.reads,
      placements: report.placements,
      invariants: report.invariants,
      unexpected_errors: errors.length,
    };
  } finally {
    await db.end();
  }
}

if (isMain(import.meta.url)) {
  await runCli('web-load-test', () =>
    runWebLoad({
      databaseUrl: requireEnv('DATABASE_URL'),
      supabaseUrl: requireEnv('SUPABASE_URL'),
      anonKey: requireEnv('SUPABASE_ANON_KEY'),
    }),
  );
}

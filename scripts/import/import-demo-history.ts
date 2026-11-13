// Import the synthetic six-month sales history (PRD §16, AC34) into a DEMO
// database as read-only snapshots. Never creates operational orders, stock
// movements, tenders or AP. Idempotent: rows are keyed by (dataset_id, source key).
//
// Usage: DATABASE_URL=... DEMO_PROJECT_REF_ALLOWLIST=... npx tsx scripts/import/import-demo-history.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { assertDemoTarget, connect, isMain, requireEnv, runCli } from '../lib/target.ts';

const dataFile = (name: string) => fileURLToPath(new URL(`../../data/demo/${name}`, import.meta.url));
export const ORDERS_PATH = dataFile('historical_orders_demo.csv');
export const LINES_PATH = dataFile('historical_order_lines_demo.csv');
export const SUMMARY_PATH = dataFile('seed_summary.json');
export const METHOD_PATH = dataFile('history_method.json');

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  return body.map((r) => {
    if (r.length !== header.length) throw new Error(`CSV row has ${r.length} fields, header has ${header.length}`);
    return Object.fromEntries(header.map((h, idx) => [h, r[idx]]));
  });
}

const ORDER_COLUMNS = [
  'dataset_id',
  'historical_order_id',
  'business_date',
  'created_at_local',
  'timezone',
  'location_id',
  'customer_id',
  'status',
  'net_before_refund_cents',
  'tax_before_refund_cents',
  'refund_net_cents',
  'refund_tax_cents',
  'historical_cogs_cents',
  'payment_mode',
  'provenance',
] as const;
const LINE_COLUMNS = [
  'dataset_id',
  'historical_order_id',
  'line_no',
  'business_date',
  'location_id',
  'customer_id',
  'item_id',
  'quantity_fulfilled',
  'unit_price_cents',
  'discount_cents',
  'net_before_refund_cents',
  'tax_before_refund_cents',
  'refund_net_cents',
  'refund_tax_cents',
  'historical_cogs_cents',
  'payment_mode',
  'provenance',
] as const;
const ORDER_TYPES = [
  'text',
  'text',
  'date',
  'timestamp',
  'text',
  'text',
  'text',
  'text',
  'int8',
  'int8',
  'int8',
  'int8',
  'int8',
  'text',
  'text',
];
const LINE_TYPES = [
  'text',
  'text',
  'int4',
  'date',
  'text',
  'text',
  'text',
  'int4',
  'int8',
  'int8',
  'int8',
  'int8',
  'int8',
  'int8',
  'int8',
  'text',
  'text',
];

function checkHeader(rows: Record<string, string>[], expected: readonly string[], label: string) {
  const actual = Object.keys(rows[0] ?? {});
  if (actual.join(',') !== expected.join(',')) throw new Error(`${label} CSV header mismatch: ${actual.join(',')}`);
}

async function insertBatches(
  client: pg.Client,
  table: string,
  columns: readonly string[],
  types: string[],
  rows: Record<string, string>[],
  batchSize = 2000,
): Promise<number> {
  let inserted = 0;
  const selectList = columns.map((c, i) => `$${i + 1}::${types[i]}[]`).join(', ');
  const sql = `insert into public.${table} (${columns.join(', ')})
               select * from unnest(${selectList})
               on conflict do nothing`;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const params = columns.map((c) => batch.map((r) => (r[c] === '' ? null : r[c])));
    const res = await client.query(sql, params);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export interface HistoryVerification {
  orders: number;
  lines: number;
  days: number;
  location_days: number;
  first_date: string;
  last_date: string;
  order_total_mismatches: number;
  unknown_customers: number;
  unknown_items: number;
  net_sales_cents: number;
}

export async function verifyHistory(client: pg.Client, datasetId: string): Promise<HistoryVerification> {
  const { rows } = await client.query(
    `with o as (select * from public.historical_sales_orders where dataset_id = $1),
          l as (select * from public.historical_sales_lines where dataset_id = $1),
          sums as (
            select l.historical_order_id,
                   sum(net_before_refund_cents) net, sum(tax_before_refund_cents) tax,
                   sum(refund_net_cents) rnet, sum(refund_tax_cents) rtax, sum(historical_cogs_cents) cogs
              from l group by l.historical_order_id)
     select (select count(*) from o)::int as orders,
            (select count(*) from l)::int as lines,
            (select count(distinct business_date) from o)::int as days,
            (select count(*) from (select distinct location_id, business_date from o) x)::int as location_days,
            (select min(business_date)::text from o) as first_date,
            (select max(business_date)::text from o) as last_date,
            (select count(*) from o left join sums s using (historical_order_id)
              where s.historical_order_id is null
                 or (o.net_before_refund_cents, o.tax_before_refund_cents, o.refund_net_cents, o.refund_tax_cents,
                     o.historical_cogs_cents) is distinct from (s.net, s.tax, s.rnet, s.rtax, s.cogs))::int
              as order_total_mismatches,
            (select count(*) from o where customer_id is not null
               and customer_id not in (select customer_id from public.customers))::int as unknown_customers,
            (select count(*) from l where item_id not in (select item_id from public.items where is_sellable))::int
              as unknown_items,
            (select coalesce(sum(net_before_refund_cents - refund_net_cents), 0) from o)::bigint as net_sales_cents`,
    [datasetId],
  );
  const r = rows[0];
  return { ...r, net_sales_cents: Number(r.net_sales_cents) };
}

export async function importDemoHistory(client: pg.Client) {
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  const method = JSON.parse(readFileSync(METHOD_PATH, 'utf8'));
  const { rows: settings } = await client.query<{ data_mode: string; dataset_id: string }>(
    'select data_mode, dataset_id from public.app_settings',
  );
  if (settings[0].data_mode !== 'demo') throw new Error('database is not in demo mode');
  const datasetId = settings[0].dataset_id;

  const orders = parseCsv(readFileSync(ORDERS_PATH, 'utf8'));
  const lines = parseCsv(readFileSync(LINES_PATH, 'utf8'));
  checkHeader(orders, ORDER_COLUMNS, 'orders');
  checkHeader(lines, LINE_COLUMNS, 'lines');
  for (const r of [...orders, ...lines]) {
    if (r.dataset_id !== datasetId) throw new Error(`history row dataset_id ${r.dataset_id} != database ${datasetId}`);
  }

  await client.query('begin');
  try {
    const insertedOrders = await insertBatches(client, 'historical_sales_orders', ORDER_COLUMNS, ORDER_TYPES, orders);
    const insertedLines = await insertBatches(client, 'historical_sales_lines', LINE_COLUMNS, LINE_TYPES, lines);
    const verification = await verifyHistory(client, datasetId);

    const failures: string[] = [];
    const want = (label: string, actual: unknown, expected: unknown) => {
      if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
    };
    want('orders', verification.orders, summary.historical_orders);
    want('lines', verification.lines, summary.historical_lines);
    want('days', verification.days, summary.history_days);
    want('location_days', verification.location_days, method.daily_location_rows);
    want('first_date', verification.first_date, method.date_range[0]);
    want('last_date', verification.last_date, method.date_range[1]);
    want('order_total_mismatches', verification.order_total_mismatches, 0);
    want('unknown_customers', verification.unknown_customers, 0);
    want('unknown_items', verification.unknown_items, 0);
    want('net_sales_cents', verification.net_sales_cents, summary.historical_net_sales_cents);
    if (failures.length) throw new Error(`history verification failed: ${failures.join('; ')}`);

    const changed = insertedOrders + insertedLines > 0;
    if (changed) {
      await client.query(
        `select private.write_audit(null, 'import.demo_history', 'dataset', $1, null, null, null, $2::jsonb,
           'Synthetic history snapshot import (no operational posting)', null, 'operator_tooling')`,
        [datasetId, JSON.stringify({ orders: insertedOrders, lines: insertedLines })],
      );
    }
    await client.query('commit');
    return { dataset_id: datasetId, inserted: { orders: insertedOrders, lines: insertedLines }, changed, verification };
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

if (isMain(import.meta.url)) {
  await runCli('import-demo-history', async () => {
    const databaseUrl = requireEnv('DATABASE_URL');
    const client = await connect(databaseUrl);
    try {
      await assertDemoTarget(client, databaseUrl, process.env.SUPABASE_URL);
      return await importDemoHistory(client);
    } finally {
      await client.end();
    }
  });
}

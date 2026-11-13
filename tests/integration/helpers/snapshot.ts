import type pg from 'pg';

/** Row count + content checksum of every public table (detects any change at all). */
export async function snapshotPublicTables(db: pg.Client, exclude: string[] = []): Promise<Record<string, string>> {
  const { rows: tables } = await db.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    if (exclude.includes(tablename)) continue;
    const { rows } = await db.query<{ n: string; h: string | null }>(
      `select count(*)::text as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from public.${tablename} t`,
    );
    out[tablename] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}

// Keys whose values legitimately differ between two otherwise identical imports
// (timestamps, generated surrogate IDs, auth user IDs).
const VOLATILE = [
  'created_at',
  'updated_at',
  'imported_at',
  'occurred_at',
  'confirmed_at',
  'activated_at',
  'superseded_at',
  'mode_changed_at',
  'posting_enabled_at',
  'recipe_version_id',
  'supplier_item_id',
  'membership_id',
  'gate_id',
  'scope_id',
  'auth_user_id',
  'lot_id',
  'movement_id',
  'movement_no',
  'opening_count_id',
  'source_id',
  'received_at',
  'posted_at',
];

/** Content fingerprint of every public table except the audit log, ignoring volatile keys. */
export async function contentFingerprint(db: pg.Client): Promise<Record<string, string>> {
  const { rows: tables } = await db.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'audit_log' order by tablename`,
  );
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    const { rows } = await db.query<{ n: string; h: string }>(
      `select count(*)::text n, md5(coalesce(string_agg(j, '|' order by j), '')) h
         from (select (to_jsonb(t) - $1::text[])::text j from public.${tablename} t) x`,
      [VOLATILE],
    );
    out[tablename] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';
import type { OpsUserName } from '../setup/ops.global';
import { key, localStack, rpc, signIn, withDb } from '../helpers/stack';

export const stack = localStack();
const clients = new Map<OpsUserName, SupabaseClient>();

export async function as(name: OpsUserName): Promise<SupabaseClient> {
  const cached = clients.get(name);
  if (cached) return cached;
  const u = inject('opsUsers')[name];
  const c = await signIn(stack, u.email, u.password);
  clients.set(name, c);
  return c;
}

export function employeeId(name: OpsUserName): string {
  return inject('opsUsers')[name].employeeId;
}

/** Call an RPC and fail the test unless it succeeds with ok: true. */
export async function ok<T = Record<string, unknown>>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const r = await rpc(client, name, args);
  if (r.code || (r.data && r.data.ok === false)) {
    throw new Error(`${name} failed: ${r.code ?? JSON.stringify(r.data)} ${r.error?.details ?? ''}`);
  }
  return r.data as T;
}

/** Error code of an RPC call: a raised code, or the {ok:false,error} code, or null. */
export async function code(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  const r = await rpc(client, name, args);
  if (r.code) return r.code;
  if (r.data && r.data.ok === false) return r.data.error as string;
  return null;
}

export { key };

export interface Balance {
  on_hand: string;
  reserved: string;
  available: string;
}

/** Balances straight from the database (decimal strings, never floats). */
export async function balance(locationId: string, itemId: string): Promise<Balance> {
  return withDb(stack.dbUrl, async (db) => {
    const { rows } = await db.query(
      `select coalesce(sum(on_hand), 0)::numeric(18,6)::text on_hand, coalesce(sum(reserved), 0)::numeric(18,6)::text reserved,
              private.available_qty($1, $2)::numeric(18,6)::text available
         from public.stock_balances where location_id = $1 and item_id = $2`,
      [locationId, itemId],
    );
    return rows[0];
  });
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return withDb(stack.dbUrl, async (db) => (await db.query(text, params)).rows as T[]);
}

export interface OrderResult {
  order_id: string;
  order_number: string;
  pickup_code: string;
  status: string;
  version: number;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  balance_due_cents: number;
  tender_mode: string;
  replayed?: boolean;
}

/** Accept → start → ready → pay in full → complete. Returns the final result. */
export async function runOrderToCompletion(
  client: SupabaseClient,
  locationId: string,
  lines: Array<{ item_id: string; quantity: number }>,
) {
  let o = await ok<OrderResult>(client, 'accept_order', {
    p_request_key: key(),
    p_location_id: locationId,
    p_lines: lines,
  });
  const hasKitchen = lines.some((l) => l.item_id.startsWith('FG-'));
  if (hasKitchen)
    o = await ok<OrderResult>(client, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
    });
  o = await ok<OrderResult>(client, 'mark_order_ready', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_expected_version: o.version,
  });
  if (o.total_cents > 0) {
    await ok(client, 'record_tender', {
      p_request_key: key(),
      p_order_id: o.order_id,
      p_amount_cents: o.total_cents,
      p_method: 'cash',
    });
  }
  return ok<OrderResult>(client, 'complete_order_pickup', {
    p_request_key: key(),
    p_order_id: o.order_id,
    p_expected_version: o.version,
  });
}

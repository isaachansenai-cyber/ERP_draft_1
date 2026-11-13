import type { Database } from './database.types';
import { supabase } from './supabase';

export type RpcName = keyof Database['public']['Functions'];
export type RpcArgs<N extends RpcName> = Database['public']['Functions'][N]['Args'];

/**
 * How certain we are about the server-side outcome.
 * - rejected: the server answered and nothing was committed (business error,
 *   validation, authorization). Safe to change input and submit again.
 * - uncertain: no definitive answer (network failure, timeout, expired session,
 *   5xx). The write may or may not have committed; check the request key first.
 */
export type Outcome = 'rejected' | 'uncertain';

export class RpcError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | null;
  readonly outcome: Outcome;
  readonly httpStatus: number | null;

  constructor(
    code: string,
    outcome: Outcome,
    detail: Record<string, unknown> | null,
    httpStatus: number | null,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RpcError';
    this.code = code;
    this.outcome = outcome;
    this.detail = detail;
    this.httpStatus = httpStatus;
  }
}

interface RawError {
  code?: string;
  message?: string;
  details?: string | null;
}

function parseDetail(details: string | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return { text: details };
  }
}

/** Classify a PostgREST/supabase-js error into a stable RpcError. Exported for tests. */
export function classifyError(error: RawError, httpStatus: number | null): RpcError {
  const code = error.code ?? '';
  if (code === 'P0001') {
    return new RpcError(error.message ?? 'unknown_error', 'rejected', parseDetail(error.details), httpStatus);
  }
  if (code === '42501') {
    return new RpcError('unauthorized', 'rejected', parseDetail(error.details), httpStatus, error.message);
  }
  if (httpStatus === 401 || code === 'PGRST301' || code === 'PGRST303') {
    return new RpcError('session_expired', 'uncertain', null, httpStatus, error.message);
  }
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && code.startsWith('PGRST')) {
    // Request never reached a function body (bad arguments, unknown function).
    return new RpcError('request_invalid', 'rejected', { postgrest_code: code }, httpStatus, error.message);
  }
  if (code === '23505') return new RpcError('conflict:duplicate', 'rejected', parseDetail(error.details), httpStatus);
  if (code === '40001' || code === '40P01') return new RpcError('conflict:retry', 'rejected', null, httpStatus);
  return new RpcError('network_uncertain', 'uncertain', null, httpStatus, error.message);
}

export async function callRpc<T = unknown, N extends RpcName = RpcName>(
  name: N,
  args: RpcArgs<N>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    // supabase-js' generic typing for rpc() is strict; args are checked by RpcArgs above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase.rpc as any)(name, args).abortSignal(controller.signal);
    if (res.error)
      throw classifyError(res.error as RawError, typeof res.status === 'number' && res.status > 0 ? res.status : null);
    return res.data as T;
  } catch (err) {
    if (err instanceof RpcError) throw err;
    throw new RpcError('network_uncertain', 'uncertain', null, null, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

import { RpcError } from './rpc';

export interface RequestStatus {
  status: 'committed' | 'not_found' | 'in_progress';
  rpc_name?: string;
  result?: unknown;
}

export type CallResult<T> =
  | { kind: 'success'; result: T; replayed: boolean }
  /** Server answered; nothing was committed. */
  | { kind: 'rejected'; error: RpcError }
  /** Outcome was uncertain; the key check proved nothing was committed. Retry with the same key is safe. */
  | { kind: 'not_committed'; error: RpcError }
  /** Outcome still unknown (check failed or request still running). Do not assume either way. */
  | { kind: 'unconfirmed'; error: RpcError };

/**
 * Run a write with a request key. On an uncertain failure (network, timeout,
 * expired session) the key is checked with get_request_result before anything
 * is reported, so the UI never shows success before a confirmed commit and
 * never invites a blind retry of a write that may have succeeded (AC29).
 */
export async function idempotentCall<T>(
  requestKey: string,
  call: (requestKey: string) => Promise<T>,
  check: (requestKey: string) => Promise<RequestStatus>,
): Promise<CallResult<T>> {
  try {
    const result = await call(requestKey);
    const replayed = Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).replayed);
    return { kind: 'success', result, replayed };
  } catch (err) {
    const error =
      err instanceof RpcError ? err : new RpcError('network_uncertain', 'uncertain', null, null, String(err));
    if (error.outcome === 'rejected') return { kind: 'rejected', error };
    return resolveUncertain<T>(requestKey, error, check);
  }
}

export async function resolveUncertain<T>(
  requestKey: string,
  error: RpcError,
  check: (requestKey: string) => Promise<RequestStatus>,
): Promise<CallResult<T>> {
  try {
    const status = await check(requestKey);
    if (status.status === 'committed') return { kind: 'success', result: status.result as T, replayed: true };
    if (status.status === 'not_found') return { kind: 'not_committed', error };
    return { kind: 'unconfirmed', error };
  } catch (checkErr) {
    return { kind: 'unconfirmed', error: checkErr instanceof RpcError ? checkErr : error };
  }
}

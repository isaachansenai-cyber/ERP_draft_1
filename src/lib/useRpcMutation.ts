import { useCallback, useRef, useState } from 'react';
import { idempotentCall, resolveUncertain, type CallResult, type RequestStatus } from './idempotentCall';
import { clearRequestKey, getOrCreateRequestKey, peekRequestKey } from './requestKeys';
import { callRpc, RpcError, type RpcArgs, type RpcName } from './rpc';
import { useOnlineStatus } from './useOnlineStatus';

export type MutationState<T> = { status: 'idle' } | { status: 'submitting' } | { status: 'checking' } | CallResult<T>;

type ArgsWithoutKey<N extends RpcName> = Omit<RpcArgs<N>, 'p_request_key'>;

const checkKey = (requestKey: string) => callRpc<RequestStatus>('get_request_result', { p_request_key: requestKey });

/**
 * Shared write hook (CLAUDE.md §8). One request key per intent, kept until the
 * outcome is known; uncertain outcomes are resolved with get_request_result;
 * retries reuse the same key; success is shown only after the server confirms.
 */
export function useRpcMutation<T = Record<string, unknown>, N extends RpcName = RpcName>(
  rpcName: N,
  intentId: string,
  options: { onSuccess?: (result: T) => void } = {},
) {
  const [state, setState] = useState<MutationState<T>>({ status: 'idle' });
  const lastArgs = useRef<ArgsWithoutKey<N> | null>(null);
  const online = useOnlineStatus();
  const { onSuccess } = options;

  const settle = useCallback(
    (result: CallResult<T>) => {
      if (result.kind === 'success' || result.kind === 'rejected') clearRequestKey(intentId);
      setState(result);
      if (result.kind === 'success') onSuccess?.(result.result);
    },
    [intentId, onSuccess],
  );

  const submit = useCallback(
    async (args: ArgsWithoutKey<N>) => {
      if (!navigator.onLine) {
        setState({ kind: 'rejected', error: new RpcError('network_offline', 'rejected', null, null) });
        return;
      }
      lastArgs.current = args;
      const requestKey = getOrCreateRequestKey(intentId);
      setState({ status: 'submitting' });
      const result = await idempotentCall<T>(
        requestKey,
        (key) => callRpc<T>(rpcName, { ...args, p_request_key: key } as RpcArgs<N>),
        checkKey,
      );
      settle(result);
    },
    [intentId, rpcName, settle],
  );

  /** Retry the last submission with the same request key (only after not_committed/unconfirmed). */
  const retry = useCallback(async () => {
    if (lastArgs.current) await submit(lastArgs.current);
  }, [submit]);

  /** Re-check an unconfirmed outcome without re-submitting. */
  const checkAgain = useCallback(async () => {
    const key = peekRequestKey(intentId);
    if (!key) return;
    setState({ status: 'checking' });
    settle(await resolveUncertain<T>(key, new RpcError('network_uncertain', 'uncertain', null, null), checkKey));
  }, [intentId, settle]);

  const reset = useCallback(() => {
    clearRequestKey(intentId);
    lastArgs.current = null;
    setState({ status: 'idle' });
  }, [intentId]);

  const busy = 'status' in state && (state.status === 'submitting' || state.status === 'checking');
  return { state, submit, retry, checkAgain, reset, busy, canPost: online && !busy };
}

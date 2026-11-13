import { describe, expect, it, vi } from 'vitest';
import { idempotentCall } from '../../src/lib/idempotentCall';
import { RpcError } from '../../src/lib/rpc';

const KEY = '11111111-1111-1111-1111-111111111111';
const uncertain = () => new RpcError('network_uncertain', 'uncertain', null, null);

describe('idempotentCall (AC29 client behavior)', () => {
  it('reports success only from a confirmed server result', async () => {
    const r = await idempotentCall(KEY, async () => ({ ok: true }), vi.fn());
    expect(r).toEqual({ kind: 'success', result: { ok: true }, replayed: false });
  });

  it('passes the same request key to the call', async () => {
    const call = vi.fn(async (k: string) => ({ k }));
    await idempotentCall(KEY, call, vi.fn());
    expect(call).toHaveBeenCalledWith(KEY);
  });

  it('a definite rejection is reported without checking the key', async () => {
    const check = vi.fn();
    const r = await idempotentCall(
      KEY,
      async () => {
        throw new RpcError('validation:reason', 'rejected', null, 400);
      },
      check,
    );
    expect(r.kind).toBe('rejected');
    expect(check).not.toHaveBeenCalled();
  });

  it('an uncertain failure that actually committed is reported as success (no duplicate retry)', async () => {
    const check = vi.fn(async () => ({ status: 'committed' as const, result: { employee_id: 'EMP-0001' } }));
    const r = await idempotentCall(
      KEY,
      async () => {
        throw uncertain();
      },
      check,
    );
    expect(check).toHaveBeenCalledWith(KEY);
    expect(r).toEqual({ kind: 'success', result: { employee_id: 'EMP-0001' }, replayed: true });
  });

  it('an uncertain failure that did not commit is reported as safe to retry', async () => {
    const r = await idempotentCall(
      KEY,
      async () => {
        throw uncertain();
      },
      async () => ({ status: 'not_found' as const }),
    );
    expect(r.kind).toBe('not_committed');
  });

  it('if the check itself fails the outcome stays unknown (never shown as success or failure)', async () => {
    const r = await idempotentCall(
      KEY,
      async () => {
        throw uncertain();
      },
      async () => {
        throw uncertain();
      },
    );
    expect(r.kind).toBe('unconfirmed');
  });

  it('a request still in progress stays unconfirmed', async () => {
    const r = await idempotentCall(
      KEY,
      async () => {
        throw uncertain();
      },
      async () => ({ status: 'in_progress' as const }),
    );
    expect(r.kind).toBe('unconfirmed');
  });
});

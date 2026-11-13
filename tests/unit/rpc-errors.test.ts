import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/lib/errors';
import { classifyError } from '../../src/lib/rpc';

describe('classifyError separates definite rejections from uncertain outcomes', () => {
  it('business errors raised by RPCs are rejected with their stable code and detail', () => {
    const e = classifyError(
      { code: 'P0001', message: 'setup_gate_closed:tax_rate_confirmed', details: '{"gate_key":"tax_rate_confirmed"}' },
      400,
    );
    expect(e.outcome).toBe('rejected');
    expect(e.code).toBe('setup_gate_closed:tax_rate_confirmed');
    expect(e.detail).toEqual({ gate_key: 'tax_rate_confirmed' });
  });

  it('permission denied is a definite rejection', () => {
    expect(classifyError({ code: '42501', message: 'permission denied' }, 403)).toMatchObject({
      code: 'unauthorized',
      outcome: 'rejected',
    });
  });

  it('an expired session is uncertain (the write may have committed before expiry was noticed)', () => {
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' }, 401)).toMatchObject({
      code: 'session_expired',
      outcome: 'uncertain',
    });
  });

  it('network failures and server errors are uncertain', () => {
    expect(classifyError({ message: 'TypeError: Failed to fetch' }, null).outcome).toBe('uncertain');
    expect(classifyError({ code: '', message: 'Bad gateway' }, 502).outcome).toBe('uncertain');
  });

  it('every code maps to a human message', () => {
    expect(describeError('setup_gate_closed:tax_rate_confirmed')).toContain('tax rate confirmed');
    expect(
      describeError('setup_gate_precondition:menu_prices_confirmed', { reason: 'sellable_items_without_price' }),
    ).toContain('sellable items without price');
    expect(describeError('pin_locked')).toContain('15 minutes');
    expect(describeError('something_new')).toContain('something_new');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearRequestKey, getOrCreateRequestKey, peekRequestKey } from '../../src/lib/requestKeys';

describe('request keys persist per intent until resolved', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('returns the same key for the same intent (survives re-render/reload)', () => {
    const a = getOrCreateRequestKey('confirm-gate:1');
    expect(getOrCreateRequestKey('confirm-gate:1')).toBe(a);
    expect(window.sessionStorage.getItem('rpc-intent:confirm-gate:1')).toBe(a);
  });

  it('different intents get different keys; clearing starts a new intent', () => {
    const a = getOrCreateRequestKey('a');
    const b = getOrCreateRequestKey('b');
    expect(a).not.toBe(b);
    clearRequestKey('a');
    expect(peekRequestKey('a')).toBeNull();
    expect(getOrCreateRequestKey('a')).not.toBe(a);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, interpretScan, loadDraft, newDraft, saveDraft, setLineQuantity } from '../../src/lib/draft';
import { describeError } from '../../src/lib/errors';

const menu = [
  { item_id: 'FG-001', is_available: true },
  { item_id: 'RET-001', is_available: false },
];

describe('keyboard-wedge scans (AC28)', () => {
  it('adds sellable items and never ingredients', () => {
    expect(interpretScan('fg-001\n', menu)).toEqual({ kind: 'add', itemId: 'FG-001' });
    expect(interpretScan('ING-001', menu)).toEqual({ kind: 'ingredient', code: 'ING-001' });
    expect(interpretScan('RET-001', menu)).toEqual({ kind: 'unavailable', itemId: 'RET-001' });
    expect(interpretScan('XYZ', menu)).toEqual({ kind: 'unknown', code: 'XYZ' });
  });
});

describe('cart lines', () => {
  it('keeps whole quantities between 1 and 999; 0 removes', () => {
    let lines = setLineQuantity([], 'FG-001', 1);
    lines = setLineQuantity(lines, 'FG-001', 2.7);
    expect(lines).toEqual([{ item_id: 'FG-001', quantity: 2 }]);
    expect(setLineQuantity(lines, 'FG-001', 5000)).toEqual([{ item_id: 'FG-001', quantity: 999 }]);
    expect(setLineQuantity(lines, 'FG-001', 0)).toEqual([]);
  });
});

describe('unsent draft storage', () => {
  beforeEach(() => window.localStorage.clear());
  it('persists per location and is cleared after acceptance', () => {
    const d = { ...newDraft(), lines: [{ item_id: 'FG-001', quantity: 2 }] };
    saveDraft('LOC-PRO', d);
    expect(loadDraft('LOC-PRO')).toEqual(d);
    expect(loadDraft('LOC-SLC').lines).toEqual([]);
    clearDraft('LOC-PRO');
    expect(loadDraft('LOC-PRO').lines).toEqual([]);
  });
});

describe('insufficient stock message names the bottleneck', () => {
  it('lists each short ingredient with its shortfall and unit', () => {
    const msg = describeError('insufficient_stock', {
      shortages: [{ item_id: 'ING-001', name: 'Boneless chicken thighs', shortfall: '740.000000', base_unit: 'g' }],
    });
    expect(msg).toBe('Not enough stock: Boneless chicken thighs short by 740 g. Nothing was reserved.');
  });
});

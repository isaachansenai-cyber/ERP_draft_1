import { describe, expect, it } from 'vitest';
import { allocateDiscount, estimateOrder, lineTax } from '../../src/lib/money';

describe('discount allocation (largest remainder, ties by line order)', () => {
  it('allocates the exact rounded total across lines', () => {
    const lines = [1599, 1399, 1549];
    const d = allocateDiscount(lines, '12.5');
    expect(d.reduce((a, b) => a + b, 0)).toBe(Math.round(4547 * 0.125)); // 568.375 → 568
    expect(d).toEqual([200, 175, 193]);
  });

  it('breaks equal remainders by line order', () => {
    expect(allocateDiscount([100, 100, 100], '1')).toEqual([1, 1, 1]);
    expect(allocateDiscount([100, 100, 100], '0.5')).toEqual([1, 1, 0]); // 1.5 → 2 cents total
  });

  it('handles 0%, 100% and an all-zero order', () => {
    expect(allocateDiscount([500, 700], '0')).toEqual([0, 0]);
    expect(allocateDiscount([500, 700], '100')).toEqual([500, 700]);
    expect(allocateDiscount([0, 0], '50')).toEqual([0, 0]);
  });
});

describe('per-line tax rounds half up', () => {
  it('rounds .5 cents up', () => {
    expect(lineTax(1000, '0.0725')).toBe(73); // 72.5 → 73
    expect(lineTax(1599, '0.0725')).toBe(116); // 115.9275
    expect(lineTax(0, '0.0725')).toBe(0);
  });

  it('estimates an order the same way the server prices it', () => {
    const e = estimateOrder(
      [
        { unitPrice: 1599, quantity: 3 },
        { unitPrice: 1549, quantity: 2 },
      ],
      '',
      '0.0725',
    );
    expect(e).toEqual({ gross: 7895, discount: 0, net: 7895, tax: 348 + 225, total: 7895 + 573 });
  });
});

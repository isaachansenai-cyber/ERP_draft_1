import { describe, expect, it } from 'vitest';
import { formatCents, parseDollarsToCents, percentToRate, rateToPercent } from '../../src/lib/format';

describe('money and rate formatting (no floating point on amounts)', () => {
  it('formats integer cents', () => {
    expect(formatCents(1599)).toBe('$15.99');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-5)).toBe('-$0.05');
    expect(formatCents(30682004)).toBe('$306,820.04');
    expect(formatCents(null)).toBe('—');
  });

  it('parses dollars to cents exactly', () => {
    expect(parseDollarsToCents('15.99')).toBe(1599);
    expect(parseDollarsToCents('$7')).toBe(700);
    expect(parseDollarsToCents('0.1')).toBe(10);
    expect(parseDollarsToCents('1.005')).toBeNull();
    expect(parseDollarsToCents('-1')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
  });

  it('converts percent to an exact decimal rate and back', () => {
    expect(percentToRate('7.25')).toBe('0.0725');
    expect(percentToRate('7.25%')).toBe('0.0725');
    expect(percentToRate('0')).toBe('0');
    expect(percentToRate('6.1')).toBe('0.061');
    expect(percentToRate('100')).toBeNull();
    expect(percentToRate('7.123456')).toBeNull();
    expect(rateToPercent('0.072500')).toBe('7.25%');
    expect(rateToPercent(0.0725)).toBe('7.25%');
  });
});

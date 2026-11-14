import { describe, expect, it } from 'vitest';
import { addBusinessDays, denverLocalToIso, isoToDenverLocal } from '../../src/lib/time';

describe('America/Denver wall-clock entry (form helper)', () => {
  it('converts standard and daylight times', () => {
    expect(denverLocalToIso('2026-07-04T12:00')).toBe('2026-07-04T18:00:00.000Z'); // MDT −6
    expect(denverLocalToIso('2026-12-24T12:00')).toBe('2026-12-24T19:00:00.000Z'); // MST −7
  });

  it('handles the 2026-11-01 fall-back: midnight is MDT, 06:00 is MST, the repeated 01:30 resolves to the first one', () => {
    expect(denverLocalToIso('2026-10-31T22:00')).toBe('2026-11-01T04:00:00.000Z');
    expect(denverLocalToIso('2026-11-01T06:00')).toBe('2026-11-01T13:00:00.000Z');
    expect(denverLocalToIso('2026-11-01T01:30')).toBe('2026-11-01T07:30:00.000Z');
  });

  it('handles the 2027-03-14 spring-forward', () => {
    expect(denverLocalToIso('2027-03-13T22:00')).toBe('2027-03-14T05:00:00.000Z');
    expect(denverLocalToIso('2027-03-14T06:00')).toBe('2027-03-14T12:00:00.000Z');
  });

  it('round-trips and rejects malformed input', () => {
    expect(isoToDenverLocal('2026-11-01T13:00:00Z')).toBe('2026-11-01T06:00');
    expect(isoToDenverLocal(denverLocalToIso('2026-03-01T09:15')!)).toBe('2026-03-01T09:15');
    expect(denverLocalToIso('2026-03-01 09:15')).toBeNull();
    expect(addBusinessDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

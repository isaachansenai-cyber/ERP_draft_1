import { describe, expect, it } from 'vitest';
import { navFor } from '../../src/lib/nav';
import { chartGeometry, type StockHistoryDay } from '../../src/lib/stockChart';

const day = (date: string, on_hand: string, used = '0', wasted = '0', received = '0'): StockHistoryDay => ({
  date,
  on_hand,
  used,
  wasted,
  received,
});

describe('stock history chart geometry (display only)', () => {
  const series = [
    day('2026-11-16', '1000.000000'),
    day('2026-11-17', '1300.000000', '200.000000', '0', '500.000000'),
    day('2026-11-18', '1250.000000', '0', '50.000000'),
  ];

  it('places the reorder line on the same scale as the on-hand line', () => {
    const g = chartGeometry(series, '1100.000000');
    expect(g.rop).toBe(1100);
    // 1100 lies between the 1000 and 1250 points, so its y is between theirs.
    expect(g.yLine(1100)).toBeLessThan(g.yLine(1000));
    expect(g.yLine(1100)).toBeGreaterThan(g.yLine(1300));
    expect(g.lineMax).toBeCloseTo(1300 * 1.1);
  });

  it('keeps a reorder point above all stock inside the chart', () => {
    const g = chartGeometry(series, '5000');
    expect(g.lineMax).toBeCloseTo(5500);
    expect(g.yLine(5000)).toBeGreaterThan(0);
  });

  it('scales bars to the largest day of usage plus waste, or deliveries', () => {
    const g = chartGeometry(series, null);
    expect(g.rop).toBeNull();
    expect(g.barMax).toBe(500);
    expect(g.barHeight(500)).toBeCloseTo(64);
    expect(g.barHeight(-5)).toBe(0);
  });

  it('draws one point per day, left to right', () => {
    const g = chartGeometry(series, null);
    expect(g.path.split(' ')).toHaveLength(3);
    expect(g.x(0)).toBeLessThan(g.x(1));
    expect(g.x(1)).toBeLessThan(g.x(2));
  });

  it('an empty or all-zero history still has a usable scale', () => {
    const g = chartGeometry([day('2026-11-18', '0')], null);
    expect(g.lineMax).toBeGreaterThan(0);
    expect(g.barMax).toBe(1);
  });
});

describe('navigation by role (ADR 0033)', () => {
  const labels = (role: string) => navFor(role).map((n) => n.label);

  it('employees see only the screens their job needs', () => {
    expect(labels('employee')).toEqual([
      'Overview',
      'POS',
      'Kitchen',
      'Waste reports',
      'Refunds & returns',
      'What can we serve',
      'Staff time',
    ]);
    expect(navFor('employee').find((n) => n.label === 'Waste reports')?.to).toBe('/inventory/waste');
  });

  it('managers and the owner keep every screen', () => {
    for (const role of ['manager', 'owner']) {
      expect(labels(role)).toContain('Dashboard');
      expect(labels(role)).toContain('Inventory');
      expect(labels(role)).toContain('Labels');
      expect(labels(role)).toContain('Settings & setup');
      expect(labels(role)).not.toContain('Waste reports');
    }
  });
});

import Decimal from 'decimal.js';

// Display-only mirror of the server's order money rules (CLAUDE.md §5.5). The
// server recomputes everything on acceptance; these numbers are an estimate
// shown on the unsent draft and must match the server for the same inputs.

/** Order-wide discount in cents, allocated by largest remainder (ties by line order). */
export function allocateDiscount(lineGross: number[], percent: string | number): number[] {
  const total = lineGross.reduce((a, b) => a + b, 0);
  const pct = new Decimal(percent || 0);
  if (total === 0 || pct.lte(0)) return lineGross.map(() => 0);
  const discTotal = new Decimal(total).mul(pct).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const exact = lineGross.map((g) => new Decimal(discTotal).mul(g).div(total));
  const floors = exact.map((e) => e.floor().toNumber());
  let leftover = discTotal - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e.minus(e.floor()) }))
    .sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (leftover <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    leftover -= 1;
  }
  return out;
}

/** Per-line tax, rounded half up to cents. */
export function lineTax(netCents: number, rate: string | number): number {
  return new Decimal(netCents).mul(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export interface OrderEstimate {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

export function estimateOrder(
  lines: Array<{ unitPrice: number; quantity: number }>,
  percent: string,
  rate: string | null,
): OrderEstimate {
  const gross = lines.map((l) => l.unitPrice * l.quantity);
  const disc = allocateDiscount(gross, percent);
  const net = gross.map((g, i) => g - (disc[i] ?? 0));
  const tax = rate === null ? 0 : net.reduce((sum, n) => sum + lineTax(n, rate), 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return { gross: sum(gross), discount: sum(disc), net: sum(net), tax, total: sum(net) + tax };
}

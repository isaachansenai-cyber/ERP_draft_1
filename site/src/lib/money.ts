import Decimal from 'decimal.js';

/** Whole cents to "$12.34", using integer arithmetic only. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export interface OrderEstimate {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Display-only mirror of the ERP's order money rules (CLAUDE.md §5.5) for an
 * order with no discount: tax is rounded half up per line, then summed. The
 * ERP computes and snapshots the real total when it accepts the order.
 */
export function estimateOrder(lines: Array<{ unitCents: number; quantity: number }>, taxRate: string): OrderEstimate {
  const rate = new Decimal(taxRate);
  let subtotalCents = 0;
  let taxCents = 0;
  for (const l of lines) {
    const net = l.unitCents * l.quantity;
    subtotalCents += net;
    taxCents += new Decimal(net).mul(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** "7.25%" from the ERP's exact rate text "0.072500". */
export function formatRate(taxRate: string): string {
  return `${new Decimal(taxRate).mul(100).toDecimalPlaces(3).toString()}%`;
}

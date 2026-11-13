import Decimal from 'decimal.js';

// Display helpers. Business time zone is America/Denver (PRD §11, §12).

export const BUSINESS_TZ = 'America/Denver';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d);
}

/** Integer cents → "$12.34" without floating-point arithmetic on the amount. */
export function formatCents(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const n = BigInt(cents);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${rest}`;
}

/** "12.34" → 1234 cents, or null if not a valid non-negative amount with ≤ 2 decimals. */
export function parseDollarsToCents(input: string): number | null {
  const m = input
    .trim()
    .replace(/^\$/, '')
    .match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Percent string "7.25" → decimal fraction string "0.0725" (exact; null if invalid). */
export function percentToRate(input: string): string | null {
  const trimmed = input.trim().replace(/%$/, '');
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(trimmed)) return null;
  return new Decimal(trimmed).div(100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** Decimal fraction "0.0725" → "7.25%". */
export function rateToPercent(rate: string | number): string {
  return `${new Decimal(String(rate)).mul(100).toFixed()}%`;
}

// America/Denver wall-clock helpers for forms (display/entry only; the server
// stores UTC and validates every timestamp).
import { BUSINESS_TZ } from './format';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Wall-clock fields of an instant in America/Denver. */
function denverFields(ms: number) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset (ms) of Denver from UTC at an instant: local wall clock − UTC. */
function offsetAt(ms: number): number {
  const f = denverFields(ms);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * "2026-11-01T01:30" (Denver wall clock, as from <input type="datetime-local">)
 * → ISO UTC instant. An ambiguous fall-back time resolves to the first (MDT)
 * occurrence; a skipped spring-forward time moves forward by the gap.
 * Returns null for malformed input.
 */
export function denverLocalToIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Try the offsets in effect a day either side; prefer the earlier valid instant.
  const candidates = [offsetAt(wall - 86_400_000), offsetAt(wall + 86_400_000)]
    .map((off) => wall - off)
    .filter((ms) => wall - offsetAt(ms) === ms)
    .sort((a, b) => a - b);
  const ms = candidates[0] ?? wall - offsetAt(wall - 86_400_000);
  return new Date(ms).toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" Denver wall clock for a datetime-local input. */
export function isoToDenverLocal(iso: string): string {
  const f = denverFields(new Date(iso).getTime());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

/** Local business date (YYYY-MM-DD) n days after a business date. */
export function addBusinessDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

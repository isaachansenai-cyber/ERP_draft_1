import { BUSINESS_TZ } from './format';

// Kitchen view of a website order (BUILD_PLAN §5.3). Display only: the pickup
// time and cook minutes come from the ERP; nothing here changes the order.

export interface ScheduleLine {
  quantity: number;
  prep_minutes: number | null;
  prep_lead_days: number | null;
}

export interface KitchenSchedule {
  /** The customer's requested pickup time (web orders only). */
  pickupAt: string | null;
  /** Latest time to start cooking: pickup minus the longest cook time. */
  startBy: string | null;
  /** A dish needs overnight work (marinade, braise) before the pickup day. */
  prepAhead: boolean;
  /** The pickup is on a later business day than today. */
  laterDay: boolean;
}

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function kitchenSchedule(
  order: { channel: 'pos' | 'web'; requested_pickup_at: string | null },
  lines: ScheduleLine[],
  now: Date = new Date(),
): KitchenSchedule {
  const prepAhead = lines.some((l) => (l.prep_lead_days ?? 0) > 0);
  if (order.channel !== 'web' || !order.requested_pickup_at) {
    return { pickupAt: null, startBy: null, prepAhead, laterDay: false };
  }
  const pickup = new Date(order.requested_pickup_at);
  const minutes = Math.max(0, ...lines.map((l) => l.prep_minutes ?? 0));
  return {
    pickupAt: order.requested_pickup_at,
    startBy: new Date(pickup.getTime() - minutes * 60_000).toISOString(),
    prepAhead,
    laterDay: dayKey.format(pickup) > dayKey.format(now),
  };
}

const time = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, hour: 'numeric', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "2:00 PM" today, or "Thu, Nov 27, 2:00 PM" on another day. */
export function formatKitchenTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return dayKey.format(d) === dayKey.format(now) ? time.format(d) : dayTime.format(d);
}

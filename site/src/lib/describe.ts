import type { MenuItem, WebLocation } from './webApi';

// Customer-facing wording for values the ERP returns as codes or numbers.

/** Why a location is not taking web orders, in plain words. */
export function closedMessage(reason: string | null): string {
  switch (reason) {
    case 'paused':
      return 'Online ordering is paused at this location right now. Please visit or call us.';
    case 'unknown_location':
      return 'We could not find this location.';
    default:
      return "Online ordering isn't open at this location yet. Please visit us in person.";
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` + suffix : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** "Open daily 12pm–8pm", or one entry per weekday when the hours differ. */
export function hoursSummary(location: WebLocation): string {
  if (location.hours.length === 0) return 'Hours not published yet';
  const first = location.hours[0]!;
  const sameAll =
    location.hours.length === 7 &&
    location.hours.every((h) => h.opens_at === first.opens_at && h.closes_at === first.closes_at);
  if (sameAll) return `Open daily ${clock(first.opens_at)}–${clock(first.closes_at)}`;
  return location.hours.map((h) => `${WEEKDAYS[h.weekday - 1]} ${clock(h.opens_at)}–${clock(h.closes_at)}`).join(', ');
}

/** How long a dish takes, from the ERP's lead days and cook minutes. */
export function prepNote(item: MenuItem): string | null {
  if (item.item_type === 'retail') return null;
  if ((item.prep_lead_days ?? 0) > 0) return 'Prepared a day ahead: order by the day before.';
  const minutes = item.prep_minutes;
  if (minutes === null) return null;
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `Cooked fresh the same day: about ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}.`;
  }
  return `Ready in about ${minutes} minutes.`;
}

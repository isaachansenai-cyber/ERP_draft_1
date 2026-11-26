// Pickup times are shown in the restaurants' time zone, whatever the visitor's
// device is set to (CLAUDE.md §8).
const TZ = 'America/Denver';

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

/** Local calendar date "YYYY-MM-DD" in Denver. */
export const localDayKey = (iso: string | Date) => dayKeyFormat.format(new Date(iso));

/** "Thursday, November 26" */
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));

/** "12:15 PM" */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

/** "Thursday, November 26 at 12:15 PM" */
export const formatPickup = (iso: string) => `${formatDay(iso)} at ${formatTime(iso)}`;

/** Group slot times by local day, keeping their order. */
export function groupByDay<T extends { pickup_at: string }>(slots: T[]): Array<{ day: string; slots: T[] }> {
  const groups: Array<{ day: string; slots: T[] }> = [];
  for (const s of slots) {
    const day = localDayKey(s.pickup_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.slots.push(s);
    else groups.push({ day, slots: [s] });
  }
  return groups;
}

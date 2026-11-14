# 0027 Clocking, breaks and corrections

- Clock-in, clock-out and breaks take no time or employee parameter: the server uses `now()` and the signed-in employee. A clock action locks the employee row, so concurrent clock-ins serialize; a partial unique index and an exclusion constraint back this up.
- An entry is linked to a published shift at the same location that is in progress or starts within the next hour; otherwise it is flagged `unscheduled` (kept, never discarded).
- Breaks are explicit unpaid intervals started and ended by the employee (one open break at a time). Clock-out closes any open break. There is no automatic deduction.
- Manager corrections may set past timestamps only, keep clock-out after clock-in, keep breaks inside the entry, and cannot reopen a closed entry. They replace the entry's breaks, and an immutable `time_corrections` row keeps the original and new times and breaks with the reason.
- Managers cannot correct their own time; another manager at the location or the owner does. Open entries stay open as listed exceptions; nothing auto-clocks out.
- Hours = elapsed UTC time − recorded breaks, split at America/Denver midnight (DST-aware). The hours report spans at most 62 days.

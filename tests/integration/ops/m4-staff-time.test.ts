// AC25 clock integrity, AC26 schedules and corrections, AC27 timezone, through
// the real API in a pilot database.
import { describe, expect, it } from 'vitest';
import { as, code, employeeId, key, ok, sql, stack } from './helpers';
import { inject } from 'vitest';
import { rpc, signIn } from '../helpers/stack';

const PRO = 'LOC-PRO';
const SLC = 'LOC-SLC';

interface Entry {
  time_entry_id: string;
  version: number;
  clock_in_at: string;
  clock_out_at: string | null;
  unscheduled: boolean;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function clockedEntry(name: 'slcEmployee' | 'slcEmployee2' | 'proEmployee', loc: string) {
  const c = await as(name);
  const e = await ok<Entry>(c, 'clock_in', { p_request_key: key(), p_location_id: loc });
  return ok<Entry>(c, 'clock_out', { p_request_key: key() }).then((r) => ({ ...r, time_entry_id: e.time_entry_id }));
}

describe('AC25 clock integrity', () => {
  it('two simultaneous clock-ins by the same employee create exactly one open entry', async () => {
    const u = inject('opsUsers').slcEmployee2;
    const [a, b] = await Promise.all([signIn(stack, u.email, u.password), signIn(stack, u.email, u.password)]);
    const results = await Promise.all([
      rpc(a, 'clock_in', { p_request_key: key(), p_location_id: SLC }),
      rpc(b, 'clock_in', { p_request_key: key(), p_location_id: SLC }),
    ]);
    const codes = results.map((r) => r.code).sort();
    expect(codes).toEqual([null, 'conflict:open_time_entry'].sort());
    const [open] = await sql<{ n: number }>(
      `select count(*)::int n from public.time_entries where employee_id = $1 and clock_out_at is null`,
      [u.employeeId],
    );
    expect(open!.n).toBe(1);
    await ok(a, 'clock_out', { p_request_key: key() });
  });

  it('employees clock only themselves, only where assigned, and cannot alter timestamps', async () => {
    const e = await as('proEmployee');
    expect(await code(e, 'clock_in', { p_request_key: key(), p_location_id: SLC })).toBe('unauthorized');
    // There is no parameter to clock someone else in; supplying one is rejected by the API.
    const other = await rpc(e, 'clock_in', {
      p_request_key: key(),
      p_location_id: PRO,
      p_employee_id: employeeId('slcEmployee'),
    });
    expect(other.code).toMatch(/PGRST|function/);
    const entry = await ok<Entry>(e, 'clock_in', { p_request_key: key(), p_location_id: PRO });
    expect(entry.unscheduled).toBe(true); // no shift: flagged, not discarded
    const upd = await e
      .from('time_entries')
      .update({ clock_in_at: '2026-01-01T00:00:00Z' })
      .eq('time_entry_id', entry.time_entry_id);
    expect(upd.error).not.toBeNull();
    expect(
      await code(e, 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: entry.time_entry_id,
        p_expected_version: entry.version,
        p_clock_in_at: hoursFromNow(-3),
        p_clock_out_at: null,
        p_reason: 'I forgot to clock in',
      }),
    ).toBe('unauthorized');
    expect(await code(e, 'clock_in', { p_request_key: key(), p_location_id: PRO })).toBe('conflict:open_time_entry');
    await ok(e, 'start_break', { p_request_key: key() });
    await ok(e, 'end_break', { p_request_key: key() });
    const out = await ok<Entry & { breaks: unknown[] }>(e, 'clock_out', { p_request_key: key() });
    expect(new Date(out.clock_out_at!).getTime()).toBeGreaterThan(new Date(out.clock_in_at).getTime());
    expect(out.breaks).toHaveLength(1);
  });

  it('closed entries cannot overlap and clock-out must follow clock-in', async () => {
    const m = await as('slcManager');
    const first = await clockedEntry('slcEmployee', SLC);
    const second = await clockedEntry('slcEmployee', SLC);
    await ok(m, 'correct_time_entry', {
      p_request_key: key(),
      p_time_entry_id: first.time_entry_id,
      p_expected_version: first.version,
      p_clock_in_at: '2026-11-05T15:00:00Z',
      p_clock_out_at: '2026-11-05T20:00:00Z',
      p_reason: 'Paper timesheet entered',
    });
    expect(
      await code(m, 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: second.time_entry_id,
        p_expected_version: second.version,
        p_clock_in_at: '2026-11-05T19:00:00Z',
        p_clock_out_at: '2026-11-05T22:00:00Z',
        p_reason: 'Overlaps the first entry',
      }),
    ).toBe('conflict:overlapping_time_entry');
    expect(
      await code(m, 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: second.time_entry_id,
        p_expected_version: second.version,
        p_clock_in_at: '2026-11-06T20:00:00Z',
        p_clock_out_at: '2026-11-06T19:00:00Z',
        p_reason: 'Backwards times',
      }),
    ).toBe('validation:times');
  });
});

describe('AC26 schedules and corrections', () => {
  it('employees see only their own published shifts; drafts and others stay hidden', async () => {
    const m = await as('proManager');
    const e = await as('proEmployee');
    const draft = await ok<{ shift_id: string; version: number }>(m, 'create_shift', {
      p_request_key: key(),
      p_location_id: PRO,
      p_employee_id: employeeId('proEmployee'),
      p_starts_at: hoursFromNow(48),
      p_ends_at: hoursFromNow(56),
      p_note: 'Prep',
    });
    const mine = async () => (await e.from('shifts').select('shift_id, employee_id, status')).data ?? [];
    expect((await mine()).map((s) => s.shift_id)).not.toContain(draft.shift_id);
    await ok(m, 'publish_shift', {
      p_request_key: key(),
      p_shift_id: draft.shift_id,
      p_expected_version: draft.version,
    });
    expect((await mine()).map((s) => s.shift_id)).toContain(draft.shift_id);
    // A published shift for someone else stays hidden from this employee.
    const theirs = await ok<{ shift_id: string; version: number }>(m, 'create_shift', {
      p_request_key: key(),
      p_location_id: PRO,
      p_employee_id: employeeId('proManager'),
      p_starts_at: hoursFromNow(48),
      p_ends_at: hoursFromNow(56),
    });
    await ok(m, 'publish_shift', {
      p_request_key: key(),
      p_shift_id: theirs.shift_id,
      p_expected_version: theirs.version,
    });
    const visible = await mine();
    expect(visible.every((s) => s.employee_id === employeeId('proEmployee') && s.status === 'published')).toBe(true);
    const status = await ok<{ upcoming_shifts: Array<{ shift_id: string }> }>(e, 'get_my_time_status', {});
    expect(status.upcoming_shifts.map((s) => s.shift_id)).toContain(draft.shift_id);
    expect(
      await code(e, 'create_shift', {
        p_request_key: key(),
        p_location_id: PRO,
        p_employee_id: employeeId('proEmployee'),
        p_starts_at: hoursFromNow(80),
        p_ends_at: hoursFromNow(84),
      }),
    ).toBe('unauthorized');
  });

  it('overlapping shifts fail; published changes need a reason and are audited', async () => {
    const m = await as('proManager');
    const s = await ok<{ shift_id: string; version: number }>(m, 'create_shift', {
      p_request_key: key(),
      p_location_id: PRO,
      p_employee_id: employeeId('proEmployee'),
      p_starts_at: hoursFromNow(100),
      p_ends_at: hoursFromNow(108),
    });
    expect(
      await code(m, 'create_shift', {
        p_request_key: key(),
        p_location_id: PRO,
        p_employee_id: employeeId('proEmployee'),
        p_starts_at: hoursFromNow(106),
        p_ends_at: hoursFromNow(110),
      }),
    ).toBe('conflict:overlapping_shift');
    const pub = await ok<{ version: number }>(m, 'publish_shift', {
      p_request_key: key(),
      p_shift_id: s.shift_id,
      p_expected_version: s.version,
    });
    const args = {
      p_shift_id: s.shift_id,
      p_expected_version: pub.version,
      p_starts_at: hoursFromNow(101),
      p_ends_at: hoursFromNow(109),
    };
    expect(await code(m, 'update_shift', { p_request_key: key(), ...args })).toBe('validation:reason');
    const upd = await ok<{ version: number }>(m, 'update_shift', {
      p_request_key: key(),
      ...args,
      p_reason: 'Delivery moved',
    });
    await ok(m, 'cancel_shift', {
      p_request_key: key(),
      p_shift_id: s.shift_id,
      p_expected_version: upd.version,
      p_reason: 'Closed for maintenance',
    });
    const audit = await sql<{ action: string }>(
      `select action from public.audit_log where object_id = $1 order by occurred_at`,
      [s.shift_id],
    );
    expect(audit.map((a) => a.action)).toEqual(['shift.create', 'shift.publish', 'shift.update', 'shift.cancel']);
    // A cancelled shift no longer blocks the time slot.
    await ok(m, 'create_shift', {
      p_request_key: key(),
      p_location_id: PRO,
      p_employee_id: employeeId('proEmployee'),
      p_starts_at: hoursFromNow(102),
      p_ends_at: hoursFromNow(108),
    });
  });

  it('a manager correction keeps the original values and a reason; managers cannot correct their own time', async () => {
    const m = await as('slcManager');
    const entry = await clockedEntry('slcEmployee', SLC);
    const [before] = await sql<{ clock_in_at: Date; clock_out_at: Date }>(
      `select clock_in_at, clock_out_at from public.time_entries where time_entry_id = $1`,
      [entry.time_entry_id],
    );
    expect(
      await code(m, 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: entry.time_entry_id,
        p_expected_version: entry.version,
        p_clock_in_at: '2026-11-07T15:00:00Z',
        p_clock_out_at: '2026-11-07T23:00:00Z',
        p_reason: '',
      }),
    ).toBe('validation:reason');
    await ok(m, 'correct_time_entry', {
      p_request_key: key(),
      p_time_entry_id: entry.time_entry_id,
      p_expected_version: entry.version,
      p_clock_in_at: '2026-11-07T15:00:00Z',
      p_clock_out_at: '2026-11-07T23:00:00Z',
      p_reason: 'Tablet was offline at clock-in',
      p_breaks: [{ starts_at: '2026-11-07T19:00:00Z', ends_at: '2026-11-07T19:30:00Z' }],
    });
    const [c] = await sql<{ oi: Date; oo: Date; ni: Date; reason: string; by: string }>(
      `select original_clock_in_at oi, original_clock_out_at oo, new_clock_in_at ni, reason, corrected_by by
         from public.time_corrections where time_entry_id = $1`,
      [entry.time_entry_id],
    );
    expect(c!.oi.getTime()).toBe(before!.clock_in_at.getTime());
    expect(c!.oo.getTime()).toBe(before!.clock_out_at.getTime());
    expect(c!.ni.toISOString()).toBe('2026-11-07T15:00:00.000Z');
    expect(c!.reason).toBe('Tablet was offline at clock-in');
    expect(c!.by).toBe(employeeId('slcManager'));
    await expect(
      sql(`update public.time_corrections set reason = 'x' where time_entry_id = $1`, [entry.time_entry_id]),
    ).rejects.toThrow();

    const own = await ok<Entry>(m, 'clock_in', { p_request_key: key(), p_location_id: SLC });
    expect(
      await code(m, 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: own.time_entry_id,
        p_expected_version: own.version,
        p_clock_in_at: hoursFromNow(-5),
        p_clock_out_at: null,
        p_reason: 'Adjusting my own time',
      }),
    ).toBe('unauthorized');
    await ok(m, 'clock_out', { p_request_key: key() });
    // Another location's manager cannot correct this location's time.
    expect(
      await code(await as('proManager'), 'correct_time_entry', {
        p_request_key: key(),
        p_time_entry_id: entry.time_entry_id,
        p_expected_version: entry.version + 1,
        p_clock_in_at: '2026-11-07T15:00:00Z',
        p_clock_out_at: '2026-11-07T22:00:00Z',
        p_reason: 'Not my location',
      }),
    ).toBe('unauthorized');
  });
});

describe('AC27 timezone', () => {
  it('an overnight entry across the 2026-11-01 fall-back gives 9 elapsed hours split 2 + 7 at local midnight', async () => {
    const m = await as('slcManager');
    const entry = await clockedEntry('slcEmployee', SLC);
    // 22:00 MDT Oct 31 → 06:00 MST Nov 1 (the 01:00 hour happens twice).
    await ok(m, 'correct_time_entry', {
      p_request_key: key(),
      p_time_entry_id: entry.time_entry_id,
      p_expected_version: entry.version,
      p_clock_in_at: '2026-11-01T04:00:00Z',
      p_clock_out_at: '2026-11-01T13:00:00Z',
      p_reason: 'Overnight inventory shift entered from paper',
      p_breaks: [{ starts_at: '2026-11-01T08:00:00Z', ends_at: '2026-11-01T08:30:00Z' }],
    });
    const report = await ok<{
      days: Array<{ employee_id: string; business_date: string; worked_hours: string; break_hours: string }>;
      entries: Array<{ time_entry_id: string; elapsed_hours: string; break_hours: string }>;
    }>(m, 'get_hours_report', { p_location_id: SLC, p_from: '2026-10-31', p_to: '2026-11-01' });
    const mine = report.days.filter((d) => d.employee_id === employeeId('slcEmployee'));
    expect(mine).toEqual([
      expect.objectContaining({ business_date: '2026-10-31', worked_hours: '2.00', break_hours: '0.00' }),
      expect.objectContaining({ business_date: '2026-11-01', worked_hours: '6.50', break_hours: '0.50' }),
    ]);
    const e = report.entries.find((x) => x.time_entry_id === entry.time_entry_id)!;
    expect(e.elapsed_hours).toBe('9.0000');
    // The employee sees only their own hours.
    const own = await ok<{ scope: string; days: Array<{ employee_id: string }> }>(
      await as('slcEmployee'),
      'get_hours_report',
      {
        p_location_id: SLC,
        p_from: '2026-10-31',
        p_to: '2026-11-01',
      },
    );
    expect(own.scope).toBe('own');
    expect(own.days.every((d) => d.employee_id === employeeId('slcEmployee'))).toBe(true);
  });

  it('sales filters use local business dates', async () => {
    const m = await as('proManager');
    const today = inject('opsToday');
    const s = await ok<{ timezone: string; locations: Array<{ completed_orders: number }> }>(m, 'get_sales_summary', {
      p_from: today,
      p_to: today,
      p_location_ids: [PRO],
    });
    const [n] = await sql<{ n: number }>(
      `select count(*)::int n from public.orders where location_id = $1 and status = 'completed'
          and (completed_at at time zone 'America/Denver')::date = $2::date`,
      [PRO, today],
    );
    expect(s.timezone).toBe('America/Denver');
    expect(s.locations[0]!.completed_orders).toBe(n!.n);
  });
});

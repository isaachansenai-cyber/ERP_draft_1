// Schedules, clocking and time records (PRD §11). Not payroll. Every clock
// timestamp comes from the server; only a manager correction can set one, and
// it keeps the original values and a reason.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Empty, Field, inputClass, Loading, Notice, QueryError, ScrollRegion } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { addBusinessDays, denverLocalToIso, isoToDenverLocal } from '../lib/time';
import { useRpcMutation } from '../lib/useRpcMutation';
import { Status } from './inventory/ControlsPanels';

interface TimeEntry {
  time_entry_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  version: number;
  unscheduled: boolean;
  open_break: boolean;
  location_id: string;
}
interface TimeStatus {
  server_time: string;
  business_date: string;
  open_entry: TimeEntry | null;
  upcoming_shifts: Array<{
    shift_id: string;
    location_id: string;
    starts_at: string;
    ends_at: string;
    note: string | null;
  }>;
}
interface HoursReport {
  date_from: string;
  date_to: string;
  scope: 'own' | 'location';
  refreshed_at: string;
  days: Array<{
    employee_id: string;
    display_name: string;
    business_date: string;
    worked_hours: string;
    break_hours: string;
    includes_open_entry: boolean;
  }>;
  entries: Array<{
    time_entry_id: string;
    employee_id: string;
    display_name: string;
    clock_in_at: string;
    clock_out_at: string | null;
    version: number;
    open: boolean;
    unscheduled: boolean;
    corrected: boolean;
    elapsed_hours: string;
    break_hours: string;
    breaks: Array<{ starts_at: string; ends_at: string | null }>;
    corrections: Array<{
      original_clock_in_at: string;
      original_clock_out_at: string | null;
      new_clock_in_at: string;
      new_clock_out_at: string | null;
      reason: string;
      corrected_at: string;
      corrected_by: string;
    }>;
  }>;
  open_exceptions: Array<{ time_entry_id: string; display_name: string; clock_in_at: string }> | null;
}

function MyTime({ locationId, today }: { locationId: string; today: string }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['my-time'], queryFn: () => callRpc<TimeStatus>('get_my_time_status', {}) });
  const hours = useQuery({
    queryKey: ['hours', locationId, 'own', today],
    queryFn: () =>
      callRpc<HoursReport>('get_hours_report', {
        p_location_id: locationId,
        p_from: addBusinessDays(today, -13),
        p_to: today,
      }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-time'] });
    void queryClient.invalidateQueries({ queryKey: ['hours'] });
  };
  const open = status.data?.open_entry;
  const clockIn = useRpcMutation('clock_in', `clock-in:${locationId}:${open?.time_entry_id ?? 'none'}`, {
    onSuccess: refresh,
  });
  const clockOut = useRpcMutation('clock_out', `clock-out:${open?.time_entry_id ?? 'none'}`, { onSuccess: refresh });
  const breakStart = useRpcMutation('start_break', `break-start:${open?.time_entry_id}:${open?.open_break}`, {
    onSuccess: refresh,
  });
  const breakEnd = useRpcMutation('end_break', `break-end:${open?.time_entry_id}:${open?.open_break}`, {
    onSuccess: refresh,
  });
  if (status.isPending) return <Loading />;
  if (status.error) return <QueryError error={status.error} onRetry={() => void status.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <section
        className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
        aria-labelledby="clock-heading"
      >
        <h2 id="clock-heading" className="text-lg font-semibold">
          Clock
        </h2>
        <p className="text-sm text-slate-700">
          Times come from the server clock, not this device. You can only clock yourself. Ask a manager to correct a
          mistake.
        </p>
        {open ? (
          <>
            <p data-testid="clock-status">
              <Badge tone="good">Clocked in</Badge> since {formatDateTime(open.clock_in_at)} at {open.location_id}
              {open.unscheduled ? (
                <>
                  {' '}
                  <Badge tone="warn">unscheduled</Badge>
                </>
              ) : null}
              {open.open_break ? (
                <>
                  {' '}
                  <Badge tone="warn">on break</Badge>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {open.open_break ? (
                <Button variant="secondary" disabled={!breakEnd.canPost} onClick={() => void breakEnd.submit({})}>
                  End break
                </Button>
              ) : (
                <Button variant="secondary" disabled={!breakStart.canPost} onClick={() => void breakStart.submit({})}>
                  Start unpaid break
                </Button>
              )}
              <Button variant="danger" disabled={!clockOut.canPost} onClick={() => void clockOut.submit({})}>
                Clock out
              </Button>
            </div>
          </>
        ) : (
          <>
            <p data-testid="clock-status">
              <Badge>Not clocked in</Badge>
            </p>
            <Button disabled={!clockIn.canPost} onClick={() => void clockIn.submit({ p_location_id: locationId })}>
              Clock in here
            </Button>
          </>
        )}
        <Status m={clockIn} text="Clocked in." />
        <Status m={clockOut} text="Clocked out." />
        <Status m={breakStart} text="Break started." />
        <Status m={breakEnd} text="Break ended." />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="my-shifts-heading">
        <h2 id="my-shifts-heading" className="text-lg font-semibold">
          My published shifts (next 14 days)
        </h2>
        {status.data.upcoming_shifts.length === 0 ? (
          <Empty>No published shifts.</Empty>
        ) : (
          <ul className="text-sm">
            {status.data.upcoming_shifts.map((s) => (
              <li key={s.shift_id} className="border-b border-slate-200 py-1">
                {formatDateTime(s.starts_at)} – {formatDateTime(s.ends_at)} · {s.location_id}
                {s.note ? ` · ${s.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="my-hours-heading">
        <h2 id="my-hours-heading" className="text-lg font-semibold">
          My hours (last 14 days, split at local midnight)
        </h2>
        {hours.isPending ? (
          <Loading />
        ) : hours.error ? (
          <QueryError error={hours.error} />
        ) : hours.data.days.length === 0 ? (
          <Empty>No recorded time.</Empty>
        ) : (
          <HoursTable report={hours.data} />
        )}
      </section>
    </div>
  );
}

function HoursTable({ report }: { report: HoursReport }) {
  return (
    <ScrollRegion label="Hours by day">
      <p className="text-xs text-slate-600">
        {report.date_from} to {report.date_to} · America/Denver · elapsed time minus recorded unpaid breaks · refreshed{' '}
        {formatDateTime(report.refreshed_at)}
      </p>
      <table className="w-full border-collapse bg-white text-sm" data-testid="hours-table">
        <thead>
          <tr className="border-b border-slate-400 text-left">
            <th className="p-2">Staff</th>
            <th className="p-2">Business date</th>
            <th className="p-2">Worked hours</th>
            <th className="p-2">Breaks</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((d) => (
            <tr key={`${d.employee_id}:${d.business_date}`} className="border-b border-slate-200">
              <td className="p-2">{d.display_name}</td>
              <td className="p-2">{d.business_date}</td>
              <td className="p-2 font-semibold">
                {d.worked_hours}
                {d.includes_open_entry ? (
                  <>
                    {' '}
                    <Badge tone="warn">open entry</Badge>
                  </>
                ) : null}
              </td>
              <td className="p-2">{d.break_hours}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

interface Shift {
  shift_id: string;
  employee_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  status: string;
  version: number;
  employees: { display_name: string } | null;
}

function ShiftRow({ s, onDone }: { s: Shift; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(isoToDenverLocal(s.starts_at));
  const [end, setEnd] = useState(isoToDenverLocal(s.ends_at));
  const publish = useRpcMutation('publish_shift', `shift-publish:${s.shift_id}:${s.version}`, { onSuccess: onDone });
  const cancel = useRpcMutation('cancel_shift', `shift-cancel:${s.shift_id}:${s.version}`, { onSuccess: onDone });
  const update = useRpcMutation('update_shift', `shift-update:${s.shift_id}:${s.version}`, {
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
  });
  return (
    <li
      className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 text-sm"
      data-testid={`shift-${s.shift_id}`}
    >
      <p>
        <span className="font-semibold">{s.employees?.display_name ?? s.employee_id}</span> ·{' '}
        {formatDateTime(s.starts_at)} – {formatDateTime(s.ends_at)}{' '}
        <Badge tone={s.status === 'published' ? 'good' : s.status === 'cancelled' ? 'neutral' : 'warn'}>
          {s.status}
        </Badge>
        {s.note ? ` · ${s.note}` : ''}
      </p>
      {s.status !== 'cancelled' ? (
        <div className="flex flex-wrap items-end gap-2">
          {s.status === 'draft' ? (
            <Button
              disabled={!publish.canPost}
              onClick={() => void publish.submit({ p_shift_id: s.shift_id, p_expected_version: s.version })}
            >
              Publish
            </Button>
          ) : null}
          <Field label="Reason (to change or cancel)" htmlFor={`shift-reason-${s.shift_id}`}>
            <input
              id={`shift-reason-${s.shift_id}`}
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button variant="secondary" onClick={() => setEditing((x) => !x)}>
            {editing ? 'Close' : 'Change times…'}
          </Button>
          <Button
            variant="danger"
            disabled={!cancel.canPost || reason.trim().length < 3}
            onClick={() =>
              void cancel.submit({ p_shift_id: s.shift_id, p_expected_version: s.version, p_reason: reason })
            }
          >
            Cancel shift
          </Button>
        </div>
      ) : null}
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Start (Denver)" htmlFor={`shift-s-${s.shift_id}`}>
            <input
              id={`shift-s-${s.shift_id}`}
              type="datetime-local"
              className={inputClass}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="End (Denver)" htmlFor={`shift-e-${s.shift_id}`}>
            <input
              id={`shift-e-${s.shift_id}`}
              type="datetime-local"
              className={inputClass}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Button
            disabled={
              !update.canPost ||
              !denverLocalToIso(start) ||
              !denverLocalToIso(end) ||
              (s.status === 'published' && reason.trim().length < 3)
            }
            onClick={() =>
              void update.submit({
                p_shift_id: s.shift_id,
                p_expected_version: s.version,
                p_starts_at: denverLocalToIso(start)!,
                p_ends_at: denverLocalToIso(end)!,
                p_note: s.note ?? undefined,
                p_reason: reason || undefined,
              })
            }
          >
            Save times
          </Button>
        </div>
      ) : null}
      <Status m={publish} text="Published: the employee can now see it." />
      <Status m={cancel} text="Shift cancelled (audited)." />
      <Status m={update} text="Shift updated (audited)." />
    </li>
  );
}

function SchedulePanel({ locationId, today }: { locationId: string; today: string }) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(today);
  const staff = useQuery({
    queryKey: ['location-staff', locationId],
    queryFn: () =>
      callRpc<Array<{ employee_id: string; display_name: string; role: string }>>('list_location_staff', {
        p_location_id: locationId,
      }),
  });
  const shifts = useQuery({
    queryKey: ['shifts', locationId, from],
    queryFn: async () => {
      const fromIso = denverLocalToIso(`${from}T00:00`)!;
      const toIso = denverLocalToIso(`${addBusinessDays(from, 7)}T00:00`)!;
      const { data, error } = await supabase
        .from('shifts')
        .select(
          'shift_id, employee_id, starts_at, ends_at, note, status, version, employees!shifts_employee_id_fkey(display_name)',
        )
        .eq('location_id', locationId)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at');
      if (error) throw error;
      return data as unknown as Shift[];
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['shifts', locationId] });
  const [employee, setEmployee] = useState('');
  const [start, setStart] = useState(`${today}T09:00`);
  const [end, setEnd] = useState(`${today}T17:00`);
  const [note, setNote] = useState('');
  const create = useRpcMutation('create_shift', `shift-create:${locationId}:${employee}:${start}`, {
    onSuccess: refresh,
  });
  const startIso = denverLocalToIso(start);
  const endIso = denverLocalToIso(end);
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-slate-400 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create.submit({
            p_location_id: locationId,
            p_employee_id: employee,
            p_starts_at: startIso!,
            p_ends_at: endIso!,
            p_note: note || undefined,
          });
        }}
      >
        <h2 className="w-full text-lg font-semibold">New shift (draft until published)</h2>
        <Field label="Staff member" htmlFor="shift-employee">
          <select
            id="shift-employee"
            className={inputClass}
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
          >
            <option value="">Choose…</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.employee_id} value={s.employee_id}>
                {s.display_name} ({s.role})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start (Denver)" htmlFor="shift-start">
          <input
            id="shift-start"
            type="datetime-local"
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="End (Denver)" htmlFor="shift-end">
          <input
            id="shift-end"
            type="datetime-local"
            className={inputClass}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor="shift-note">
          <input id="shift-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!create.canPost || !employee || !startIso || !endIso}>
          Create draft shift
        </Button>
        <div className="w-full">
          <Status m={create} text="Draft shift created. Publish it so the employee can see it." />
        </div>
      </form>
      <Field label="Week starting" htmlFor="shift-week">
        <input
          id="shift-week"
          type="date"
          className={`${inputClass} w-48`}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      {shifts.isPending ? (
        <Loading />
      ) : shifts.error ? (
        <QueryError error={shifts.error} onRetry={() => void shifts.refetch()} />
      ) : shifts.data.length === 0 ? (
        <Empty>No shifts in this week.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.data.map((s) => (
            <ShiftRow key={`${s.shift_id}:${s.version}`} s={s} onDone={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CorrectEntry({ entry, onDone }: { entry: HoursReport['entries'][number]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [clockIn, setClockIn] = useState(isoToDenverLocal(entry.clock_in_at));
  const [clockOut, setClockOut] = useState(entry.clock_out_at ? isoToDenverLocal(entry.clock_out_at) : '');
  const [reason, setReason] = useState('');
  const m = useRpcMutation('correct_time_entry', `time-correct:${entry.time_entry_id}:${entry.version}`, {
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  const inIso = denverLocalToIso(clockIn);
  const outIso = clockOut ? denverLocalToIso(clockOut) : null;
  if (!open)
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Correct…
        </Button>
        <Status m={m} text="Correction saved; the original values are kept." />
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-amber-600 bg-amber-50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_time_entry_id: entry.time_entry_id,
          p_expected_version: entry.version,
          p_clock_in_at: inIso!,
          // null keeps an open entry open (the SQL parameter accepts null; generated types omit it).
          p_clock_out_at: outIso as string,
          p_reason: reason,
        });
      }}
    >
      <Field label="Clock in (Denver)" htmlFor={`ci-${entry.time_entry_id}`}>
        <input
          id={`ci-${entry.time_entry_id}`}
          type="datetime-local"
          className={inputClass}
          value={clockIn}
          onChange={(e) => setClockIn(e.target.value)}
        />
      </Field>
      <Field label="Clock out (Denver)" htmlFor={`co-${entry.time_entry_id}`} hint="Blank keeps an open entry open">
        <input
          id={`co-${entry.time_entry_id}`}
          type="datetime-local"
          className={inputClass}
          value={clockOut}
          onChange={(e) => setClockOut(e.target.value)}
        />
      </Field>
      <Field label="Reason (required)" htmlFor={`cr-${entry.time_entry_id}`}>
        <input
          id={`cr-${entry.time_entry_id}`}
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost || !inIso || (clockOut !== '' && !outIso) || reason.trim().length < 5}>
        Save correction
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Close
      </Button>
      <div className="w-full">
        <Status m={m} text="Correction saved; the original values are kept." />
      </div>
    </form>
  );
}

function TimeRecordsPanel({ locationId, today }: { locationId: string; today: string }) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(addBusinessDays(today, -6));
  const [to, setTo] = useState(today);
  const report = useQuery({
    queryKey: ['hours', locationId, 'location', from, to],
    queryFn: () => callRpc<HoursReport>('get_hours_report', { p_location_id: locationId, p_from: from, p_to: to }),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hours', locationId] });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From" htmlFor="hours-from">
          <input
            id="hours-from"
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="hours-to">
          <input id="hours-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {report.isPending ? (
        <Loading />
      ) : report.error ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          {report.data.open_exceptions && report.data.open_exceptions.length > 0 ? (
            <Notice tone="warning" title="Open time entries (not auto-closed)">
              <ul>
                {report.data.open_exceptions.map((x) => (
                  <li key={x.time_entry_id}>
                    {x.display_name} since {formatDateTime(x.clock_in_at)}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {report.data.days.length === 0 ? (
            <Empty>No recorded time in this range.</Empty>
          ) : (
            <HoursTable report={report.data} />
          )}
          <h2 className="text-lg font-semibold">Entries</h2>
          <ul className="flex flex-col gap-2">
            {report.data.entries.map((e) => (
              <li
                key={`${e.time_entry_id}:${e.version}`}
                className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 text-sm"
              >
                <p>
                  <span className="font-semibold">{e.display_name}</span> · {formatDateTime(e.clock_in_at)} –{' '}
                  {e.clock_out_at ? formatDateTime(e.clock_out_at) : 'open'} · {e.elapsed_hours} h elapsed,{' '}
                  {e.break_hours} h breaks {e.open ? <Badge tone="warn">open</Badge> : null}{' '}
                  {e.unscheduled ? <Badge tone="warn">unscheduled</Badge> : null}{' '}
                  {e.corrected ? <Badge>corrected</Badge> : null}
                </p>
                {e.corrections.length > 0 ? (
                  <ul className="text-xs">
                    {e.corrections.map((c) => (
                      <li key={c.corrected_at}>
                        {formatDateTime(c.corrected_at)} by {c.corrected_by}: was{' '}
                        {formatDateTime(c.original_clock_in_at)} –{' '}
                        {c.original_clock_out_at ? formatDateTime(c.original_clock_out_at) : 'open'}; now{' '}
                        {formatDateTime(c.new_clock_in_at)} –{' '}
                        {c.new_clock_out_at ? formatDateTime(c.new_clock_out_at) : 'open'} · “{c.reason}”
                      </li>
                    ))}
                  </ul>
                ) : null}
                <CorrectEntry entry={e} onDone={refresh} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function StaffPage() {
  const { selectedLocation, context } = useAuth();
  const { tab } = useParams();
  if (!selectedLocation || !context) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  const tabs = [
    { id: 'me', label: 'My time & shifts' },
    ...(isManager
      ? [
          { id: 'schedule', label: 'Schedule' },
          { id: 'time', label: 'Time records & hours' },
        ]
      : []),
  ];
  const current = tab ?? 'me';
  if (!tabs.some((t) => t.id === current)) return <Navigate to="/staff" replace />;
  return (
    <section aria-labelledby="staff-heading" className="flex flex-col gap-4">
      <h1 id="staff-heading" className="text-2xl font-bold">
        Staff time — {selectedLocation.location_name}
      </h1>
      <p className="text-sm text-slate-700">Schedules and time records only: no pay, overtime or automatic breaks.</p>
      <nav aria-label="Staff sections" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.id}
            to={t.id === 'me' ? '/staff' : `/staff/${t.id}`}
            end
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${isActive ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {current === 'me' ? (
        <MyTime locationId={selectedLocation.location_id} today={context.business_date} />
      ) : current === 'schedule' ? (
        <SchedulePanel locationId={selectedLocation.location_id} today={context.business_date} />
      ) : (
        <TimeRecordsPanel locationId={selectedLocation.location_id} today={context.business_date} />
      )}
    </section>
  );
}

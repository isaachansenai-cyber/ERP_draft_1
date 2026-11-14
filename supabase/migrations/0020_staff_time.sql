-- 0020 Schedules, clocking, breaks, manager corrections and the hours report
-- (PRD §11; AC25, AC26, AC27). Not payroll: no pay rates, overtime rules or
-- automatic break deductions. Every timestamp an employee records comes from
-- the server clock; only a manager correction can set one, and it keeps the
-- original values and a reason.

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create table public.shifts (
  shift_id uuid primary key default gen_random_uuid(),
  location_id text not null references public.locations (location_id) on delete restrict,
  employee_id text not null references public.employees (employee_id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  version integer not null default 1 check (version > 0),
  created_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  constraint shifts_order check (ends_at > starts_at),
  constraint shifts_length check (ends_at - starts_at <= interval '16 hours'),
  constraint shifts_cancelled check ((status = 'cancelled') = (cancelled_at is not null)),
  -- No overlapping scheduled shifts for the same employee, across all locations.
  constraint shifts_no_overlap exclude using gist (
    employee_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status <> 'cancelled')
);

create index shifts_location_time on public.shifts (location_id, starts_at);

-- ---------------------------------------------------------------------------
-- Time entries and breaks
-- ---------------------------------------------------------------------------
create table public.time_entries (
  time_entry_id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (employee_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  shift_id uuid references public.shifts (shift_id) on delete restrict,
  unscheduled boolean not null,
  corrected boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  request_key uuid,
  constraint time_entries_order check (clock_out_at is null or clock_out_at > clock_in_at),
  -- Entries for one employee never overlap (an open entry extends to infinity).
  constraint time_entries_no_overlap exclude using gist (
    employee_id with =, tstzrange(clock_in_at, coalesce(clock_out_at, 'infinity'::timestamptz), '[)') with &&)
);

-- At most one open entry per employee across all locations.
create unique index time_entries_one_open on public.time_entries (employee_id) where clock_out_at is null;
create index time_entries_location_time on public.time_entries (location_id, clock_in_at);

create table public.break_intervals (
  break_id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries (time_entry_id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz,
  recorded_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint break_intervals_order check (ends_at is null or ends_at > starts_at),
  constraint break_intervals_no_overlap exclude using gist (
    time_entry_id with =, tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz), '[)') with &&)
);

create unique index break_intervals_one_open on public.break_intervals (time_entry_id) where ends_at is null;

-- Immutable record of every manager correction: original and new values plus a reason.
create table public.time_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries (time_entry_id) on delete restrict,
  original_clock_in_at timestamptz not null,
  original_clock_out_at timestamptz,
  original_breaks jsonb not null,
  new_clock_in_at timestamptz not null,
  new_clock_out_at timestamptz,
  new_breaks jsonb not null,
  reason text not null check (length(btrim(reason)) >= 5),
  corrected_by text not null references public.employees (employee_id) on delete restrict,
  corrected_at timestamptz not null default now(),
  request_key uuid
);

create trigger time_corrections_append_only before update or delete on public.time_corrections
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.breaks_json(p_entry_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at) order by b.starts_at), '[]'::jsonb)
  from public.break_intervals b where b.time_entry_id = p_entry_id;
$$;

-- Worked seconds per America/Denver business date for one entry: elapsed UTC
-- time inside each local day (midnight to midnight, DST-aware) minus recorded
-- breaks inside that day. Open entries/breaks are measured up to p_until.
create function private.time_entry_days(p_entry_id uuid, p_until timestamptz default now())
returns table (business_date date, elapsed_seconds numeric, break_seconds numeric, worked_seconds numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select t.clock_in_at as s, coalesce(t.clock_out_at, greatest(p_until, t.clock_in_at)) as f
    from public.time_entries t where t.time_entry_id = p_entry_id
  ), days as (
    select d::date as day,
           greatest(e.s, (d::date)::timestamp at time zone 'America/Denver') as ds,
           least(e.f, (d::date + 1)::timestamp at time zone 'America/Denver') as de
    from e, generate_series((e.s at time zone 'America/Denver')::date, (e.f at time zone 'America/Denver')::date, interval '1 day') d
  ), seg as (
    select days.day, days.ds, days.de,
           coalesce((select sum(extract(epoch from (least(days.de, coalesce(b.ends_at, p_until)) - greatest(days.ds, b.starts_at))))
                     from public.break_intervals b
                     where b.time_entry_id = p_entry_id and b.starts_at < days.de and coalesce(b.ends_at, p_until) > days.ds), 0) as brk
    from days where days.de > days.ds
  )
  select seg.day, extract(epoch from (seg.de - seg.ds)), seg.brk, extract(epoch from (seg.de - seg.ds)) - seg.brk from seg;
$$;

create function private.time_entry_result(p_entry_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time_entry_id', t.time_entry_id, 'employee_id', t.employee_id,
    'location_id', t.location_id, 'clock_in_at', t.clock_in_at, 'clock_out_at', t.clock_out_at, 'version', t.version,
    'unscheduled', t.unscheduled, 'corrected', t.corrected, 'shift_id', t.shift_id,
    'open_break', exists (select 1 from public.break_intervals b where b.time_entry_id = t.time_entry_id and b.ends_at is null),
    'breaks', private.breaks_json(t.time_entry_id))
  from public.time_entries t where t.time_entry_id = p_entry_id;
$$;

create function private.shift_for_manager(p_shift_id uuid)
returns public.shifts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.shifts;
begin
  select * into v from public.shifts s where s.shift_id = p_shift_id;
  if v.shift_id is null then perform private.raise_error('validation:unknown_shift'); end if;
  perform private.require_location_role(v.location_id, array['manager']);
  return v;
end;
$$;

create function private.validate_shift(p_location_id text, p_employee_id text, p_starts timestamptz, p_ends timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    perform private.raise_error('validation:shift_times', jsonb_build_object('rule', 'end after start'));
  end if;
  if p_ends - p_starts > interval '16 hours' then
    perform private.raise_error('validation:shift_times', jsonb_build_object('rule', 'at most 16 hours'));
  end if;
  if not exists (select 1 from public.memberships m join public.employees e on e.employee_id = m.employee_id
                 where m.employee_id = p_employee_id and m.active and e.active and m.location_id = p_location_id) then
    perform private.raise_error('validation:employee_not_at_location');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shift RPCs (managers of the location)
-- ---------------------------------------------------------------------------
create function public.create_shift(p_request_key uuid, p_location_id text, p_employee_id text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_shift public.shifts;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'create_shift', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  perform private.validate_shift(p_location_id, p_employee_id, p_starts_at, p_ends_at);
  begin
    insert into public.shifts (location_id, employee_id, starts_at, ends_at, note, created_by)
    values (p_location_id, p_employee_id, p_starts_at, p_ends_at, nullif(btrim(p_note), ''), v_actor)
    returning * into v_shift;
  exception when exclusion_violation then
    perform private.raise_error('conflict:overlapping_shift', jsonb_build_object('employee_id', p_employee_id));
  end;
  perform private.write_audit(v_actor, 'shift.create', 'shift', v_shift.shift_id::text, p_location_id, p_request_key, null,
    jsonb_build_object('employee_id', p_employee_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'shift_id', v_shift.shift_id,
    'status', v_shift.status, 'version', v_shift.version));
end;
$$;

create function public.update_shift(p_request_key uuid, p_shift_id uuid, p_expected_version integer, p_starts_at timestamptz,
  p_ends_at timestamptz, p_note text default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_shift public.shifts := private.shift_for_manager(p_shift_id);
  v_cached jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'update_shift', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_shift from public.shifts s where s.shift_id = p_shift_id for update;
  if v_shift.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_shift.status = 'cancelled' then perform private.raise_error('invalid_state:cancelled->updated'); end if;
  if v_shift.status = 'published' and (p_reason is null or length(btrim(p_reason)) < 3) then
    perform private.raise_error('validation:reason', jsonb_build_object('rule', 'changing a published shift needs a reason'));
  end if;
  perform private.validate_shift(v_shift.location_id, v_shift.employee_id, p_starts_at, p_ends_at);
  begin
    update public.shifts set starts_at = p_starts_at, ends_at = p_ends_at, note = nullif(btrim(p_note), ''), version = version + 1
     where shift_id = p_shift_id;
  exception when exclusion_violation then
    perform private.raise_error('conflict:overlapping_shift', jsonb_build_object('employee_id', v_shift.employee_id));
  end;
  perform private.write_audit(v_actor, 'shift.update', 'shift', p_shift_id::text, v_shift.location_id, p_request_key,
    jsonb_build_object('starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at, 'status', v_shift.status),
    jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at), p_reason);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'shift_id', p_shift_id,
    'status', v_shift.status, 'version', v_shift.version + 1));
end;
$$;

create function public.publish_shift(p_request_key uuid, p_shift_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_shift public.shifts := private.shift_for_manager(p_shift_id);
  v_cached jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'publish_shift', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_shift from public.shifts s where s.shift_id = p_shift_id for update;
  if v_shift.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_shift.status <> 'draft' then perform private.raise_error('invalid_state:' || v_shift.status || '->published'); end if;
  update public.shifts set status = 'published', published_at = now(), version = version + 1 where shift_id = p_shift_id;
  perform private.write_audit(v_actor, 'shift.publish', 'shift', p_shift_id::text, v_shift.location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'shift_id', p_shift_id,
    'status', 'published', 'version', v_shift.version + 1));
end;
$$;

create function public.cancel_shift(p_request_key uuid, p_shift_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_shift public.shifts := private.shift_for_manager(p_shift_id);
  v_cached jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'cancel_shift', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_shift from public.shifts s where s.shift_id = p_shift_id for update;
  if v_shift.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_shift.status = 'cancelled' then perform private.raise_error('invalid_state:cancelled->cancelled'); end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  update public.shifts set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), version = version + 1
   where shift_id = p_shift_id;
  perform private.write_audit(v_actor, 'shift.cancel', 'shift', p_shift_id::text, v_shift.location_id, p_request_key,
    jsonb_build_object('status', v_shift.status), jsonb_build_object('status', 'cancelled'), p_reason);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'shift_id', p_shift_id,
    'status', 'cancelled', 'version', v_shift.version + 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- Clocking (the signed-in employee only; server clock only)
-- ---------------------------------------------------------------------------
create function public.clock_in(p_request_key uuid, p_location_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_now timestamptz := now();
  v_shift uuid;
  v_entry uuid;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_cached := private.idem_begin(v_actor, 'clock_in', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  -- Serialize this employee's clock actions.
  perform 1 from public.employees e where e.employee_id = v_actor for update;
  if exists (select 1 from public.time_entries t where t.employee_id = v_actor and t.clock_out_at is null) then
    perform private.raise_error('conflict:open_time_entry');
  end if;
  -- A published shift at this location covering now (or starting within the hour) links the entry.
  select s.shift_id into v_shift from public.shifts s
  where s.employee_id = v_actor and s.location_id = p_location_id and s.status = 'published'
    and s.starts_at - interval '1 hour' <= v_now and s.ends_at > v_now
  order by s.starts_at limit 1;
  begin
    insert into public.time_entries (employee_id, location_id, clock_in_at, shift_id, unscheduled, request_key)
    values (v_actor, p_location_id, v_now, v_shift, v_shift is null, p_request_key)
    returning time_entry_id into v_entry;
  exception
    when unique_violation then perform private.raise_error('conflict:open_time_entry');
    when exclusion_violation then perform private.raise_error('conflict:overlapping_time_entry');
  end;
  perform private.write_audit(v_actor, 'time.clock_in', 'time_entry', v_entry::text, p_location_id, p_request_key, null,
    jsonb_build_object('clock_in_at', v_now, 'unscheduled', v_shift is null));
  return private.idem_finish(v_actor, p_request_key, private.time_entry_result(v_entry));
end;
$$;

create function public.clock_out(p_request_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_entry public.time_entries;
begin
  v_cached := private.idem_begin(v_actor, 'clock_out', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform 1 from public.employees e where e.employee_id = v_actor for update;
  select * into v_entry from public.time_entries t where t.employee_id = v_actor and t.clock_out_at is null for update;
  if v_entry.time_entry_id is null then perform private.raise_error('invalid_state:not_clocked_in'); end if;
  update public.break_intervals set ends_at = greatest(now(), starts_at + interval '1 microsecond')
   where time_entry_id = v_entry.time_entry_id and ends_at is null;
  update public.time_entries set clock_out_at = greatest(now(), clock_in_at + interval '1 microsecond'), version = version + 1
   where time_entry_id = v_entry.time_entry_id;
  perform private.write_audit(v_actor, 'time.clock_out', 'time_entry', v_entry.time_entry_id::text, v_entry.location_id,
    p_request_key, null, jsonb_build_object('clock_out_at', now()));
  return private.idem_finish(v_actor, p_request_key, private.time_entry_result(v_entry.time_entry_id));
end;
$$;

create function public.start_break(p_request_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_entry public.time_entries;
begin
  v_cached := private.idem_begin(v_actor, 'start_break', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_entry from public.time_entries t where t.employee_id = v_actor and t.clock_out_at is null for update;
  if v_entry.time_entry_id is null then perform private.raise_error('invalid_state:not_clocked_in'); end if;
  begin
    insert into public.break_intervals (time_entry_id, starts_at, recorded_by)
    values (v_entry.time_entry_id, greatest(now(), v_entry.clock_in_at), v_actor);
  exception when unique_violation or exclusion_violation then
    perform private.raise_error('invalid_state:break_already_open');
  end;
  perform private.write_audit(v_actor, 'time.break_start', 'time_entry', v_entry.time_entry_id::text, v_entry.location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, private.time_entry_result(v_entry.time_entry_id));
end;
$$;

create function public.end_break(p_request_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_entry public.time_entries;
begin
  v_cached := private.idem_begin(v_actor, 'end_break', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_entry from public.time_entries t where t.employee_id = v_actor and t.clock_out_at is null for update;
  if v_entry.time_entry_id is null then perform private.raise_error('invalid_state:not_clocked_in'); end if;
  if not exists (select 1 from public.break_intervals b where b.time_entry_id = v_entry.time_entry_id and b.ends_at is null) then
    perform private.raise_error('invalid_state:no_open_break');
  end if;
  update public.break_intervals set ends_at = greatest(now(), starts_at + interval '1 microsecond')
   where time_entry_id = v_entry.time_entry_id and ends_at is null;
  perform private.write_audit(v_actor, 'time.break_end', 'time_entry', v_entry.time_entry_id::text, v_entry.location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, private.time_entry_result(v_entry.time_entry_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Manager correction (originals kept; mandatory reason)
-- ---------------------------------------------------------------------------
-- p_breaks: null keeps the recorded breaks; an array [{starts_at, ends_at}] replaces them.
create function public.correct_time_entry(p_request_key uuid, p_time_entry_id uuid, p_expected_version integer,
  p_clock_in_at timestamptz, p_clock_out_at timestamptz, p_reason text, p_breaks jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_entry public.time_entries;
  v_orig_breaks jsonb;
  v_new_breaks jsonb;
  r record;
begin
  select * into v_entry from public.time_entries t where t.time_entry_id = p_time_entry_id;
  if v_entry.time_entry_id is null then perform private.raise_error('validation:unknown_time_entry'); end if;
  perform private.require_location_role(v_entry.location_id, array['manager']);
  -- Managers do not correct their own time; another manager or the owner does.
  if v_entry.employee_id = v_actor and not private.is_owner() then
    perform private.raise_error('unauthorized', jsonb_build_object('reason', 'cannot_correct_own_time'));
  end if;
  v_cached := private.idem_begin(v_actor, 'correct_time_entry', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  if p_reason is null or length(btrim(p_reason)) < 5 then perform private.raise_error('validation:reason'); end if;
  if p_clock_in_at is null or p_clock_in_at > now() or (p_clock_out_at is not null and (p_clock_out_at <= p_clock_in_at or p_clock_out_at > now())) then
    perform private.raise_error('validation:times', jsonb_build_object('rule', 'clock-out after clock-in, neither in the future'));
  end if;
  select * into v_entry from public.time_entries t where t.time_entry_id = p_time_entry_id for update;
  if v_entry.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if p_clock_out_at is null and v_entry.clock_out_at is not null then
    perform private.raise_error('validation:times', jsonb_build_object('rule', 'a closed entry cannot be reopened'));
  end if;
  v_orig_breaks := private.breaks_json(p_time_entry_id);
  v_new_breaks := coalesce(p_breaks, v_orig_breaks);
  if jsonb_typeof(v_new_breaks) <> 'array' then perform private.raise_error('validation:breaks'); end if;
  for r in select * from jsonb_to_recordset(v_new_breaks) as x(starts_at timestamptz, ends_at timestamptz) loop
    if r.starts_at is null or r.starts_at < p_clock_in_at or (r.ends_at is not null and r.ends_at <= r.starts_at)
       or (p_clock_out_at is not null and (r.ends_at is null or r.ends_at > p_clock_out_at)) then
      perform private.raise_error('validation:breaks', jsonb_build_object('rule', 'breaks must lie inside the entry'));
    end if;
  end loop;

  begin
    delete from public.break_intervals where time_entry_id = p_time_entry_id;
    update public.time_entries
       set clock_in_at = p_clock_in_at, clock_out_at = p_clock_out_at, corrected = true, version = version + 1
     where time_entry_id = p_time_entry_id;
    insert into public.break_intervals (time_entry_id, starts_at, ends_at, recorded_by)
    select p_time_entry_id, x.starts_at, x.ends_at, v_actor
    from jsonb_to_recordset(v_new_breaks) as x(starts_at timestamptz, ends_at timestamptz);
  exception when exclusion_violation then
    perform private.raise_error('conflict:overlapping_time_entry');
  end;
  insert into public.time_corrections (time_entry_id, original_clock_in_at, original_clock_out_at, original_breaks,
    new_clock_in_at, new_clock_out_at, new_breaks, reason, corrected_by, request_key)
  values (p_time_entry_id, v_entry.clock_in_at, v_entry.clock_out_at, v_orig_breaks, p_clock_in_at, p_clock_out_at,
    private.breaks_json(p_time_entry_id), btrim(p_reason), v_actor, p_request_key);
  perform private.write_audit(v_actor, 'time.correct', 'time_entry', p_time_entry_id::text, v_entry.location_id, p_request_key,
    jsonb_build_object('clock_in_at', v_entry.clock_in_at, 'clock_out_at', v_entry.clock_out_at, 'breaks', v_orig_breaks),
    jsonb_build_object('clock_in_at', p_clock_in_at, 'clock_out_at', p_clock_out_at, 'breaks', private.breaks_json(p_time_entry_id)),
    p_reason);
  return private.idem_finish(v_actor, p_request_key, private.time_entry_result(p_time_entry_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create function public.get_my_time_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_open uuid;
begin
  select t.time_entry_id into v_open from public.time_entries t where t.employee_id = v_actor and t.clock_out_at is null;
  return jsonb_build_object(
    'server_time', now(), 'business_date', private.business_date(), 'timezone', 'America/Denver',
    'open_entry', case when v_open is not null then private.time_entry_result(v_open) end,
    'upcoming_shifts', coalesce((
      select jsonb_agg(jsonb_build_object('shift_id', s.shift_id, 'location_id', s.location_id, 'starts_at', s.starts_at,
        'ends_at', s.ends_at, 'note', s.note) order by s.starts_at)
      from public.shifts s
      where s.employee_id = v_actor and s.status = 'published' and s.ends_at > now() - interval '12 hours'
        and s.starts_at < now() + interval '14 days'), '[]'::jsonb));
end;
$$;

-- Hours per employee per local business date (America/Denver). Managers and the
-- owner see everyone at the location; anyone else sees only their own time.
create function public.get_hours_report(p_location_id text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me text := private.require_actor();
  v_manager boolean;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 62 then
    perform private.raise_error('validation:date_range', jsonb_build_object('rule', 'from <= to, at most 62 days'));
  end if;
  v_manager := private.has_location_role(p_location_id, array['manager']);
  v_from := p_from::timestamp at time zone 'America/Denver';
  v_to := (p_to + 1)::timestamp at time zone 'America/Denver';
  return jsonb_build_object(
    'location_id', p_location_id, 'date_from', p_from, 'date_to', p_to, 'timezone', 'America/Denver',
    'refreshed_at', now(), 'scope', case when v_manager then 'location' else 'own' end,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'display_name', x.display_name,
        'business_date', x.business_date, 'worked_hours', round(x.worked / 3600.0, 2)::text,
        'break_hours', round(x.brk / 3600.0, 2)::text, 'includes_open_entry', x.has_open) order by x.display_name, x.business_date)
      from (
        select t.employee_id, e.display_name, d.business_date, sum(d.worked_seconds) worked, sum(d.break_seconds) brk,
               bool_or(t.clock_out_at is null) has_open
        from public.time_entries t
        join public.employees e on e.employee_id = t.employee_id
        cross join lateral private.time_entry_days(t.time_entry_id) d
        where t.location_id = p_location_id and (v_manager or t.employee_id = v_me)
          and t.clock_in_at < v_to and coalesce(t.clock_out_at, now()) > v_from
          and d.business_date between p_from and p_to
        group by t.employee_id, e.display_name, d.business_date) x), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('time_entry_id', t.time_entry_id, 'employee_id', t.employee_id,
        'display_name', e.display_name, 'clock_in_at', t.clock_in_at, 'clock_out_at', t.clock_out_at, 'version', t.version,
        'open', t.clock_out_at is null, 'unscheduled', t.unscheduled, 'corrected', t.corrected,
        'elapsed_hours', round(extract(epoch from (coalesce(t.clock_out_at, now()) - t.clock_in_at)) / 3600.0, 4)::text,
        'break_hours', round(coalesce((select sum(extract(epoch from (coalesce(b.ends_at, now()) - b.starts_at)))
                                       from public.break_intervals b where b.time_entry_id = t.time_entry_id), 0) / 3600.0, 4)::text,
        'breaks', private.breaks_json(t.time_entry_id),
        'corrections', (select coalesce(jsonb_agg(jsonb_build_object('original_clock_in_at', c.original_clock_in_at,
            'original_clock_out_at', c.original_clock_out_at, 'new_clock_in_at', c.new_clock_in_at,
            'new_clock_out_at', c.new_clock_out_at, 'reason', c.reason, 'corrected_at', c.corrected_at,
            'corrected_by', (select ce.display_name from public.employees ce where ce.employee_id = c.corrected_by))
            order by c.corrected_at), '[]'::jsonb) from public.time_corrections c where c.time_entry_id = t.time_entry_id))
        order by t.clock_in_at desc)
      from public.time_entries t join public.employees e on e.employee_id = t.employee_id
      where t.location_id = p_location_id and (v_manager or t.employee_id = v_me)
        and t.clock_in_at < v_to and coalesce(t.clock_out_at, now()) > v_from), '[]'::jsonb),
    -- Open entries anywhere at the location are exceptions, never auto-closed.
    'open_exceptions', case when v_manager then coalesce((
      select jsonb_agg(jsonb_build_object('time_entry_id', t.time_entry_id, 'display_name', e.display_name,
        'clock_in_at', t.clock_in_at) order by t.clock_in_at)
      from public.time_entries t join public.employees e on e.employee_id = t.employee_id
      where t.location_id = p_location_id and t.clock_out_at is null), '[]'::jsonb) end);
end;
$$;

-- Staff at a location (for the schedule form): managers only.
create function public.list_location_staff(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_location_role(p_location_id, array['manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('employee_id', e.employee_id, 'display_name', e.display_name, 'role', m.role)
      order by e.display_name)
    from public.memberships m join public.employees e on e.employee_id = m.employee_id
    where m.location_id = p_location_id and m.active and e.active), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['shifts', 'time_entries', 'break_intervals', 'time_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- Employees see only their own published shifts; managers see their locations' shifts.
create policy shifts_read on public.shifts for select to authenticated
  using (location_id in (select private.managed_location_ids())
         or (employee_id = (select private.current_employee_id()) and status = 'published'));
create policy time_entries_read on public.time_entries for select to authenticated
  using (location_id in (select private.managed_location_ids()) or employee_id = (select private.current_employee_id()));
create policy break_intervals_read on public.break_intervals for select to authenticated
  using (exists (select 1 from public.time_entries t where t.time_entry_id = break_intervals.time_entry_id
                 and (t.location_id in (select private.managed_location_ids()) or t.employee_id = (select private.current_employee_id()))));
create policy time_corrections_read on public.time_corrections for select to authenticated
  using (exists (select 1 from public.time_entries t where t.time_entry_id = time_corrections.time_entry_id
                 and (t.location_id in (select private.managed_location_ids()) or t.employee_id = (select private.current_employee_id()))));

grant execute on function
  public.create_shift(uuid, text, text, timestamptz, timestamptz, text),
  public.update_shift(uuid, uuid, integer, timestamptz, timestamptz, text, text),
  public.publish_shift(uuid, uuid, integer),
  public.cancel_shift(uuid, uuid, integer, text),
  public.clock_in(uuid, text),
  public.clock_out(uuid),
  public.start_break(uuid),
  public.end_break(uuid),
  public.correct_time_entry(uuid, uuid, integer, timestamptz, timestamptz, text, jsonb),
  public.get_my_time_status(),
  public.get_hours_report(text, date, date),
  public.list_location_staff(text)
to authenticated;

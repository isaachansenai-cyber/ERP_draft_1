-- Milestone 4 invariants: the EOQ formula (AC22), local-day splitting across
-- both America/Denver DST transitions (AC27), schedule and time-entry overlap
-- rules (AC25, AC26) and append-only planning/correction records. Runs against
-- a fresh pilot database; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

-- ------------------------------------------------------------------- EOQ
select is(round(private.eoq(10000, 20, 2), 3), 447.214::numeric, 'EOQ(D=10,000, S=$20, H=$2) = 447.214');
select is(ceil(private.eoq(10000, 20, 2) / 25) * 25, 450::numeric, 'rounded up to 25-unit packs = 450');
select is(private.eoq(0, 20, 2), 0::numeric, 'zero demand with positive H gives 0');
select throws_ok($$select private.eoq(10000, 20, 0)$$, 'P0001', 'validation:eoq_holding_cost_not_positive', 'H = 0 is rejected');
select throws_ok($$select private.eoq(10000, 20, -1)$$, 'P0001', 'validation:eoq_holding_cost_not_positive', 'negative H is rejected');
select throws_ok($$select private.eoq(-1, 20, 2)$$, 'P0001', 'validation:eoq_demand_negative', 'negative D is rejected');
select throws_ok($$select private.eoq(10000, -1, 2)$$, 'P0001', 'validation:eoq_ordering_cost_negative', 'negative S is rejected');

-- ----------------------------------------------------- staff fixtures
insert into public.employees (employee_id, display_name) values ('EMP-9401', 'Time Tester'), ('EMP-9402', 'Time Tester 2');

-- Fall back: 22:00 MDT Oct 31 → 06:00 MST Nov 1 2026 = 9 h; 2 h on Oct 31, 7 h on Nov 1.
insert into public.time_entries (time_entry_id, employee_id, location_id, clock_in_at, clock_out_at, unscheduled)
values ('00000000-0000-0000-0000-00000000c001', 'EMP-9401', 'LOC-PRO', '2026-11-01T04:00:00Z', '2026-11-01T13:00:00Z', true);
select is((select array_agg(business_date::text || '=' || round(worked_seconds / 3600, 2)::text order by business_date)
           from private.time_entry_days('00000000-0000-0000-0000-00000000c001')),
  array['2026-10-31=2.00', '2026-11-01=7.00'], 'fall-back night: 2 h + 7 h at local midnight');
select is((select sum(elapsed_seconds) / 3600 from private.time_entry_days('00000000-0000-0000-0000-00000000c001')),
  9::numeric, 'fall-back night: 9 elapsed hours in total');

-- Spring forward: 22:00 MST Mar 13 → 06:00 MDT Mar 14 2027 = 7 h; 2 h on Mar 13, 5 h on Mar 14.
insert into public.time_entries (time_entry_id, employee_id, location_id, clock_in_at, clock_out_at, unscheduled)
values ('00000000-0000-0000-0000-00000000c002', 'EMP-9401', 'LOC-PRO', '2027-03-14T05:00:00Z', '2027-03-14T12:00:00Z', true);
select is((select array_agg(business_date::text || '=' || round(worked_seconds / 3600, 2)::text order by business_date)
           from private.time_entry_days('00000000-0000-0000-0000-00000000c002')),
  array['2027-03-13=2.00', '2027-03-14=5.00'], 'spring-forward night: 2 h + 5 h at local midnight');
select is((select sum(elapsed_seconds) / 3600 from private.time_entry_days('00000000-0000-0000-0000-00000000c002')),
  7::numeric, 'spring-forward night: 7 elapsed hours in total');

-- A recorded break is subtracted from the local day it falls in.
insert into public.break_intervals (time_entry_id, starts_at, ends_at, recorded_by)
values ('00000000-0000-0000-0000-00000000c002', '2027-03-14T09:00:00Z', '2027-03-14T09:45:00Z', 'EMP-9401');
select is((select round(worked_seconds / 3600, 2) from private.time_entry_days('00000000-0000-0000-0000-00000000c002')
           where business_date = '2027-03-14'), 4.25::numeric, 'a 45-minute break comes off the day it is in');
select throws_ok($$insert into public.break_intervals (time_entry_id, starts_at, ends_at, recorded_by)
  values ('00000000-0000-0000-0000-00000000c002', '2027-03-14T09:30:00Z', '2027-03-14T10:00:00Z', 'EMP-9401')$$,
  '23P01', null, 'breaks within an entry cannot overlap');

-- ------------------------------------------------------- time-entry rules
select throws_ok($$insert into public.time_entries (employee_id, location_id, clock_in_at, clock_out_at, unscheduled)
  values ('EMP-9401', 'LOC-SFO', '2026-11-01T12:00:00Z', '2026-11-01T15:00:00Z', true)$$,
  '23P01', null, 'closed entries for one employee cannot overlap, even across locations');
select throws_ok($$insert into public.time_entries (employee_id, location_id, clock_in_at, clock_out_at, unscheduled)
  values ('EMP-9401', 'LOC-PRO', '2026-12-01T12:00:00Z', '2026-12-01T11:00:00Z', true)$$,
  '23514', null, 'clock-out must be later than clock-in');
insert into public.time_entries (employee_id, location_id, clock_in_at, unscheduled)
values ('EMP-9402', 'LOC-PRO', '2026-12-02T15:00:00Z', true);
select throws_matching($$insert into public.time_entries (employee_id, location_id, clock_in_at, unscheduled)
  values ('EMP-9402', 'LOC-SLC', '2026-12-10T15:00:00Z', true)$$,
  'time_entries_(one_open|no_overlap)', 'at most one open entry per employee across all locations');

-- --------------------------------------------------------------- shifts
insert into public.shifts (shift_id, location_id, employee_id, starts_at, ends_at, created_by)
values ('00000000-0000-0000-0000-00000000d001', 'LOC-PRO', 'EMP-9401', '2026-12-05T15:00:00Z', '2026-12-05T23:00:00Z', 'EMP-9401');
select throws_ok($$insert into public.shifts (location_id, employee_id, starts_at, ends_at, created_by)
  values ('LOC-SFO', 'EMP-9401', '2026-12-05T22:00:00Z', '2026-12-06T02:00:00Z', 'EMP-9401')$$,
  '23P01', null, 'overlapping shifts for one employee fail, even at another location');
update public.shifts set status = 'cancelled', cancelled_at = now() where shift_id = '00000000-0000-0000-0000-00000000d001';
select lives_ok($$insert into public.shifts (location_id, employee_id, starts_at, ends_at, created_by)
  values ('LOC-SFO', 'EMP-9401', '2026-12-05T22:00:00Z', '2026-12-06T02:00:00Z', 'EMP-9401')$$,
  'a cancelled shift no longer blocks the slot');
select throws_ok($$insert into public.shifts (location_id, employee_id, starts_at, ends_at, created_by)
  values ('LOC-PRO', 'EMP-9402', '2026-12-05T22:00:00Z', '2026-12-05T21:00:00Z', 'EMP-9401')$$,
  '23514', null, 'a shift must end after it starts');

-- ------------------------------------------------------- append-only and grants
insert into public.time_corrections (time_entry_id, original_clock_in_at, original_clock_out_at, original_breaks,
  new_clock_in_at, new_clock_out_at, new_breaks, reason, corrected_by)
values ('00000000-0000-0000-0000-00000000c001', '2026-11-01T04:00:00Z', '2026-11-01T13:00:00Z', '[]', '2026-11-01T04:00:00Z',
  '2026-11-01T12:00:00Z', '[]', 'Test correction', 'EMP-9402');
select throws_ok($$update public.time_corrections set reason = 'changed'$$, 'P0001', null, 'time corrections are immutable');
select throws_ok($$delete from public.time_corrections$$, 'P0001', null, 'time corrections cannot be deleted');
select throws_ok($$insert into public.forecast_overrides (location_id, item_id, business_date, quantity, reason, set_by)
  values ('LOC-PRO', 'ING-001', current_date, 5, 'not sellable', 'EMP-9401')$$,
  '23503', null, 'forecast overrides are for sellable items only');
select ok(not has_table_privilege('authenticated', 'public.time_entries', 'INSERT,UPDATE,DELETE'),
  'API roles cannot write time entries directly');
select ok(not has_table_privilege('authenticated', 'public.shifts', 'INSERT,UPDATE,DELETE'),
  'API roles cannot write shifts directly');
select ok(not has_table_privilege('authenticated', 'public.location_item_settings', 'INSERT,UPDATE,DELETE'),
  'API roles cannot write planning settings directly');
select ok((select relrowsecurity from pg_class where oid = 'public.time_entries'::regclass), 'RLS is enabled on time entries');

select * from finish();
rollback;

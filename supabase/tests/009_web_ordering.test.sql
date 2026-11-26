-- Public pickup website (0027): what a visitor (public anon key, no sign-in) and
-- a signed-in account without an employee can reach, the system actor, the gate,
-- grants and the pickup-slot rule with a fixed clock, including both DST changes.
-- Fresh pilot database; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(41);

select ok(public.get_schema_version() >= 27, 'schema version includes 0027 (010 checks the latest)');

-- Schema, RLS and grants ------------------------------------------------------
select has_table('public', t, t || ' exists')
from unnest(array['location_opening_hours', 'web_ordering_settings', 'web_menu_content', 'web_order_contacts']) t;
select ok(bool_and(c.relrowsecurity), 'row level security is on for every new web table')
from pg_class c where c.oid in ('public.location_opening_hours'::regclass, 'public.web_ordering_settings'::regclass,
                                'public.web_menu_content'::regclass, 'public.web_order_contacts'::regclass);
select ok(not bool_or(has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update')
                      or has_table_privilege('anon', t, 'select')),
          'clients cannot write the web tables, and anon cannot read them')
from unnest(array['public.location_opening_hours', 'public.web_ordering_settings', 'public.web_menu_content',
                  'public.web_order_contacts']) t;
select has_column('public', 'orders', 'channel', 'orders record their channel');
select has_column('public', 'items', 'prep_minutes', 'items carry pickup-day cook minutes');
select ok(bool_and(has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute')),
          'web functions are callable with the public anon key (visitors do not sign in)')
from unnest(array['public.web_get_locations()', 'public.web_get_menu(text)', 'public.web_get_pickup_slots(text, jsonb)',
                  'public.web_place_order(uuid, text, jsonb, jsonb, timestamptz, text)', 'public.web_get_order(uuid)',
                  'public.web_get_request_result(uuid)']) f;
select ok(not bool_or(has_function_privilege('anon', f, 'execute')), 'owner web settings need a signed-in owner, never the anon key')
from unnest(array['public.set_web_ordering_settings(uuid, text, boolean, integer, integer, integer)',
                  'public.set_location_opening_hours(uuid, text, jsonb)', 'public.set_item_prep_minutes(uuid, text, integer)',
                  'public.set_web_menu_content(uuid, text, text, text, text, text, boolean)']) f;
select ok(not bool_or(has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')),
          'private web helpers are not callable')
from unnest(array['private.accept_order_core(text, uuid, text, jsonb, text, text, text, numeric, text, text, text, timestamptz)',
                  'private.web_pickup_slots(text, text[], timestamptz)', 'private.web_order_result(uuid)',
                  'private.require_order_gates(text)', 'private.portions_available(text)']) f;

-- System actor ----------------------------------------------------------------
select is((select display_name from public.employees where employee_id = 'EMP-WEB'), 'Online ordering',
  'the system employee that accepts web orders exists');
select throws_ok($$insert into public.memberships (employee_id, role, location_id) values ('EMP-WEB', 'employee', 'LOC-PRO')$$,
  '23514', null, 'the system employee can never be given a role');
select throws_ok($$update public.employees set auth_user_id = gen_random_uuid() where employee_id = 'EMP-WEB'$$,
  '23514', null, 'the system employee cannot be linked to a login');

-- Gate --------------------------------------------------------------------------
select is((select count(*)::int from public.pilot_setup_gates where gate_key = 'web_ordering_enabled' and status = 'open'), 3,
  'web_ordering_enabled starts open at all three locations');
select is((private.gate_precondition_failure(g)) ->> 'reason', 'web_settings_not_entered',
  'the web gate cannot be confirmed before the settings exist')
from public.pilot_setup_gates g where g.gate_key = 'web_ordering_enabled' and g.scope_id = 'LOC-PRO';

-- What callers outside the staff can reach ---------------------------------------
-- Calls every public function the given role may execute, with null arguments,
-- as that role (and the current JWT claims). Returns the ones that answered
-- with data instead of refusing (an exception) or answering empty.
create function pg_temp.functions_answering(p_role text) returns text[] language plpgsql as $f$
declare
  r record;
  v_out text;
  v_rows bigint;
  v_hits text[] := '{}';
begin
  execute format('set local role %I', p_role);
  for r in
    select p.oid, p.proname, p.proretset,
           coalesce((select string_agg('null::' || format_type(t, null), ', ' order by ord)
                     from unnest(p.proargtypes::oid[]) with ordinality a(t, ord)), '') as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege(p_role, p.oid, 'execute') and p.prokind = 'f'
    order by p.proname
  loop
    begin
      if r.proretset then
        execute format('select count(*) from public.%I(%s)', r.proname, r.args) into v_rows;
        v_out := case when v_rows > 0 then v_rows::text end;
      else
        execute format('select (public.%I(%s))::text', r.proname, r.args) into v_out;
      end if;
      if v_out is not null and v_out not in ('[]', '{}', 'null', '0', '') and v_out not like '{"ok": false%' then
        v_hits := v_hits || r.proname::text;
      end if;
    exception when others then
      null; -- refused
    end;
  end loop;
  reset role;
  return v_hits;
end;
$f$;

-- A website visitor: the anon key, no JWT subject.
select is(pg_temp.functions_answering('anon'),
  array['get_public_app_mode', 'web_get_locations', 'web_get_request_result']::text[],
  'with the anon key, only the app mode and the web functions answer');
set local role anon;
select throws_ok($$select count(*) from public.items$$, '42501', null, 'a visitor cannot read the items table');
select throws_ok($$select count(*) from public.orders$$, '42501', null, 'a visitor cannot read orders');
select throws_ok($$select public.list_stock_items('LOC-PRO')$$, '42501', null, 'a visitor cannot call staff functions');
select is(jsonb_array_length(public.web_get_locations()), 3, 'web_get_locations lists the three locations');
select ok((select bool_and((l ->> 'ordering_open')::boolean = false and l ->> 'status_reason' = 'posting_disabled')
           from jsonb_array_elements(public.web_get_locations()) l),
  'a fresh pilot shows every location as closed for web orders');
select throws_ok($$select public.web_place_order(gen_random_uuid(), 'LOC-PRO', '[{"item_id":"FG-001","quantity":1}]',
    '{"name":"Ana","phone":"801-555-0100","email":"ana@example.com"}', now() + interval '1 day')$$,
  'P0001', 'setup_gate_closed:posting_enabled', 'a fresh pilot refuses web orders until posting is enabled');
reset role;

-- Defense in depth: a signed-in account with no active employee (for example a
-- deactivated staff member) reads no reference tables and no staff data.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a0001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.items) + (select count(*)::int from public.recipe_components)
          + (select count(*)::int from public.locations) + (select count(*)::int from public.app_settings)
          + (select count(*)::int from public.pilot_setup_gates) + (select count(*)::int from public.web_menu_content), 0,
  'an account without an employee reads no items, recipes, locations, settings, gates or web content');
reset role;
select is(pg_temp.functions_answering('authenticated'),
  array['get_my_context', 'get_public_app_mode', 'get_schema_version', 'web_get_locations',
        'web_get_request_result']::text[],
  'an account without an employee gets answers only from the public reads and the web functions');
select set_config('request.jwt.claims', '', true);

-- Pickup slots with a fixed clock -------------------------------------------------
insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, source, provenance,
  prep_lead_days, prep_minutes)
values ('FG-971', 'Same day 25 min', 'finished_dish', 'Dish', 'serving', true, 'FG-971', 'test', 'source', 0, 25),
       ('FG-972', 'Overnight then 15 min', 'finished_dish', 'Dish', 'serving', true, 'FG-972', 'test', 'source', 1, 15),
       ('FG-973', 'Same day 2 hours', 'finished_dish', 'Dish', 'serving', true, 'FG-973', 'test', 'source', 0, 120),
       ('FG-974', 'No cook time yet', 'finished_dish', 'Dish', 'serving', true, 'FG-974', 'test', 'source', 0, null),
       ('RET-971', 'Bottled sauce', 'retail', 'Retail', 'each', true, 'RET-971', 'test', 'source', null, null);
insert into public.web_ordering_settings (location_id, enabled) values ('LOC-PRO', true);
insert into public.location_opening_hours (location_id, weekday, opens_at, closes_at)
select 'LOC-PRO', d, '12:00', '20:00' from generate_series(1, 7) d;

create function pg_temp.first_slot(p_items text[], p_now timestamptz) returns text language sql as $$
  select to_char(min(s.pickup_at) at time zone 'America/Denver', 'Dy YYYY-MM-DD HH24:MI')
  from private.web_pickup_slots('LOC-PRO', p_items, p_now) s;
$$;

-- Tuesday 2026-12-01, 17:00 in Denver.
select is(pg_temp.first_slot(array['FG-971'], '2026-12-01 17:00 America/Denver'), 'Tue 2026-12-01 17:30',
  'a 25-minute dish ordered at 17:00 is ready from 17:30 (rounded up to the slot)');
select is(pg_temp.first_slot(array['FG-973'], '2026-12-01 17:00 America/Denver'), 'Tue 2026-12-01 19:00',
  'a 2-hour dish ordered at 17:00 is ready from 19:00');
select is(pg_temp.first_slot(array['FG-973'], '2026-12-01 18:00 America/Denver'), 'Wed 2026-12-02 14:00',
  'a 2-hour dish ordered at 18:00 rolls to the next day: noon start plus 2 hours');
select is(pg_temp.first_slot(array['FG-972'], '2026-12-01 17:00 America/Denver'), 'Wed 2026-12-02 12:15',
  'an overnight dish is ready from 12:15 the next day');
select is(pg_temp.first_slot(array['FG-972', 'FG-973'], '2026-12-01 17:00 America/Denver'), 'Wed 2026-12-02 14:00',
  'the slowest item decides: overnight dish plus 2-hour dish is ready from 14:00 the next day');
select is(pg_temp.first_slot(array['FG-971'], '2026-12-01 09:00 America/Denver'), 'Tue 2026-12-01 12:30',
  'before opening, cooking starts at noon');
select is(pg_temp.first_slot(array['RET-971'], '2026-12-01 09:00 America/Denver'), 'Tue 2026-12-01 12:00',
  'a retail sauce is ready at opening');
select is((select to_char(max(s.pickup_at) at time zone 'America/Denver', 'YYYY-MM-DD HH24:MI')
           from private.web_pickup_slots('LOC-PRO', array['RET-971'], '2026-12-01 09:00 America/Denver') s),
  '2026-12-08 19:45', 'slots run to 19:45 on the 7th day ahead');
select is((select count(*)::int from private.web_pickup_slots('LOC-PRO', array['RET-971'], '2026-12-01 09:00 America/Denver')),
  8 * 32, '32 fifteen-minute slots a day for 8 days');
select throws_ok($$select * from private.web_pickup_slots('LOC-PRO', array['FG-974'], now())$$, 'P0001',
  'validation:prep_minutes_missing', 'a dish without cook minutes cannot be scheduled');

-- Closed days are skipped, and lead days count open days only.
insert into public.location_closures (location_id, business_date, reason) values ('LOC-PRO', '2026-12-02', 'Test closure');
select is(pg_temp.first_slot(array['FG-972'], '2026-12-01 17:00 America/Denver'), 'Thu 2026-12-03 12:15',
  'an overnight dish skips a closed day');
select is(pg_temp.first_slot(array['FG-973'], '2026-12-01 18:00 America/Denver'), 'Thu 2026-12-03 14:00',
  'a same-day dish rolls past a closed day');
select is((select count(*)::int from private.web_pickup_slots('LOC-PRO', array['RET-971'], '2026-12-01 09:00 America/Denver')),
  7 * 32, 'the closed day offers no slots');

-- Daylight saving changes (America/Denver): local noon stays noon.
select is(min(s.pickup_at), '2026-11-01 19:15:00+00'::timestamptz,
  'fall back: ordered Saturday 2026-10-31, ready Sunday 12:15 MST (19:15 UTC)')
from private.web_pickup_slots('LOC-PRO', array['FG-972'], '2026-10-31 17:00 America/Denver') s;
select is(min(s.pickup_at), '2027-03-14 18:15:00+00'::timestamptz,
  'spring forward: ordered Saturday 2027-03-13, ready Sunday 12:15 MDT (18:15 UTC)')
from private.web_pickup_slots('LOC-PRO', array['FG-972'], '2027-03-13 17:00 America/Denver') s;

select * from finish();
rollback;

-- Demo-mode switch/reset and manager PIN override (CLAUDE.md D4, D5, §7; AC02).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

-- ------------------------------------------------------------ manager PIN
insert into public.employees (employee_id, display_name) values
  ('EMP-9101', 'PRO manager'), ('EMP-9102', 'PRO employee'), ('EMP-9103', 'SLC manager');
insert into public.memberships (employee_id, role, location_id) values
  ('EMP-9101', 'manager', 'LOC-PRO'), ('EMP-9102', 'employee', 'LOC-PRO'), ('EMP-9103', 'manager', 'LOC-SLC');
insert into private.manager_pins (employee_id, pin_hash) values ('EMP-9101', extensions.crypt('482913', extensions.gen_salt('bf', 4)));

select ok(private.pin_is_weak('111111') and private.pin_is_weak('123456') and private.pin_is_weak('987654'),
  'repeated and sequential PINs are rejected as weak');
select ok(not private.pin_is_weak('482913'), 'a non-trivial PIN is accepted');
select is(private.check_manager_pin('EMP-9101', '482913', 'LOC-PRO'), null, 'correct PIN from a manager of the location approves');
select is(private.check_manager_pin('EMP-9101', '482913', 'LOC-SLC'), 'approver_not_authorized', 'a manager cannot approve at another location');
select is(private.check_manager_pin('EMP-9102', '482913', 'LOC-PRO'), 'approver_not_authorized', 'an employee can never approve');
select is(private.check_manager_pin('EMP-9103', '000000', 'LOC-SLC'), 'pin_not_set', 'a manager without a PIN cannot approve');
select is(private.check_manager_pin('EMP-9101', '000001', 'LOC-PRO'), 'pin_invalid', 'wrong PIN #1');
select private.check_manager_pin('EMP-9101', '000002', 'LOC-PRO');
select private.check_manager_pin('EMP-9101', '000003', 'LOC-PRO');
select private.check_manager_pin('EMP-9101', '000004', 'LOC-PRO');
select is(private.check_manager_pin('EMP-9101', '000005', 'LOC-PRO'), 'pin_locked', 'the 5th wrong PIN locks the PIN');
select is(private.check_manager_pin('EMP-9101', '482913', 'LOC-PRO'), 'pin_locked', 'even the correct PIN is refused while locked');
select ok((select locked_until > now() + interval '14 minutes' and locked_until <= now() + interval '15 minutes'
             from private.manager_pins where employee_id = 'EMP-9101'), 'lockout lasts 15 minutes');
select ok((select pin_hash not like '%482913%' and pin_hash like '$2%' from private.manager_pins where employee_id = 'EMP-9101'),
  'only a bcrypt hash of the PIN is stored');

-- Clean up identity rows so the database is pristine again for the demo checks.
delete from private.manager_pins;
delete from public.memberships;
delete from public.employees;

-- ------------------------------------------------------------- demo mode
select throws_ok($$select private.enable_demo_mode('not a dataset')$$, 'P0001', 'validation:dataset_id', 'dataset id is validated');
select lives_ok($$select private.enable_demo_mode('demo-2026-v1')$$, 'a pristine database can be switched to demo mode');
select is((select data_mode || '/' || dataset_id from public.app_settings), 'demo/demo-2026-v1', 'demo mode and dataset recorded');
select lives_ok($$insert into public.customers (customer_id, display_name, email, provenance)
                  values ('DEMO-CUST-01', 'Demo Customer 01', 'customer01@example.invalid', 'synthetic_demo_fixture')$$,
  'synthetic fixtures are accepted in a demo database');
select lives_ok($$select private.reset_demo_data()$$, 'demo reset runs in a demo database');
select is((select count(*)::int from public.customers), 0, 'demo reset removed demo customers');

select * from finish();
rollback;

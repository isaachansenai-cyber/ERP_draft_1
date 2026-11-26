-- Website checkout (0028): web_get_menu reports the location's current tax rate.
-- Fresh pilot database; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

select ok(public.get_schema_version() >= 28, 'schema version includes 0028 (011 checks the latest)');
select ok(has_function_privilege('anon', 'public.web_get_menu(text)', 'execute'), 'visitors can still read the menu');

set local role anon;
select is(public.web_get_menu('LOC-PRO') ->> 'tax_rate', null, 'no tax rate entered: the menu says so (null)');
reset role;

insert into public.location_tax_rates (location_id, effective_from, rate, provenance)
values ('LOC-PRO', current_date - 30, 0.0725, 'test'), ('LOC-PRO', current_date + 30, 0.0800, 'test');
set local role anon;
select is(public.web_get_menu('LOC-PRO') ->> 'tax_rate', '0.072500',
  'the menu reports the rate in force today as exact text, not a future one');
reset role;

select * from finish();
rollback;

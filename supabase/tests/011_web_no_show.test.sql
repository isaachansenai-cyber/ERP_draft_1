-- Website no-shows (0029): reason code and grants. Behavior is tested through
-- the API in tests/integration/demo/web-ordering.test.ts. Fresh pilot; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

select is(public.get_schema_version(), 29, 'schema version is the latest migration');
select is((select applies_to from public.reason_codes where code = 'NO_SHOW'), array['cancellation']::text[],
  'NO_SHOW is a cancellation reason');
select ok(has_function_privilege('authenticated', 'public.cancel_uncollected_web_orders(uuid, text)', 'execute'),
  'signed-in staff reach the no-show action (it checks for a manager)');
select ok(not has_function_privilege('anon', 'public.cancel_uncollected_web_orders(uuid, text)', 'execute'),
  'website visitors cannot reach it');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000b0001","role":"authenticated"}', true);
select throws_ok($$select public.cancel_uncollected_web_orders(gen_random_uuid(), 'LOC-PRO')$$, 'P0001', 'unauthorized',
  'an account without an employee is refused');
reset role;

select * from finish();
rollback;

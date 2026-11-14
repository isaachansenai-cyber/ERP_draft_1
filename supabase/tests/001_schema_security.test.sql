-- Schema-level security invariants (PRD §15, AC03, AC30/AC31 groundwork).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'RLS is enabled on every public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'API roles have no write privileges on any public table (writes go through RPCs)');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'anon cannot read any public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'private' and grantee in ('anon', 'authenticated')),
  0, 'no private table is granted to an API role');

select is(
  (select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  array['get_public_app_mode']::text[],
  'anon can execute only get_public_app_mode');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig::text[] @> array['search_path=""'], false)),
  0, 'every SECURITY DEFINER function pins an empty search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('enable_demo_mode', 'reset_demo_data', 'confirm_gates_for_demo', 'bootstrap_owner',
                        'check_manager_pin', 'idem_begin', 'write_audit', 'convert_to_base')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  0, 'demo/reset/bootstrap/PIN/idempotency/audit internals are not executable by authenticated');

select ok(
  not has_function_privilege('authenticated', 'private.reset_demo_data()', 'execute')
  and not has_function_privilege('service_role', 'private.reset_demo_data()', 'execute'),
  'demo reset is not reachable through the API, even with the service role');

select is(
  (select count(*)::int from pg_views where schemaname = 'public'),
  0, 'no public views exist that could bypass RLS through their owner');

select is((select data_mode from public.app_settings), 'pilot', 'a freshly migrated database is in pilot mode');
select is((select posting_enabled from public.app_settings), false, 'posting is disabled by default');

select is(
  (select count(*)::int from public.pilot_setup_gates),
  17, 'company (5) and location (4 x 3) setup gates exist after migration, all open');

select * from finish();
rollback;

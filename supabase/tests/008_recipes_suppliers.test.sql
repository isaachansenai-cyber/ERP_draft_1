-- Schema version (0024), recipe editing (0025) and supplier change requests
-- (0026): schema, grants and invariants. Fresh pilot database; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

-- Schema version ------------------------------------------------------------
select is(public.get_schema_version(), 26, 'schema version is the latest migration');
select ok(not has_function_privilege('anon', 'public.get_schema_version()', 'execute')
  and has_function_privilege('authenticated', 'public.get_schema_version()', 'execute'), 'signed-in users read the schema version');

-- Recipe editing ------------------------------------------------------------
select has_column('public', 'recipe_versions', 'draft_revision', 'drafts carry a revision for conflict checks');
select has_index('public', 'recipe_versions', 'recipe_versions_one_draft', 'at most one draft per dish');
select ok(not has_function_privilege('anon', 'public.start_recipe_draft(uuid, text)', 'execute'), 'anon cannot start drafts');
select ok(has_function_privilege('authenticated', 'public.activate_recipe_version(uuid, uuid, integer, text)', 'execute'),
  'signed-in users reach activate (the function checks for the owner)');
select ok(not has_function_privilege('authenticated', 'private.lock_recipe_draft(uuid, integer)', 'execute'),
  'private recipe helpers are not callable');

insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, source, provenance)
values ('FG-981', 'Test dish', 'finished_dish', 'Dish', 'serving', true, 'FG-981', 'test', 'source');
insert into public.recipe_versions (recipe_version_id, parent_item_id, version_no, status, basis, source, provenance)
values ('00000000-0000-0000-0000-00000000e001', 'FG-981', 1, 'draft', 'test', 'test', 'source');
select throws_ok(
  $$insert into public.recipe_versions (parent_item_id, version_no, status, basis, source, provenance)
    values ('FG-981', 3, 'draft', 'test', 'test', 'source')$$,
  '23505', null, 'a second draft for the same dish is refused');

-- Supplier change requests --------------------------------------------------
select has_table('public', 'supplier_change_requests', 'change request table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_change_requests'::regclass),
  'row level security is on for change requests');
select ok(not has_table_privilege('authenticated', 'public.supplier_change_requests', 'insert'),
  'clients cannot insert change requests directly');
select ok(not has_table_privilege('authenticated', 'public.supplier_change_requests', 'update'),
  'clients cannot update change requests directly');
select has_column('public', 'suppliers', 'version', 'suppliers carry a version for conflict checks');
select has_column('public', 'supplier_items', 'lead_updated_at', 'lead-time edits are time-stamped');

insert into public.suppliers (supplier_id, name, source, provenance) values ('SUP-98', 'Request supplier', 'test', 'source');
insert into public.employees (employee_id, display_name, provenance) values ('EMP-T98', 'Requester', 'test');
insert into public.supplier_change_requests (request_id, supplier_id, location_id, requested_by, supplier_version_at_request,
  proposed, current_at_request, note)
values ('00000000-0000-0000-0000-00000000f001', 'SUP-98', 'LOC-PRO', 'EMP-T98', 1, '{"phone": "801 555 0100"}', '{}', 'From the rep');

select throws_ok(
  $$insert into public.supplier_change_requests (supplier_id, location_id, requested_by, supplier_version_at_request,
      proposed, current_at_request, note)
    values ('SUP-98', 'LOC-PRO', 'EMP-T98', 1, '{}', '{}', '  ')$$,
  '23514', null, 'a request needs a note');
select throws_ok(
  $$update public.supplier_change_requests set status = 'rejected', decided_at = now(), decision_note = null
     where request_id = '00000000-0000-0000-0000-00000000f001'$$,
  '23514', null, 'a rejection needs a reason');
select throws_ok(
  $$update public.supplier_change_requests set proposed = '{"phone": "1"}'
     where request_id = '00000000-0000-0000-0000-00000000f001'$$,
  'P0001', 'immutable:supplier_change_request', 'the proposal cannot be rewritten while pending');
select lives_ok(
  $$update public.supplier_change_requests set status = 'approved', version = 2, decided_at = now()
     where request_id = '00000000-0000-0000-0000-00000000f001'$$,
  'a pending request can be decided');
select throws_ok(
  $$update public.supplier_change_requests set decision_note = 'changed my mind'
     where request_id = '00000000-0000-0000-0000-00000000f001'$$,
  'P0001', 'immutable:supplier_change_request', 'a decided request is history');
select throws_ok(
  $$delete from public.supplier_change_requests where request_id = '00000000-0000-0000-0000-00000000f001'$$,
  'P0001', 'immutable:supplier_change_request', 'requests cannot be deleted');

select * from finish();
rollback;

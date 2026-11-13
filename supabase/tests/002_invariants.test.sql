-- Data invariants enforced in the database (PRD §5, §6, §14, §15; AC02, AC04, AC09, AC31).
-- Runs against a freshly migrated (pilot-mode) database; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

-- ---------------------------------------------------------------- data mode
select throws_ok($$update public.app_settings set data_mode = 'demo'$$, 'P0001', 'forbidden:data_mode_change',
  'data_mode cannot be changed by a plain UPDATE');
select throws_ok($$delete from public.app_settings$$, 'P0001', 'immutable:app_settings', 'app_settings cannot be deleted');

-- ------------------------------------------------- synthetic data blocked in pilot
select throws_ok($$insert into public.customers (customer_id, display_name, provenance)
                   values ('DEMO-CUST-99', 'X', 'synthetic_demo_fixture')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'synthetic customer rejected in pilot');
select throws_ok($$insert into public.customers (customer_id, display_name, email, provenance)
                   values ('CUST-0001', 'X', 'x@example.invalid', 'pilot_operator_entered')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'example.invalid email rejected in pilot');
select throws_ok($$insert into public.employees (employee_id, display_name) values ('DEMO-OWNER', 'X')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'demo staff fixture id rejected in pilot');
select throws_ok($$insert into public.location_tax_rates (location_id, effective_from, rate, provenance)
                   values ('LOC-PRO', '2026-05-01', 0.0725, 'synthetic; not a verified Utah rate')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'synthetic tax rate rejected in pilot');
select throws_ok($$insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, source, provenance)
                   values ('RET-001', 'Sauce', 'retail', 'Retail', 'each', true, 'RET-001', 'generated', 'synthetic_demo_fixture')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'synthetic retail item rejected in pilot');
select throws_ok($$insert into public.historical_sales_orders (dataset_id, historical_order_id, business_date, created_at_local,
                     timezone, location_id, status, net_before_refund_cents, tax_before_refund_cents, refund_net_cents,
                     refund_tax_cents, historical_cogs_cents, payment_mode, provenance)
                   values ('demo-2026-v1', 'H-1', '2026-05-01', '2026-05-01 12:00', 'America/Denver', 'LOC-PRO', 'completed',
                     100, 7, 0, 0, 10, 'SIMULATED', 'synthetic_history_snapshot')$$,
  'P0001', 'forbidden:synthetic_data_in_pilot', 'historical demo sales rejected in pilot');
select throws_ok($$truncate public.historical_sales_orders, public.historical_sales_lines$$,
  'P0001', 'forbidden:truncate_outside_demo', 'history cannot be truncated outside demo');
select throws_ok($$truncate public.audit_log$$, 'P0001', 'forbidden:truncate_outside_demo', 'audit log cannot be truncated in pilot');
select throws_ok($$select private.reset_demo_data()$$, 'P0001', 'forbidden:not_demo_database', 'demo reset refuses a pilot database');

-- ------------------------------------------------------------- append-only
select private.write_audit(null, 'test.event', 'test', '1', null, null, null, null, null, null, 'migration');
select throws_ok($$update public.audit_log set note = 'x'$$, 'P0001', 'immutable:audit_log', 'audit rows cannot be updated');
select throws_ok($$delete from public.audit_log$$, 'P0001', 'immutable:audit_log', 'audit rows cannot be deleted');

insert into public.employees (employee_id, display_name) values ('EMP-9001', 'Test Owner');
insert into public.location_tax_rates (location_id, effective_from, rate, provenance) values ('LOC-PRO', '2030-01-01', 0.07, 'pilot_operator_entered');
select throws_ok($$update public.location_tax_rates set rate = 0.08$$, 'P0001', 'immutable:location_tax_rates',
  'tax rates are append-only (history is never rewritten)');

-- ---------------------------------------------------- catalog and recipes
insert into public.suppliers (supplier_id, name, source, provenance) values ('SUP-99', 'Test supplier', 'test', 'source');
insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, primary_supplier_id, source, provenance) values
  ('ING-901', 'Test flour', 'ingredient', 'Dry', 'g', false, 'ING-901', 'SUP-99', 'test', 'source'),
  ('ING-902', 'Test milk', 'ingredient', 'Dairy', 'ml', false, 'ING-902', 'SUP-99', 'test', 'source'),
  ('FG-901', 'Test dish', 'finished_dish', 'Menu Item', 'serving', true, 'FG-901', null, 'test', 'source');

select throws_ok($$insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, source, provenance)
                   values ('ING-903', 'Bad', 'ingredient', 'Dry', 'g', true, 'ING-903', 'test', 'source')$$,
  '23514', null, 'ingredients can never be sellable');
select throws_ok($$insert into public.location_item_prices (location_id, item_id, price_cents, effective_from, provenance)
                   values ('LOC-PRO', 'ING-901', 100, '2030-01-01', 'pilot_operator_entered')$$,
  '23503', null, 'a POS price cannot be attached to an ingredient');

insert into public.recipe_versions (recipe_version_id, parent_item_id, version_no, basis, source, provenance)
values ('00000000-0000-0000-0000-000000000901', 'FG-901', 1, 'test', 'test', 'source');
insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
values ('00000000-0000-0000-0000-000000000901', 1, 'ING-901', 'g', 180, 'test', 'test');
select throws_ok($$insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
                   values ('00000000-0000-0000-0000-000000000901', 2, 'ING-902', 'g', 10, 'test', 'test')$$,
  '23503', null, 'a recipe component must use the ingredient base unit (no g for an ml item)');
select throws_ok($$insert into public.recipe_components (recipe_version_id, line_no, component_item_id, component_item_type, unit, quantity_per_serving, basis, source)
                   values ('00000000-0000-0000-0000-000000000901', 2, 'FG-901', 'finished_dish', 'serving', 1, 'test', 'test')$$,
  '23514', null, 'no nested recipes: components must be ingredients');
update public.recipe_versions set status = 'active', activated_at = now() where recipe_version_id = '00000000-0000-0000-0000-000000000901';
select throws_ok($$update public.recipe_components set quantity_per_serving = 999 where recipe_version_id = '00000000-0000-0000-0000-000000000901'$$,
  'P0001', 'immutable:recipe_version', 'components of an active version cannot change');
select throws_ok($$insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
                   values ('00000000-0000-0000-0000-000000000901', 2, 'ING-902', 'ml', 10, 'test', 'test')$$,
  'P0001', 'immutable:recipe_version', 'components cannot be added to an active version');
select throws_ok($$update public.recipe_versions set basis = 'changed' where recipe_version_id = '00000000-0000-0000-0000-000000000901'$$,
  'P0001', 'immutable:recipe_version', 'an active version cannot be edited');
select lives_ok($$update public.recipe_versions set status = 'superseded', superseded_at = now()
                  where recipe_version_id = '00000000-0000-0000-0000-000000000901'$$,
  'an active version can only be superseded');
select is((select quantity_per_serving::text from public.recipe_components where recipe_version_id = '00000000-0000-0000-0000-000000000901'),
  '180.000000', 'superseding keeps the historical component quantity unchanged');

-- ------------------------------------------------------- unit conversion
select is(private.convert_to_base('ING-901', 2.5, 'kg'), 2500.000000::numeric, 'kg → g within the mass dimension');
select is(private.convert_to_base('ING-901', 20000, 'g'), 20000::numeric, 'base unit passes through unchanged');
select throws_ok($$select private.convert_to_base('ING-901', 1, 'ml')$$, 'P0001', 'validation:unverified_conversion',
  'ml → g is rejected without an item-specific verified conversion');
insert into public.item_unit_conversions (item_id, from_unit, base_qty_per_unit, verified_by, evidence_note)
values ('ING-901', 'ml', 0.6, 'EMP-9001', 'weighed 1 L of this flour = 600 g');
select is(private.convert_to_base('ING-901', 100, 'ml'), 60.000000::numeric, 'verified item-specific conversion is applied');

-- ------------------------------------------------------------ setup gates
select throws_ok($$select private.require_gate('tax_rate_confirmed', 'LOC-PRO')$$, 'P0001', 'setup_gate_closed:tax_rate_confirmed',
  'an open gate blocks its workflow');
select throws_ok($$select private.require_posting_enabled()$$, 'P0001', 'setup_gate_closed:posting_enabled',
  'operational posting is blocked until the final switch');
select is(
  private.gate_precondition_failure((select g from public.pilot_setup_gates g where gate_key = 'opening_counts_posted' and scope_id = 'LOC-PRO'))->>'reason',
  'workflow_not_yet_available', 'opening counts cannot be confirmed before the stock ledger exists');

-- ------------------------------------------------------------- idempotency
select is(private.idem_begin('EMP-9001', 'test_rpc', '00000000-0000-0000-0000-0000000000a1'), null, 'first call proceeds');
select private.idem_finish('EMP-9001', '00000000-0000-0000-0000-0000000000a1', '{"ok": true, "id": 1}');
select is(private.idem_begin('EMP-9001', 'test_rpc', '00000000-0000-0000-0000-0000000000a1'),
  '{"ok": true, "id": 1, "replayed": true}'::jsonb, 'a retry with the same key returns the stored result');
select throws_ok($$select private.idem_begin('EMP-9001', 'other_rpc', '00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'conflict:request_key_reused', 'a key cannot be reused for a different RPC');

-- ----------------------------------------------------- pilot → demo safety
select throws_ok($$select private.enable_demo_mode('demo-2026-v1')$$, 'P0001', 'forbidden:database_not_pristine',
  'a database with staff records cannot be switched to demo mode');

select * from finish();
rollback;

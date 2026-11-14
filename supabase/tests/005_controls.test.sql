-- Milestone 3 invariants: append-only money and control records, transfer
-- reconciliation, invoice-number uniqueness, refund planning from snapshots
-- (PRD §6–§9; AC13, AC16, AC18, AC31). Runs against a fresh pilot database;
-- everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(27);

-- ------------------------------------------------------ append-only tables
select ok((select bool_and(exists (
    select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
    where c.relname = t and p.proname = 'forbid_update_delete' and not g.tgisinternal)) from unnest(array[
  'refunds', 'refund_lines', 'returns', 'return_lines', 'cogs_reversals', 'exchanges', 'transfer_receipts',
  'supplier_invoice_lines', 'supplier_payments', 'supplier_credits', 'supplier_payment_reversals',
  'supplier_credit_reversals']) t),
  'refunds, returns, reversals, transfer receipts and AP money rows are append-only');

select ok(not has_table_privilege('authenticated', t, 'INSERT,UPDATE,DELETE'), 'API roles cannot write ' || t)
from unnest(array['public.refunds', 'public.return_custody', 'public.stock_counts', 'public.waste_reports',
                  'public.transfers', 'public.transfer_lines', 'public.supplier_invoices', 'public.supplier_payments']) t;

select ok((select relrowsecurity from pg_class where oid = t::regclass), 'RLS is enabled on ' || t)
from unnest(array['public.refunds', 'public.returns', 'public.return_custody', 'public.supplier_invoices',
                  'public.supplier_payments', 'public.stock_counts', 'public.transfers']) t;

-- ----------------------------------------------- transfer line reconciliation
insert into public.employees (employee_id, display_name) values ('EMP-9301', 'Controls Tester');
insert into public.suppliers (supplier_id, name, source, provenance) values ('SUP-97', 'Test supplier', 'test', 'source');
insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, primary_supplier_id, source, provenance)
values ('ING-961', 'Test flour', 'ingredient', 'Dry', 'g', false, 'ING-961', 'SUP-97', 'test', 'source');
insert into public.lots (lot_id, location_id, item_id, lot_code, source_type)
values ('00000000-0000-0000-0000-00000000b001', 'LOC-PRO', 'ING-961', 'T-1', 'receipt');
insert into public.transfers (transfer_id, transfer_number, from_location_id, to_location_id, status, created_by)
values ('00000000-0000-0000-0000-00000000b101', 'TRF-TEST-1', 'LOC-PRO', 'LOC-SFO', 'dispatched', 'EMP-9301');
insert into public.transfer_lines (transfer_line_id, transfer_id, item_id, source_lot_id, dispatched_qty, unit_cost, dispatch_movement_id)
values ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000b101', 'ING-961',
        '00000000-0000-0000-0000-00000000b001', 100, 0.01,
        private.post_movement('LOC-PRO', 'ING-961', '00000000-0000-0000-0000-00000000b001', 'sellable', 100, 0.01, 'opening', null,
                              'test', null, null, null, 'EMP-9301'));
select is((select in_transit_qty::text from public.transfer_lines where transfer_line_id = '00000000-0000-0000-0000-00000000b201'),
  '100.000000', 'dispatched stock is in transit until received or lost');
select lives_ok($$update public.transfer_lines set received_qty = 60, lost_qty = 15 where transfer_line_id = '00000000-0000-0000-0000-00000000b201'$$,
  'received + lost may be below dispatched (the rest stays in transit)');
select is((select received_qty + lost_qty + in_transit_qty from public.transfer_lines
           where transfer_line_id = '00000000-0000-0000-0000-00000000b201'), 100.000000::numeric,
  'received + lost + in transit = dispatched');
select throws_ok($$update public.transfer_lines set received_qty = 90 where transfer_line_id = '00000000-0000-0000-0000-00000000b201'$$,
  '23514', null, 'received + lost can never exceed dispatched');

-- ---------------------------------------------------- invoice-number uniqueness
insert into public.supplier_invoices (supplier_id, location_id, invoice_number, invoice_date, due_date, due_date_source,
  lines_cents, total_cents, has_discrepancy, record_mode, created_by)
values ('SUP-97', 'LOC-PRO', 'INV-42', current_date, current_date, 'entered', 100, 100, false, 'MANUAL_EXTERNAL', 'EMP-9301');
select throws_ok($$insert into public.supplier_invoices (supplier_id, location_id, invoice_number, invoice_date, due_date, due_date_source,
  lines_cents, total_cents, has_discrepancy, record_mode, created_by)
values ('SUP-97', 'LOC-SFO', '  inv-42 ', current_date, current_date, 'entered', 100, 100, false, 'MANUAL_EXTERNAL', 'EMP-9301')$$,
  '23505', null, 'invoice numbers are unique per supplier after trimming and case folding');
select throws_ok($$insert into public.supplier_invoices (supplier_id, location_id, invoice_number, invoice_date, due_date, due_date_source,
  lines_cents, tax_cents, total_cents, has_discrepancy, record_mode, created_by)
values ('SUP-97', 'LOC-PRO', 'INV-43', current_date, current_date, 'entered', 100, 7, 100, false, 'MANUAL_EXTERNAL', 'EMP-9301')$$,
  '23514', null, 'an invoice total must equal lines + tax + other charges');
select throws_ok($$delete from public.supplier_invoices$$, 'P0001', null, 'invoices cannot be deleted (void instead)');

-- ------------------------------------------------------- refund planning
-- A synthetic line snapshot: 3 units, net 4317, tax 313 (planned against no prior refunds).
create temporary table t_line as
select gen_random_uuid() as order_line_id, gen_random_uuid() as order_id, 1 as revision, 1 as line_no, 'FG-001'::text as item_id,
       true as is_sellable, 'finished_dish'::text as item_type, 3 as quantity, 1599::bigint as unit_price_cents,
       current_date as price_effective_from, 4797::bigint as gross_cents, 480::bigint as discount_cents,
       4317::bigint as net_cents, 313::bigint as tax_cents, null::uuid as recipe_version_id;
select is((select private.plan_line_refund(jsonb_populate_record(null::public.order_lines, to_jsonb(l)), 1, null) ->> 'net' from t_line l), '1439',
  'one of three units refunds a proportional share of the line net');
select is((select private.plan_line_refund(jsonb_populate_record(null::public.order_lines, to_jsonb(l)), 3, null) - 'order_line_id' from t_line l),
  '{"net": 4317, "tax": 313, "quantity": 3}'::jsonb, 'refunding every unit returns exactly the line net and tax');
select throws_ok($$select private.plan_line_refund(jsonb_populate_record(null::public.order_lines, to_jsonb(l)), 4, null) from t_line l$$,
  'P0001', 'validation:refund_exceeds_line', 'a refund cannot exceed the units sold');
select throws_ok($$select private.plan_line_refund(jsonb_populate_record(null::public.order_lines, to_jsonb(l)), null, 4318) from t_line l$$,
  'P0001', 'validation:refund_exceeds_line', 'an amount refund cannot exceed the line net');

select * from finish();
rollback;

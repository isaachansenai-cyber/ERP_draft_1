-- Stock ledger invariants (PRD §6; AC04, AC05, AC12 groundwork, AC31; CLAUDE.md D11).
-- Runs against a fresh pilot database; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into public.employees (employee_id, display_name) values ('EMP-9201', 'Ledger Tester');
insert into public.suppliers (supplier_id, name, source, provenance) values ('SUP-98', 'Test supplier', 'test', 'source');
insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, primary_supplier_id, source, provenance) values
  ('ING-951', 'Test chicken', 'ingredient', 'Protein', 'g', false, 'ING-951', 'SUP-98', 'test', 'source'),
  ('ING-952', 'Test lime', 'ingredient', 'Produce', 'each', false, 'ING-952', 'SUP-98', 'test', 'source'),
  ('FG-951', 'Test dish', 'finished_dish', 'Menu Item', 'serving', true, 'FG-951', null, 'test', 'source');

-- ----------------------------------------------------------- opening count
select lives_ok($$select private.post_opening_count('LOC-PRO',
  '[{"item_id":"ING-951","quantity_base":"1000","unit_cost":"0.006","lot_code":"A-DATED","use_by_date":"2099-01-01"},
    {"item_id":"ING-952","quantity_base":"10.5","unit_cost":"0.25"}]'::jsonb, 'EMP-9201', 'pilot_operator_entered')$$,
  'an opening count posts lots, movements, balances and valuation');
select is((select count(*)::int from public.inventory_movements where movement_type = 'opening'), 2, 'one opening movement per line');
select is((select on_hand::text from public.stock_balances b join public.lots l using (lot_id) where l.item_id = 'ING-952'), '10.500000',
  'fractional "each" quantities are kept exactly');
select throws_ok($$select private.post_opening_count('LOC-PRO', '[{"item_id":"ING-951","quantity_base":"1","unit_cost":"0"}]'::jsonb, 'EMP-9201', 'pilot_operator_entered')$$,
  'P0001', 'invalid_state:opening_already_posted', 'opening stock is posted once per location');
select throws_ok($$select private.post_opening_count('LOC-SFO', '[{"item_id":"FG-951","quantity_base":"1","unit_cost":"0"}]'::jsonb, 'EMP-9201', 'pilot_operator_entered')$$,
  'P0001', 'validation:item_not_stockable', 'made-to-order dishes never hold stock');

-- ------------------------------------------------- weighted average (D11)
select is(private.value_incoming('LOC-PRO', 'ING-951', 1000, 0.008), 0.00700000::numeric,
  'average = (1000 × 0.006 + 1000 × 0.008) / 2000');
update public.item_valuation set valued_qty = 0 where location_id = 'LOC-PRO' and item_id = 'ING-951';
select is(private.value_incoming('LOC-PRO', 'ING-951', 500, 0.01), 0.01000000::numeric,
  'with no valued stock the new average is the incoming cost');
update public.item_valuation set valued_qty = 1000, avg_unit_cost = 0.006 where location_id = 'LOC-PRO' and item_id = 'ING-951';

-- ------------------------------------------------------- FEFO and eligibility
insert into public.lots (lot_id, location_id, item_id, lot_code, use_by_date, source_type, received_at) values
  ('00000000-0000-0000-0000-00000000a001', 'LOC-PRO', 'ING-951', 'B-SOONER', '2098-01-01', 'receipt', now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000a002', 'LOC-PRO', 'ING-951', 'C-UNDATED', null, 'receipt', now() - interval '2 day'),
  ('00000000-0000-0000-0000-00000000a003', 'LOC-PRO', 'ING-951', 'D-EXPIRED', '2000-01-01', 'receipt', now() - interval '3 day');
insert into public.stock_balances (lot_id, condition, location_id, item_id, on_hand) values
  ('00000000-0000-0000-0000-00000000a001', 'sellable', 'LOC-PRO', 'ING-951', 100),
  ('00000000-0000-0000-0000-00000000a002', 'sellable', 'LOC-PRO', 'ING-951', 100),
  ('00000000-0000-0000-0000-00000000a003', 'sellable', 'LOC-PRO', 'ING-951', 100),
  ('00000000-0000-0000-0000-00000000a003', 'quarantined', 'LOC-PRO', 'ING-951', 50);
select is(private.available_qty('LOC-PRO', 'ING-951'), 1200.000000::numeric,
  'available excludes expired and quarantined stock (1000 + 100 + 100 eligible)');

-- reservations require an order row; create a minimal accepted order shell
insert into public.orders (order_id, order_number, location_id, business_date, pickup_code, status, tender_mode, tax_rate, accepted_by)
values ('00000000-0000-0000-0000-0000000b0001', 'PRO-TEST-0001', 'LOC-PRO', private.business_date(), 'PRO-9999', 'accepted', 'MANUAL_EXTERNAL', 0, 'EMP-9201');
select is(private.reserve_fefo('00000000-0000-0000-0000-0000000b0001', 'LOC-PRO', 'ING-951', 1150, 'kitchen'), 0::numeric, 'reservation fully allocated');
select results_eq(
  $$select l.lot_code, a.quantity from public.reservation_allocations a join public.lots l using (lot_id)
     where a.order_id = '00000000-0000-0000-0000-0000000b0001' order by l.use_by_date nulls last$$,
  $$values ('B-SOONER'::text, 100.000000::numeric(18,6)), ('A-DATED', 1000.000000), ('C-UNDATED', 50.000000)$$,
  'FEFO: earliest use-by first, later dated next, undated last; expired never');
select is(private.available_qty('LOC-PRO', 'ING-951'), 50.000000::numeric, 'available = eligible on hand − reservations');
select is(private.reserve_fefo('00000000-0000-0000-0000-0000000b0001', 'LOC-PRO', 'ING-951', 80, 'kitchen'), 30::numeric,
  'a reservation beyond availability reports the shortfall');

-- -------------------------------------------------------------- invariants
select throws_ok($$update public.stock_balances set reserved = on_hand + 1 where lot_id = '00000000-0000-0000-0000-00000000a001'$$,
  '23514', null, 'reserved can never exceed on hand');
select throws_ok($$update public.stock_balances set on_hand = -1 where lot_id = '00000000-0000-0000-0000-00000000a002'$$,
  '23514', null, 'on hand can never go negative');
select throws_ok($$update public.stock_balances set reserved = 1 where lot_id = '00000000-0000-0000-0000-00000000a003' and condition = 'quarantined'$$,
  '23514', null, 'quarantined stock cannot be reserved');
select throws_ok($$update public.inventory_movements set quantity = 1$$, 'P0001', 'immutable:inventory_movements', 'movements cannot be updated');
select throws_ok($$delete from public.inventory_movements$$, 'P0001', 'immutable:inventory_movements', 'movements cannot be deleted');
select throws_ok($$truncate public.inventory_movements cascade$$, 'P0001', 'forbidden:truncate_outside_demo', 'the ledger cannot be truncated in pilot');
select throws_ok($$update public.lots set use_by_date = '2100-01-01'$$, 'P0001', 'immutable:lots', 'lot identity and use-by are immutable');
select throws_ok($$select private.post_movement('LOC-PRO', 'ING-952', (select lot_id from public.lots where item_id = 'ING-952'), 'sellable', -11, 0.25,
                   'waste', 'SPOILAGE', 'test', null, null, null, 'EMP-9201')$$,
  'P0001', 'insufficient_stock', 'a movement that would make a balance negative is refused');
select ok(not has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT,UPDATE,DELETE'),
  'API roles cannot write the ledger directly');
select ok(not has_table_privilege('authenticated', 'public.stock_balances', 'INSERT,UPDATE,DELETE'),
  'API roles cannot write balances directly');

select * from finish();
rollback;

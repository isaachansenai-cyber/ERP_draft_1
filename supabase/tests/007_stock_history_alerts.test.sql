-- Item stock history, manager reorder alerts and the narrower employee scope
-- (migration 0023). Runs against a fresh pilot database; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

insert into public.suppliers (supplier_id, name, source, provenance) values ('SUP-97', 'History supplier', 'test', 'source');
insert into public.items (item_id, name, item_type, category, base_unit, is_sellable, barcode, primary_supplier_id, source, provenance)
values ('ING-971', 'History onions', 'ingredient', 'Produce', 'g', false, 'ING-971', 'SUP-97', 'test', 'source');
insert into public.lots (lot_id, location_id, item_id, lot_code, use_by_date, source_type, received_at)
values ('00000000-0000-0000-0000-00000000d001', 'LOC-SFO', 'ING-971', 'H-1', null, 'receipt', now() - interval '6 day');

-- Day offsets from today's business date: -5 opening 1000; -3 receipt +500 and
-- kitchen issue -200; -2 waste -50; -1 count -10 and transfer in +40.
insert into public.inventory_movements (location_id, item_id, lot_id, condition, quantity, unit_cost, movement_type, source_type, business_date)
select 'LOC-SFO', 'ING-971', '00000000-0000-0000-0000-00000000d001', 'sellable', q, 0.01, t, 'test', private.business_date() - d
from (values (5, 1000::numeric, 'opening'), (3, 500, 'receipt'), (3, -200, 'kitchen_issue'), (2, -50, 'waste'),
             (1, -10, 'count_adjustment'), (1, 40, 'transfer_in')) v(d, q, t);

select results_eq(
  $$select (private.business_date() - business_date)::int, on_hand::numeric(18,6), used::numeric(18,6),
           wasted::numeric(18,6), received::numeric(18,6)
      from private.item_stock_series('LOC-SFO', 'ING-971', private.business_date() - 4, private.business_date())$$,
  $$values (4, 1000::numeric(18,6), 0::numeric(18,6), 0::numeric(18,6), 0::numeric(18,6)),
           (3, 1300, 200, 0, 500),
           (2, 1250, 0, 50, 0),
           (1, 1280, 0, 0, 40),
           (0, 1280, 0, 0, 0)$$,
  'on hand carries in movements before the window; usage, waste and deliveries are split per day');
select is((select count(*)::int from private.item_stock_series('LOC-SFO', 'ING-971', private.business_date() - 89, private.business_date())),
  90, 'a 90-day window returns one row per day, including days with no movement');
select is((select on_hand from private.item_stock_series('LOC-SFO', 'ING-971', private.business_date() - 89, private.business_date())
           order by business_date limit 1), 0::numeric, 'days before the first movement show zero on hand');
select is((select count(*)::int from private.item_stock_series('LOC-PRO', 'ING-971', private.business_date() - 6, private.business_date())
           where on_hand <> 0 or used <> 0), 0, 'another location''s movements never appear');

-- Reorder alerts use the existing badge rule: available < reorder point.
insert into public.stock_balances (lot_id, condition, location_id, item_id, on_hand)
values ('00000000-0000-0000-0000-00000000d001', 'sellable', 'LOC-SFO', 'ING-971', 1280);
insert into public.location_item_settings (location_id, item_id, reorder_applicable, reorder_point_base, provenance)
values ('LOC-SFO', 'ING-971', true, 1281, 'pilot_operator_entered');
select results_eq($$select item_id, available::numeric(18,6), reorder_point::numeric(18,6) from private.reorder_alert_items('LOC-SFO')$$,
  $$values ('ING-971'::text, 1280::numeric(18,6), 1281::numeric(18,6))$$, 'an item below its reorder point is listed');
update public.location_item_settings set reorder_point_base = 1280 where location_id = 'LOC-SFO' and item_id = 'ING-971';
select is((select count(*)::int from private.reorder_alert_items('LOC-SFO')), 0, 'an item exactly at its reorder point is not listed');
update public.location_item_settings set reorder_point_base = 5000, reorder_applicable = false
  where location_id = 'LOC-SFO' and item_id = 'ING-971';
select is((select count(*)::int from private.reorder_alert_items('LOC-SFO')), 0, 'items without an applicable reorder point are never listed');
select is((select count(*)::int from private.reorder_alert_items('LOC-PRO') where item_id = 'ING-971'), 0,
  'alerts are per location');

-- Permissions
select ok(has_function_privilege('authenticated', 'public.get_item_stock_history(text, text, integer)', 'execute'),
  'signed-in users can call get_item_stock_history (the body checks the role)');
select ok(has_function_privilege('authenticated', 'public.get_reorder_alerts()', 'execute'), 'signed-in users can call get_reorder_alerts');
select ok(has_function_privilege('authenticated', 'public.list_stock_items(text)', 'execute'), 'signed-in users can call list_stock_items');
select ok(not has_function_privilege('anon', 'public.get_item_stock_history(text, text, integer)', 'execute'), 'anonymous callers cannot read history');
select ok(not has_function_privilege('authenticated', 'private.sales_summary_core(date, date, text[], text)', 'execute')
      and not has_function_privilege('authenticated', 'private.stock_overview_core(text)', 'execute'),
  'the unwrapped report bodies cannot be called directly');
select ok(not has_function_privilege('authenticated', 'private.item_stock_series(text, text, date, date)', 'execute')
      and not has_function_privilege('authenticated', 'private.reorder_alert_items(text)', 'execute'),
  'the history and alert helpers cannot be called directly');
select throws_ok($$select public.get_reorder_alerts()$$, 'P0001', 'unauthorized', 'alerts need a signed-in staff member');
select throws_ok($$select public.get_sales_summary(current_date, current_date)$$, 'P0001', 'unauthorized',
  'the sales summary needs a signed-in staff member');

select is((select count(*)::int from pg_policies where schemaname = 'public'
           and tablename in ('lots', 'stock_balances', 'reservation_allocations') and cmd = 'SELECT'
           and qual like '%managed_location_ids%'), 3, 'raw stock tables are readable by managers and the owner only');
select is((select count(*)::int from pg_policies where schemaname = 'public'
           and tablename in ('lots', 'stock_balances', 'reservation_allocations') and qual like '%accessible_location_ids%'), 0,
  'no remaining policy opens raw stock tables to every role at a location');

select * from finish();
rollback;

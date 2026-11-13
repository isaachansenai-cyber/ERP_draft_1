-- 0006 Row-level security and table grants (PRD §4, §15; CLAUDE.md §6).
-- API roles get SELECT only, filtered by RLS. All writes go through
-- SECURITY DEFINER RPCs that authorize the caller themselves. anon gets nothing.

do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'app_settings', 'employees', 'memberships', 'audit_log',
    'units', 'suppliers', 'items', 'item_standard_costs', 'item_unit_conversions',
    'supplier_items', 'location_item_prices', 'location_tax_rates', 'location_item_settings',
    'location_closures', 'reason_codes', 'customers', 'recipe_versions', 'recipe_components',
    'pilot_setup_gates', 'historical_sales_orders', 'historical_sales_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Reference data readable by any signed-in staff member -----------------------
grant select on public.locations, public.units, public.reason_codes, public.items,
  public.item_unit_conversions, public.recipe_versions, public.recipe_components,
  public.app_settings, public.pilot_setup_gates
to authenticated;

create policy locations_read on public.locations for select to authenticated using (true);
create policy units_read on public.units for select to authenticated using (true);
create policy reason_codes_read on public.reason_codes for select to authenticated using (true);
create policy items_read on public.items for select to authenticated using (true);
create policy item_unit_conversions_read on public.item_unit_conversions for select to authenticated using (true);
create policy recipe_versions_read on public.recipe_versions for select to authenticated using (true);
create policy recipe_components_read on public.recipe_components for select to authenticated using (true);
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy pilot_setup_gates_read on public.pilot_setup_gates for select to authenticated using (true);

-- Identity ---------------------------------------------------------------------
grant select on public.employees, public.memberships to authenticated;

create policy employees_read on public.employees for select to authenticated
  using ((select private.can_view_employee(employee_id)));

create policy memberships_read on public.memberships for select to authenticated
  using (
    (select private.is_owner())
    or employee_id = (select private.current_employee_id())
    or location_id in (select private.managed_location_ids())
  );

-- Audit: owner all; managers their locations' operational audit ---------------
grant select on public.audit_log to authenticated;
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select private.is_owner()) or location_id in (select private.managed_location_ids()));

-- Costs, suppliers and supply relations: owner and managers only ---------------
grant select on public.suppliers, public.supplier_items, public.item_standard_costs to authenticated;
create policy suppliers_read on public.suppliers for select to authenticated
  using ((select private.is_owner_or_manager()));
create policy supplier_items_read on public.supplier_items for select to authenticated
  using ((select private.is_owner_or_manager()));
create policy item_standard_costs_read on public.item_standard_costs for select to authenticated
  using ((select private.is_owner_or_manager()));

-- Location-scoped configuration ------------------------------------------------
grant select on public.location_item_prices, public.location_tax_rates,
  public.location_closures, public.location_item_settings to authenticated;
create policy location_item_prices_read on public.location_item_prices for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy location_tax_rates_read on public.location_tax_rates for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy location_closures_read on public.location_closures for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy location_item_settings_read on public.location_item_settings for select to authenticated
  using (location_id in (select private.managed_location_ids()));

-- Customers: owner only until the order-context lookup RPC (Milestone 2) ------
grant select on public.customers to authenticated;
create policy customers_read on public.customers for select to authenticated
  using ((select private.is_owner()));

-- Demo history: owner all; managers own locations. Cross-location manager
-- summaries and employee daily summaries are served by authorized report
-- functions, never by direct table reads.
grant select on public.historical_sales_orders, public.historical_sales_lines to authenticated;
create policy historical_sales_orders_read on public.historical_sales_orders for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy historical_sales_lines_read on public.historical_sales_lines for select to authenticated
  using (location_id in (select private.managed_location_ids()));

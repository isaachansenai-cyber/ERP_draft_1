-- 0022 Demo reset also clears the Milestone 4 tables (schedules, time, forecast overrides).

create or replace function private.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.data_mode() <> 'demo' then
    perform private.raise_error('forbidden:not_demo_database');
  end if;
  truncate table
    public.forecast_overrides,
    public.time_corrections,
    public.break_intervals,
    public.time_entries,
    public.shifts,
    public.supplier_credit_reversals,
    public.supplier_payment_reversals,
    public.supplier_credits,
    public.supplier_payments,
    public.supplier_invoice_lines,
    public.supplier_invoices,
    public.exchanges,
    public.cogs_reversals,
    public.return_custody,
    public.refund_lines,
    public.refunds,
    public.return_lines,
    public.returns,
    public.return_policy,
    public.transfer_receipts,
    public.transfer_lines,
    public.transfer_requests,
    public.transfers,
    public.waste_report_lines,
    public.waste_reports,
    public.stock_count_lines,
    public.stock_counts,
    public.tenders,
    public.order_state_events,
    public.order_cancellation_waste,
    public.order_issue_costs,
    public.order_line_requirements,
    public.order_lines,
    public.reservation_allocations,
    public.orders,
    public.location_item_availability,
    public.receipt_lines,
    public.receipts,
    public.purchase_order_lines,
    public.purchase_orders,
    public.opening_count_lines,
    public.opening_counts,
    public.inventory_movements,
    public.stock_balances,
    public.item_valuation,
    public.lots,
    public.historical_sales_lines,
    public.historical_sales_orders,
    public.audit_log,
    public.pilot_setup_gates,
    public.memberships,
    public.location_item_prices,
    public.location_tax_rates,
    public.location_item_settings,
    public.location_closures,
    public.item_standard_costs,
    public.item_unit_conversions,
    public.supplier_items,
    public.recipe_components,
    public.recipe_versions,
    public.customers,
    public.items,
    public.suppliers,
    private.request_log,
    private.manager_pins,
    private.order_counters,
    public.employees;
  perform private.ensure_base_gates();
  update public.app_settings set posting_enabled = false, posting_enabled_at = null, posting_enabled_by = null where singleton;
  perform private.write_audit(null, 'demo.reset', 'app_settings', 'singleton', null, null, null, null,
    null, null, 'operator_tooling');
end;
$$;

revoke all on function private.reset_demo_data() from public, anon, authenticated;

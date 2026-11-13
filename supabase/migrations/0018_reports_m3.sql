-- 0018 Reports and demo reset for Milestone 3 (PRD §12; AC20, AC15)
-- Sales summary now includes refunds (by refund business date, using the
-- original line snapshots), COGS less retail cost reversals, waste from
-- post-start cancellations + posted waste reports + transit losses (each cost
-- counted once), count variance, inventory and in-transit value, and supplier
-- payables. Transit losses and in-transit value belong to the source location.

create or replace function public.get_sales_summary(p_from date, p_to date, p_location_ids text[] default null,
  p_source text default 'operational')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := private.is_owner();
  v_managed text[] := array(select private.managed_location_ids());
  v_accessible text[] := array(select private.accessible_location_ids());
  v_is_manager boolean := cardinality(array(select private.managed_location_ids())) > 0;
  v_targets text[];
  v_rows jsonb;
  v_mode text := private.data_mode();
begin
  perform private.require_actor();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform private.raise_error('validation:date_range', jsonb_build_object('rule', 'from <= to, at most 366 days'));
  end if;
  if p_source not in ('operational', 'historical') then perform private.raise_error('validation:source'); end if;
  if p_source = 'historical' and v_mode <> 'demo' then
    perform private.raise_error('validation:source', jsonb_build_object('reason', 'historical demo data exists only in the demo project'));
  end if;

  v_targets := coalesce(p_location_ids, array(select l.location_id from public.locations l order by l.location_id));
  if not v_owner and not v_is_manager then
    -- Employee: own-location daily summary only.
    if p_from <> p_to then perform private.raise_error('validation:employee_daily_summary_only'); end if;
    if p_location_ids is null then
      v_targets := v_accessible;
    elsif not (v_targets <@ v_accessible) then
      perform private.raise_error('unauthorized', jsonb_build_object('reason', 'location_not_assigned'));
    end if;
  end if;

  with loc as (
    select l.location_id, l.name,
           case when v_owner or l.location_id = any (v_managed) then 'full'
                when v_is_manager then 'summary'
                else 'employee' end as access
    from public.locations l
    where l.location_id = any (v_targets)
  ), op as (
    select o.location_id, count(*) as orders, sum(o.gross_cents) as gross, sum(o.discount_cents) as disc,
           sum(o.tax_cents) as tax,
           sum((select coalesce(sum(c.issued_cost), 0) from public.order_issue_costs c where c.order_id = o.order_id)) as cogs,
           avg(extract(epoch from (o.completed_at - o.accepted_at)) / 60.0) as fulfil_min
    from public.orders o
    where p_source = 'operational' and o.status = 'completed' and o.completed_business_date between p_from and p_to
    group by o.location_id
  ), tend as (
    select t.location_id, sum(t.amount_cents) as amount from public.tenders t
    where p_source = 'operational' and t.business_date between p_from and p_to group by t.location_id
  ), waste as (
    select w.location_id, sum(w.issued_cost) as cost, count(*) as n from public.order_cancellation_waste w
    where p_source = 'operational' and w.business_date between p_from and p_to group by w.location_id
  ), cancelled as (
    select o.location_id, count(*) as n from public.orders o
    where p_source = 'operational' and o.status = 'cancelled'
      and private.business_date(o.cancelled_at) between p_from and p_to group by o.location_id
  ), pending as (
    select o.location_id, sum(c.issued_cost) as cost from public.orders o
    join public.order_issue_costs c on c.order_id = o.order_id
    where p_source = 'operational' and o.status in ('preparing', 'ready') group by o.location_id
  ), refund as (
    select f.location_id, sum(f.net_cents) as net, sum(f.tax_cents) as tax, count(distinct f.order_id) as n
    from public.refunds f
    where p_source = 'operational' and f.kind = 'sale' and f.business_date between p_from and p_to group by f.location_id
  ), paid_out as (
    select f.location_id, sum(f.paid_out_cents) as amount from public.refunds f
    where p_source = 'operational' and f.business_date between p_from and p_to group by f.location_id
  ), cogs_rev as (
    select c.location_id, sum(c.cost) as cost from public.cogs_reversals c
    where p_source = 'operational' and c.business_date between p_from and p_to group by c.location_id
  ), waste_rep as (
    select w.location_id, sum(w.total_cost) as cost, count(*) as n from public.waste_reports w
    where p_source = 'operational' and w.status = 'posted' and w.business_date between p_from and p_to group by w.location_id
  ), transit_loss as (
    select t.from_location_id as location_id, sum(r.lost_cost) as cost from public.transfer_receipts r
    join public.transfer_lines l on l.transfer_line_id = r.transfer_line_id
    join public.transfers t on t.transfer_id = l.transfer_id
    where p_source = 'operational' and r.lost_qty > 0 and r.business_date between p_from and p_to group by t.from_location_id
  ), count_var as (
    select c.location_id, sum(cl.variance * coalesce(cl.unit_cost, 0)) as cost from public.stock_counts c
    join public.stock_count_lines cl on cl.count_id = c.count_id
    where p_source = 'operational' and c.status = 'posted' and private.business_date(c.posted_at) between p_from and p_to
    group by c.location_id
  ), inv_value as (
    select v.location_id, sum(v.valued_qty * v.avg_unit_cost) as value from public.item_valuation v
    where p_source = 'operational' group by v.location_id
  ), transit_value as (
    select t.from_location_id as location_id, sum(l.in_transit_qty * l.unit_cost) as value from public.transfer_lines l
    join public.transfers t on t.transfer_id = l.transfer_id
    where p_source = 'operational' and t.status in ('dispatched', 'partially_received') group by t.from_location_id
  ), ap as (
    select i.location_id,
           sum(i.total_cents - a.applied) as outstanding,
           sum(case when i.due_date < private.business_date() then i.total_cents - a.applied else 0 end) as overdue,
           count(*) filter (where i.due_date < private.business_date()) as overdue_n
    from public.supplier_invoices i
    cross join lateral (select (private.invoice_applied_cents(i.invoice_id) ->> 'paid')::bigint
                               + (private.invoice_applied_cents(i.invoice_id) ->> 'credited')::bigint as applied) a
    where p_source = 'operational' and i.status in ('open', 'partially_paid') group by i.location_id
  ), hist as (
    select h.location_id, count(*) as orders,
           sum(h.net_before_refund_cents) + sum((select coalesce(sum(x.discount_cents), 0) from public.historical_sales_lines x
              where x.dataset_id = h.dataset_id and x.historical_order_id = h.historical_order_id)) as gross,
           sum((select coalesce(sum(x.discount_cents), 0) from public.historical_sales_lines x
              where x.dataset_id = h.dataset_id and x.historical_order_id = h.historical_order_id)) as disc,
           sum(h.refund_net_cents) as refunds, sum(h.tax_before_refund_cents - h.refund_tax_cents) as tax,
           sum(h.historical_cogs_cents) as cogs_cents, sum(h.net_before_refund_cents + h.tax_before_refund_cents) as tendered
    from public.historical_sales_orders h
    where p_source = 'historical' and h.business_date between p_from and p_to
    group by h.location_id
  ), low as (
    select s.location_id, count(*) as n from public.location_item_settings s
    where s.reorder_applicable and private.available_qty(s.location_id, s.item_id) < s.reorder_point_base
    group by s.location_id
  ), rows as (
    select l.location_id, l.name, l.access,
           coalesce(op.orders, h.orders, 0) as orders,
           coalesce(op.gross, h.gross, 0) as gross,
           coalesce(op.disc, h.disc, 0) as disc,
           coalesce(h.refunds, rf.net, 0) as refunds,
           coalesce(rf.n, 0) as refunded_orders,
           coalesce(op.tax, h.tax, 0) - coalesce(rf.tax, 0) as tax,
           case when p_source = 'historical' then coalesce(h.cogs_cents, 0)
                else round((coalesce(op.cogs, 0) - coalesce(cr.cost, 0)) * 100) end as cogs_cents,
           round(coalesce(cr.cost, 0) * 100) as cogs_reversed_cents,
           round((coalesce(w.cost, 0) + coalesce(wr.cost, 0) + coalesce(tl.cost, 0)) * 100) as waste_cents,
           round(coalesce(w.cost, 0) * 100) as waste_cancel_cents,
           round(coalesce(wr.cost, 0) * 100) as waste_report_cents,
           round(coalesce(tl.cost, 0) * 100) as waste_transit_cents,
           coalesce(wr.n, 0) as waste_reports,
           round(coalesce(cv.cost, 0) * 100) as count_variance_cents,
           round(coalesce(iv.value, 0) * 100) as inventory_value_cents,
           round(coalesce(tv.value, 0) * 100) as in_transit_value_cents,
           coalesce(po.amount, 0) as recorded_refunds,
           coalesce(ap.outstanding, 0) as ap_outstanding, coalesce(ap.overdue, 0) as ap_overdue, coalesce(ap.overdue_n, 0) as ap_overdue_n,
           coalesce(w.n, 0) as waste_orders,
           round(coalesce(pd.cost, 0) * 100) as pending_cents,
           case when p_source = 'historical' then coalesce(h.tendered, 0) else coalesce(t.amount, 0) end as tenders,
           op.fulfil_min, coalesce(c.n, 0) as cancelled, coalesce(lw.n, 0) as low_stock
    from loc l
    left join op on op.location_id = l.location_id
    left join hist h on h.location_id = l.location_id
    left join tend t on t.location_id = l.location_id
    left join waste w on w.location_id = l.location_id
    left join cancelled c on c.location_id = l.location_id
    left join pending pd on pd.location_id = l.location_id
    left join low lw on lw.location_id = l.location_id
    left join refund rf on rf.location_id = l.location_id
    left join paid_out po on po.location_id = l.location_id
    left join cogs_rev cr on cr.location_id = l.location_id
    left join waste_rep wr on wr.location_id = l.location_id
    left join transit_loss tl on tl.location_id = l.location_id
    left join count_var cv on cv.location_id = l.location_id
    left join inv_value iv on iv.location_id = l.location_id
    left join transit_value tv on tv.location_id = l.location_id
    left join ap on ap.location_id = l.location_id
  )
  select jsonb_agg(
    case when r.access = 'summary' then
      jsonb_build_object('location_id', r.location_id, 'location_name', r.name, 'access', r.access,
        'completed_orders', r.orders, 'net_sales_cents', r.gross - r.disc - r.refunds)
    else
      jsonb_build_object('location_id', r.location_id, 'location_name', r.name, 'access', r.access,
        'completed_orders', r.orders,
        'gross_sales_cents', r.gross, 'discount_cents', r.disc, 'refund_cents', r.refunds,
        'net_sales_cents', r.gross - r.disc - r.refunds, 'tax_cents', r.tax,
        'recorded_tenders_cents', r.tenders,
        'recorded_refunds_cents', r.recorded_refunds,
        'refunded_orders', r.refunded_orders,
        'average_order_value_cents', case when r.orders > 0 then round((r.gross - r.disc - r.refunds)::numeric / r.orders) end,
        'cogs_cents', case when r.access = 'full' then r.cogs_cents end,
        'gross_margin_cents', case when r.access = 'full' then r.gross - r.disc - r.refunds - r.cogs_cents end,
        'cogs_reversed_cents', case when r.access = 'full' then r.cogs_reversed_cents end,
        'waste_cost_cents', case when r.access = 'full' then r.waste_cents end,
        'waste_breakdown', case when r.access = 'full' and p_source = 'operational' then jsonb_build_object(
          'post_start_cancellations_cents', r.waste_cancel_cents, 'waste_reports_cents', r.waste_report_cents,
          'transit_loss_cents', r.waste_transit_cents, 'posted_waste_reports', r.waste_reports) end,
        'count_variance_cents', case when r.access = 'full' and p_source = 'operational' then r.count_variance_cents end,
        'inventory_value_cents', case when r.access = 'full' and p_source = 'operational' then r.inventory_value_cents end,
        'in_transit_value_cents', case when r.access = 'full' and p_source = 'operational' then r.in_transit_value_cents end,
        'supplier_outstanding_cents', case when r.access = 'full' and p_source = 'operational' then r.ap_outstanding end,
        'supplier_overdue_cents', case when r.access = 'full' and p_source = 'operational' then r.ap_overdue end,
        'supplier_overdue_invoices', case when r.access = 'full' and p_source = 'operational' then r.ap_overdue_n end,
        'pending_preparation_cost_cents', case when r.access = 'full' and p_source = 'operational' then r.pending_cents end,
        'low_stock_items', case when r.access = 'full' and p_source = 'operational' then r.low_stock end,
        'average_fulfillment_minutes', case when r.fulfil_min is not null then round(r.fulfil_min::numeric, 1) end,
        'fulfillment_samples', r.orders,
        'cancelled_orders', r.cancelled)
    end order by r.location_id)
    into v_rows
  from rows r;

  return jsonb_build_object(
    'source', p_source,
    'data_label', case when p_source = 'historical' then 'demo historical (synthetic; cost fields are synthetic estimates)'
                       when v_mode = 'demo' then 'demo operational' else 'pilot operational' end,
    'date_from', p_from, 'date_to', p_to, 'timezone', 'America/Denver', 'currency', 'USD',
    'refreshed_at', now(),
    'payments_note', case when v_mode = 'demo' then 'Simulated payments; no money moved.'
                          else 'Recorded payments handled outside the app; not bank settlement.' end,
    'locations', coalesce(v_rows, '[]'::jsonb));
end;
$$;

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

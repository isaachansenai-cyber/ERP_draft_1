-- 0012 Read models and reports (PRD §10 groundwork, §12, §13; AC03, AC20)
-- POS menu availability, stock overview and the sales summary used by the
-- dashboard and its CSV export. All are SECURITY DEFINER functions that
-- authorize the caller and filter by role/location themselves.

-- ---------------------------------------------------------------------------
-- POS menu: price, override, and independent portions available per item.
-- ---------------------------------------------------------------------------
create function public.get_pos_menu(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  return coalesce((
    with comp as (
      select v.parent_item_id, c.component_item_id, c.quantity_per_serving,
             private.available_qty(p_location_id, c.component_item_id) as avail
      from public.recipe_versions v
      join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
      where v.status = 'active'
    ), dish as (
      select distinct on (c.parent_item_id) c.parent_item_id, c.component_item_id as bottleneck,
             floor(c.avail / c.quantity_per_serving)::bigint as portions
      from comp c
      order by c.parent_item_id, floor(c.avail / c.quantity_per_serving), c.component_item_id
    )
    select jsonb_agg(jsonb_build_object(
      'item_id', i.item_id, 'name', i.name, 'item_type', i.item_type, 'category', i.category,
      'price_cents', (private.current_price(p_location_id, i.item_id, v_today)).price_cents,
      'is_available', coalesce(a.is_available, true), 'unavailable_reason', a.reason,
      'portions_available', case when i.item_type = 'finished_dish' then coalesce(d.portions, 0)
                                 else floor(private.available_qty(p_location_id, i.item_id))::bigint end,
      'bottleneck_item_id', d.bottleneck, 'bottleneck_name', b.name,
      'prep_lead_days', i.prep_lead_days, 'lead_time_note', i.lead_time_note,
      'recipes_verified', case when i.item_type = 'finished_dish' then private.gate_confirmed('recipes_verified', i.item_id) end
    ) order by i.item_type, i.item_id)
    from public.items i
    left join public.location_item_availability a on a.location_id = p_location_id and a.item_id = i.item_id
    left join dish d on d.parent_item_id = i.item_id
    left join public.items b on b.item_id = d.bottleneck
    where i.is_sellable and i.archived_at is null
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock overview: on hand / reserved / quarantined / available per item and
-- lot. Costs and reorder settings only for managers/owner (PRD §4).
-- ---------------------------------------------------------------------------
create function public.get_stock_overview(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_manager := private.has_location_role(p_location_id, array['manager']);
  return jsonb_build_object(
    'location_id', p_location_id,
    'business_date', private.business_date(),
    'shows_costs', v_manager,
    'opening_count_posted', exists (select 1 from public.opening_counts o where o.location_id = p_location_id),
    'items', coalesce((
      select jsonb_agg(row_data order by row_data ->> 'item_id') from (
        select jsonb_build_object(
          'item_id', i.item_id, 'name', i.name, 'item_type', i.item_type, 'category', i.category,
          'base_unit', i.base_unit, 'requires_use_by', i.requires_use_by,
          'on_hand', coalesce(sum(b.on_hand), 0)::text,
          'quarantined', coalesce(sum(b.on_hand) filter (where b.condition = 'quarantined'), 0)::text,
          'reserved', coalesce(sum(b.reserved), 0)::text,
          'expired_on_hand', coalesce(sum(b.on_hand) filter (where b.condition = 'sellable' and not private.lot_is_eligible(l.use_by_date)), 0)::text,
          'available', private.available_qty(p_location_id, i.item_id)::text,
          'avg_unit_cost', case when v_manager then v.avg_unit_cost::text end,
          'stock_value', case when v_manager then round(coalesce(v.valued_qty, 0) * coalesce(v.avg_unit_cost, 0), 2)::text end,
          'reorder_point', case when v_manager and s.reorder_applicable then s.reorder_point_base::text end,
          'below_reorder_point', case when v_manager and s.reorder_applicable
                                      then private.available_qty(p_location_id, i.item_id) < s.reorder_point_base end,
          'lots', coalesce(jsonb_agg(jsonb_build_object(
                     'lot_id', l.lot_id, 'lot_code', l.lot_code, 'supplier_lot', l.supplier_lot, 'use_by_date', l.use_by_date,
                     'condition', b.condition, 'on_hand', b.on_hand::text, 'reserved', b.reserved::text,
                     'eligible', b.condition = 'sellable' and private.lot_is_eligible(l.use_by_date),
                     'received_at', l.received_at) order by l.use_by_date nulls last, l.received_at)
                   filter (where b.lot_id is not null and b.on_hand > 0), '[]'::jsonb)
        ) as row_data
        from public.items i
        left join public.stock_balances b on b.item_id = i.item_id and b.location_id = p_location_id
        left join public.lots l on l.lot_id = b.lot_id
        left join public.item_valuation v on v.location_id = p_location_id and v.item_id = i.item_id
        left join public.location_item_settings s on s.location_id = p_location_id and s.item_id = i.item_id
        where i.is_purchasable and i.archived_at is null
        group by i.item_id, i.name, i.item_type, i.category, i.base_unit, i.requires_use_by,
                 v.avg_unit_cost, v.valued_qty, s.reorder_applicable, s.reorder_point_base
      ) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales summary (PRD §12). Operational source: completed orders by completion
-- business date; payments in their own event dates; COGS from issue-cost
-- snapshots; post-start cancellations as waste only. Historical source (demo
-- only): read-only synthetic snapshots, never combined with operational data.
-- Access: owner full everywhere; manager full at own locations and only
-- order count + net sales elsewhere; employee one day at own location without
-- costs or margins.
-- ---------------------------------------------------------------------------
create function public.get_sales_summary(p_from date, p_to date, p_location_ids text[] default null,
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
           coalesce(h.refunds, 0) as refunds,
           coalesce(op.tax, h.tax, 0) as tax,
           case when p_source = 'historical' then coalesce(h.cogs_cents, 0)
                else round(coalesce(op.cogs, 0) * 100) end as cogs_cents,
           round(coalesce(w.cost, 0) * 100) as waste_cents,
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
        'average_order_value_cents', case when r.orders > 0 then round((r.gross - r.disc - r.refunds)::numeric / r.orders) end,
        'cogs_cents', case when r.access = 'full' then r.cogs_cents end,
        'gross_margin_cents', case when r.access = 'full' then r.gross - r.disc - r.refunds - r.cogs_cents end,
        'waste_cost_cents', case when r.access = 'full' then r.waste_cents end,
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

-- ---------------------------------------------------------------------------
-- Demo reset now also clears the operational tables added in Milestone 2.
-- ---------------------------------------------------------------------------
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

grant execute on function
  public.get_pos_menu(text),
  public.get_stock_overview(text),
  public.get_sales_summary(date, date, text[], text)
to authenticated;

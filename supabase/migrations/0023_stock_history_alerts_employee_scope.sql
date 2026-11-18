-- 0023 Item stock history chart, manager reorder alerts, and a narrower
-- employee scope (operator decisions, see docs/decisions/0033 and 0034).
--
-- 1. get_item_stock_history: per-day on-hand, usage, waste and deliveries for
--    one item at one location, plus its reorder point, the Planning screen's
--    suggested order quantity and the next open purchase order. Managers at the
--    location and the owner only. Read-only.
-- 2. get_reorder_alerts: items below their reorder point, only at locations
--    where the caller holds a MANAGER membership. The owner is not notified
--    (empty result) unless they also hold a manager membership. Employees are
--    refused. Same rule as get_stock_overview.below_reorder_point
--    (available < reorder point). Nothing is stored.
-- 3. Employees lose the sales summary (and so its CSV export), the stock
--    overview and raw read access to lots, stock balances and reservation
--    allocations. list_stock_items gives the waste-report form item names
--    without quantities.

-- ---------------------------------------------------------------------------
-- 1. Stock history
-- ---------------------------------------------------------------------------
-- On hand at the end of each business date = every movement up to that date.
-- Usage = kitchen issues + retail sales; waste = posted waste; deliveries =
-- receipts + incoming transfers. Counts, reversals, condition changes and
-- outgoing transfers move the on-hand line only.
create function private.item_stock_series(p_location_id text, p_item_id text, p_from date, p_to date)
returns table (business_date date, on_hand numeric, used numeric, wasted numeric, received numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select g::date as d from generate_series(p_from, p_to, interval '1 day') g
  ), opening as (
    select coalesce(sum(m.quantity), 0) as q
    from public.inventory_movements m
    where m.location_id = p_location_id and m.item_id = p_item_id and m.business_date < p_from
  ), daily as (
    select m.business_date as d,
           sum(m.quantity) as net,
           coalesce(sum(-m.quantity) filter (where m.movement_type in ('kitchen_issue', 'retail_issue')), 0) as used,
           coalesce(sum(-m.quantity) filter (where m.movement_type = 'waste'), 0) as wasted,
           coalesce(sum(m.quantity) filter (where m.movement_type in ('receipt', 'transfer_in') and m.quantity > 0), 0) as received
    from public.inventory_movements m
    where m.location_id = p_location_id and m.item_id = p_item_id and m.business_date between p_from and p_to
    group by m.business_date
  )
  select d.d,
         (select o.q from opening o) + coalesce(sum(dl.net) over (order by d.d), 0),
         coalesce(dl.used, 0), coalesce(dl.wasted, 0), coalesce(dl.received, 0)
  from days d left join daily dl on dl.d = d.d
  order by d.d;
$$;

create function public.get_item_stock_history(p_location_id text, p_item_id text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_from date;
  v_item public.items;
  v_settings public.location_item_settings;
  v_eoq jsonb;
  v_series jsonb;
  v_next jsonb;
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['manager']);
  if p_days is null or p_days not in (7, 30, 90) then
    perform private.raise_error('validation:days', jsonb_build_object('allowed', jsonb_build_array(7, 30, 90)));
  end if;
  select * into v_item from public.items i where i.item_id = p_item_id and i.is_purchasable and i.archived_at is null;
  if v_item.item_id is null then perform private.raise_error('validation:item_not_stocked'); end if;
  v_from := v_today - (p_days - 1);

  select * into v_settings from public.location_item_settings s where s.location_id = p_location_id and s.item_id = p_item_id;
  v_eoq := public.get_eoq_inputs(p_location_id, p_item_id, 'operational');

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', s.business_date, 'on_hand', round(s.on_hand, 6)::text, 'used', round(s.used, 6)::text,
           'wasted', round(s.wasted, 6)::text, 'received', round(s.received, 6)::text) order by s.business_date), '[]'::jsonb)
    into v_series
  from private.item_stock_series(p_location_id, p_item_id, v_from, v_today) s;

  select jsonb_build_object('po_number', x.po_number, 'expected_date', x.expected_date, 'quantity', x.qty::text,
           'late', x.expected_date is null or x.expected_date < v_today)
    into v_next
  from (
    select po.po_number, po.expected_date, sum((l.ordered_packs - l.received_packs - l.cancelled_packs) * l.pack_base_qty) as qty
    from public.purchase_orders po join public.purchase_order_lines l on l.po_id = po.po_id
    where po.location_id = p_location_id and l.item_id = p_item_id
      and po.status in ('submitted', 'partially_received')
      and l.ordered_packs - l.received_packs - l.cancelled_packs > 0
    group by po.po_id, po.po_number, po.expected_date
    order by (po.expected_date is null or po.expected_date < v_today), po.expected_date nulls last, po.po_number
    limit 1) x;

  return jsonb_build_object(
    'location_id', p_location_id, 'item_id', v_item.item_id, 'name', v_item.name, 'base_unit', v_item.base_unit,
    'days', p_days, 'date_from', v_from, 'date_to', v_today, 'timezone', 'America/Denver', 'refreshed_at', now(),
    'data_label', case when private.data_mode() = 'demo' then 'demo operational' else 'pilot operational' end,
    'on_hand_now', coalesce((select sum(b.on_hand) from public.stock_balances b
                             where b.location_id = p_location_id and b.item_id = p_item_id), 0)::text,
    'available_now', private.available_qty(p_location_id, p_item_id)::text,
    'reorder_applicable', coalesce(v_settings.reorder_applicable, false),
    'reorder_point', case when v_settings.reorder_applicable then v_settings.reorder_point_base::text end,
    'suggested_order', case when v_eoq -> 'eoq' is not null and jsonb_typeof(v_eoq -> 'eoq') = 'object' then jsonb_build_object(
        'quantity', v_eoq -> 'eoq' ->> 'actionable_quantity', 'packs', v_eoq -> 'eoq' ->> 'actionable_packs',
        'demand_source', v_eoq ->> 'annual_demand_source') end,
    'suggested_order_missing_reason', case when v_eoq -> 'eoq' is null or jsonb_typeof(v_eoq -> 'eoq') <> 'object' then
        case when v_eoq ->> 'demand_status' = 'insufficient' and v_eoq ->> 'annual_demand_override' is null
             then 'insufficient_history' else 'planning_inputs_missing' end end,
    'next_delivery', v_next,
    'series', v_series);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reorder alerts for managers
-- ---------------------------------------------------------------------------
create function private.reorder_alert_items(p_location_id text)
returns table (item_id text, name text, base_unit text, available numeric, reorder_point numeric, on_order numeric,
               next_expected_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select i.item_id, i.name, i.base_unit, private.available_qty(p_location_id, i.item_id), s.reorder_point_base,
         coalesce(po.qty, 0), po.next_date
  from public.location_item_settings s
  join public.items i on i.item_id = s.item_id and i.archived_at is null
  left join lateral (
    select sum((l.ordered_packs - l.received_packs - l.cancelled_packs) * l.pack_base_qty) as qty,
           min(p.expected_date) filter (where p.expected_date >= private.business_date()) as next_date
    from public.purchase_orders p join public.purchase_order_lines l on l.po_id = p.po_id
    where p.location_id = p_location_id and l.item_id = s.item_id and p.status in ('submitted', 'partially_received')
      and l.ordered_packs - l.received_packs - l.cancelled_packs > 0) po on true
  where s.location_id = p_location_id and s.reorder_applicable and s.reorder_point_base is not null
    and private.available_qty(p_location_id, i.item_id) < s.reorder_point_base
  order by i.item_id;
$$;

create function public.get_reorder_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_locations text[];
begin
  perform private.require_actor();
  -- Explicit manager memberships only: owner-wide access does not create alerts.
  v_locations := array(
    select distinct m.location_id
    from public.memberships m
    join public.employees e on e.employee_id = m.employee_id
    where e.auth_user_id = auth.uid() and e.active and m.active and m.role = 'manager' and m.location_id is not null
    order by m.location_id);
  if cardinality(v_locations) = 0 and not private.is_owner() then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'manager'));
  end if;
  return jsonb_build_object(
    'refreshed_at', now(),
    'rule', 'available below reorder point',
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location_id', l.location_id, 'location_name', l.name,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'item_id', a.item_id, 'name', a.name, 'base_unit', a.base_unit, 'available', a.available::text,
            'reorder_point', a.reorder_point::text, 'on_order', a.on_order::text,
            'next_expected_date', a.next_expected_date) order by a.item_id)
          from private.reorder_alert_items(l.location_id) a), '[]'::jsonb)) order by l.location_id)
      from public.locations l where l.location_id = any (v_locations)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Employee scope
-- ---------------------------------------------------------------------------
-- Item names for the waste-report form: no quantities, no costs.
create function public.list_stock_items(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', i.name, 'base_unit', i.base_unit,
             'item_type', i.item_type, 'category', i.category) order by i.item_id)
    from public.items i where i.is_purchasable and i.archived_at is null), '[]'::jsonb);
end;
$$;

-- The existing bodies move to private unchanged; the public names become thin
-- wrappers that refuse employees before any data is read.
alter function public.get_sales_summary(date, date, text[], text) set schema private;
alter function private.get_sales_summary(date, date, text[], text) rename to sales_summary_core;
revoke all on function private.sales_summary_core(date, date, text[], text) from public, anon, authenticated;

create function public.get_sales_summary(p_from date, p_to date, p_location_ids text[] default null,
  p_source text default 'operational')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  if not private.is_owner_or_manager() then
    perform private.raise_error('unauthorized', jsonb_build_object('reason', 'sales_summary_managers_only'));
  end if;
  return private.sales_summary_core(p_from, p_to, p_location_ids, p_source);
end;
$$;

alter function public.get_stock_overview(text) set schema private;
alter function private.get_stock_overview(text) rename to stock_overview_core;
revoke all on function private.stock_overview_core(text) from public, anon, authenticated;

create function public.get_stock_overview(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['manager']);
  return private.stock_overview_core(p_location_id);
end;
$$;

-- Raw stock tables: managers and the owner only (every employee-facing screen
-- reads stock through security-definer functions).
drop policy lots_read on public.lots;
create policy lots_read on public.lots for select to authenticated
  using (location_id in (select private.managed_location_ids()));
drop policy stock_balances_read on public.stock_balances;
create policy stock_balances_read on public.stock_balances for select to authenticated
  using (location_id in (select private.managed_location_ids()));
drop policy reservation_allocations_read on public.reservation_allocations;
create policy reservation_allocations_read on public.reservation_allocations for select to authenticated
  using (location_id in (select private.managed_location_ids()));

revoke all on function
  private.item_stock_series(text, text, date, date),
  private.reorder_alert_items(text),
  public.get_item_stock_history(text, text, integer),
  public.get_reorder_alerts(),
  public.list_stock_items(text),
  public.get_sales_summary(date, date, text[], text),
  public.get_stock_overview(text)
from public, anon;
revoke all on function private.item_stock_series(text, text, date, date), private.reorder_alert_items(text) from authenticated;
grant execute on function
  public.get_item_stock_history(text, text, integer),
  public.get_reorder_alerts(),
  public.list_stock_items(text),
  public.get_sales_summary(date, date, text[], text),
  public.get_stock_overview(text)
to authenticated;

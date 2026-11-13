-- 0021 Planning: 14-day demand forecast with provenance and manager overrides,
-- BOM explosion and MRP projection with proposed orders, ROP/EOQ settings and
-- the EOQ formula, "What can we serve" and the menu-mix simulator
-- (PRD §10; AC21, AC22, AC23, AC24). Everything here is a read or a preview
-- except overrides and settings, which a manager saves explicitly. Proposals
-- become purchase orders only through the normal draft-PO RPC.

alter table public.location_item_settings
  add column annual_demand_override_base numeric(18, 6) check (annual_demand_override_base >= 0),
  add column annual_demand_unit text not null default 'item base units per year';

-- ---------------------------------------------------------------------------
-- Manager forecast overrides (append-only; the latest per location/item/date wins)
-- ---------------------------------------------------------------------------
create table public.forecast_overrides (
  override_id uuid primary key default gen_random_uuid(),
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null,
  is_sellable boolean not null default true check (is_sellable),
  business_date date not null,
  quantity integer not null check (quantity between 0 and 10000),
  reason text not null check (length(btrim(reason)) >= 3),
  set_by text not null references public.employees (employee_id) on delete restrict,
  set_at timestamptz not null default now(),
  request_key uuid,
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable)
);

create index forecast_overrides_lookup on public.forecast_overrides (location_id, item_id, business_date, set_at desc);
create trigger forecast_overrides_append_only before update or delete on public.forecast_overrides
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- EOQ (AC22): sqrt(2 × D × S / H), D base units/year, S USD/order, H USD/base unit/year
-- ---------------------------------------------------------------------------
create function private.eoq(p_annual_demand numeric, p_ordering_cost_usd numeric, p_holding_cost_usd numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_annual_demand is null or p_ordering_cost_usd is null or p_holding_cost_usd is null then
    raise exception using errcode = 'P0001', message = 'validation:eoq_inputs_missing';
  end if;
  if p_annual_demand < 0 then raise exception using errcode = 'P0001', message = 'validation:eoq_demand_negative'; end if;
  if p_ordering_cost_usd < 0 then raise exception using errcode = 'P0001', message = 'validation:eoq_ordering_cost_negative'; end if;
  if p_holding_cost_usd <= 0 then raise exception using errcode = 'P0001', message = 'validation:eoq_holding_cost_not_positive'; end if;
  if p_annual_demand = 0 then return 0; end if;
  return sqrt(2 * p_annual_demand * p_ordering_cost_usd / p_holding_cost_usd);
end;
$$;

-- Unconstrained EOQ, the pack-rounded actionable quantity, and the cover-days cap,
-- kept separate. When the cap is below the actionable quantity the caller must choose.
create function public.calculate_eoq(p_annual_demand numeric, p_ordering_cost_cents bigint, p_holding_cost numeric,
  p_pack_base_qty numeric default null, p_min_order_base numeric default null, p_max_cover_days integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_eoq numeric;
  v_actionable numeric;
  v_daily numeric;
  v_cap numeric;
  v_warnings jsonb := '[]'::jsonb;
begin
  perform private.require_actor();
  if p_pack_base_qty is not null and p_pack_base_qty <= 0 then perform private.raise_error('validation:pack_base_qty'); end if;
  if p_max_cover_days is not null and p_max_cover_days <= 0 then perform private.raise_error('validation:max_cover_days'); end if;
  v_eoq := private.eoq(p_annual_demand, p_ordering_cost_cents / 100.0, p_holding_cost);
  v_actionable := case when p_pack_base_qty is not null then ceil(v_eoq / p_pack_base_qty) * p_pack_base_qty else ceil(v_eoq) end;
  if p_min_order_base is not null and v_actionable < p_min_order_base then
    v_actionable := case when p_pack_base_qty is not null then ceil(p_min_order_base / p_pack_base_qty) * p_pack_base_qty
                         else ceil(p_min_order_base) end;
    v_warnings := v_warnings || '["raised_to_minimum_order"]'::jsonb;
  end if;
  if p_max_cover_days is not null and p_annual_demand > 0 then
    v_daily := p_annual_demand / 365.0;
    v_cap := v_daily * p_max_cover_days;
    if v_actionable > v_cap then
      v_warnings := v_warnings || '["exceeds_max_cover_days: choose a quantity"]'::jsonb;
    end if;
  end if;
  return jsonb_build_object(
    'eoq', round(v_eoq, 3)::text, 'actionable_quantity', v_actionable::text,
    'actionable_packs', case when p_pack_base_qty is not null then (v_actionable / p_pack_base_qty)::text end,
    'cover_cap_quantity', round(v_cap, 3)::text,
    'cover_cap_packs', case when v_cap is not null and p_pack_base_qty is not null then floor(v_cap / p_pack_base_qty)::text end,
    'warnings', v_warnings,
    'units', jsonb_build_object('annual_demand', 'item base units per year', 'ordering_cost', 'USD per replenishment order',
      'holding_cost', 'USD per base unit per year', 'quantity', 'item base units'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Demand history (sellable items) by local business date
-- ---------------------------------------------------------------------------
-- operational: completed orders' current-revision lines (refunds do not erase demand;
-- cancelled/unprepared orders are excluded). historical: synthetic demo history only.
create function private.daily_sales(p_location_id text, p_source text, p_from date, p_to date)
returns table (item_id text, business_date date, qty numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.item_id, o.completed_business_date, sum(l.quantity)::numeric
  from public.orders o join public.order_lines l on l.order_id = o.order_id and l.revision = o.revision
  where p_source = 'operational' and o.location_id = p_location_id and o.status = 'completed'
    and o.completed_business_date between p_from and p_to
  group by l.item_id, o.completed_business_date
  union all
  select h.item_id, h.business_date, sum(h.quantity_fulfilled)::numeric
  from public.historical_sales_lines h
  where p_source = 'historical' and h.location_id = p_location_id and h.business_date between p_from and p_to
  group by h.item_id, h.business_date;
$$;

-- The observed history range before p_as_of: from the first sales date to the
-- last observed date (yesterday, or the end of the demo history).
create function private.history_range(p_location_id text, p_source text, p_as_of date)
returns table (first_date date, last_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_source = 'operational'
              then (select min(o.completed_business_date) from public.orders o
                    where o.location_id = p_location_id and o.status = 'completed' and o.completed_business_date < p_as_of)
              else (select min(h.business_date) from public.historical_sales_orders h
                    where h.location_id = p_location_id and h.business_date < p_as_of) end,
         case when p_source = 'operational' then p_as_of - 1
              else least(p_as_of - 1, (select max(h.business_date) from public.historical_sales_orders h
                                       where h.location_id = p_location_id)) end;
$$;

create function private.require_planning_source(p_source text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_source not in ('operational', 'historical') then perform private.raise_error('validation:source'); end if;
  if p_source = 'historical' and private.data_mode() <> 'demo' then
    perform private.raise_error('validation:source', jsonb_build_object('reason', 'synthetic history exists only in the demo project'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Forecast rows (AC21, AC23)
-- ---------------------------------------------------------------------------
-- Same-weekday mean over the previous 8 complete weeks (zero-sales open days
-- count; only dates before the as-of date). Fewer than 2 instances → trailing
-- 28-day mean. No history → a manager forecast is required. A manager override
-- replaces the computed value. On the current business date the forecast is
-- reduced by orders already fulfilled, in preparation, or accepted (their
-- ingredients are already consumed or reserved), so nothing is counted twice.
create function private.forecast_rows(p_location_id text, p_as_of date, p_days integer, p_source text)
returns table (item_id text, item_type text, business_date date, method text, observations integer, window_from date,
  window_to date, base_qty numeric, override_qty integer, override_reason text, forecast_qty numeric, fulfilled_qty numeric,
  in_progress_qty numeric, accepted_qty numeric, residual_qty numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with rng as (select * from private.history_range(p_location_id, p_source, p_as_of)),
  items as (select i.item_id, i.item_type from public.items i where i.is_sellable and i.archived_at is null),
  targets as (select (p_as_of + g)::date as t from generate_series(0, p_days - 1) g),
  open_past as (
    select (p_as_of - g)::date as d
    from generate_series(1, 56) g, rng
    where rng.first_date is not null and (p_as_of - g) >= rng.first_date and (p_as_of - g) <= rng.last_date
      and not exists (select 1 from public.location_closures c where c.location_id = p_location_id and c.business_date = p_as_of - g)),
  hist as (select * from private.daily_sales(p_location_id, p_source, p_as_of - 56, p_as_of - 1)),
  qty as (
    select i.item_id, o.d, coalesce(h.qty, 0) as q
    from items i cross join open_past o
    left join hist h on h.item_id = i.item_id and h.business_date = o.d),
  calc as (
    select i.item_id, i.item_type, t.t,
      exists (select 1 from public.location_closures c where c.location_id = p_location_id and c.business_date = t.t) as closed,
      (select count(*) from qty where qty.item_id = i.item_id and extract(dow from qty.d) = extract(dow from t.t))::integer as n_wd,
      (select avg(q) from qty where qty.item_id = i.item_id and extract(dow from qty.d) = extract(dow from t.t)) as m_wd,
      (select count(*) from qty where qty.item_id = i.item_id and qty.d >= p_as_of - 28)::integer as n_28,
      (select avg(q) from qty where qty.item_id = i.item_id and qty.d >= p_as_of - 28) as m_28
    from items i cross join targets t),
  meth as (
    select c.*,
      case when c.closed then 'closed' when c.n_wd >= 2 then 'same_weekday_8w' when c.n_28 >= 1 then 'trailing_28d'
           else 'manager_required' end as method
    from calc c),
  ovr as (
    select distinct on (f.item_id, f.business_date) f.item_id, f.business_date, f.quantity, f.reason
    from public.forecast_overrides f
    where f.location_id = p_location_id and f.business_date between p_as_of and p_as_of + p_days - 1
    order by f.item_id, f.business_date, f.set_at desc),
  today as (
    select l.item_id,
      sum(l.quantity) filter (where o.status = 'completed' and o.completed_business_date = private.business_date()) as fulfilled,
      sum(l.quantity) filter (where o.status in ('preparing', 'ready') and o.business_date = private.business_date()) as in_progress,
      sum(l.quantity) filter (where o.status = 'accepted' and o.business_date = private.business_date()) as accepted
    from public.orders o join public.order_lines l on l.order_id = o.order_id and l.revision = o.revision
    where o.location_id = p_location_id and (o.business_date = private.business_date() or o.completed_business_date = private.business_date())
    group by l.item_id),
  base as (
    select m.item_id, m.item_type, m.t, m.method,
      case m.method when 'same_weekday_8w' then m.n_wd when 'trailing_28d' then m.n_28 else 0 end as obs,
      case m.method when 'same_weekday_8w' then p_as_of - 56 when 'trailing_28d' then p_as_of - 28 end as wf,
      case when m.method in ('same_weekday_8w', 'trailing_28d') then p_as_of - 1 end as wt,
      case m.method when 'closed' then 0 when 'same_weekday_8w' then round(m.m_wd, 2) when 'trailing_28d' then round(m.m_28, 2) end as base_qty,
      o.quantity as override_qty, o.reason as override_reason,
      case when m.t = private.business_date() then coalesce(td.fulfilled, 0) else 0 end as fulfilled,
      case when m.t = private.business_date() then coalesce(td.in_progress, 0) else 0 end as in_progress,
      case when m.t = private.business_date() then coalesce(td.accepted, 0) else 0 end as accepted
    from meth m
    left join ovr o on o.item_id = m.item_id and o.business_date = m.t
    left join today td on td.item_id = m.item_id)
  select b.item_id, b.item_type, b.t, b.method, b.obs, b.wf, b.wt, b.base_qty, b.override_qty, b.override_reason,
    coalesce(b.override_qty::numeric, b.base_qty) as forecast_qty, b.fulfilled, b.in_progress, b.accepted,
    case when coalesce(b.override_qty::numeric, b.base_qty) is null then null
         else greatest(0, coalesce(b.override_qty::numeric, b.base_qty) - b.fulfilled - b.in_progress - b.accepted) end
  from base b;
$$;

create function public.get_demand_forecast(p_location_id text, p_as_of date default null, p_days integer default 14,
  p_source text default 'operational')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, private.business_date());
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['manager']);
  perform private.require_planning_source(p_source);
  if p_days not between 1 and 28 then perform private.raise_error('validation:days'); end if;
  return jsonb_build_object(
    'location_id', p_location_id, 'as_of', v_as_of, 'days', p_days, 'source', p_source,
    'data_label', case when p_source = 'historical' then 'demo historical (synthetic)'
                       when private.data_mode() = 'demo' then 'demo operational' else 'pilot operational' end,
    'timezone', 'America/Denver', 'refreshed_at', now(),
    'history', (select jsonb_build_object('first_date', r.first_date, 'last_date', r.last_date)
                from private.history_range(p_location_id, p_source, v_as_of) r),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name', i.name, 'item_type', x.item_type, 'days', x.days)
        order by x.item_type, x.item_id)
      from (select f.item_id, f.item_type, jsonb_agg(jsonb_build_object('date', f.business_date, 'method', f.method,
              'observations', f.observations, 'window_from', f.window_from, 'window_to', f.window_to,
              'base_qty', f.base_qty::text, 'override_qty', f.override_qty, 'override_reason', f.override_reason,
              'forecast_qty', f.forecast_qty::text, 'fulfilled_qty', f.fulfilled_qty, 'in_progress_qty', f.in_progress_qty,
              'accepted_qty', f.accepted_qty, 'residual_qty', f.residual_qty::text) order by f.business_date) as days
            from private.forecast_rows(p_location_id, v_as_of, p_days, p_source) f
            group by f.item_id, f.item_type) x
      join public.items i on i.item_id = x.item_id), '[]'::jsonb));
end;
$$;

create function public.set_forecast_override(p_request_key uuid, p_location_id text, p_item_id text, p_business_date date,
  p_quantity integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_id uuid;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'set_forecast_override', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_business_date is null or p_business_date < private.business_date() or p_business_date > private.business_date() + 60 then
    perform private.raise_error('validation:business_date', jsonb_build_object('rule', 'today to 60 days ahead'));
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 10000 then perform private.raise_error('validation:quantity'); end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_sellable and i.archived_at is null) then
    perform private.raise_error('validation:item_not_sellable');
  end if;
  insert into public.forecast_overrides (location_id, item_id, business_date, quantity, reason, set_by, request_key)
  values (p_location_id, p_item_id, p_business_date, p_quantity, btrim(p_reason), v_actor, p_request_key)
  returning override_id into v_id;
  perform private.write_audit(v_actor, 'forecast.override', 'forecast_override', v_id::text, p_location_id, p_request_key, null,
    jsonb_build_object('item_id', p_item_id, 'business_date', p_business_date, 'quantity', p_quantity), p_reason);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'override_id', v_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- MRP projection and proposals (AC21)
-- ---------------------------------------------------------------------------
-- Day 0 is today. Starting balance = available stock (eligible sellable on hand −
-- reservations; quarantine excluded). Requirements = residual forecast exploded
-- through the active recipe (retail items require themselves). Open PO balances
-- arrive only on their expected date; late or undated ones are flagged, not added.
create function public.get_replenishment_plan(p_location_id text, p_days integer default 14, p_source text default 'operational')
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
  perform private.require_location_role(p_location_id, array['manager']);
  perform private.require_planning_source(p_source);
  if p_days not between 1 and 28 then perform private.raise_error('validation:days'); end if;
  return (
    with fc as (select * from private.forecast_rows(p_location_id, v_today, p_days, p_source)),
    req as (
      select c.component_item_id as item_id, f.business_date as d, sum(f.residual_qty * c.quantity_per_serving) as qty,
             bool_or(f.residual_qty is null) as missing
      from fc f
      join public.recipe_versions v on v.parent_item_id = f.item_id and v.status = 'active'
      join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
      group by c.component_item_id, f.business_date
      union all
      select f.item_id, f.business_date, coalesce(f.residual_qty, 0), f.residual_qty is null
      from fc f where f.item_type = 'retail'),
    open_po as (
      select l.item_id, po.po_id, po.po_number, po.expected_date,
             (l.ordered_packs - l.received_packs - l.cancelled_packs) * l.pack_base_qty as qty
      from public.purchase_orders po join public.purchase_order_lines l on l.po_id = po.po_id
      where po.location_id = p_location_id and po.status in ('submitted', 'partially_received')
        and l.ordered_packs - l.received_packs - l.cancelled_packs > 0),
    stock_items as (
      select distinct x.item_id from (
        select r.item_id from req r where r.qty > 0
        union select o.item_id from open_po o
        union select s.item_id from public.location_item_settings s
              where s.location_id = p_location_id and s.reorder_applicable and s.reorder_point_base is not null) x),
    days as (select (v_today + g)::date as d from generate_series(0, p_days - 1) g),
    grid as (
      select s.item_id, d.d,
        coalesce((select sum(o.qty) from open_po o where o.item_id = s.item_id and o.expected_date = d.d), 0) as receipts,
        coalesce((select sum(r.qty) from req r where r.item_id = s.item_id and r.d = d.d), 0) as requirement,
        coalesce((select bool_or(r.missing) from req r where r.item_id = s.item_id and r.d = d.d), false) as missing
      from stock_items s cross join days d),
    proj as (
      select g.*, private.available_qty(p_location_id, g.item_id)
               + sum(g.receipts - g.requirement) over (partition by g.item_id order by g.d) as projected
      from grid g),
    summary as (
      select p.item_id,
        jsonb_agg(jsonb_build_object('date', p.d, 'receipts', p.receipts::text, 'requirement', round(p.requirement, 6)::text,
          'projected', round(p.projected, 6)::text, 'forecast_missing', p.missing) order by p.d) as days,
        min(p.projected) as min_projected, sum(p.requirement) as total_req, bool_or(p.missing) as any_missing
      from proj p group by p.item_id)
    select jsonb_build_object(
      'location_id', p_location_id, 'as_of', v_today, 'days', p_days, 'source', p_source,
      'data_label', case when p_source = 'historical' then 'demand from demo historical (synthetic)'
                         when private.data_mode() = 'demo' then 'demo operational' else 'pilot operational' end,
      'timezone', 'America/Denver', 'refreshed_at', now(),
      'items', coalesce(jsonb_agg(z.j order by (z.j ->> 'shortage_date') nulls last, z.j ->> 'item_id'), '[]'::jsonb))
    from (
      select jsonb_build_object(
        'item_id', s.item_id, 'name', i.name, 'base_unit', i.base_unit, 'requires_use_by', i.requires_use_by,
        'available_now', private.available_qty(p_location_id, s.item_id)::text,
        'safety_stock', st.safety_stock_base::text, 'reorder_point', st.reorder_point_base::text,
        'suggested_reorder_point', round(s.total_req / p_days * coalesce(si.procurement_lead_days, i.procurement_lead_days, 0)
                                          + coalesce(st.safety_stock_base, 0), 3)::text,
        'lead_days', coalesce(si.procurement_lead_days, i.procurement_lead_days),
        'lead_time_basis', coalesce(si.lead_time_basis, i.lead_time_basis),
        'supplier_id', si.supplier_id, 'supplier_item_id', si.supplier_item_id, 'pack_base_qty', si.pack_base_qty::text,
        'days', s.days, 'forecast_missing', s.any_missing,
        'shortage_date', sh.d,
        'proposed_order_date', sh.d - coalesce(si.procurement_lead_days, i.procurement_lead_days, 0),
        'proposed_order_late', sh.d is not null and sh.d - coalesce(si.procurement_lead_days, i.procurement_lead_days, 0) < v_today,
        'proposed_quantity', case when sh.d is not null then
            (case when si.pack_base_qty is not null
                  then ceil((coalesce(st.safety_stock_base, 0) - s.min_projected) / si.pack_base_qty) * si.pack_base_qty
                  else ceil(coalesce(st.safety_stock_base, 0) - s.min_projected) end)::text end,
        'proposed_packs', case when sh.d is not null and si.pack_base_qty is not null then
            ceil((coalesce(st.safety_stock_base, 0) - s.min_projected) / si.pack_base_qty)::text end,
        'late_receipts', coalesce((select jsonb_agg(jsonb_build_object('po_number', o.po_number, 'expected_date', o.expected_date,
            'quantity', o.qty::text)) from open_po o where o.item_id = s.item_id and (o.expected_date is null or o.expected_date < v_today)), '[]'::jsonb),
        'below_reorder_point_date', (select min(p.d) from proj p where p.item_id = s.item_id and st.reorder_point_base is not null
                                       and p.projected < st.reorder_point_base)) as j
      from summary s
      join public.items i on i.item_id = s.item_id
      left join public.location_item_settings st on st.location_id = p_location_id and st.item_id = s.item_id
      left join public.supplier_items si on si.item_id = s.item_id and si.is_primary and si.archived_at is null
      left join lateral (select min(p.d) as d from proj p where p.item_id = s.item_id and p.projected < coalesce(st.safety_stock_base, 0)) sh on true
    ) z);
end;
$$;

-- ---------------------------------------------------------------------------
-- ROP/EOQ inputs and settings (AC22)
-- ---------------------------------------------------------------------------
-- D = fulfilled component use over the last 180 complete days ÷ observed open days × 365.
create function public.get_eoq_inputs(p_location_id text, p_item_id text, p_source text default 'operational')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_from date := private.business_date() - 180;
  v_first date;
  v_last date;
  v_open integer;
  v_total numeric;
  v_d numeric;
  v_status text;
  v_settings public.location_item_settings;
  v_si public.supplier_items;
  v_eoq jsonb;
  v_effective_d numeric;
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['manager']);
  perform private.require_planning_source(p_source);
  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_purchasable) then
    perform private.raise_error('validation:item_not_stocked');
  end if;
  select r.first_date, r.last_date into v_first, v_last from private.history_range(p_location_id, p_source, v_today) r;
  select count(*) into v_open
  from generate_series(greatest(v_from, coalesce(v_first, v_today)), coalesce(v_last, v_today - 1), interval '1 day') g
  where v_first is not null
    and not exists (select 1 from public.location_closures c where c.location_id = p_location_id and c.business_date = g::date);
  if p_source = 'operational' then
    select coalesce(sum(case when l.item_id = p_item_id then l.quantity::numeric else 0 end), 0)
           + coalesce(sum((select sum(q.required_qty) from public.order_line_requirements q
                           where q.order_line_id = l.order_line_id and q.component_item_id = p_item_id)), 0)
      into v_total
    from public.orders o join public.order_lines l on l.order_id = o.order_id and l.revision = o.revision
    where o.location_id = p_location_id and o.status = 'completed' and o.completed_business_date between v_from and v_today - 1;
  else
    select coalesce(sum(case when h.item_id = p_item_id then h.quantity_fulfilled::numeric
                             else h.quantity_fulfilled * coalesce((select c.quantity_per_serving from public.recipe_versions v
                               join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
                               where v.parent_item_id = h.item_id and v.status = 'active' and c.component_item_id = p_item_id), 0) end), 0)
      into v_total
    from public.historical_sales_lines h
    where h.location_id = p_location_id and h.business_date between v_from and v_today - 1;
  end if;
  if v_open < 28 then
    v_status := 'insufficient';
  else
    v_status := 'estimated';
    v_d := v_total / v_open * 365;
  end if;
  select * into v_settings from public.location_item_settings s where s.location_id = p_location_id and s.item_id = p_item_id;
  select * into v_si from public.supplier_items s where s.item_id = p_item_id and s.is_primary and s.archived_at is null;
  v_effective_d := coalesce(v_settings.annual_demand_override_base, v_d);
  if v_effective_d is not null and v_settings.ordering_cost_cents is not null and coalesce(v_settings.annual_holding_cost_per_base, 0) > 0 then
    v_eoq := public.calculate_eoq(v_effective_d, v_settings.ordering_cost_cents, v_settings.annual_holding_cost_per_base,
      v_si.pack_base_qty, null, v_settings.max_cover_days);
  end if;
  return jsonb_build_object(
    'location_id', p_location_id, 'item_id', p_item_id, 'source', p_source,
    'data_label', case when p_source = 'historical' then 'demo historical (synthetic)'
                       when private.data_mode() = 'demo' then 'demo operational' else 'pilot operational' end,
    'window_from', v_from, 'window_to', v_today - 1, 'open_days_observed', v_open, 'fulfilled_use', round(v_total, 6)::text,
    'demand_status', v_status, 'estimated_annual_demand', round(v_d, 3)::text,
    'annual_demand_override', v_settings.annual_demand_override_base::text,
    'annual_demand_used', round(v_effective_d, 3)::text,
    'annual_demand_source', case when v_settings.annual_demand_override_base is not null then 'manager input'
                                 when v_d is not null then 'estimated' else null end,
    'settings', case when v_settings.item_id is not null then jsonb_build_object(
        'reorder_point', v_settings.reorder_point_base::text, 'safety_stock', v_settings.safety_stock_base::text,
        'ordering_cost_cents', v_settings.ordering_cost_cents, 'holding_cost', v_settings.annual_holding_cost_per_base::text,
        'max_cover_days', v_settings.max_cover_days, 'provenance', v_settings.provenance,
        'approved_at', v_settings.approved_at, 'approved_by', v_settings.approved_by,
        'units', jsonb_build_object('quantity', v_settings.quantity_unit_basis, 'ordering_cost', v_settings.ordering_cost_unit,
          'holding_cost', v_settings.holding_cost_unit, 'annual_demand', v_settings.annual_demand_unit)) end,
    'pack_base_qty', v_si.pack_base_qty::text, 'lead_days', v_si.procurement_lead_days, 'lead_time_basis', v_si.lead_time_basis,
    'eoq', v_eoq);
end;
$$;

create function public.set_location_item_settings(p_request_key uuid, p_location_id text, p_item_id text,
  p_reorder_point numeric, p_safety_stock numeric, p_ordering_cost_cents bigint, p_holding_cost numeric,
  p_max_cover_days integer default null, p_annual_demand_override numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'set_location_item_settings', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_gate('planning_inputs_confirmed', p_location_id);
  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_purchasable and i.archived_at is null) then
    perform private.raise_error('validation:item_not_stocked');
  end if;
  if p_reorder_point is null or p_reorder_point < 0 then perform private.raise_error('validation:reorder_point'); end if;
  if p_safety_stock is null or p_safety_stock < 0 then perform private.raise_error('validation:safety_stock'); end if;
  if p_safety_stock > p_reorder_point then
    perform private.raise_error('validation:safety_stock', jsonb_build_object('rule', 'safety stock cannot exceed the reorder point'));
  end if;
  if p_ordering_cost_cents is null or p_ordering_cost_cents < 0 then perform private.raise_error('validation:ordering_cost'); end if;
  if p_holding_cost is null or p_holding_cost <= 0 then perform private.raise_error('validation:eoq_holding_cost_not_positive'); end if;
  if p_max_cover_days is not null and p_max_cover_days <= 0 then perform private.raise_error('validation:max_cover_days'); end if;
  if p_annual_demand_override is not null and p_annual_demand_override < 0 then perform private.raise_error('validation:eoq_demand_negative'); end if;
  select to_jsonb(s) into v_before from public.location_item_settings s where s.location_id = p_location_id and s.item_id = p_item_id;
  insert into public.location_item_settings (location_id, item_id, reorder_applicable, reorder_point_base, safety_stock_base,
    ordering_cost_cents, annual_holding_cost_per_base, max_cover_days, annual_demand_override_base, provenance, approved_by, approved_at)
  values (p_location_id, p_item_id, true, p_reorder_point, p_safety_stock, p_ordering_cost_cents, p_holding_cost, p_max_cover_days,
    p_annual_demand_override, case when private.data_mode() = 'demo' then 'demo_manager_entered' else 'pilot_manager_approved' end,
    v_actor, now())
  on conflict (location_id, item_id) do update
    set reorder_applicable = true, reorder_point_base = excluded.reorder_point_base, safety_stock_base = excluded.safety_stock_base,
        ordering_cost_cents = excluded.ordering_cost_cents, annual_holding_cost_per_base = excluded.annual_holding_cost_per_base,
        max_cover_days = excluded.max_cover_days, annual_demand_override_base = excluded.annual_demand_override_base,
        provenance = excluded.provenance, approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now()
    where public.location_item_settings.location_id = excluded.location_id;
  perform private.write_audit(v_actor, 'planning.settings', 'location_item_settings', p_location_id || ':' || p_item_id,
    p_location_id, p_request_key, v_before,
    jsonb_build_object('reorder_point', p_reorder_point, 'safety_stock', p_safety_stock, 'ordering_cost_cents', p_ordering_cost_cents,
      'holding_cost', p_holding_cost, 'max_cover_days', p_max_cover_days, 'annual_demand_override', p_annual_demand_override));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'location_id', p_location_id, 'item_id', p_item_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- What can we serve (AC24)
-- ---------------------------------------------------------------------------
-- Independent potentials: each dish's portions assume it alone uses the stock.
create function public.get_serve_view(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_manager boolean;
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_manager := private.has_location_role(p_location_id, array['manager']);
  return jsonb_build_object(
    'location_id', p_location_id, 'business_date', v_today, 'refreshed_at', now(),
    'note', 'Each dish''s portions are independent: dishes share ingredients, so these numbers cannot be added together.',
    'dishes', coalesce((
      with comp as (
        select v.parent_item_id, c.component_item_id, c.quantity_per_serving,
               private.available_qty(p_location_id, c.component_item_id) as avail
        from public.recipe_versions v join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
        where v.status = 'active'),
      ranked as (
        select comp.*, floor(comp.avail / comp.quantity_per_serving)::bigint as portions,
               row_number() over (partition by comp.parent_item_id
                                  order by floor(comp.avail / comp.quantity_per_serving), comp.component_item_id) as rn
        from comp),
      fc as (select * from private.forecast_rows(p_location_id, v_today, 1, 'operational') f where f.item_type = 'finished_dish')
      select jsonb_agg(jsonb_build_object(
        'item_id', i.item_id, 'name', i.name, 'portions_now', r.portions,
        'bottleneck_item_id', r.component_item_id, 'bottleneck_name', b.name, 'bottleneck_base_unit', b.base_unit,
        'bottleneck_available', r.avail::text, 'bottleneck_per_serving', r.quantity_per_serving::text,
        'accepted_today', f.accepted_qty, 'in_progress_today', f.in_progress_qty, 'fulfilled_today', f.fulfilled_qty,
        'planned_today', case when v_manager then f.forecast_qty::text end,
        'planned_remaining_today', case when v_manager then f.residual_qty::text end,
        'forecast_method', case when v_manager then f.method end,
        'next_delivery', (select jsonb_build_object('po_number', po.po_number, 'expected_date', po.expected_date,
              'quantity', ((l.ordered_packs - l.received_packs - l.cancelled_packs) * l.pack_base_qty)::text)
            from public.purchase_orders po join public.purchase_order_lines l on l.po_id = po.po_id
            where po.location_id = p_location_id and po.status in ('submitted', 'partially_received')
              and l.item_id = r.component_item_id and l.ordered_packs - l.received_packs - l.cancelled_packs > 0
            order by po.expected_date nulls last limit 1),
        'prep_lead_days', i.prep_lead_days, 'lead_time_note', i.lead_time_note) order by i.item_id)
      from ranked r
      join public.items i on i.item_id = r.parent_item_id
      join public.items b on b.item_id = r.component_item_id
      left join fc f on f.item_id = r.parent_item_id
      where r.rn = 1), '[]'::jsonb));
end;
$$;

-- Menu-mix preview (managers): aggregates shared components across the whole mix,
-- shows combined shortages and a pack-rounded replenishment preview. Saves nothing.
-- p_mix: [{item_id, quantity}]
create function public.simulate_menu_mix(p_location_id text, p_mix jsonb)
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
  perform private.require_location_role(p_location_id, array['manager']);
  if p_mix is null or jsonb_typeof(p_mix) <> 'array' or jsonb_array_length(p_mix) = 0 then
    perform private.raise_error('validation:mix');
  end if;
  if exists (select 1 from jsonb_to_recordset(p_mix) as x(item_id text, quantity integer)
             where x.quantity is null or x.quantity < 0 or x.quantity > 10000
                or not exists (select 1 from public.items i where i.item_id = x.item_id and i.is_sellable)) then
    perform private.raise_error('validation:mix', jsonb_build_object('rule', 'sellable items with whole quantities'));
  end if;
  return (
    with mix as (select x.item_id, sum(x.quantity) as qty from jsonb_to_recordset(p_mix) as x(item_id text, quantity integer)
                 group by x.item_id),
    req as (
      select c.component_item_id as item_id, sum(m.qty * c.quantity_per_serving) as required,
             jsonb_agg(jsonb_build_object('dish', m.item_id, 'quantity', (m.qty * c.quantity_per_serving)::text) order by m.item_id) as used_by
      from mix m
      join public.recipe_versions v on v.parent_item_id = m.item_id and v.status = 'active'
      join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
      group by c.component_item_id
      union all
      select m.item_id, m.qty, jsonb_build_array(jsonb_build_object('dish', m.item_id, 'quantity', m.qty::text))
      from mix m join public.items i on i.item_id = m.item_id where i.item_type = 'retail'),
    rows as (
      select r.item_id, i.name, i.base_unit, r.required, private.available_qty(p_location_id, r.item_id) as avail, r.used_by,
             si.supplier_id, si.supplier_item_id, si.pack_base_qty, coalesce(si.procurement_lead_days, i.procurement_lead_days) as lead
      from req r join public.items i on i.item_id = r.item_id
      left join public.supplier_items si on si.item_id = r.item_id and si.is_primary and si.archived_at is null)
    select jsonb_build_object(
      'location_id', p_location_id, 'business_date', v_today, 'preview_only', true,
      'feasible', coalesce(bool_and(rows.avail >= rows.required), true),
      'components', coalesce(jsonb_agg(jsonb_build_object(
        'item_id', rows.item_id, 'name', rows.name, 'base_unit', rows.base_unit, 'required', rows.required::text,
        'available', rows.avail::text, 'shortfall', greatest(rows.required - rows.avail, 0)::text, 'used_by', rows.used_by,
        'shared', jsonb_array_length(rows.used_by) > 1,
        'proposed_quantity', case when rows.required > rows.avail then
          (case when rows.pack_base_qty is not null then ceil((rows.required - rows.avail) / rows.pack_base_qty) * rows.pack_base_qty
                else ceil(rows.required - rows.avail) end)::text end,
        'proposed_packs', case when rows.required > rows.avail and rows.pack_base_qty is not null
          then ceil((rows.required - rows.avail) / rows.pack_base_qty)::text end,
        'supplier_id', rows.supplier_id, 'supplier_item_id', rows.supplier_item_id, 'lead_days', rows.lead,
        'earliest_arrival', case when rows.required > rows.avail then v_today + coalesce(rows.lead, 0) end)
        order by (rows.required > rows.avail) desc, rows.item_id), '[]'::jsonb))
    from rows);
end;
$$;

-- planning_inputs_confirmed is now confirmable (owner attestation).
create or replace function private.gate_precondition_failure(p_gate public.pilot_setup_gates)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_missing jsonb;
begin
  case p_gate.gate_key
    when 'tax_rate_confirmed' then
      if not exists (select 1 from public.location_tax_rates t
                     where t.location_id = p_gate.scope_id and t.effective_from <= v_today and t.confirmed_by is not null) then
        return jsonb_build_object('reason', 'no_confirmed_tax_rate_effective_today');
      end if;
    when 'menu_prices_confirmed' then
      select jsonb_agg(i.item_id order by i.item_id) into v_missing
      from public.items i
      where i.is_sellable and i.archived_at is null
        and not exists (select 1 from public.location_item_prices p
                        where p.location_id = p_gate.scope_id and p.item_id = i.item_id and p.effective_from <= v_today);
      if v_missing is not null then
        return jsonb_build_object('reason', 'sellable_items_without_price', 'item_ids', v_missing);
      end if;
    when 'recipes_verified' then
      if not exists (select 1 from public.recipe_versions v where v.parent_item_id = p_gate.scope_id and v.status = 'active') then
        return jsonb_build_object('reason', 'no_active_recipe_version');
      end if;
    when 'pack_conversions_verified' then
      if not exists (select 1 from public.supplier_items si where si.supplier_item_id::text = p_gate.scope_id
                     and si.pack_base_qty is not null and si.cost_basis in ('quoted', 'estimated')) then
        return jsonb_build_object('reason', 'pack_size_or_cost_not_entered');
      end if;
    when 'supplier_master_verified' then
      if not exists (select 1 from public.suppliers s where s.supplier_id = p_gate.scope_id and s.payment_terms_days is not null) then
        return jsonb_build_object('reason', 'payment_terms_not_entered');
      end if;
    when 'opening_counts_posted' then
      if not exists (select 1 from public.opening_counts o where o.location_id = p_gate.scope_id) then
        return jsonb_build_object('reason', 'no_opening_count_posted');
      end if;
    when 'return_policy_configured' then
      if not exists (select 1 from public.return_policy) then
        return jsonb_build_object('reason', 'return_policy_not_set');
      end if;
    when 'planning_inputs_confirmed' then
      -- Attestation: the owner confirms the location's ordering/holding cost basis
      -- and cover-day policy were reviewed; managers then save approved settings.
      null;
    else
      null;
  end case;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.forecast_overrides enable row level security;
revoke all on table public.forecast_overrides from anon, authenticated;
grant select on table public.forecast_overrides to authenticated;
create policy forecast_overrides_read on public.forecast_overrides for select to authenticated
  using (location_id in (select private.managed_location_ids()));

grant execute on function
  public.calculate_eoq(numeric, bigint, numeric, numeric, numeric, integer),
  public.get_demand_forecast(text, date, integer, text),
  public.set_forecast_override(uuid, text, text, date, integer, text),
  public.get_replenishment_plan(text, integer, text),
  public.get_eoq_inputs(text, text, text),
  public.set_location_item_settings(uuid, text, text, numeric, numeric, bigint, numeric, integer, numeric),
  public.get_serve_view(text),
  public.simulate_menu_mix(text, jsonb)
to authenticated;

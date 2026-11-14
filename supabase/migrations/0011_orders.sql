-- 0011 Orders, kitchen and pickup (PRD §6, §7; CLAUDE.md §5.5, §5.6, D5, D10)
-- Accept (snapshot + whole-order reservation), edit (new revision), kitchen
-- start (single issue), ready, recorded tenders, pickup completion and
-- cancellation (pre-start release / post-start waste).

-- ---------------------------------------------------------------------------
-- Menu availability override per location (can disable, never creates stock)
-- ---------------------------------------------------------------------------
create table public.location_item_availability (
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null,
  is_sellable boolean not null default true check (is_sellable),
  is_available boolean not null,
  reason text,
  updated_by text references public.employees (employee_id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (location_id, item_id),
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable)
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table private.order_counters (
  location_id text not null,
  business_date date not null,
  last_no integer not null,
  primary key (location_id, business_date)
);

create table public.orders (
  order_id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  business_date date not null,
  pickup_code text not null,
  status text not null check (status in ('accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  version integer not null default 1 check (version > 0),
  revision integer not null default 1 check (revision > 0),
  customer_id text references public.customers (customer_id) on delete restrict,
  pickup_name text,
  note text,
  has_kitchen_items boolean not null default false,
  tender_mode text not null check (tender_mode in ('SIMULATED', 'MANUAL_EXTERNAL')),
  tax_rate numeric(7, 6) not null check (tax_rate >= 0 and tax_rate < 1),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  discount_reason text,
  discount_approved_by text references public.employees (employee_id) on delete restrict,
  gross_cents bigint not null default 0 check (gross_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  net_cents bigint not null default 0 check (net_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  estimated_ready_at timestamptz,
  accepted_at timestamptz not null default now(),
  accepted_by text not null references public.employees (employee_id) on delete restrict,
  started_at timestamptz,
  started_by text references public.employees (employee_id) on delete restrict,
  ready_at timestamptz,
  completed_at timestamptz,
  completed_by text references public.employees (employee_id) on delete restrict,
  completed_business_date date,
  cancelled_at timestamptz,
  cancelled_by text references public.employees (employee_id) on delete restrict,
  cancel_reason_code text references public.reason_codes (code) on delete restrict,
  cancel_note text,
  cancel_approved_by text references public.employees (employee_id) on delete restrict,
  provenance text not null default 'operational',
  unique (location_id, business_date, pickup_code),
  constraint orders_money check (net_cents = gross_cents - discount_cents and total_cents = net_cents + tax_cents),
  constraint orders_discount_reason check (discount_percent = 0 or (discount_reason is not null and discount_approved_by is not null)),
  constraint orders_completed check ((status = 'completed') = (completed_at is not null)),
  constraint orders_cancelled check ((status = 'cancelled') = (cancelled_at is not null))
);

create index orders_loc_status on public.orders (location_id, status);
create index orders_loc_completed on public.orders (location_id, completed_business_date) where status = 'completed';

alter table public.reservation_allocations
  add constraint reservation_allocations_order_fk foreign key (order_id) references public.orders (order_id) on delete restrict;

create table public.order_lines (
  order_line_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (order_id) on delete restrict,
  revision integer not null,
  line_no integer not null check (line_no > 0),
  item_id text not null,
  is_sellable boolean not null default true check (is_sellable),
  item_type text not null check (item_type in ('finished_dish', 'retail')),
  quantity integer not null check (quantity between 1 and 999),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  price_effective_from date not null,
  gross_cents bigint not null check (gross_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  net_cents bigint not null check (net_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  recipe_version_id uuid references public.recipe_versions (recipe_version_id) on delete restrict,
  unique (order_id, revision, line_no),
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable),
  constraint order_lines_money check (gross_cents = quantity * unit_price_cents and net_cents = gross_cents - discount_cents),
  constraint order_lines_recipe check ((item_type = 'finished_dish') = (recipe_version_id is not null))
);

create index order_lines_order on public.order_lines (order_id, revision);

-- Snapshotted BOM explosion per line (AC09: later recipe edits never change it).
create table public.order_line_requirements (
  order_line_id uuid not null references public.order_lines (order_line_id) on delete restrict,
  component_item_id text not null references public.items (item_id) on delete restrict,
  quantity_per_serving numeric(18, 6) not null check (quantity_per_serving > 0),
  required_qty numeric(18, 6) not null check (required_qty > 0),
  primary key (order_line_id, component_item_id)
);

-- Actual issue cost snapshots (manager-only; employees never see costs).
create table public.order_issue_costs (
  order_id uuid not null references public.orders (order_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  purpose text not null check (purpose in ('kitchen', 'retail')),
  issued_qty numeric(18, 6) not null check (issued_qty > 0),
  issued_cost numeric(28, 14) not null check (issued_cost >= 0),
  issued_at timestamptz not null default now(),
  primary key (order_id, item_id, purpose)
);

-- Post-start cancellation: the already-issued cost is reclassified as waste
-- (no movement, no restock, no second issue).
create table public.order_cancellation_waste (
  order_id uuid primary key references public.orders (order_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  business_date date not null,
  reason_code text not null references public.reason_codes (code) on delete restrict,
  note text,
  issued_cost numeric(28, 14) not null check (issued_cost >= 0),
  approved_by text not null references public.employees (employee_id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create table public.order_state_events (
  event_id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (order_id) on delete restrict,
  from_status text,
  to_status text not null,
  version integer not null,
  actor_employee_id text not null references public.employees (employee_id) on delete restrict,
  approver_employee_id text references public.employees (employee_id) on delete restrict,
  request_key uuid,
  note text,
  occurred_at timestamptz not null default now()
);

-- Recorded tenders: records of money handled outside the app (PRD §7, AC17).
create table public.tenders (
  tender_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (order_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  tender_type text not null check (tender_type in ('SIMULATED', 'MANUAL_EXTERNAL')),
  method text not null check (method in ('cash', 'card_external', 'other_external')),
  amount_cents bigint not null check (amount_cents > 0),
  external_reference text,
  recorded_by text not null references public.employees (employee_id) on delete restrict,
  recorded_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  request_key uuid
);

create index tenders_order on public.tenders (order_id);

do $$
declare
  t text;
begin
  foreach t in array array['order_line_requirements', 'order_issue_costs', 'order_cancellation_waste',
                           'order_state_events', 'tenders'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_update_delete()',
                   t || '_append_only', t);
  end loop;
end;
$$;

-- Order lines are append-only too: an edit writes a new revision.
create trigger order_lines_append_only before update or delete on public.order_lines
  for each row when (pg_trigger_depth() = 0 and current_setting('app.order_line_pricing', true) is distinct from 'on')
  execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Manager approval: a manager/owner at the location approves their own action;
-- anyone else needs a valid manager PIN (D5). Returns {approver, error}.
create function private.resolve_approval(p_actor text, p_location_id text, p_approver text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text;
begin
  if private.has_location_role(p_location_id, array['manager']) then
    return jsonb_build_object('approver', p_actor, 'error', null);
  end if;
  if p_approver is null or p_pin is null then
    return jsonb_build_object('approver', null, 'error', 'approval_required');
  end if;
  v_error := private.check_manager_pin(p_approver, p_pin, p_location_id);
  return jsonb_build_object('approver', case when v_error is null then p_approver end, 'error', v_error);
end;
$$;

create function private.current_price(p_location_id text, p_item_id text, p_date date)
returns public.location_item_prices
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.location_item_prices p
  where p.location_id = p_location_id and p.item_id = p_item_id and p.effective_from <= p_date
  order by p.effective_from desc limit 1;
$$;

create function private.current_tax_rate(p_location_id text, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select t.rate from public.location_tax_rates t
  where t.location_id = p_location_id and t.effective_from <= p_date
  order by t.effective_from desc limit 1;
$$;

-- Write one revision of lines with price, recipe and BOM snapshots, then
-- allocate the order discount (largest remainder, ties by line order) and
-- per-line tax (half up). Updates the order totals. p_lines: [{item_id, quantity}].
create function private.build_order_revision(p_order_id uuid, p_location_id text, p_revision integer, p_lines jsonb,
  p_discount_percent numeric, p_tax_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_line record;
  v_item public.items;
  v_price public.location_item_prices;
  v_recipe uuid;
  v_line_id uuid;
  v_no integer := 0;
  v_gross_total bigint;
  v_disc_total bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  if (select count(distinct x ->> 'item_id') from jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) then
    perform private.raise_error('validation:duplicate_item', jsonb_build_object('rule', 'one line per item; use quantity'));
  end if;

  for v_line in
    select x.item_id, x.quantity, e.ord from jsonb_array_elements(p_lines) with ordinality as e(j, ord),
      lateral jsonb_to_record(e.j) as x(item_id text, quantity numeric)
    order by e.ord
  loop
    v_no := v_no + 1;
    if v_line.quantity is null or v_line.quantity <> trunc(v_line.quantity) or v_line.quantity < 1 or v_line.quantity > 999 then
      perform private.raise_error('validation:quantity', jsonb_build_object('item_id', v_line.item_id, 'rule', 'whole servings 1-999'));
    end if;
    select * into v_item from public.items i where i.item_id = v_line.item_id and i.archived_at is null;
    if v_item.item_id is null or not v_item.is_sellable then
      perform private.raise_error('validation:item_not_sellable', jsonb_build_object('item_id', v_line.item_id));
    end if;
    if exists (select 1 from public.location_item_availability a
               where a.location_id = p_location_id and a.item_id = v_item.item_id and not a.is_available) then
      perform private.raise_error('validation:item_unavailable', jsonb_build_object('item_id', v_item.item_id));
    end if;
    v_price := private.current_price(p_location_id, v_item.item_id, v_today);
    if v_price.item_id is null then
      perform private.raise_error('validation:no_price', jsonb_build_object('item_id', v_item.item_id));
    end if;
    v_recipe := null;
    if v_item.item_type = 'finished_dish' then
      perform private.require_gate('recipes_verified', v_item.item_id);
      select v.recipe_version_id into v_recipe from public.recipe_versions v
      where v.parent_item_id = v_item.item_id and v.status = 'active';
      if v_recipe is null then
        perform private.raise_error('validation:no_active_recipe', jsonb_build_object('item_id', v_item.item_id));
      end if;
    end if;

    insert into public.order_lines (order_id, revision, line_no, item_id, item_type, quantity, unit_price_cents,
      price_effective_from, gross_cents, discount_cents, net_cents, tax_cents, recipe_version_id)
    values (p_order_id, p_revision, v_no, v_item.item_id, v_item.item_type, v_line.quantity::integer, v_price.price_cents,
      v_price.effective_from, v_line.quantity::integer * v_price.price_cents, 0, v_line.quantity::integer * v_price.price_cents,
      0, v_recipe)
    returning order_line_id into v_line_id;

    if v_recipe is not null then
      insert into public.order_line_requirements (order_line_id, component_item_id, quantity_per_serving, required_qty)
      select v_line_id, c.component_item_id, c.quantity_per_serving, c.quantity_per_serving * v_line.quantity
      from public.recipe_components c where c.recipe_version_id = v_recipe;
    end if;
  end loop;

  select coalesce(sum(l.gross_cents), 0) into v_gross_total
  from public.order_lines l where l.order_id = p_order_id and l.revision = p_revision;
  v_disc_total := case when v_gross_total = 0 then 0 else round(v_gross_total * p_discount_percent / 100.0)::bigint end;

  perform set_config('app.order_line_pricing', 'on', true);
  with base as (
    select l.order_line_id, l.line_no, l.gross_cents,
           case when v_gross_total = 0 then 0::numeric else v_disc_total::numeric * l.gross_cents / v_gross_total end as exact
    from public.order_lines l where l.order_id = p_order_id and l.revision = p_revision
  ), floored as (
    select b.*, floor(b.exact)::bigint as fl, b.exact - floor(b.exact) as rem from base b
  ), ranked as (
    select f.*, row_number() over (order by f.rem desc, f.line_no) as rn,
           v_disc_total - sum(f.fl) over () as leftover
    from floored f
  ), alloc as (
    select r.order_line_id, r.gross_cents, r.fl + case when r.rn <= r.leftover then 1 else 0 end as disc from ranked r
  )
  update public.order_lines l
     set discount_cents = a.disc,
         net_cents = a.gross_cents - a.disc,
         tax_cents = round((a.gross_cents - a.disc) * p_tax_rate)::bigint
    from alloc a
   where l.order_line_id = a.order_line_id;
  perform set_config('app.order_line_pricing', 'off', true);

  update public.orders o
     set gross_cents = t.gross, discount_cents = t.disc, net_cents = t.net, tax_cents = t.tax, total_cents = t.net + t.tax,
         has_kitchen_items = t.kitchen
    from (select coalesce(sum(l.gross_cents), 0) gross, coalesce(sum(l.discount_cents), 0) disc,
                 coalesce(sum(l.net_cents), 0) net, coalesce(sum(l.tax_cents), 0) tax,
                 bool_or(l.item_type = 'finished_dish') kitchen
          from public.order_lines l where l.order_id = p_order_id and l.revision = p_revision) t
   where o.order_id = p_order_id;
end;
$$;

-- Reserve the whole order's requirements atomically (AC05/AC06): shared
-- ingredients are aggregated across lines, every item is checked before any
-- allocation is written, and stock rows are locked in a consistent order.
create function private.reserve_order(p_order_id uuid, p_location_id text, p_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needs jsonb;
  v_items text[];
  v_short jsonb;
  r record;
  v_left numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object('item_id', n.item_id, 'purpose', n.purpose, 'qty', n.qty)
                            order by n.item_id, n.purpose), '[]'::jsonb)
    into v_needs
  from (
    select x.item_id, x.purpose, sum(x.qty) as qty from (
      select q.component_item_id as item_id, 'kitchen' as purpose, q.required_qty as qty
      from public.order_line_requirements q
      join public.order_lines l on l.order_line_id = q.order_line_id
      where l.order_id = p_order_id and l.revision = p_revision
      union all
      select l.item_id, 'retail', l.quantity::numeric
      from public.order_lines l
      where l.order_id = p_order_id and l.revision = p_revision and l.item_type = 'retail'
    ) x group by x.item_id, x.purpose
  ) n;

  select array_agg(distinct e ->> 'item_id' order by e ->> 'item_id') into v_items from jsonb_array_elements(v_needs) e;
  perform private.lock_stock(p_location_id, v_items);

  -- Check every item before writing any allocation (no partial reservations).
  select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'name', i.name, 'base_unit', i.base_unit,
           'required', s.need::text, 'available', s.avail::text, 'shortfall', (s.need - s.avail)::text) order by s.item_id)
    into v_short
  from (select e ->> 'item_id' as item_id, sum((e ->> 'qty')::numeric) as need,
               private.available_qty(p_location_id, e ->> 'item_id') as avail
        from jsonb_array_elements(v_needs) e group by e ->> 'item_id') s
  join public.items i on i.item_id = s.item_id
  where s.avail < s.need;
  if v_short is not null then
    perform private.raise_error('insufficient_stock', jsonb_build_object('location_id', p_location_id, 'shortages', v_short));
  end if;

  for r in select x.item_id, x.purpose, x.qty from jsonb_to_recordset(v_needs) as x(item_id text, purpose text, qty numeric) loop
    v_left := private.reserve_fefo(p_order_id, p_location_id, r.item_id, r.qty, r.purpose);
    if v_left > 0 then
      perform private.raise_error('insufficient_stock', jsonb_build_object('item_id', r.item_id, 'shortfall', v_left::text));
    end if;
  end loop;
end;
$$;

-- Re-check reserved lots before consumption (PRD §6): an allocation on a lot
-- that expired since acceptance is reassigned to eligible stock or blocks.
create function private.revalidate_allocations(p_order_id uuid, p_location_id text, p_purpose text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_left numeric;
begin
  for r in
    select a.item_id, sum(a.quantity) as qty
    from public.reservation_allocations a
    join public.lots l on l.lot_id = a.lot_id
    where a.order_id = p_order_id and a.status = 'active' and a.purpose = p_purpose
      and not private.lot_is_eligible(l.use_by_date)
    group by a.item_id order by a.item_id
  loop
    update public.stock_balances b set reserved = b.reserved - x.qty, updated_at = now()
      from (select a.lot_id, sum(a.quantity) as qty
              from public.reservation_allocations a
              join public.lots l on l.lot_id = a.lot_id
             where a.order_id = p_order_id and a.status = 'active' and a.purpose = p_purpose and a.item_id = r.item_id
               and not private.lot_is_eligible(l.use_by_date)
             group by a.lot_id) x
     where b.lot_id = x.lot_id and b.condition = 'sellable';
    update public.reservation_allocations a set status = 'released', closed_at = now()
      from public.lots l
     where l.lot_id = a.lot_id and a.order_id = p_order_id and a.status = 'active' and a.purpose = p_purpose
       and a.item_id = r.item_id and not private.lot_is_eligible(l.use_by_date);
    v_left := private.reserve_fefo(p_order_id, p_location_id, r.item_id, r.qty, p_purpose);
    if v_left > 0 then
      perform private.raise_error('insufficient_stock', jsonb_build_object('item_id', r.item_id,
        'reason', 'reserved_lot_expired', 'shortfall', v_left::text));
    end if;
  end loop;
end;
$$;

-- Consume active allocations once, at the weighted-average issue cost.
create function private.consume_allocations(p_order_id uuid, p_location_id text, p_purpose text, p_request_key uuid, p_actor text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_cost numeric;
  v_movement uuid;
  v_total numeric := 0;
begin
  for r in
    select a.allocation_id, a.item_id, a.lot_id, a.quantity from public.reservation_allocations a
    where a.order_id = p_order_id and a.status = 'active' and a.purpose = p_purpose
    order by a.item_id, a.lot_id
  loop
    v_cost := private.value_outgoing(p_location_id, r.item_id, r.quantity);
    v_movement := private.post_movement(p_location_id, r.item_id, r.lot_id, 'sellable', -r.quantity, v_cost,
      case when p_purpose = 'kitchen' then 'kitchen_issue' else 'retail_issue' end, null, 'order', p_order_id, null,
      p_request_key, p_actor, null, 'operational', -r.quantity);
    update public.reservation_allocations
       set status = 'consumed', closed_at = now(), consumed_movement_id = v_movement
     where allocation_id = r.allocation_id;
    v_total := v_total + r.quantity * v_cost;
  end loop;

  insert into public.order_issue_costs (order_id, item_id, purpose, issued_qty, issued_cost)
  select m.source_id, m.item_id, p_purpose, sum(-m.quantity), sum(-m.extended_cost)
  from public.inventory_movements m
  where m.source_type = 'order' and m.source_id = p_order_id
    and m.movement_type = case when p_purpose = 'kitchen' then 'kitchen_issue' else 'retail_issue' end
  group by m.source_id, m.item_id;
  return v_total;
end;
$$;

create function private.next_order_number(p_location_id text, p_date date)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into private.order_counters (location_id, business_date, last_no) values (p_location_id, p_date, 1)
  on conflict (location_id, business_date) do update set last_no = private.order_counters.last_no + 1
  returning last_no;
$$;

create function private.order_result(p_order_id uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'order_id', o.order_id, 'order_number', o.order_number, 'pickup_code', o.pickup_code,
    'status', o.status, 'version', o.version, 'revision', o.revision, 'gross_cents', o.gross_cents,
    'discount_cents', o.discount_cents, 'net_cents', o.net_cents, 'tax_cents', o.tax_cents, 'total_cents', o.total_cents,
    'tender_mode', o.tender_mode,
    'paid_cents', coalesce((select sum(t.amount_cents) from public.tenders t where t.order_id = o.order_id), 0),
    'balance_due_cents', o.total_cents - coalesce((select sum(t.amount_cents) from public.tenders t where t.order_id = o.order_id), 0))
    || p_extra
  from public.orders o where o.order_id = p_order_id;
$$;

create function private.order_event(p_order public.orders, p_to text, p_version integer, p_actor text,
  p_approver text, p_request_key uuid, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, approver_employee_id, request_key, note)
  values (p_order.order_id, p_order.status, p_to, p_version, p_actor, p_approver, p_request_key, p_note);
  select private.write_audit(p_actor, 'order.' || p_to, 'order', p_order.order_id::text, p_order.location_id, p_request_key,
    jsonb_build_object('status', p_order.status, 'version', p_order.version),
    jsonb_build_object('status', p_to, 'version', p_version), p_note, p_approver);
$$;

-- Load an order and check the caller works at its location (location comes
-- from the document, never from the client).
create function private.order_for_staff(p_order_id uuid)
returns public.orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.order_id = p_order_id;
  if v_order.order_id is null then perform private.raise_error('validation:unknown_order'); end if;
  perform private.require_location_role(v_order.location_id, array['employee', 'manager']);
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
create function public.accept_order(p_request_key uuid, p_location_id text, p_lines jsonb,
  p_customer_id text default null, p_pickup_name text default null, p_note text default null,
  p_discount_percent numeric default 0, p_discount_reason text default null,
  p_approver_employee_id text default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_today date := private.business_date();
  v_pct numeric := coalesce(p_discount_percent, 0);
  v_approval jsonb;
  v_approver text;
  v_rate numeric;
  v_no integer;
  v_short text;
  v_customer public.customers;
  v_order public.orders;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_cached := private.idem_begin(v_actor, 'accept_order', p_request_key);
  if v_cached is not null then return v_cached; end if;

  perform private.require_posting_enabled();
  perform private.require_gate('opening_counts_posted', p_location_id);
  perform private.require_gate('menu_prices_confirmed', p_location_id);
  perform private.require_gate('tax_rate_confirmed', p_location_id);

  if v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 2) then
    perform private.raise_error('validation:discount_percent', jsonb_build_object('rule', '0 to 100, max 2 decimals'));
  end if;
  if v_pct > 0 then
    if p_discount_reason is null or length(btrim(p_discount_reason)) < 3 then
      perform private.raise_error('validation:discount_reason');
    end if;
    v_approval := private.resolve_approval(v_actor, p_location_id, p_approver_employee_id, p_pin);
    if v_approval ->> 'error' is not null then
      perform private.idem_abandon(v_actor, p_request_key);
      return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
    end if;
    v_approver := v_approval ->> 'approver';
  end if;
  if p_customer_id is not null then
    select * into v_customer from public.customers c where c.customer_id = p_customer_id and c.archived_at is null;
    if v_customer.customer_id is null then perform private.raise_error('validation:unknown_customer'); end if;
  end if;
  v_rate := private.current_tax_rate(p_location_id, v_today);
  if v_rate is null then perform private.raise_error('validation:no_tax_rate'); end if;

  v_no := private.next_order_number(p_location_id, v_today);
  select l.short_code into v_short from public.locations l where l.location_id = p_location_id;
  insert into public.orders (order_number, location_id, business_date, pickup_code, status, customer_id, pickup_name, note,
    tender_mode, tax_rate, discount_percent, discount_reason, discount_approved_by, accepted_by, provenance)
  values (v_short || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0'), p_location_id, v_today,
    v_short || '-' || lpad(v_no::text, 4, '0'), 'accepted', p_customer_id,
    coalesce(nullif(btrim(p_pickup_name), ''), v_customer.display_name), nullif(btrim(p_note), ''),
    case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end, v_rate, v_pct,
    case when v_pct > 0 then btrim(p_discount_reason) end, v_approver, v_actor,
    case when private.data_mode() = 'demo' then 'demo_operational' else 'operational' end)
  returning * into v_order;

  perform private.build_order_revision(v_order.order_id, p_location_id, 1, p_lines, v_pct, v_rate);
  perform private.reserve_order(v_order.order_id, p_location_id, 1);

  insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, approver_employee_id, request_key)
  values (v_order.order_id, null, 'accepted', 1, v_actor, v_approver, p_request_key);
  perform private.write_audit(v_actor, 'order.accepted', 'order', v_order.order_id::text, p_location_id, p_request_key, null,
    jsonb_build_object('order_number', v_order.order_number, 'discount_percent', v_pct), null, v_approver);
  return private.idem_finish(v_actor, p_request_key, private.order_result(v_order.order_id));
end;
$$;

create function public.edit_accepted_order(p_request_key uuid, p_order_id uuid, p_expected_version integer, p_lines jsonb,
  p_discount_percent numeric default 0, p_discount_reason text default null,
  p_approver_employee_id text default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_pct numeric := coalesce(p_discount_percent, 0);
  v_approval jsonb;
  v_approver text;
  v_rate numeric;
  v_paid bigint;
begin
  v_cached := private.idem_begin(v_actor, 'edit_accepted_order', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();

  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_order.status <> 'accepted' then perform private.raise_error('invalid_state:' || v_order.status || '->edit'); end if;
  if v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 2) then perform private.raise_error('validation:discount_percent'); end if;
  if v_pct > 0 then
    if p_discount_reason is null or length(btrim(p_discount_reason)) < 3 then perform private.raise_error('validation:discount_reason'); end if;
    v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
    if v_approval ->> 'error' is not null then
      perform private.idem_abandon(v_actor, p_request_key);
      return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
    end if;
    v_approver := v_approval ->> 'approver';
  end if;
  v_rate := private.current_tax_rate(v_order.location_id, private.business_date());

  perform private.release_allocations(p_order_id);
  update public.orders
     set revision = revision + 1, version = version + 1, tax_rate = v_rate, discount_percent = v_pct,
         discount_reason = case when v_pct > 0 then btrim(p_discount_reason) end, discount_approved_by = v_approver
   where order_id = p_order_id;
  perform private.build_order_revision(p_order_id, v_order.location_id, v_order.revision + 1, p_lines, v_pct, v_rate);
  perform private.reserve_order(p_order_id, v_order.location_id, v_order.revision + 1);

  select coalesce(sum(t.amount_cents), 0) into v_paid from public.tenders t where t.order_id = p_order_id;
  if v_paid > (select o.total_cents from public.orders o where o.order_id = p_order_id) then
    perform private.raise_error('validation:recorded_payment_exceeds_new_total');
  end if;
  perform private.order_event(v_order, 'accepted', v_order.version + 1, v_actor, v_approver, p_request_key, 'edited: revision ' || (v_order.revision + 1));
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id));
end;
$$;

create function public.start_order_preparation(p_request_key uuid, p_order_id uuid, p_expected_version integer,
  p_estimated_ready_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_items text[];
begin
  v_cached := private.idem_begin(v_actor, 'start_order_preparation', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();

  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_order.status <> 'accepted' or not v_order.has_kitchen_items then
    perform private.raise_error('invalid_state:' || v_order.status || '->preparing');
  end if;
  if p_estimated_ready_at is not null and p_estimated_ready_at < now() - interval '1 minute' then
    perform private.raise_error('validation:estimated_ready_at');
  end if;

  select array_agg(distinct a.item_id order by a.item_id) into v_items
  from public.reservation_allocations a where a.order_id = p_order_id and a.status = 'active' and a.purpose = 'kitchen';
  perform private.lock_stock(v_order.location_id, v_items);
  perform private.revalidate_allocations(p_order_id, v_order.location_id, 'kitchen');
  perform private.consume_allocations(p_order_id, v_order.location_id, 'kitchen', p_request_key, v_actor);

  update public.orders
     set status = 'preparing', started_at = now(), started_by = v_actor, estimated_ready_at = p_estimated_ready_at,
         version = version + 1
   where order_id = p_order_id;
  perform private.order_event(v_order, 'preparing', v_order.version + 1, v_actor, null, p_request_key);
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id));
end;
$$;

create function public.mark_order_ready(p_request_key uuid, p_order_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'mark_order_ready', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  -- Retail-only orders go straight from accepted to ready (no kitchen issue).
  if not (v_order.status = 'preparing' or (v_order.status = 'accepted' and not v_order.has_kitchen_items)) then
    perform private.raise_error('invalid_state:' || v_order.status || '->ready');
  end if;
  update public.orders set status = 'ready', ready_at = now(), version = version + 1 where order_id = p_order_id;
  perform private.order_event(v_order, 'ready', v_order.version + 1, v_actor, null, p_request_key);
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id));
end;
$$;

create function public.record_tender(p_request_key uuid, p_order_id uuid, p_amount_cents bigint, p_method text,
  p_external_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_paid bigint;
  v_tender uuid;
begin
  v_cached := private.idem_begin(v_actor, 'record_tender', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.status not in ('accepted', 'preparing', 'ready') then
    perform private.raise_error('invalid_state:' || v_order.status || '->tender');
  end if;
  if p_method not in ('cash', 'card_external', 'other_external') then perform private.raise_error('validation:method'); end if;
  select coalesce(sum(t.amount_cents), 0) into v_paid from public.tenders t where t.order_id = p_order_id;
  if p_amount_cents is null or p_amount_cents <= 0 then perform private.raise_error('validation:amount_cents'); end if;
  if p_amount_cents > v_order.total_cents - v_paid then
    perform private.raise_error('validation:amount_exceeds_balance',
      jsonb_build_object('balance_due_cents', v_order.total_cents - v_paid));
  end if;

  insert into public.tenders (order_id, location_id, tender_type, method, amount_cents, external_reference, recorded_by, request_key)
  values (p_order_id, v_order.location_id, v_order.tender_mode, p_method, p_amount_cents,
          nullif(btrim(p_external_reference), ''), v_actor, p_request_key)
  returning tender_id into v_tender;
  perform private.write_audit(v_actor, 'tender.record', 'tender', v_tender::text, v_order.location_id, p_request_key, null,
    jsonb_build_object('order_id', p_order_id, 'amount_cents', p_amount_cents, 'tender_type', v_order.tender_mode, 'method', p_method));
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id, jsonb_build_object('tender_id', v_tender)));
end;
$$;

create function public.complete_order_pickup(p_request_key uuid, p_order_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_paid bigint;
  v_items text[];
begin
  v_cached := private.idem_begin(v_actor, 'complete_order_pickup', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_order.status <> 'ready' then perform private.raise_error('invalid_state:' || v_order.status || '->completed'); end if;
  select coalesce(sum(t.amount_cents), 0) into v_paid from public.tenders t where t.order_id = p_order_id;
  if v_order.total_cents - v_paid <> 0 then
    perform private.raise_error('validation:balance_due', jsonb_build_object('balance_due_cents', v_order.total_cents - v_paid));
  end if;
  if v_order.total_cents = 0 and v_order.discount_percent <> 100 then
    perform private.raise_error('validation:zero_value_requires_approval');
  end if;

  -- Retail units are consumed once, at handover.
  select array_agg(distinct a.item_id order by a.item_id) into v_items
  from public.reservation_allocations a where a.order_id = p_order_id and a.status = 'active' and a.purpose = 'retail';
  if v_items is not null then
    perform private.lock_stock(v_order.location_id, v_items);
    perform private.revalidate_allocations(p_order_id, v_order.location_id, 'retail');
    perform private.consume_allocations(p_order_id, v_order.location_id, 'retail', p_request_key, v_actor);
  end if;

  update public.orders
     set status = 'completed', completed_at = now(), completed_by = v_actor, completed_business_date = private.business_date(),
         version = version + 1
   where order_id = p_order_id;
  perform private.order_event(v_order, 'completed', v_order.version + 1, v_actor, null, p_request_key);
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id));
end;
$$;

create function public.cancel_order(p_request_key uuid, p_order_id uuid, p_expected_version integer, p_reason_code text,
  p_note text default null, p_approver_employee_id text default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_reason public.reason_codes;
  v_approval jsonb;
  v_approver text;
  v_issued numeric;
begin
  v_cached := private.idem_begin(v_actor, 'cancel_order', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_reason from public.reason_codes r where r.code = p_reason_code and r.active and 'cancellation' = any (r.applies_to);
  if v_reason.code is null then perform private.raise_error('validation:reason_code'); end if;
  if v_reason.requires_note and (p_note is null or length(btrim(p_note)) < 3) then perform private.raise_error('validation:note_required'); end if;

  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_order.status not in ('accepted', 'preparing', 'ready') then
    perform private.raise_error('invalid_state:' || v_order.status || '->cancelled');
  end if;
  if exists (select 1 from public.tenders t where t.order_id = p_order_id) then
    -- Recorded payments are reversed through the refund workflow (Milestone 3).
    perform private.raise_error('invalid_state:recorded_payment_requires_refund');
  end if;

  if v_order.status = 'accepted' then
    -- Before kitchen start any staff member at the location may cancel (audited).
    perform private.release_allocations(p_order_id);
  else
    v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
    if v_approval ->> 'error' is not null then
      perform private.idem_abandon(v_actor, p_request_key);
      return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
    end if;
    v_approver := v_approval ->> 'approver';
    perform private.release_allocations(p_order_id, 'retail');
    select coalesce(sum(c.issued_cost), 0) into v_issued
    from public.order_issue_costs c where c.order_id = p_order_id and c.purpose = 'kitchen';
    insert into public.order_cancellation_waste (order_id, location_id, business_date, reason_code, note, issued_cost, approved_by)
    values (p_order_id, v_order.location_id, private.business_date(), p_reason_code, nullif(btrim(p_note), ''), v_issued, v_approver);
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason_code = p_reason_code,
         cancel_note = nullif(btrim(p_note), ''), cancel_approved_by = v_approver, version = version + 1
   where order_id = p_order_id;
  perform private.order_event(v_order, 'cancelled', v_order.version + 1, v_actor, v_approver, p_request_key,
    p_reason_code || coalesce(': ' || btrim(p_note), ''));
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id));
end;
$$;

create function public.set_menu_availability(p_request_key uuid, p_location_id text, p_item_id text, p_available boolean,
  p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'set_menu_availability', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_sellable) then
    perform private.raise_error('validation:item_not_sellable');
  end if;
  if p_available is null then perform private.raise_error('validation:available'); end if;
  if not p_available and (p_reason is null or length(btrim(p_reason)) < 3) then perform private.raise_error('validation:reason'); end if;
  insert into public.location_item_availability (location_id, item_id, is_available, reason, updated_by)
  values (p_location_id, p_item_id, p_available, nullif(btrim(p_reason), ''), v_actor)
  on conflict (location_id, item_id) do update
    set is_available = excluded.is_available, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now();
  perform private.write_audit(v_actor, 'menu.set_availability', 'item', p_item_id, p_location_id, p_request_key, null,
    jsonb_build_object('is_available', p_available), p_reason);
  v_result := jsonb_build_object('ok', true, 'item_id', p_item_id, 'is_available', p_available);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers: minimal lookup/create for an order at the caller's location
-- ---------------------------------------------------------------------------
create sequence private.customer_number_seq;

create function public.search_customers(p_location_id text, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  if p_query is null or length(btrim(p_query)) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', c.customer_id, 'display_name', c.display_name) order by c.display_name)
    from (select * from public.customers c
          where c.archived_at is null
            and (c.display_name ilike '%' || btrim(p_query) || '%' or c.customer_id ilike btrim(p_query) || '%'
                 or c.phone = btrim(p_query))
          order by c.display_name limit 20) c), '[]'::jsonb);
end;
$$;

create function public.create_customer(p_request_key uuid, p_location_id text, p_display_name text,
  p_phone text default null, p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_id text;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_cached := private.idem_begin(v_actor, 'create_customer', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then
    perform private.raise_error('validation:display_name');
  end if;
  if p_email is not null and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.raise_error('validation:email'); end if;
  v_id := 'CUST-' || lpad(nextval('private.customer_number_seq')::text, 6, '0');
  insert into public.customers (customer_id, display_name, phone, email, provenance, created_by, created_location_id)
  values (v_id, btrim(p_display_name), nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''),
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end,
          v_actor, p_location_id);
  perform private.write_audit(v_actor, 'customer.create', 'customer', v_id, p_location_id, p_request_key);
  v_result := jsonb_build_object('ok', true, 'customer_id', v_id, 'display_name', btrim(p_display_name));
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['location_item_availability', 'orders', 'order_lines', 'order_line_requirements',
                           'order_issue_costs', 'order_cancellation_waste', 'order_state_events', 'tenders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy location_item_availability_read on public.location_item_availability for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy orders_read on public.orders for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy order_lines_read on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = order_lines.order_id
                 and o.location_id in (select private.accessible_location_ids())));
create policy order_line_requirements_read on public.order_line_requirements for select to authenticated
  using (exists (select 1 from public.order_lines l join public.orders o on o.order_id = l.order_id
                 where l.order_line_id = order_line_requirements.order_line_id
                   and o.location_id in (select private.accessible_location_ids())));
create policy order_state_events_read on public.order_state_events for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = order_state_events.order_id
                 and o.location_id in (select private.accessible_location_ids())));
create policy tenders_read on public.tenders for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy order_issue_costs_read on public.order_issue_costs for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = order_issue_costs.order_id
                 and o.location_id in (select private.managed_location_ids())));
create policy order_cancellation_waste_read on public.order_cancellation_waste for select to authenticated
  using (location_id in (select private.managed_location_ids()));

grant execute on function
  public.accept_order(uuid, text, jsonb, text, text, text, numeric, text, text, text),
  public.edit_accepted_order(uuid, uuid, integer, jsonb, numeric, text, text, text),
  public.start_order_preparation(uuid, uuid, integer, timestamptz),
  public.mark_order_ready(uuid, uuid, integer),
  public.record_tender(uuid, uuid, bigint, text, text),
  public.complete_order_pickup(uuid, uuid, integer),
  public.cancel_order(uuid, uuid, integer, text, text, text, text),
  public.set_menu_availability(uuid, text, text, boolean, text),
  public.search_customers(text, text),
  public.create_customer(uuid, text, text, text, text)
to authenticated;

-- 0009 Inventory ledger (PRD §6; CLAUDE.md §5.3, §5.6; AC04, AC05, AC06, AC12 groundwork, AC31)
-- Lots, append-only movements, per-lot balances with reservations, weighted
-- average valuation, FEFO reservation helpers and one-time opening counts.

-- ---------------------------------------------------------------------------
-- Lots: physical stock identity per location/item. Dishes never have stock.
-- ---------------------------------------------------------------------------
create table public.lots (
  lot_id uuid primary key default gen_random_uuid(),
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null,
  is_purchasable boolean not null default true check (is_purchasable),
  lot_code text not null check (length(btrim(lot_code)) > 0),
  supplier_lot text,
  use_by_date date,
  source_type text not null check (source_type in ('opening', 'receipt', 'transfer', 'return')),
  source_id uuid,
  received_at timestamptz not null default now(),
  provenance text not null default 'operational',
  created_by text references public.employees (employee_id) on delete restrict,
  foreign key (item_id, is_purchasable) references public.items (item_id, is_purchasable),
  unique (location_id, item_id, lot_code)
);

create trigger lots_no_synthetic_in_pilot
  before insert or update on public.lots
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'lot_code');

-- Lot identity is immutable once created (use-by corrections arrive with counts in M3).
create trigger lots_immutable
  before update or delete on public.lots
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Balances: projection per lot and condition, maintained only by RPCs in the
-- same transaction as the movement that changes them.
-- ---------------------------------------------------------------------------
create table public.stock_balances (
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  condition text not null check (condition in ('sellable', 'quarantined')),
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  on_hand numeric(18, 6) not null default 0 check (on_hand >= 0),
  reserved numeric(18, 6) not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (lot_id, condition),
  constraint stock_balances_reserved_le_on_hand check (reserved <= on_hand),
  constraint stock_balances_reserve_sellable_only check (condition = 'sellable' or reserved = 0)
);

create index stock_balances_loc_item on public.stock_balances (location_id, item_id);

-- Weighted-average valuation per location/item (independent of lot selection).
create table public.item_valuation (
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  valued_qty numeric(18, 6) not null default 0 check (valued_qty >= 0),
  avg_unit_cost numeric(18, 8) not null default 0 check (avg_unit_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (location_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Append-only movement ledger (AC31): every quantity change has a row.
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  movement_id uuid primary key default gen_random_uuid(),
  movement_no bigint generated always as identity unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  condition text not null check (condition in ('sellable', 'quarantined')),
  quantity numeric(18, 6) not null check (quantity <> 0),
  unit_cost numeric(18, 8) not null check (unit_cost >= 0),
  extended_cost numeric(28, 14) generated always as (quantity * unit_cost) stored,
  movement_type text not null check (movement_type in (
    'opening', 'receipt', 'kitchen_issue', 'retail_issue', 'waste', 'count_adjustment',
    'transfer_out', 'transfer_in', 'reversal')),
  reason_code text references public.reason_codes (code) on delete restrict,
  source_type text not null,
  source_id uuid,
  source_line_id uuid,
  request_key uuid,
  actor_employee_id text references public.employees (employee_id) on delete restrict,
  approver_employee_id text references public.employees (employee_id) on delete restrict,
  reverses_movement_id uuid references public.inventory_movements (movement_id) on delete restrict,
  occurred_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  provenance text not null default 'operational'
);

create index inventory_movements_loc_item on public.inventory_movements (location_id, item_id, occurred_at);
create index inventory_movements_source on public.inventory_movements (source_type, source_id);

create trigger inventory_movements_append_only
  before update or delete on public.inventory_movements
  for each row execute function private.forbid_update_delete();
create trigger inventory_movements_no_truncate
  before truncate on public.inventory_movements
  for each statement execute function private.forbid_truncate_outside_demo();
create trigger inventory_movements_no_synthetic_in_pilot
  before insert on public.inventory_movements
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Reservations: allocations of specific lots to an order (FEFO).
-- order_id gets its foreign key in 0011 once orders exist.
-- ---------------------------------------------------------------------------
create table public.reservation_allocations (
  allocation_id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  quantity numeric(18, 6) not null check (quantity > 0),
  purpose text not null check (purpose in ('kitchen', 'retail')),
  status text not null default 'active' check (status in ('active', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  consumed_movement_id uuid references public.inventory_movements (movement_id) on delete restrict,
  constraint reservation_allocations_closed check ((status = 'active') = (closed_at is null))
);

create index reservation_allocations_order on public.reservation_allocations (order_id);
create index reservation_allocations_active_lot on public.reservation_allocations (lot_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Opening counts: one verified opening per location (PRD §6, §16).
-- ---------------------------------------------------------------------------
create table public.opening_counts (
  opening_count_id uuid primary key default gen_random_uuid(),
  location_id text not null unique references public.locations (location_id) on delete restrict,
  posted_at timestamptz not null default now(),
  posted_by text references public.employees (employee_id) on delete restrict,
  line_count integer not null check (line_count > 0),
  provenance text not null,
  note text
);

create table public.opening_count_lines (
  opening_count_id uuid not null references public.opening_counts (opening_count_id) on delete restrict,
  line_no integer not null check (line_no > 0),
  item_id text not null references public.items (item_id) on delete restrict,
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  quantity_base numeric(18, 6) not null check (quantity_base > 0),
  unit_cost numeric(18, 8) not null check (unit_cost >= 0),
  use_by_date date,
  primary key (opening_count_id, line_no)
);

create trigger opening_counts_immutable before update or delete on public.opening_counts
  for each row execute function private.forbid_update_delete();
create trigger opening_count_lines_immutable before update or delete on public.opening_count_lines
  for each row execute function private.forbid_update_delete();
create trigger opening_counts_no_synthetic_in_pilot before insert on public.opening_counts
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Ledger helpers (internal; never granted to API roles)
-- ---------------------------------------------------------------------------

-- Lot is eligible for availability/reservation: sellable condition, not expired
-- (use-by valid through the end of that local business date).
create function private.lot_is_eligible(p_use_by date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_use_by is null or p_use_by >= private.business_date();
$$;

-- Append one movement and apply it to the lot balance.
create function private.post_movement(
  p_location_id text, p_item_id text, p_lot_id uuid, p_condition text, p_quantity numeric,
  p_unit_cost numeric, p_type text, p_reason text, p_source_type text, p_source_id uuid,
  p_source_line_id uuid, p_request_key uuid, p_actor text, p_approver text default null,
  p_provenance text default 'operational', p_reserved_delta numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement_id uuid;
begin
  insert into public.inventory_movements (location_id, item_id, lot_id, condition, quantity, unit_cost,
    movement_type, reason_code, source_type, source_id, source_line_id, request_key, actor_employee_id,
    approver_employee_id, provenance)
  values (p_location_id, p_item_id, p_lot_id, p_condition, p_quantity, round(p_unit_cost, 8), p_type, p_reason,
    p_source_type, p_source_id, p_source_line_id, p_request_key, p_actor, p_approver, p_provenance)
  returning movement_id into v_movement_id;

  -- Update first: CHECK constraints are evaluated on a proposed INSERT row
  -- before ON CONFLICT is resolved, so a negative delta cannot use upsert.
  update public.stock_balances
     set on_hand = on_hand + p_quantity, reserved = reserved + p_reserved_delta, updated_at = now()
   where lot_id = p_lot_id and condition = p_condition;
  if not found then
    insert into public.stock_balances (lot_id, condition, location_id, item_id, on_hand, reserved)
    values (p_lot_id, p_condition, p_location_id, p_item_id, p_quantity, p_reserved_delta);
  end if;
  return v_movement_id;
exception
  when check_violation then
    perform private.raise_error('insufficient_stock',
      jsonb_build_object('item_id', p_item_id, 'lot_id', p_lot_id, 'reason', 'balance_would_go_negative'));
    return null;
end;
$$;

-- Weighted average after adding valued quantity (receipt/opening/transfer-in).
-- CLAUDE.md D11: if valued on-hand <= 0 the new average is the incoming cost.
create function private.value_incoming(p_location_id text, p_item_id text, p_qty numeric, p_unit_cost numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.item_valuation;
  v_avg numeric;
begin
  select * into v_row from public.item_valuation v
  where v.location_id = p_location_id and v.item_id = p_item_id for update;
  if v_row.location_id is null or v_row.valued_qty <= 0 then
    v_avg := round(p_unit_cost, 8);
  else
    v_avg := round((v_row.valued_qty * v_row.avg_unit_cost + p_qty * p_unit_cost) / (v_row.valued_qty + p_qty), 8);
  end if;
  insert into public.item_valuation (location_id, item_id, valued_qty, avg_unit_cost)
  values (p_location_id, p_item_id, p_qty, v_avg)
  on conflict (location_id, item_id) do update
    set valued_qty = public.item_valuation.valued_qty + p_qty, avg_unit_cost = v_avg, updated_at = now();
  return v_avg;
end;
$$;

-- Remove valued quantity at the current average; returns the issue unit cost.
create function private.value_outgoing(p_location_id text, p_item_id text, p_qty numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.item_valuation;
begin
  select * into v_row from public.item_valuation v
  where v.location_id = p_location_id and v.item_id = p_item_id for update;
  if v_row.location_id is null or v_row.valued_qty < p_qty then
    perform private.raise_error('insufficient_stock',
      jsonb_build_object('item_id', p_item_id, 'reason', 'valuation_quantity_short'));
  end if;
  update public.item_valuation
     set valued_qty = valued_qty - p_qty, updated_at = now()
   where location_id = p_location_id and item_id = p_item_id;
  return v_row.avg_unit_cost;
end;
$$;

-- Available = eligible sellable on-hand − reservations on those lots (PRD §6).
create function private.available_qty(p_location_id text, p_item_id text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(b.on_hand - b.reserved), 0)
  from public.stock_balances b
  join public.lots l on l.lot_id = b.lot_id
  where b.location_id = p_location_id and b.item_id = p_item_id and b.condition = 'sellable'
    and private.lot_is_eligible(l.use_by_date);
$$;

-- Lock every balance row for the given items at a location in a consistent order
-- (location, item, lot) so competing transactions serialize without deadlocks.
create function private.lock_stock(p_location_id text, p_item_ids text[])
returns void
language sql
security definer
set search_path = ''
as $$
  select 1 from public.stock_balances b
  where b.location_id = p_location_id and b.item_id = any (p_item_ids)
  order by b.location_id, b.item_id, b.lot_id, b.condition
  for update;
$$;

-- Reserve p_qty FEFO: earliest use-by first, then receipt time; undated lots
-- after dated lots. Returns the unallocated shortfall (0 when fully reserved).
-- Caller must have locked the item's balances.
create function private.reserve_fefo(p_order_id uuid, p_location_id text, p_item_id text, p_qty numeric, p_purpose text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric := p_qty;
  v_take numeric;
  r record;
begin
  for r in
    select b.lot_id, b.on_hand - b.reserved as free
    from public.stock_balances b
    join public.lots l on l.lot_id = b.lot_id
    where b.location_id = p_location_id and b.item_id = p_item_id and b.condition = 'sellable'
      and private.lot_is_eligible(l.use_by_date) and b.on_hand - b.reserved > 0
    order by l.use_by_date nulls last, l.received_at, l.lot_id
  loop
    exit when v_remaining <= 0;
    v_take := least(r.free, v_remaining);
    update public.stock_balances set reserved = reserved + v_take, updated_at = now()
     where lot_id = r.lot_id and condition = 'sellable';
    insert into public.reservation_allocations (order_id, location_id, item_id, lot_id, quantity, purpose)
    values (p_order_id, p_location_id, p_item_id, r.lot_id, v_take, p_purpose);
    v_remaining := v_remaining - v_take;
  end loop;
  return greatest(v_remaining, 0);
end;
$$;

-- Release every active allocation of an order (optionally one purpose).
create function private.release_allocations(p_order_id uuid, p_purpose text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select a.allocation_id, a.lot_id, a.quantity from public.reservation_allocations a
    where a.order_id = p_order_id and a.status = 'active' and (p_purpose is null or a.purpose = p_purpose)
    order by a.location_id, a.item_id, a.lot_id
  loop
    update public.stock_balances set reserved = reserved - r.quantity, updated_at = now()
     where lot_id = r.lot_id and condition = 'sellable';
    update public.reservation_allocations set status = 'released', closed_at = now()
     where allocation_id = r.allocation_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening counts
-- ---------------------------------------------------------------------------

-- p_lines: [{item_id, quantity_base, unit_cost, lot_code?, use_by_date?}]
create function private.post_opening_count(p_location_id text, p_lines jsonb, p_actor text,
  p_provenance text, p_request_key uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count_id uuid;
  v_line record;
  v_item public.items;
  v_lot_id uuid;
  v_no integer := 0;
  v_pilot boolean := private.data_mode() = 'pilot';
begin
  if exists (select 1 from public.opening_counts o where o.location_id = p_location_id) then
    perform private.raise_error('invalid_state:opening_already_posted', jsonb_build_object('location_id', p_location_id));
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  if (select count(distinct x ->> 'item_id') from jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) then
    perform private.raise_error('validation:duplicate_item', jsonb_build_object('rule', 'one opening line per item'));
  end if;

  insert into public.opening_counts (location_id, posted_by, line_count, provenance, note)
  values (p_location_id, p_actor, jsonb_array_length(p_lines), p_provenance, p_note)
  returning opening_count_id into v_count_id;

  for v_line in
    select x.item_id, x.quantity_base, x.unit_cost, x.lot_code, x.use_by_date
    from jsonb_to_recordset(p_lines) as x(item_id text, quantity_base numeric, unit_cost numeric, lot_code text, use_by_date date)
    order by x.item_id
  loop
    v_no := v_no + 1;
    select * into v_item from public.items i where i.item_id = v_line.item_id and i.archived_at is null;
    if v_item.item_id is null or not v_item.is_purchasable then
      perform private.raise_error('validation:item_not_stockable', jsonb_build_object('item_id', v_line.item_id));
    end if;
    if v_line.quantity_base is null or v_line.quantity_base <= 0 or v_line.quantity_base <> round(v_line.quantity_base, 6) then
      perform private.raise_error('validation:quantity', jsonb_build_object('item_id', v_line.item_id));
    end if;
    if v_line.unit_cost is null or v_line.unit_cost < 0 then
      perform private.raise_error('validation:unit_cost', jsonb_build_object('item_id', v_line.item_id));
    end if;
    if v_pilot and v_item.requires_use_by and v_line.use_by_date is null then
      perform private.raise_error('validation:use_by_required', jsonb_build_object('item_id', v_line.item_id));
    end if;

    insert into public.lots (location_id, item_id, lot_code, use_by_date, source_type, source_id, provenance, created_by)
    values (p_location_id, v_line.item_id,
            coalesce(nullif(btrim(v_line.lot_code), ''), 'OPEN-' || p_location_id || '-' || v_line.item_id),
            v_line.use_by_date, 'opening', v_count_id, p_provenance, p_actor)
    returning lot_id into v_lot_id;

    insert into public.opening_count_lines (opening_count_id, line_no, item_id, lot_id, quantity_base, unit_cost, use_by_date)
    values (v_count_id, v_no, v_line.item_id, v_lot_id, v_line.quantity_base, v_line.unit_cost, v_line.use_by_date);

    perform private.value_incoming(p_location_id, v_line.item_id, v_line.quantity_base, v_line.unit_cost);
    perform private.post_movement(p_location_id, v_line.item_id, v_lot_id, 'sellable', v_line.quantity_base,
      v_line.unit_cost, 'opening', null, 'opening_count', v_count_id, null, p_request_key, p_actor, null, p_provenance);
  end loop;

  perform private.write_audit(p_actor, 'opening_count.post', 'opening_count', v_count_id::text, p_location_id,
    p_request_key, null, jsonb_build_object('lines', v_no), p_note, null,
    case when p_actor is null then 'operator_tooling' else 'employee' end);
  return v_count_id;
end;
$$;

create function public.post_opening_count(p_request_key uuid, p_location_id text, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_id uuid;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'post_opening_count', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_gate('perishables_confirmed');
  perform pg_advisory_xact_lock(hashtext('opening_count:' || p_location_id));
  v_id := private.post_opening_count(p_location_id, p_lines, v_actor,
    case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end,
    p_request_key, p_note);
  v_result := jsonb_build_object('ok', true, 'opening_count_id', v_id, 'lines', jsonb_array_length(p_lines));
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Opening counts now satisfy the opening_counts_posted gate precondition.
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
      if not exists (
        select 1 from public.location_tax_rates t
        where t.location_id = p_gate.scope_id and t.effective_from <= v_today and t.confirmed_by is not null
      ) then
        return jsonb_build_object('reason', 'no_confirmed_tax_rate_effective_today');
      end if;
    when 'menu_prices_confirmed' then
      select jsonb_agg(i.item_id order by i.item_id) into v_missing
      from public.items i
      where i.is_sellable and i.archived_at is null
        and not exists (
          select 1 from public.location_item_prices p
          where p.location_id = p_gate.scope_id and p.item_id = i.item_id and p.effective_from <= v_today);
      if v_missing is not null then
        return jsonb_build_object('reason', 'sellable_items_without_price', 'item_ids', v_missing);
      end if;
    when 'recipes_verified' then
      if not exists (
        select 1 from public.recipe_versions v
        where v.parent_item_id = p_gate.scope_id and v.status = 'active'
      ) then
        return jsonb_build_object('reason', 'no_active_recipe_version');
      end if;
    when 'pack_conversions_verified' then
      if not exists (
        select 1 from public.supplier_items si
        where si.supplier_item_id::text = p_gate.scope_id and si.pack_base_qty is not null
          and si.cost_basis in ('quoted', 'estimated')
      ) then
        return jsonb_build_object('reason', 'pack_size_or_cost_not_entered');
      end if;
    when 'supplier_master_verified' then
      if not exists (
        select 1 from public.suppliers s
        where s.supplier_id = p_gate.scope_id and s.payment_terms_days is not null
      ) then
        return jsonb_build_object('reason', 'payment_terms_not_entered');
      end if;
    when 'opening_counts_posted' then
      if not exists (select 1 from public.opening_counts o where o.location_id = p_gate.scope_id) then
        return jsonb_build_object('reason', 'no_opening_count_posted');
      end if;
    when 'planning_inputs_confirmed', 'return_policy_configured' then
      return jsonb_build_object('reason', 'workflow_not_yet_available',
        'note', 'The screen that records this value is delivered in a later milestone.');
    else
      null;
  end case;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['lots', 'stock_balances', 'item_valuation', 'inventory_movements',
                           'reservation_allocations', 'opening_counts', 'opening_count_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- Availability is visible to staff at the location; costs and ledger detail to managers.
create policy lots_read on public.lots for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy stock_balances_read on public.stock_balances for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy reservation_allocations_read on public.reservation_allocations for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy item_valuation_read on public.item_valuation for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy inventory_movements_read on public.inventory_movements for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy opening_counts_read on public.opening_counts for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy opening_count_lines_read on public.opening_count_lines for select to authenticated
  using (exists (select 1 from public.opening_counts o where o.opening_count_id = opening_count_lines.opening_count_id
                 and o.location_id in (select private.managed_location_ids())));

grant execute on function public.post_opening_count(uuid, text, jsonb, text) to authenticated;

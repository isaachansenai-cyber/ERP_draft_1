-- 0015 Inventory controls (PRD §6; AC11, AC12, AC13, AC31)
-- Versioned physical counts with stale-snapshot rejection, employee waste
-- reports posted by managers, quarantine/release, and inter-location transfers
-- with in-transit custody, partial receipt and reason-coded transit loss.

alter table public.inventory_movements drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in (
  'opening', 'receipt', 'kitchen_issue', 'retail_issue', 'waste', 'count_adjustment', 'transfer_out', 'transfer_in',
  'reversal', 'condition_change', 'return_restock'));

create sequence private.count_number_seq;
create sequence private.waste_number_seq;
create sequence private.transfer_number_seq;

-- Consistent document numbering: <PREFIX>-<LOC>-000001
create function private.doc_number(p_prefix text, p_location_id text, p_seq text)
returns text
language sql
security definer
set search_path = ''
as $$
  select p_prefix || '-' || (select l.short_code from public.locations l where l.location_id = p_location_id) || '-'
         || lpad(nextval(p_seq::regclass)::text, 6, '0');
$$;

-- Reason code must exist, be active and apply to the given use; OTHER needs a note.
create function private.require_reason(p_code text, p_use text, p_note text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reason public.reason_codes;
begin
  select * into v_reason from public.reason_codes r where r.code = p_code and r.active and p_use = any (r.applies_to);
  if v_reason.code is null then
    perform private.raise_error('validation:reason_code', jsonb_build_object('use', p_use));
  end if;
  if v_reason.requires_note and (p_note is null or length(btrim(p_note)) < 3) then
    perform private.raise_error('validation:note_required');
  end if;
end;
$$;

-- ===========================================================================
-- Physical counts (AC11)
-- ===========================================================================
create table public.stock_counts (
  count_id uuid primary key default gen_random_uuid(),
  count_number text not null unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  version integer not null default 1,
  item_ids text[] not null,
  snapshot_movement_no bigint not null,
  reason_code text references public.reason_codes (code) on delete restrict,
  note text,
  created_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  posted_by text references public.employees (employee_id) on delete restrict,
  posted_at timestamptz,
  cancelled_at timestamptz
);

create table public.stock_count_lines (
  count_id uuid not null references public.stock_counts (count_id) on delete restrict,
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  condition text not null,
  item_id text not null references public.items (item_id) on delete restrict,
  expected_qty numeric(18, 6) not null,
  counted_qty numeric(18, 6) check (counted_qty >= 0),
  variance numeric(18, 6) generated always as (counted_qty - expected_qty) stored,
  unit_cost numeric(18, 8),
  movement_id uuid references public.inventory_movements (movement_id) on delete restrict,
  primary key (count_id, lot_id, condition)
);

-- Snapshot every balance for the chosen items (all purchasable items by default).
create function public.start_stock_count(p_request_key uuid, p_location_id text, p_item_ids text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_items text[];
  v_marker bigint;
  v_count public.stock_counts;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'start_stock_count', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();

  v_items := coalesce(p_item_ids, array(select i.item_id from public.items i where i.is_purchasable and i.archived_at is null order by 1));
  if cardinality(v_items) = 0 then perform private.raise_error('validation:items'); end if;
  -- Lock the balances so the snapshot and its movement marker are consistent.
  perform private.lock_stock(p_location_id, v_items);
  select coalesce(max(m.movement_no), 0) into v_marker
  from public.inventory_movements m where m.location_id = p_location_id and m.item_id = any (v_items);

  insert into public.stock_counts (count_number, location_id, item_ids, snapshot_movement_no, created_by)
  values (private.doc_number('CNT', p_location_id, 'private.count_number_seq'), p_location_id, v_items, v_marker, v_actor)
  returning * into v_count;
  insert into public.stock_count_lines (count_id, lot_id, condition, item_id, expected_qty)
  select v_count.count_id, b.lot_id, b.condition, b.item_id, b.on_hand
  from public.stock_balances b
  where b.location_id = p_location_id and b.item_id = any (v_items) and b.on_hand > 0;

  perform private.write_audit(v_actor, 'stock_count.start', 'stock_count', v_count.count_id::text, p_location_id, p_request_key,
    null, jsonb_build_object('count_number', v_count.count_number, 'snapshot_movement_no', v_marker));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'count_id', v_count.count_id,
    'count_number', v_count.count_number, 'version', v_count.version,
    'lines', (select count(*) from public.stock_count_lines l where l.count_id = v_count.count_id)));
end;
$$;

-- p_counts: [{lot_id, condition, counted_qty}]; lines not given are treated as counted = expected.
-- Rejected (whole count) if any of its items moved after the snapshot.
create function public.post_stock_count(p_request_key uuid, p_count_id uuid, p_expected_version integer, p_counts jsonb,
  p_reason_code text default 'COUNT_VARIANCE', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_count public.stock_counts;
  v_changed jsonb;
  r record;
  v_balance public.stock_balances;
  v_cost numeric;
  v_movement uuid;
  v_adjusted integer := 0;
begin
  select * into v_count from public.stock_counts c where c.count_id = p_count_id;
  if v_count.count_id is null then perform private.raise_error('validation:unknown_count'); end if;
  perform private.require_location_role(v_count.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'post_stock_count', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  perform private.require_reason(p_reason_code, 'count', p_note);

  select * into v_count from public.stock_counts c where c.count_id = p_count_id for update;
  if v_count.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_count.status <> 'draft' then perform private.raise_error('invalid_state:' || v_count.status || '->posted'); end if;

  perform private.lock_stock(v_count.location_id, v_count.item_ids);
  select jsonb_agg(distinct m.item_id) into v_changed
  from public.inventory_movements m
  where m.location_id = v_count.location_id and m.item_id = any (v_count.item_ids) and m.movement_no > v_count.snapshot_movement_no;
  if v_changed is not null then
    perform private.raise_error('conflict:stock_changed_since_count', jsonb_build_object('item_ids', v_changed,
      'action', 'cancel this count and start a new one for the affected items'));
  end if;

  for r in
    select x.lot_id, x.condition, x.counted_qty from jsonb_to_recordset(coalesce(p_counts, '[]'::jsonb))
      as x(lot_id uuid, condition text, counted_qty numeric)
    order by x.lot_id, x.condition
  loop
    if r.counted_qty is null or r.counted_qty < 0 or r.counted_qty <> round(r.counted_qty, 6) then
      perform private.raise_error('validation:counted_qty', jsonb_build_object('lot_id', r.lot_id));
    end if;
    if not exists (select 1 from public.stock_count_lines l where l.count_id = p_count_id and l.lot_id = r.lot_id and l.condition = r.condition) then
      perform private.raise_error('validation:count_line', jsonb_build_object('lot_id', r.lot_id));
    end if;
    select * into v_balance from public.stock_balances b where b.lot_id = r.lot_id and b.condition = r.condition;
    -- Reservations are preserved: a count can never drop below reserved stock.
    if r.counted_qty < v_balance.reserved then
      perform private.raise_error('validation:count_below_reserved',
        jsonb_build_object('lot_id', r.lot_id, 'reserved', v_balance.reserved::text));
    end if;
    v_movement := null;
    v_cost := null;
    if r.counted_qty <> v_balance.on_hand then
      if r.counted_qty > v_balance.on_hand then
        select coalesce(v.avg_unit_cost, 0) into v_cost from public.item_valuation v
        where v.location_id = v_count.location_id and v.item_id = v_balance.item_id;
        perform private.value_incoming(v_count.location_id, v_balance.item_id, r.counted_qty - v_balance.on_hand, coalesce(v_cost, 0));
      else
        v_cost := private.value_outgoing(v_count.location_id, v_balance.item_id, v_balance.on_hand - r.counted_qty);
      end if;
      v_movement := private.post_movement(v_count.location_id, v_balance.item_id, r.lot_id, r.condition,
        r.counted_qty - v_balance.on_hand, coalesce(v_cost, 0), 'count_adjustment', p_reason_code, 'stock_count', p_count_id,
        null, p_request_key, v_actor);
      v_adjusted := v_adjusted + 1;
    end if;
    update public.stock_count_lines
       set counted_qty = r.counted_qty, unit_cost = v_cost, movement_id = v_movement
     where count_id = p_count_id and lot_id = r.lot_id and condition = r.condition;
  end loop;
  update public.stock_count_lines set counted_qty = expected_qty where count_id = p_count_id and counted_qty is null;

  update public.stock_counts
     set status = 'posted', posted_by = v_actor, posted_at = now(), reason_code = p_reason_code, note = p_note, version = version + 1
   where count_id = p_count_id;
  perform private.write_audit(v_actor, 'stock_count.post', 'stock_count', p_count_id::text, v_count.location_id, p_request_key,
    null, jsonb_build_object('adjusted_lines', v_adjusted), p_note);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'count_id', p_count_id, 'status', 'posted',
    'adjusted_lines', v_adjusted, 'version', v_count.version + 1));
end;
$$;

create function public.cancel_stock_count(p_request_key uuid, p_count_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_count public.stock_counts;
begin
  select * into v_count from public.stock_counts c where c.count_id = p_count_id;
  if v_count.count_id is null then perform private.raise_error('validation:unknown_count'); end if;
  perform private.require_location_role(v_count.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'cancel_stock_count', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_count from public.stock_counts c where c.count_id = p_count_id for update;
  if v_count.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_count.status <> 'draft' then perform private.raise_error('invalid_state:' || v_count.status || '->cancelled'); end if;
  update public.stock_counts set status = 'cancelled', cancelled_at = now(), version = version + 1 where count_id = p_count_id;
  perform private.write_audit(v_actor, 'stock_count.cancel', 'stock_count', p_count_id::text, v_count.location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'count_id', p_count_id, 'status', 'cancelled'));
end;
$$;

-- ===========================================================================
-- Waste: employees report, managers post (PRD §4, §6)
-- ===========================================================================
create table public.waste_reports (
  waste_report_id uuid primary key default gen_random_uuid(),
  report_number text not null unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  status text not null default 'submitted' check (status in ('submitted', 'posted', 'rejected')),
  version integer not null default 1,
  reason_code text not null references public.reason_codes (code) on delete restrict,
  note text,
  submitted_by text not null references public.employees (employee_id) on delete restrict,
  submitted_at timestamptz not null default now(),
  decided_by text references public.employees (employee_id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  business_date date,
  total_cost numeric(28, 14)
);

create table public.waste_report_lines (
  waste_report_id uuid not null references public.waste_reports (waste_report_id) on delete restrict,
  line_no integer not null,
  item_id text not null,
  is_purchasable boolean not null default true check (is_purchasable),
  lot_id uuid references public.lots (lot_id) on delete restrict,
  quantity numeric(18, 6) not null check (quantity > 0),
  posted_cost numeric(28, 14),
  primary key (waste_report_id, line_no),
  foreign key (item_id, is_purchasable) references public.items (item_id, is_purchasable)
);

-- p_lines: [{item_id, quantity, lot_id?}]
create function public.submit_waste_report(p_request_key uuid, p_location_id text, p_lines jsonb, p_reason_code text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_report public.waste_reports;
  r record;
  v_no integer := 0;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_cached := private.idem_begin(v_actor, 'submit_waste_report', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_reason(p_reason_code, 'waste', p_note);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  insert into public.waste_reports (report_number, location_id, reason_code, note, submitted_by)
  values (private.doc_number('WST', p_location_id, 'private.waste_number_seq'), p_location_id, p_reason_code, nullif(btrim(p_note), ''), v_actor)
  returning * into v_report;
  for r in select * from jsonb_to_recordset(p_lines) as x(item_id text, quantity numeric, lot_id uuid) loop
    v_no := v_no + 1;
    if r.quantity is null or r.quantity <= 0 or r.quantity <> round(r.quantity, 6) then
      perform private.raise_error('validation:quantity', jsonb_build_object('line_no', v_no));
    end if;
    if r.lot_id is not null and not exists (select 1 from public.lots l where l.lot_id = r.lot_id and l.location_id = p_location_id and l.item_id = r.item_id) then
      perform private.raise_error('validation:lot', jsonb_build_object('line_no', v_no));
    end if;
    insert into public.waste_report_lines (waste_report_id, line_no, item_id, lot_id, quantity)
    values (v_report.waste_report_id, v_no, r.item_id, r.lot_id, r.quantity);
  end loop;
  perform private.write_audit(v_actor, 'waste_report.submit', 'waste_report', v_report.waste_report_id::text, p_location_id,
    p_request_key, null, jsonb_build_object('report_number', v_report.report_number, 'lines', v_no), p_note);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'waste_report_id', v_report.waste_report_id,
    'report_number', v_report.report_number, 'status', 'submitted', 'version', 1));
end;
$$;

-- Remove unreserved stock for waste: quarantined first, then expired, then
-- FEFO sellable (only the unreserved part of each lot). Returns the cost.
create function private.remove_unreserved(p_location_id text, p_item_id text, p_lot_id uuid, p_qty numeric, p_type text,
  p_reason text, p_source_type text, p_source_id uuid, p_request_key uuid, p_actor text, p_approver text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left numeric := p_qty;
  v_take numeric;
  v_cost numeric;
  v_total numeric := 0;
  r record;
begin
  perform private.lock_stock(p_location_id, array[p_item_id]);
  for r in
    select b.lot_id, b.condition, b.on_hand - b.reserved as free
    from public.stock_balances b join public.lots l on l.lot_id = b.lot_id
    where b.location_id = p_location_id and b.item_id = p_item_id and (p_lot_id is null or b.lot_id = p_lot_id)
      and b.on_hand - b.reserved > 0
    order by (b.condition = 'quarantined') desc, private.lot_is_eligible(l.use_by_date), l.use_by_date nulls last, l.received_at
  loop
    exit when v_left <= 0;
    v_take := least(r.free, v_left);
    v_cost := private.value_outgoing(p_location_id, p_item_id, v_take);
    perform private.post_movement(p_location_id, p_item_id, r.lot_id, r.condition, -v_take, v_cost, p_type, p_reason,
      p_source_type, p_source_id, null, p_request_key, p_actor, p_approver);
    v_total := v_total + v_take * v_cost;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    perform private.raise_error('insufficient_stock', jsonb_build_object('shortages', jsonb_build_array(jsonb_build_object(
      'item_id', p_item_id, 'name', (select i.name from public.items i where i.item_id = p_item_id),
      'base_unit', (select i.base_unit from public.items i where i.item_id = p_item_id),
      'required', p_qty::text, 'available', (p_qty - v_left)::text, 'shortfall', v_left::text)),
      'reason', 'only unreserved stock can be removed'));
  end if;
  return v_total;
end;
$$;

create function public.decide_waste_report(p_request_key uuid, p_waste_report_id uuid, p_expected_version integer,
  p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_report public.waste_reports;
  r record;
  v_cost numeric;
  v_total numeric := 0;
begin
  select * into v_report from public.waste_reports w where w.waste_report_id = p_waste_report_id;
  if v_report.waste_report_id is null then perform private.raise_error('validation:unknown_waste_report'); end if;
  perform private.require_location_role(v_report.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'decide_waste_report', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_decision not in ('post', 'reject') then perform private.raise_error('validation:decision'); end if;
  if p_decision = 'post' then perform private.require_posting_enabled(); end if;
  select * into v_report from public.waste_reports w where w.waste_report_id = p_waste_report_id for update;
  if v_report.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_report.status <> 'submitted' then perform private.raise_error('invalid_state:' || v_report.status || '->' || p_decision); end if;

  if p_decision = 'post' then
    for r in select * from public.waste_report_lines l where l.waste_report_id = p_waste_report_id order by l.item_id, l.line_no loop
      v_cost := private.remove_unreserved(v_report.location_id, r.item_id, r.lot_id, r.quantity, 'waste', v_report.reason_code,
        'waste_report', p_waste_report_id, p_request_key, v_actor, v_actor);
      update public.waste_report_lines set posted_cost = v_cost where waste_report_id = p_waste_report_id and line_no = r.line_no;
      v_total := v_total + v_cost;
    end loop;
  elsif p_note is null or length(btrim(p_note)) < 3 then
    perform private.raise_error('validation:reason');
  end if;

  update public.waste_reports
     set status = case when p_decision = 'post' then 'posted' else 'rejected' end, decided_by = v_actor, decided_at = now(),
         decision_note = nullif(btrim(p_note), ''), business_date = private.business_date(),
         total_cost = case when p_decision = 'post' then v_total end, version = version + 1
   where waste_report_id = p_waste_report_id;
  perform private.write_audit(v_actor, 'waste_report.' || p_decision, 'waste_report', p_waste_report_id::text, v_report.location_id,
    p_request_key, null, jsonb_build_object('total_cost', v_total::text), p_note, v_actor);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'waste_report_id', p_waste_report_id,
    'status', case when p_decision = 'post' then 'posted' else 'rejected' end, 'total_cost', round(v_total, 4)::text,
    'version', v_report.version + 1));
end;
$$;

-- ===========================================================================
-- Quarantine of owned stock (stays in valued on-hand; never available)
-- ===========================================================================
create function public.change_stock_condition(p_request_key uuid, p_lot_id uuid, p_quantity numeric, p_to_condition text,
  p_reason_code text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_lot public.lots;
  v_from text;
  v_bal public.stock_balances;
  v_cost numeric;
begin
  select * into v_lot from public.lots l where l.lot_id = p_lot_id;
  if v_lot.lot_id is null then perform private.raise_error('validation:unknown_lot'); end if;
  perform private.require_location_role(v_lot.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'change_stock_condition', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  if p_to_condition not in ('sellable', 'quarantined') then perform private.raise_error('validation:condition'); end if;
  if p_quantity is null or p_quantity <= 0 then perform private.raise_error('validation:quantity'); end if;
  v_from := case when p_to_condition = 'quarantined' then 'sellable' else 'quarantined' end;
  if p_to_condition = 'quarantined' then
    perform private.require_reason(p_reason_code, 'waste', p_note);
  elsif not private.lot_is_eligible(v_lot.use_by_date) then
    perform private.raise_error('validation:lot_expired');
  end if;

  perform private.lock_stock(v_lot.location_id, array[v_lot.item_id]);
  select * into v_bal from public.stock_balances b where b.lot_id = p_lot_id and b.condition = v_from;
  if v_bal.lot_id is null or v_bal.on_hand - v_bal.reserved < p_quantity then
    perform private.raise_error('insufficient_stock', jsonb_build_object('reason', 'only unreserved stock can change condition',
      'available', coalesce(v_bal.on_hand - v_bal.reserved, 0)::text));
  end if;
  select coalesce(v.avg_unit_cost, 0) into v_cost from public.item_valuation v where v.location_id = v_lot.location_id and v.item_id = v_lot.item_id;
  perform private.post_movement(v_lot.location_id, v_lot.item_id, p_lot_id, v_from, -p_quantity, v_cost, 'condition_change',
    p_reason_code, 'condition_change', p_lot_id, null, p_request_key, v_actor, v_actor);
  perform private.post_movement(v_lot.location_id, v_lot.item_id, p_lot_id, p_to_condition, p_quantity, v_cost, 'condition_change',
    p_reason_code, 'condition_change', p_lot_id, null, p_request_key, v_actor, v_actor);
  perform private.write_audit(v_actor, 'stock.' || p_to_condition, 'lot', p_lot_id::text, v_lot.location_id, p_request_key,
    jsonb_build_object('condition', v_from), jsonb_build_object('condition', p_to_condition, 'quantity', p_quantity::text), p_note, v_actor);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'lot_id', p_lot_id, 'condition', p_to_condition,
    'quantity', p_quantity::text));
end;
$$;

-- ===========================================================================
-- Transfers (AC13): draft → dispatched → partially_received → received
-- ===========================================================================
create table public.transfers (
  transfer_id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  from_location_id text not null references public.locations (location_id) on delete restrict,
  to_location_id text not null references public.locations (location_id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'dispatched', 'partially_received', 'received', 'cancelled')),
  version integer not null default 1,
  note text,
  created_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  dispatched_by text references public.employees (employee_id) on delete restrict,
  dispatched_at timestamptz,
  closed_at timestamptz,
  constraint transfers_distinct_locations check (from_location_id <> to_location_id)
);

create table public.transfer_requests (
  transfer_id uuid not null references public.transfers (transfer_id) on delete restrict,
  item_id text not null,
  is_purchasable boolean not null default true check (is_purchasable),
  quantity numeric(18, 6) not null check (quantity > 0),
  primary key (transfer_id, item_id),
  foreign key (item_id, is_purchasable) references public.items (item_id, is_purchasable)
);

-- One line per source lot dispatched. Transit = dispatched − received − lost.
create table public.transfer_lines (
  transfer_line_id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (transfer_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  source_lot_id uuid not null references public.lots (lot_id) on delete restrict,
  use_by_date date,
  dispatched_qty numeric(18, 6) not null check (dispatched_qty > 0),
  unit_cost numeric(18, 8) not null check (unit_cost >= 0),
  received_qty numeric(18, 6) not null default 0 check (received_qty >= 0),
  lost_qty numeric(18, 6) not null default 0 check (lost_qty >= 0),
  in_transit_qty numeric(18, 6) generated always as (dispatched_qty - received_qty - lost_qty) stored,
  dispatch_movement_id uuid not null references public.inventory_movements (movement_id) on delete restrict,
  constraint transfer_lines_reconcile check (received_qty + lost_qty <= dispatched_qty)
);

create table public.transfer_receipts (
  transfer_receipt_id uuid primary key default gen_random_uuid(),
  transfer_line_id uuid not null references public.transfer_lines (transfer_line_id) on delete restrict,
  received_qty numeric(18, 6) not null check (received_qty >= 0),
  lost_qty numeric(18, 6) not null check (lost_qty >= 0),
  condition text not null check (condition in ('sellable', 'quarantined')),
  dest_lot_id uuid references public.lots (lot_id) on delete restrict,
  movement_id uuid references public.inventory_movements (movement_id) on delete restrict,
  loss_reason_code text references public.reason_codes (code) on delete restrict,
  note text,
  received_cost numeric(28, 14) not null,
  lost_cost numeric(28, 14) not null,
  received_by text not null references public.employees (employee_id) on delete restrict,
  received_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  request_key uuid,
  constraint transfer_receipts_something check (received_qty + lost_qty > 0),
  constraint transfer_receipts_loss_reason check ((lost_qty = 0) = (loss_reason_code is null))
);

create trigger transfer_receipts_immutable before update or delete on public.transfer_receipts
  for each row execute function private.forbid_update_delete();

-- p_lines: [{item_id, quantity}] (source manager)
create function public.create_transfer(p_request_key uuid, p_from_location_id text, p_to_location_id text, p_lines jsonb,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_t public.transfers;
  r record;
begin
  perform private.require_location_role(p_from_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'create_transfer', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_to_location_id is null or p_to_location_id = p_from_location_id
     or not exists (select 1 from public.locations l where l.location_id = p_to_location_id) then
    perform private.raise_error('validation:to_location');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  insert into public.transfers (transfer_number, from_location_id, to_location_id, note, created_by)
  values (private.doc_number('TRF', p_from_location_id, 'private.transfer_number_seq'), p_from_location_id, p_to_location_id,
          nullif(btrim(p_note), ''), v_actor)
  returning * into v_t;
  for r in select * from jsonb_to_recordset(p_lines) as x(item_id text, quantity numeric) loop
    if r.quantity is null or r.quantity <= 0 then perform private.raise_error('validation:quantity'); end if;
    insert into public.transfer_requests (transfer_id, item_id, quantity) values (v_t.transfer_id, r.item_id, r.quantity);
  end loop;
  perform private.write_audit(v_actor, 'transfer.create', 'transfer', v_t.transfer_id::text, p_from_location_id, p_request_key,
    null, jsonb_build_object('transfer_number', v_t.transfer_number, 'to', p_to_location_id));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'transfer_id', v_t.transfer_id,
    'transfer_number', v_t.transfer_number, 'status', 'draft', 'version', 1));
end;
$$;

-- Dispatch unreserved, eligible sellable stock FEFO at source average cost.
create function public.dispatch_transfer(p_request_key uuid, p_transfer_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_t public.transfers;
  v_items text[];
  r record;
  b record;
  v_left numeric;
  v_take numeric;
  v_cost numeric;
  v_movement uuid;
  v_short jsonb := '[]'::jsonb;
begin
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id;
  if v_t.transfer_id is null then perform private.raise_error('validation:unknown_transfer'); end if;
  perform private.require_location_role(v_t.from_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'dispatch_transfer', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id for update;
  if v_t.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_t.status <> 'draft' then perform private.raise_error('invalid_state:' || v_t.status || '->dispatched'); end if;

  select array_agg(q.item_id order by q.item_id) into v_items from public.transfer_requests q where q.transfer_id = p_transfer_id;
  perform private.lock_stock(v_t.from_location_id, v_items);
  for r in select q.item_id, q.quantity from public.transfer_requests q where q.transfer_id = p_transfer_id order by q.item_id loop
    if private.available_qty(v_t.from_location_id, r.item_id) < r.quantity then
      v_short := v_short || jsonb_build_array(jsonb_build_object('item_id', r.item_id,
        'name', (select i.name from public.items i where i.item_id = r.item_id),
        'base_unit', (select i.base_unit from public.items i where i.item_id = r.item_id),
        'required', r.quantity::text, 'available', private.available_qty(v_t.from_location_id, r.item_id)::text,
        'shortfall', (r.quantity - private.available_qty(v_t.from_location_id, r.item_id))::text));
    end if;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    perform private.raise_error('insufficient_stock', jsonb_build_object('shortages', v_short));
  end if;

  for r in select q.item_id, q.quantity from public.transfer_requests q where q.transfer_id = p_transfer_id order by q.item_id loop
    v_left := r.quantity;
    for b in
      select bal.lot_id, bal.on_hand - bal.reserved as free, l.use_by_date
      from public.stock_balances bal join public.lots l on l.lot_id = bal.lot_id
      where bal.location_id = v_t.from_location_id and bal.item_id = r.item_id and bal.condition = 'sellable'
        and private.lot_is_eligible(l.use_by_date) and bal.on_hand - bal.reserved > 0
      order by l.use_by_date nulls last, l.received_at, l.lot_id
    loop
      exit when v_left <= 0;
      v_take := least(b.free, v_left);
      v_cost := private.value_outgoing(v_t.from_location_id, r.item_id, v_take);
      v_movement := private.post_movement(v_t.from_location_id, r.item_id, b.lot_id, 'sellable', -v_take, v_cost, 'transfer_out',
        null, 'transfer', p_transfer_id, null, p_request_key, v_actor);
      insert into public.transfer_lines (transfer_id, item_id, source_lot_id, use_by_date, dispatched_qty, unit_cost, dispatch_movement_id)
      values (p_transfer_id, r.item_id, b.lot_id, b.use_by_date, v_take, v_cost, v_movement);
      v_left := v_left - v_take;
    end loop;
  end loop;

  update public.transfers set status = 'dispatched', dispatched_by = v_actor, dispatched_at = now(), version = version + 1
   where transfer_id = p_transfer_id;
  perform private.write_audit(v_actor, 'transfer.dispatch', 'transfer', p_transfer_id::text, v_t.from_location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'transfer_id', p_transfer_id,
    'status', 'dispatched', 'version', v_t.version + 1));
end;
$$;

create function public.cancel_transfer(p_request_key uuid, p_transfer_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_t public.transfers;
begin
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id;
  if v_t.transfer_id is null then perform private.raise_error('validation:unknown_transfer'); end if;
  perform private.require_location_role(v_t.from_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'cancel_transfer', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id for update;
  if v_t.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_t.status <> 'draft' then perform private.raise_error('invalid_state:' || v_t.status || '->cancelled'); end if;
  update public.transfers set status = 'cancelled', closed_at = now(), version = version + 1 where transfer_id = p_transfer_id;
  perform private.write_audit(v_actor, 'transfer.cancel', 'transfer', p_transfer_id::text, v_t.from_location_id, p_request_key);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'transfer_id', p_transfer_id, 'status', 'cancelled'));
end;
$$;

-- Destination manager receives actual quantities and/or records transit loss.
-- p_lines: [{transfer_line_id, received_qty, lost_qty, condition?, loss_reason_code?, note?}]
-- Expired arrivals are always received into quarantine. No silent auto-receipt.
create function public.receive_transfer(p_request_key uuid, p_transfer_id uuid, p_expected_version integer, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_t public.transfers;
  r record;
  v_line public.transfer_lines;
  v_condition text;
  v_lot uuid;
  v_movement uuid;
  v_no integer := 0;
  v_open boolean;
  v_status text;
begin
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id;
  if v_t.transfer_id is null then perform private.raise_error('validation:unknown_transfer'); end if;
  perform private.require_location_role(v_t.to_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'receive_transfer', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_t from public.transfers t where t.transfer_id = p_transfer_id for update;
  if v_t.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_t.status not in ('dispatched', 'partially_received') then
    perform private.raise_error('invalid_state:' || v_t.status || '->received');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;

  for r in
    select * from jsonb_to_recordset(p_lines) as x(transfer_line_id uuid, received_qty numeric, lost_qty numeric,
      condition text, loss_reason_code text, note text)
  loop
    v_no := v_no + 1;
    select * into v_line from public.transfer_lines l where l.transfer_line_id = r.transfer_line_id and l.transfer_id = p_transfer_id for update;
    if v_line.transfer_line_id is null then perform private.raise_error('validation:transfer_line', jsonb_build_object('line_no', v_no)); end if;
    if coalesce(r.received_qty, 0) < 0 or coalesce(r.lost_qty, 0) < 0 or coalesce(r.received_qty, 0) + coalesce(r.lost_qty, 0) = 0 then
      perform private.raise_error('validation:quantity', jsonb_build_object('line_no', v_no));
    end if;
    if coalesce(r.received_qty, 0) + coalesce(r.lost_qty, 0) > v_line.in_transit_qty then
      perform private.raise_error('validation:exceeds_in_transit',
        jsonb_build_object('line_no', v_no, 'in_transit', v_line.in_transit_qty::text));
    end if;
    if coalesce(r.lost_qty, 0) > 0 then
      perform private.require_reason(r.loss_reason_code, 'transfer', r.note);
    end if;
    v_condition := case when not private.lot_is_eligible(v_line.use_by_date) then 'quarantined'
                        else coalesce(r.condition, 'sellable') end;
    if v_condition not in ('sellable', 'quarantined') then perform private.raise_error('validation:condition'); end if;
    v_lot := null;
    v_movement := null;
    if coalesce(r.received_qty, 0) > 0 then
      insert into public.lots (location_id, item_id, lot_code, supplier_lot, use_by_date, source_type, source_id, created_by)
      values (v_t.to_location_id, v_line.item_id, v_t.transfer_number || '-' || left(v_line.transfer_line_id::text, 8) || '-'
                || (select count(*) + 1 from public.transfer_receipts x where x.transfer_line_id = v_line.transfer_line_id),
              (select l.lot_code from public.lots l where l.lot_id = v_line.source_lot_id), v_line.use_by_date, 'transfer',
              p_transfer_id, v_actor)
      returning lot_id into v_lot;
      perform private.value_incoming(v_t.to_location_id, v_line.item_id, r.received_qty, v_line.unit_cost);
      v_movement := private.post_movement(v_t.to_location_id, v_line.item_id, v_lot, v_condition, r.received_qty, v_line.unit_cost,
        'transfer_in', null, 'transfer', p_transfer_id, v_line.transfer_line_id, p_request_key, v_actor);
    end if;
    insert into public.transfer_receipts (transfer_line_id, received_qty, lost_qty, condition, dest_lot_id, movement_id,
      loss_reason_code, note, received_cost, lost_cost, received_by, request_key)
    values (v_line.transfer_line_id, coalesce(r.received_qty, 0), coalesce(r.lost_qty, 0), v_condition, v_lot, v_movement,
            case when coalesce(r.lost_qty, 0) > 0 then r.loss_reason_code end, nullif(btrim(r.note), ''),
            coalesce(r.received_qty, 0) * v_line.unit_cost, coalesce(r.lost_qty, 0) * v_line.unit_cost, v_actor, p_request_key);
    update public.transfer_lines
       set received_qty = received_qty + coalesce(r.received_qty, 0), lost_qty = lost_qty + coalesce(r.lost_qty, 0)
     where transfer_line_id = v_line.transfer_line_id;
  end loop;

  v_open := exists (select 1 from public.transfer_lines l where l.transfer_id = p_transfer_id and l.in_transit_qty > 0);
  v_status := case when v_open then 'partially_received' else 'received' end;
  update public.transfers set status = v_status, version = version + 1, closed_at = case when v_open then null else now() end
   where transfer_id = p_transfer_id;
  perform private.write_audit(v_actor, 'transfer.receive', 'transfer', p_transfer_id::text, v_t.to_location_id, p_request_key,
    null, jsonb_build_object('lines', v_no, 'status', v_status));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'transfer_id', p_transfer_id,
    'status', v_status, 'version', v_t.version + 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines', 'waste_reports', 'waste_report_lines', 'transfers',
                           'transfer_requests', 'transfer_lines', 'transfer_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy stock_counts_read on public.stock_counts for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy stock_count_lines_read on public.stock_count_lines for select to authenticated
  using (exists (select 1 from public.stock_counts c where c.count_id = stock_count_lines.count_id
                 and c.location_id in (select private.managed_location_ids())));
-- Employees see the waste reports they submitted; managers their locations'.
create policy waste_reports_read on public.waste_reports for select to authenticated
  using (location_id in (select private.managed_location_ids()) or submitted_by = (select private.current_employee_id()));
create policy waste_report_lines_read on public.waste_report_lines for select to authenticated
  using (exists (select 1 from public.waste_reports w where w.waste_report_id = waste_report_lines.waste_report_id
                 and (w.location_id in (select private.managed_location_ids()) or w.submitted_by = (select private.current_employee_id()))));
-- Both ends of a transfer can see it (managers).
create policy transfers_read on public.transfers for select to authenticated
  using (from_location_id in (select private.managed_location_ids()) or to_location_id in (select private.managed_location_ids()));
create policy transfer_requests_read on public.transfer_requests for select to authenticated
  using (exists (select 1 from public.transfers t where t.transfer_id = transfer_requests.transfer_id
                 and (t.from_location_id in (select private.managed_location_ids()) or t.to_location_id in (select private.managed_location_ids()))));
create policy transfer_lines_read on public.transfer_lines for select to authenticated
  using (exists (select 1 from public.transfers t where t.transfer_id = transfer_lines.transfer_id
                 and (t.from_location_id in (select private.managed_location_ids()) or t.to_location_id in (select private.managed_location_ids()))));
create policy transfer_receipts_read on public.transfer_receipts for select to authenticated
  using (exists (select 1 from public.transfer_lines l join public.transfers t on t.transfer_id = l.transfer_id
                 where l.transfer_line_id = transfer_receipts.transfer_line_id
                   and (t.from_location_id in (select private.managed_location_ids()) or t.to_location_id in (select private.managed_location_ids()))));

grant execute on function
  public.start_stock_count(uuid, text, text[]),
  public.post_stock_count(uuid, uuid, integer, jsonb, text, text),
  public.cancel_stock_count(uuid, uuid, integer),
  public.submit_waste_report(uuid, text, jsonb, text, text),
  public.decide_waste_report(uuid, uuid, integer, text, text),
  public.change_stock_condition(uuid, uuid, numeric, text, text, text),
  public.create_transfer(uuid, text, text, jsonb, text),
  public.dispatch_transfer(uuid, uuid, integer),
  public.cancel_transfer(uuid, uuid, integer),
  public.receive_transfer(uuid, uuid, integer, jsonb)
to authenticated;

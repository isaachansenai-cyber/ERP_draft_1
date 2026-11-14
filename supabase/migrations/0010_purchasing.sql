-- 0010 Purchasing (PRD §9; AC04, AC07, AC10)
-- Supplier terms and pack maintenance, purchase orders, partial receipts with
-- lot/use-by capture, conversion and cost snapshots, and audited over-receipt.

-- ---------------------------------------------------------------------------
-- Supplier master maintenance (owner)
-- ---------------------------------------------------------------------------
create function public.set_supplier_terms(p_request_key uuid, p_supplier_id text, p_payment_terms_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before public.suppliers;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_supplier_terms', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_payment_terms_days is null or p_payment_terms_days not between 0 and 365 then
    perform private.raise_error('validation:payment_terms_days', jsonb_build_object('rule', '0 to 365 days'));
  end if;
  select * into v_before from public.suppliers s where s.supplier_id = p_supplier_id for update;
  if v_before.supplier_id is null then perform private.raise_error('validation:unknown_supplier'); end if;
  update public.suppliers
     set payment_terms_days = p_payment_terms_days,
         payment_terms_provenance = case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end,
         updated_at = now()
   where supplier_id = p_supplier_id;
  perform private.write_audit(v_actor, 'supplier.set_terms', 'supplier', p_supplier_id, null, p_request_key,
    jsonb_build_object('payment_terms_days', v_before.payment_terms_days), jsonb_build_object('payment_terms_days', p_payment_terms_days));
  v_result := jsonb_build_object('ok', true, 'supplier_id', p_supplier_id, 'payment_terms_days', p_payment_terms_days);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Pack size (in the item's base unit) and quoted/estimated pack cost.
create function public.set_supplier_item_pack(p_request_key uuid, p_supplier_item_id uuid, p_pack_description text,
  p_pack_base_qty numeric, p_pack_cost_cents bigint, p_cost_basis text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before public.supplier_items;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_supplier_item_pack', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_pack_base_qty is null or p_pack_base_qty <= 0 or p_pack_base_qty <> round(p_pack_base_qty, 6) then
    perform private.raise_error('validation:pack_base_qty');
  end if;
  if p_pack_cost_cents is null or p_pack_cost_cents < 0 then perform private.raise_error('validation:pack_cost_cents'); end if;
  if p_cost_basis not in ('quoted', 'estimated') then perform private.raise_error('validation:cost_basis'); end if;
  if p_pack_description is null or length(btrim(p_pack_description)) = 0 then perform private.raise_error('validation:pack_description'); end if;
  select * into v_before from public.supplier_items si where si.supplier_item_id = p_supplier_item_id and si.archived_at is null for update;
  if v_before.supplier_item_id is null then perform private.raise_error('validation:unknown_supplier_item'); end if;

  update public.supplier_items
     set pack_description = btrim(p_pack_description), pack_base_qty = p_pack_base_qty, pack_cost_cents = p_pack_cost_cents,
         unit_cost = round(p_pack_cost_cents / 100.0 / p_pack_base_qty, 8), cost_basis = p_cost_basis,
         effective_date = private.business_date(), updated_at = now()
   where supplier_item_id = p_supplier_item_id;
  perform private.write_audit(v_actor, 'supplier_item.set_pack', 'supplier_item', p_supplier_item_id::text, null, p_request_key,
    jsonb_build_object('pack_base_qty', v_before.pack_base_qty, 'pack_cost_cents', v_before.pack_cost_cents),
    jsonb_build_object('pack_base_qty', p_pack_base_qty, 'pack_cost_cents', p_pack_cost_cents, 'cost_basis', p_cost_basis));
  v_result := jsonb_build_object('ok', true, 'supplier_item_id', p_supplier_item_id);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchase orders (one location, one supplier)
-- ---------------------------------------------------------------------------
create sequence private.po_number_seq;
create sequence private.receipt_number_seq;

create table public.purchase_orders (
  po_id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
  expected_date date,
  note text,
  version integer not null default 1 check (version > 0),
  created_by text references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  submitted_by text references public.employees (employee_id) on delete restrict,
  submitted_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  provenance text not null default 'operational'
);

create index purchase_orders_loc_status on public.purchase_orders (location_id, status);

create table public.purchase_order_lines (
  po_line_id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (po_id) on delete restrict,
  line_no integer not null check (line_no > 0),
  supplier_item_id uuid not null references public.supplier_items (supplier_item_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  ordered_packs numeric(18, 6) not null check (ordered_packs > 0),
  pack_base_qty numeric(18, 6) not null check (pack_base_qty > 0),
  pack_cost_cents bigint not null check (pack_cost_cents >= 0),
  received_packs numeric(18, 6) not null default 0 check (received_packs >= 0),
  cancelled_packs numeric(18, 6) not null default 0 check (cancelled_packs >= 0),
  unique (po_id, line_no)
);

create table public.receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  location_id text not null references public.locations (location_id) on delete restrict,
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  po_id uuid references public.purchase_orders (po_id) on delete restrict,
  packing_slip_ref text,
  received_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  received_by text not null references public.employees (employee_id) on delete restrict,
  over_receipt_acknowledged_by text references public.employees (employee_id) on delete restrict,
  request_key uuid,
  note text,
  provenance text not null default 'operational'
);

-- A new request key never bypasses the external reference (PRD §6).
create unique index receipts_supplier_slip_unique
  on public.receipts (supplier_id, lower(btrim(packing_slip_ref))) where packing_slip_ref is not null;

create table public.receipt_lines (
  receipt_line_id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (receipt_id) on delete restrict,
  line_no integer not null check (line_no > 0),
  po_line_id uuid references public.purchase_order_lines (po_line_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  entered_quantity numeric(18, 6) not null check (entered_quantity > 0),
  entered_unit text not null,
  packs_equivalent numeric(18, 6),
  pack_base_qty_snapshot numeric(18, 6),
  base_quantity numeric(18, 6) not null check (base_quantity > 0),
  unit_cost numeric(18, 8) not null check (unit_cost >= 0),
  lot_id uuid not null references public.lots (lot_id) on delete restrict,
  supplier_lot text,
  use_by_date date,
  over_receipt boolean not null default false,
  movement_id uuid not null references public.inventory_movements (movement_id) on delete restrict,
  unique (receipt_id, line_no)
);

do $$
declare
  t text;
begin
  foreach t in array array['receipts', 'receipt_lines'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_update_delete()',
                   t || '_immutable', t);
  end loop;
end;
$$;

-- p_lines: [{supplier_item_id, packs}]
create function public.create_purchase_order(p_request_key uuid, p_location_id text, p_supplier_id text,
  p_expected_date date, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_po public.purchase_orders;
  v_line record;
  v_si public.supplier_items;
  v_no integer := 0;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'create_purchase_order', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if not exists (select 1 from public.suppliers s where s.supplier_id = p_supplier_id and s.archived_at is null) then
    perform private.raise_error('validation:unknown_supplier');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;

  insert into public.purchase_orders (po_number, location_id, supplier_id, expected_date, note, created_by)
  values ('PO-' || (select l.short_code from public.locations l where l.location_id = p_location_id) || '-'
            || lpad(nextval('private.po_number_seq')::text, 6, '0'),
          p_location_id, p_supplier_id, p_expected_date, p_note, v_actor)
  returning * into v_po;

  for v_line in select x.supplier_item_id, x.packs from jsonb_to_recordset(p_lines) as x(supplier_item_id uuid, packs numeric) loop
    v_no := v_no + 1;
    select * into v_si from public.supplier_items si
    where si.supplier_item_id = v_line.supplier_item_id and si.supplier_id = p_supplier_id and si.archived_at is null;
    if v_si.supplier_item_id is null then
      perform private.raise_error('validation:supplier_item', jsonb_build_object('line_no', v_no));
    end if;
    if v_si.pack_base_qty is null or v_si.pack_cost_cents is null then
      perform private.raise_error('validation:pack_not_defined', jsonb_build_object('item_id', v_si.item_id));
    end if;
    if v_line.packs is null or v_line.packs <= 0 or v_line.packs <> round(v_line.packs, 6) then
      perform private.raise_error('validation:packs', jsonb_build_object('line_no', v_no));
    end if;
    insert into public.purchase_order_lines (po_id, line_no, supplier_item_id, item_id, ordered_packs, pack_base_qty, pack_cost_cents)
    values (v_po.po_id, v_no, v_si.supplier_item_id, v_si.item_id, v_line.packs, v_si.pack_base_qty, v_si.pack_cost_cents);
  end loop;

  perform private.write_audit(v_actor, 'purchase_order.create', 'purchase_order', v_po.po_id::text, p_location_id,
    p_request_key, null, jsonb_build_object('po_number', v_po.po_number, 'lines', v_no));
  v_result := jsonb_build_object('ok', true, 'po_id', v_po.po_id, 'po_number', v_po.po_number, 'version', v_po.version);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Submitted = internally approved and placed with the supplier outside the app.
create function public.submit_purchase_order(p_request_key uuid, p_po_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_po public.purchase_orders;
  v_line record;
  v_result jsonb;
begin
  select * into v_po from public.purchase_orders p where p.po_id = p_po_id;
  if v_po.po_id is null then perform private.raise_error('validation:unknown_purchase_order'); end if;
  perform private.require_location_role(v_po.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'submit_purchase_order', p_request_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_po from public.purchase_orders p where p.po_id = p_po_id for update;
  if v_po.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_po.status <> 'draft' then perform private.raise_error('invalid_state:' || v_po.status || '->submitted'); end if;
  perform private.require_gate('supplier_master_verified', v_po.supplier_id);
  for v_line in select l.supplier_item_id from public.purchase_order_lines l where l.po_id = p_po_id loop
    perform private.require_gate('pack_conversions_verified', v_line.supplier_item_id::text);
  end loop;

  update public.purchase_orders
     set status = 'submitted', submitted_by = v_actor, submitted_at = now(), version = version + 1
   where po_id = p_po_id;
  perform private.write_audit(v_actor, 'purchase_order.submit', 'purchase_order', p_po_id::text, v_po.location_id,
    p_request_key, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'));
  v_result := jsonb_build_object('ok', true, 'po_id', p_po_id, 'status', 'submitted', 'version', v_po.version + 1);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Cancel a draft, or close the unreceived balance of a submitted/partial PO.
create function public.cancel_purchase_order_balance(p_request_key uuid, p_po_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_po public.purchase_orders;
  v_received boolean;
  v_new_status text;
  v_result jsonb;
begin
  select * into v_po from public.purchase_orders p where p.po_id = p_po_id;
  if v_po.po_id is null then perform private.raise_error('validation:unknown_purchase_order'); end if;
  perform private.require_location_role(v_po.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'cancel_purchase_order_balance', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;

  select * into v_po from public.purchase_orders p where p.po_id = p_po_id for update;
  if v_po.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_po.status not in ('draft', 'submitted', 'partially_received') then
    perform private.raise_error('invalid_state:' || v_po.status || '->cancelled');
  end if;
  update public.purchase_order_lines
     set cancelled_packs = greatest(ordered_packs - received_packs, 0)
   where po_id = p_po_id;
  v_received := exists (select 1 from public.purchase_order_lines l where l.po_id = p_po_id and l.received_packs > 0);
  v_new_status := case when v_received then 'received' else 'cancelled' end;
  update public.purchase_orders
     set status = v_new_status, closed_at = now(), close_reason = btrim(p_reason), version = version + 1
   where po_id = p_po_id;
  perform private.write_audit(v_actor, 'purchase_order.cancel_balance', 'purchase_order', p_po_id::text, v_po.location_id,
    p_request_key, jsonb_build_object('status', v_po.status), jsonb_build_object('status', v_new_status), p_reason);
  v_result := jsonb_build_object('ok', true, 'po_id', p_po_id, 'status', v_new_status, 'version', v_po.version + 1);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Receive against a submitted PO. p_lines:
--   [{po_line_id, packs?, quantity?, unit?, pack_cost_cents?, supplier_lot?, use_by_date?}]
-- Either packs (× snapshotted pack size) or quantity+unit (converted with a
-- verified conversion) per line. Only quantities actually received are added.
-- Receiving beyond the ordered packs requires p_acknowledge_over_receipt.
create function public.receive_purchase_order(p_request_key uuid, p_po_id uuid, p_expected_version integer,
  p_packing_slip_ref text, p_lines jsonb, p_acknowledge_over_receipt boolean default false, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_po public.purchase_orders;
  v_receipt public.receipts;
  v_pl public.purchase_order_lines;
  v_item public.items;
  v_line record;
  v_plan jsonb := '[]'::jsonb;
  v_no integer := 0;
  v_base numeric;
  v_packs numeric;
  v_unit_cost numeric;
  v_over boolean;
  v_any_over boolean := false;
  v_lot_id uuid;
  v_movement uuid;
  v_open_left boolean;
  v_new_status text;
  v_pilot boolean := private.data_mode() = 'pilot';
  v_result jsonb;
begin
  select * into v_po from public.purchase_orders p where p.po_id = p_po_id;
  if v_po.po_id is null then perform private.raise_error('validation:unknown_purchase_order'); end if;
  perform private.require_location_role(v_po.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'receive_purchase_order', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if v_pilot then perform private.require_gate('perishables_confirmed'); end if;

  select * into v_po from public.purchase_orders p where p.po_id = p_po_id for update;
  if v_po.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_po.status not in ('submitted', 'partially_received') then
    perform private.raise_error('invalid_state:' || v_po.status || '->received');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  if (select count(distinct x ->> 'po_line_id') from jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines) then
    perform private.raise_error('validation:duplicate_po_line');
  end if;
  if p_packing_slip_ref is not null and exists (
      select 1 from public.receipts r where r.supplier_id = v_po.supplier_id
        and lower(btrim(r.packing_slip_ref)) = lower(btrim(p_packing_slip_ref))) then
    perform private.raise_error('duplicate_business_key:packing_slip_ref');
  end if;

  -- Pass 1: validate, convert and cost every line; detect over-receipt.
  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(po_line_id uuid, packs numeric, quantity numeric, unit text,
      pack_cost_cents bigint, supplier_lot text, use_by_date date)
  loop
    v_no := v_no + 1;
    select * into v_pl from public.purchase_order_lines l where l.po_line_id = v_line.po_line_id and l.po_id = p_po_id for update;
    if v_pl.po_line_id is null then perform private.raise_error('validation:po_line', jsonb_build_object('line_no', v_no)); end if;
    select * into v_item from public.items i where i.item_id = v_pl.item_id;
    if (v_line.packs is null) = (v_line.quantity is null) then
      perform private.raise_error('validation:quantity_or_packs', jsonb_build_object('line_no', v_no, 'rule', 'give packs or quantity+unit'));
    end if;
    if v_line.packs is not null then
      if v_line.packs <= 0 then perform private.raise_error('validation:packs', jsonb_build_object('line_no', v_no)); end if;
      -- Receiving in packs relies on the verified pack conversion.
      perform private.require_gate('pack_conversions_verified', v_pl.supplier_item_id::text);
      v_packs := v_line.packs;
      v_base := round(v_line.packs * v_pl.pack_base_qty, 6);
    else
      if v_line.quantity <= 0 then perform private.raise_error('validation:quantity', jsonb_build_object('line_no', v_no)); end if;
      v_base := private.convert_to_base(v_pl.item_id, v_line.quantity, coalesce(v_line.unit, v_item.base_unit));
      v_packs := round(v_base / v_pl.pack_base_qty, 6);
    end if;
    if v_pilot and v_item.requires_use_by and v_line.use_by_date is null then
      perform private.raise_error('validation:use_by_required', jsonb_build_object('item_id', v_pl.item_id));
    end if;
    if v_line.pack_cost_cents is not null and v_line.pack_cost_cents < 0 then
      perform private.raise_error('validation:pack_cost_cents', jsonb_build_object('line_no', v_no));
    end if;
    -- Actual net unit cost per base unit, from the actual pack cost when given.
    v_unit_cost := round(coalesce(v_line.pack_cost_cents, v_pl.pack_cost_cents) / 100.0 / v_pl.pack_base_qty, 8);
    v_over := v_pl.received_packs + v_packs > v_pl.ordered_packs;
    v_any_over := v_any_over or v_over;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'line_no', v_no, 'po_line_id', v_pl.po_line_id, 'item_id', v_pl.item_id, 'packs', v_packs, 'base', v_base,
      'unit_cost', v_unit_cost, 'over', v_over, 'pack_base_qty', v_pl.pack_base_qty,
      'entered_quantity', coalesce(v_line.packs, v_line.quantity),
      'entered_unit', case when v_line.packs is not null then 'pack' else coalesce(v_line.unit, v_item.base_unit) end,
      'supplier_lot', nullif(btrim(v_line.supplier_lot), ''), 'use_by_date', v_line.use_by_date,
      'ordered_packs', v_pl.ordered_packs, 'received_packs', v_pl.received_packs));
  end loop;

  if v_any_over and not coalesce(p_acknowledge_over_receipt, false) then
    perform private.raise_error('validation:over_receipt_requires_acknowledgement',
      jsonb_build_object('lines', (select jsonb_agg(jsonb_build_object('item_id', e ->> 'item_id',
        'ordered_packs', e -> 'ordered_packs', 'already_received_packs', e -> 'received_packs', 'this_receipt_packs', e -> 'packs'))
        from jsonb_array_elements(v_plan) e where (e ->> 'over')::boolean)));
  end if;

  -- Pass 2: post the receipt, lots, valuation, movements and PO progress.
  insert into public.receipts (receipt_number, location_id, supplier_id, po_id, packing_slip_ref, received_by,
    over_receipt_acknowledged_by, request_key, note)
  values ('RC-' || (select l.short_code from public.locations l where l.location_id = v_po.location_id) || '-'
            || lpad(nextval('private.receipt_number_seq')::text, 6, '0'),
          v_po.location_id, v_po.supplier_id, p_po_id, nullif(btrim(p_packing_slip_ref), ''), v_actor,
          case when v_any_over then v_actor end, p_request_key, p_note)
  returning * into v_receipt;

  for v_line in
    select * from jsonb_to_recordset(v_plan) as x(line_no integer, po_line_id uuid, item_id text, packs numeric, base numeric,
      unit_cost numeric, over boolean, pack_base_qty numeric, entered_quantity numeric, entered_unit text,
      supplier_lot text, use_by_date date)
    order by x.line_no
  loop
    insert into public.lots (location_id, item_id, lot_code, supplier_lot, use_by_date, source_type, source_id, created_by)
    values (v_po.location_id, v_line.item_id, v_receipt.receipt_number || '-' || v_line.line_no,
            v_line.supplier_lot, v_line.use_by_date, 'receipt', v_receipt.receipt_id, v_actor)
    returning lot_id into v_lot_id;

    perform private.value_incoming(v_po.location_id, v_line.item_id, v_line.base, v_line.unit_cost);
    v_movement := private.post_movement(v_po.location_id, v_line.item_id, v_lot_id, 'sellable', v_line.base,
      v_line.unit_cost, 'receipt', case when v_line.over then 'RECEIVING_ERROR' end, 'receipt', v_receipt.receipt_id,
      null, p_request_key, v_actor, case when v_line.over then v_actor end);

    insert into public.receipt_lines (receipt_id, line_no, po_line_id, item_id, entered_quantity, entered_unit,
      packs_equivalent, pack_base_qty_snapshot, base_quantity, unit_cost, lot_id, supplier_lot, use_by_date, over_receipt, movement_id)
    values (v_receipt.receipt_id, v_line.line_no, v_line.po_line_id, v_line.item_id, v_line.entered_quantity, v_line.entered_unit,
            v_line.packs, v_line.pack_base_qty, v_line.base, v_line.unit_cost, v_lot_id, v_line.supplier_lot,
            v_line.use_by_date, v_line.over, v_movement);

    update public.purchase_order_lines set received_packs = received_packs + v_line.packs where po_line_id = v_line.po_line_id;
  end loop;

  v_open_left := exists (select 1 from public.purchase_order_lines l where l.po_id = p_po_id and l.received_packs < l.ordered_packs);
  v_new_status := case when v_open_left then 'partially_received' else 'received' end;
  update public.purchase_orders
     set status = v_new_status, version = version + 1, closed_at = case when v_open_left then null else now() end
   where po_id = p_po_id;

  perform private.write_audit(v_actor, case when v_any_over then 'receipt.post_over_receipt' else 'receipt.post' end,
    'receipt', v_receipt.receipt_id::text, v_po.location_id, p_request_key, null,
    jsonb_build_object('receipt_number', v_receipt.receipt_number, 'po_number', v_po.po_number, 'lines', v_no,
      'over_receipt_acknowledged', v_any_over), p_note, case when v_any_over then v_actor end);
  v_result := jsonb_build_object('ok', true, 'receipt_id', v_receipt.receipt_id, 'receipt_number', v_receipt.receipt_number,
    'po_status', v_new_status, 'po_version', v_po.version + 1, 'over_receipt', v_any_over);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants: purchasing and unit costs are owner/manager-only (PRD §4).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines', 'receipts', 'receipt_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.po_id = purchase_order_lines.po_id
                 and p.location_id in (select private.managed_location_ids())));
create policy receipts_read on public.receipts for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy receipt_lines_read on public.receipt_lines for select to authenticated
  using (exists (select 1 from public.receipts r where r.receipt_id = receipt_lines.receipt_id
                 and r.location_id in (select private.managed_location_ids())));

grant execute on function
  public.set_supplier_terms(uuid, text, integer),
  public.set_supplier_item_pack(uuid, uuid, text, numeric, bigint, text),
  public.create_purchase_order(uuid, text, text, date, jsonb, text),
  public.submit_purchase_order(uuid, uuid, integer),
  public.cancel_purchase_order_balance(uuid, uuid, integer, text),
  public.receive_purchase_order(uuid, uuid, integer, text, jsonb, boolean, text)
to authenticated;

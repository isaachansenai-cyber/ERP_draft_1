-- 0016 Refunds, retail returns, custody, exchanges (PRD §7, §8; AC14, AC15, AC16, AC17, AC07/AC09 refund parts)
-- Refunds are records of money handled outside the app, linked to original
-- lines and limited by the original snapshots and recorded payments. Meals are
-- refunded, never restocked. Retail returns go to a custody record outside
-- valued stock until a manager restocks (demo policy) or disposes them.

alter table public.tenders drop constraint tenders_method_check;
alter table public.tenders add constraint tenders_method_check
  check (method in ('cash', 'card_external', 'other_external', 'exchange_credit'));

create sequence private.refund_number_seq;
create sequence private.return_number_seq;

-- ---------------------------------------------------------------------------
-- Return policy (owner configured; pilot restock disabled until configured)
-- ---------------------------------------------------------------------------
create table public.return_policy (
  singleton boolean primary key default true check (singleton),
  window_days integer not null check (window_days between 0 and 90),
  allow_customer_restock boolean not null default false,
  provenance text not null,
  configured_by text references public.employees (employee_id) on delete restrict,
  configured_at timestamptz not null default now()
);

create trigger return_policy_no_synthetic_in_pilot before insert or update on public.return_policy
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

create function public.set_return_policy(p_request_key uuid, p_window_days integer, p_allow_customer_restock boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_return_policy', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_window_days is null or p_window_days not between 0 and 90 then perform private.raise_error('validation:window_days'); end if;
  if p_allow_customer_restock is null then perform private.raise_error('validation:allow_customer_restock'); end if;
  insert into public.return_policy (singleton, window_days, allow_customer_restock, provenance, configured_by)
  values (true, p_window_days, p_allow_customer_restock,
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end, v_actor)
  on conflict (singleton) do update
    set window_days = excluded.window_days, allow_customer_restock = excluded.allow_customer_restock,
        provenance = excluded.provenance, configured_by = excluded.configured_by, configured_at = now()
    where public.return_policy.singleton;
  perform private.write_audit(v_actor, 'return_policy.set', 'return_policy', 'singleton', null, p_request_key, null,
    jsonb_build_object('window_days', p_window_days, 'allow_customer_restock', p_allow_customer_restock));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'window_days', p_window_days,
    'allow_customer_restock', p_allow_customer_restock));
end;
$$;

-- return_policy_configured now has a real precondition.
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
      return jsonb_build_object('reason', 'workflow_not_yet_available',
        'note', 'The screen that records this value is delivered in a later milestone.');
    else
      null;
  end case;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
create table public.refunds (
  refund_id uuid primary key default gen_random_uuid(),
  refund_number text not null unique,
  order_id uuid not null references public.orders (order_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  refund_mode text not null check (refund_mode in ('SIMULATED', 'MANUAL_EXTERNAL')),
  kind text not null check (kind in ('sale', 'cancellation')),
  method text not null check (method in ('cash', 'card_external', 'other_external', 'exchange_credit')),
  net_cents bigint not null check (net_cents >= 0),
  tax_cents bigint not null check (tax_cents >= 0),
  amount_cents bigint not null check (amount_cents > 0),
  paid_out_cents bigint not null check (paid_out_cents >= 0),
  paid_out_method text check (paid_out_method in ('cash', 'card_external', 'other_external')),
  reason_code text not null references public.reason_codes (code) on delete restrict,
  note text,
  external_reference text,
  return_id uuid,
  recorded_by text not null references public.employees (employee_id) on delete restrict,
  approved_by text not null references public.employees (employee_id) on delete restrict,
  recorded_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  request_key uuid,
  constraint refunds_amount check (amount_cents = net_cents + tax_cents),
  constraint refunds_paid_out check (paid_out_cents <= amount_cents and ((paid_out_cents = 0) = (paid_out_method is null)))
);

create index refunds_order on public.refunds (order_id);

create table public.refund_lines (
  refund_id uuid not null references public.refunds (refund_id) on delete restrict,
  order_line_id uuid not null references public.order_lines (order_line_id) on delete restrict,
  quantity integer check (quantity > 0),
  net_cents bigint not null check (net_cents >= 0),
  tax_cents bigint not null check (tax_cents >= 0),
  primary key (refund_id, order_line_id)
);

create trigger refunds_append_only before update or delete on public.refunds
  for each row execute function private.forbid_update_delete();
create trigger refund_lines_append_only before update or delete on public.refund_lines
  for each row execute function private.forbid_update_delete();

-- Plan a line refund from the original snapshots. Unit refunds are
-- proportional; the final unit (or the final cent of net) takes exactly the
-- remainder so cumulative refunds can never exceed the line's net or tax.
create function private.plan_line_refund(p_line public.order_lines, p_quantity integer, p_net bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prior_q bigint;
  v_prior_net bigint;
  v_prior_tax bigint;
  v_net bigint;
  v_tax bigint;
begin
  select coalesce(sum(rl.quantity), 0), coalesce(sum(rl.net_cents), 0), coalesce(sum(rl.tax_cents), 0)
    into v_prior_q, v_prior_net, v_prior_tax
  from public.refund_lines rl where rl.order_line_id = p_line.order_line_id;
  if (p_quantity is null) = (p_net is null) then
    perform private.raise_error('validation:quantity_or_amount', jsonb_build_object('rule', 'give quantity or net_cents'));
  end if;
  if p_quantity is not null then
    if p_quantity < 1 or v_prior_q + p_quantity > p_line.quantity then
      perform private.raise_error('validation:refund_exceeds_line', jsonb_build_object('order_line_id', p_line.order_line_id,
        'remaining_quantity', p_line.quantity - v_prior_q));
    end if;
    v_net := case when v_prior_q + p_quantity = p_line.quantity then p_line.net_cents - v_prior_net
                  else least(round(p_line.net_cents::numeric * p_quantity / p_line.quantity)::bigint, p_line.net_cents - v_prior_net) end;
  else
    v_net := p_net;
  end if;
  if v_net <= 0 and not (p_quantity is not null and p_line.net_cents = 0) then
    perform private.raise_error('validation:refund_amount', jsonb_build_object('order_line_id', p_line.order_line_id));
  end if;
  if v_net > p_line.net_cents - v_prior_net then
    perform private.raise_error('validation:refund_exceeds_line', jsonb_build_object('order_line_id', p_line.order_line_id,
      'remaining_net_cents', p_line.net_cents - v_prior_net));
  end if;
  v_tax := case when v_prior_net + v_net = p_line.net_cents then p_line.tax_cents - v_prior_tax
                when p_line.net_cents = 0 then 0
                else least(round(p_line.tax_cents::numeric * v_net / p_line.net_cents)::bigint, p_line.tax_cents - v_prior_tax) end;
  return jsonb_build_object('order_line_id', p_line.order_line_id, 'quantity', p_quantity, 'net', v_net, 'tax', v_tax);
end;
$$;

-- Write a sale refund against current-revision lines of a completed order.
-- p_lines: [{order_line_id, quantity?, net_cents?}]
create function private.record_sale_refund(p_order public.orders, p_lines jsonb, p_method text, p_reason text, p_note text,
  p_external_reference text, p_return_id uuid, p_actor text, p_approver text, p_request_key uuid,
  p_paid_out_cents bigint default null, p_paid_out_method text default null)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := '[]'::jsonb;
  r record;
  v_line public.order_lines;
  v_net bigint;
  v_tax bigint;
  v_paid bigint;
  v_refunded bigint;
  v_refund public.refunds;
  v_paid_out bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  for r in select * from jsonb_to_recordset(p_lines) as x(order_line_id uuid, quantity integer, net_cents bigint) loop
    select * into v_line from public.order_lines l
    where l.order_line_id = r.order_line_id and l.order_id = p_order.order_id and l.revision = p_order.revision;
    if v_line.order_line_id is null then perform private.raise_error('validation:order_line'); end if;
    v_plan := v_plan || jsonb_build_array(private.plan_line_refund(v_line, r.quantity, r.net_cents));
  end loop;
  select coalesce(sum((e ->> 'net')::bigint), 0), coalesce(sum((e ->> 'tax')::bigint), 0) into v_net, v_tax
  from jsonb_array_elements(v_plan) e;
  if v_net + v_tax <= 0 then perform private.raise_error('validation:refund_amount'); end if;

  select coalesce(sum(t.amount_cents), 0) into v_paid from public.tenders t where t.order_id = p_order.order_id;
  select coalesce(sum(f.amount_cents), 0) into v_refunded from public.refunds f where f.order_id = p_order.order_id;
  if v_refunded + v_net + v_tax > v_paid then
    perform private.raise_error('validation:refund_exceeds_recorded_payment',
      jsonb_build_object('recorded_payment_cents', v_paid, 'already_refunded_cents', v_refunded, 'requested_cents', v_net + v_tax));
  end if;

  v_paid_out := coalesce(p_paid_out_cents, case when p_method = 'exchange_credit' then 0 else v_net + v_tax end);
  insert into public.refunds (refund_number, order_id, location_id, refund_mode, kind, method, net_cents, tax_cents, amount_cents,
    paid_out_cents, paid_out_method, reason_code, note, external_reference, return_id, recorded_by, approved_by, request_key)
  values (private.doc_number('RFD', p_order.location_id, 'private.refund_number_seq'), p_order.order_id, p_order.location_id,
    case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end, 'sale', p_method, v_net, v_tax,
    v_net + v_tax, v_paid_out, case when v_paid_out > 0 then coalesce(p_paid_out_method, p_method) end, p_reason,
    nullif(btrim(p_note), ''), nullif(btrim(p_external_reference), ''), p_return_id, p_actor, p_approver, p_request_key)
  returning * into v_refund;
  insert into public.refund_lines (refund_id, order_line_id, quantity, net_cents, tax_cents)
  select v_refund.refund_id, (e ->> 'order_line_id')::uuid, (e ->> 'quantity')::integer, (e ->> 'net')::bigint, (e ->> 'tax')::bigint
  from jsonb_array_elements(v_plan) e;
  perform private.write_audit(p_actor, 'refund.record', 'refund', v_refund.refund_id::text, p_order.location_id, p_request_key, null,
    jsonb_build_object('order_id', p_order.order_id, 'amount_cents', v_refund.amount_cents, 'method', p_method,
      'refund_mode', v_refund.refund_mode), p_note, p_approver);
  return v_refund;
end;
$$;

create function public.record_refund(p_request_key uuid, p_order_id uuid, p_lines jsonb, p_method text, p_reason_code text,
  p_note text default null, p_external_reference text default null, p_approver_employee_id text default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_approval jsonb;
  v_refund public.refunds;
begin
  v_cached := private.idem_begin(v_actor, 'record_refund', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  perform private.require_reason(p_reason_code, 'refund', p_note);
  if p_method not in ('cash', 'card_external', 'other_external') then perform private.raise_error('validation:method'); end if;
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.status <> 'completed' then
    perform private.raise_error('invalid_state:' || v_order.status || '->refund',
      jsonb_build_object('hint', 'uncompleted orders are cancelled; the cancellation records the refund'));
  end if;
  -- Refunds need owner/manager authority: a manager's own session, or an employee with a manager PIN.
  v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
  if v_approval ->> 'error' is not null then
    perform private.idem_abandon(v_actor, p_request_key);
    return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
  end if;
  v_refund := private.record_sale_refund(v_order, p_lines, p_method, p_reason_code, p_note, p_external_reference, null,
    v_actor, v_approval ->> 'approver', p_request_key);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'refund_id', v_refund.refund_id,
    'refund_number', v_refund.refund_number, 'net_cents', v_refund.net_cents, 'tax_cents', v_refund.tax_cents,
    'amount_cents', v_refund.amount_cents, 'refund_mode', v_refund.refund_mode));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelling an order that has recorded payments (replaces 0011 version)
-- The external refund of what was paid is recorded in the same transaction.
-- ---------------------------------------------------------------------------
drop function public.cancel_order(uuid, uuid, integer, text, text, text, text);

create function public.cancel_order(p_request_key uuid, p_order_id uuid, p_expected_version integer, p_reason_code text,
  p_note text default null, p_approver_employee_id text default null, p_pin text default null,
  p_refund_method text default null, p_external_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_approval jsonb;
  v_approver text;
  v_issued numeric;
  v_paid bigint;
  v_net bigint;
begin
  v_cached := private.idem_begin(v_actor, 'cancel_order', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_reason(p_reason_code, 'cancellation', p_note);

  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  if v_order.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_order.status not in ('accepted', 'preparing', 'ready') then
    perform private.raise_error('invalid_state:' || v_order.status || '->cancelled');
  end if;
  select coalesce(sum(t.amount_cents), 0) into v_paid from public.tenders t where t.order_id = p_order_id;
  if v_paid > 0 and (p_refund_method is null or p_refund_method not in ('cash', 'card_external', 'other_external')) then
    perform private.raise_error('validation:refund_method_required', jsonb_build_object('recorded_payment_cents', v_paid));
  end if;

  -- Manager approval after kitchen start, and whenever money must be refunded.
  if v_order.status <> 'accepted' or v_paid > 0 then
    v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
    if v_approval ->> 'error' is not null then
      perform private.idem_abandon(v_actor, p_request_key);
      return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
    end if;
    v_approver := v_approval ->> 'approver';
  end if;

  if v_order.status = 'accepted' then
    perform private.release_allocations(p_order_id);
  else
    perform private.release_allocations(p_order_id, 'retail');
    select coalesce(sum(c.issued_cost), 0) into v_issued
    from public.order_issue_costs c where c.order_id = p_order_id and c.purpose = 'kitchen';
    insert into public.order_cancellation_waste (order_id, location_id, business_date, reason_code, note, issued_cost, approved_by)
    values (p_order_id, v_order.location_id, private.business_date(), p_reason_code, nullif(btrim(p_note), ''), v_issued, v_approver);
  end if;

  if v_paid > 0 then
    v_net := case when v_order.total_cents = 0 then 0 else round(v_paid::numeric * v_order.net_cents / v_order.total_cents)::bigint end;
    insert into public.refunds (refund_number, order_id, location_id, refund_mode, kind, method, net_cents, tax_cents, amount_cents,
      paid_out_cents, paid_out_method, reason_code, note, external_reference, recorded_by, approved_by, request_key)
    values (private.doc_number('RFD', v_order.location_id, 'private.refund_number_seq'), p_order_id, v_order.location_id,
      v_order.tender_mode, 'cancellation', p_refund_method, v_net, v_paid - v_net, v_paid, v_paid, p_refund_method, p_reason_code,
      nullif(btrim(p_note), ''), nullif(btrim(p_external_reference), ''), v_actor, v_approver, p_request_key);
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason_code = p_reason_code,
         cancel_note = nullif(btrim(p_note), ''), cancel_approved_by = v_approver, version = version + 1
   where order_id = p_order_id;
  perform private.order_event(v_order, 'cancelled', v_order.version + 1, v_actor, v_approver, p_request_key,
    p_reason_code || coalesce(': ' || btrim(p_note), '') || case when v_paid > 0 then ' (refund recorded ' || v_paid || ' cents)' else '' end);
  return private.idem_finish(v_actor, p_request_key, private.order_result(p_order_id, jsonb_build_object('refunded_cents', v_paid)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Retail returns and custody
-- ---------------------------------------------------------------------------
create table public.returns (
  return_id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  order_id uuid not null references public.orders (order_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  reason_code text not null references public.reason_codes (code) on delete restrict,
  note text,
  processed_by text not null references public.employees (employee_id) on delete restrict,
  approved_by text not null references public.employees (employee_id) on delete restrict,
  processed_at timestamptz not null default now(),
  business_date date not null default private.business_date(),
  request_key uuid
);

alter table public.refunds add constraint refunds_return_fk foreign key (return_id) references public.returns (return_id) on delete restrict;

create table public.return_lines (
  return_line_id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns (return_id) on delete restrict,
  order_line_id uuid not null references public.order_lines (order_line_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  quantity integer not null check (quantity > 0),
  condition text not null check (condition in ('unopened_intact', 'opened', 'damaged')),
  stock_returned boolean not null,
  unit_issue_cost numeric(18, 8) not null check (unit_issue_cost >= 0)
);

-- Customer-returned goods: outside valued on-hand and availability until decided.
create table public.return_custody (
  custody_id uuid primary key default gen_random_uuid(),
  return_line_id uuid not null unique references public.return_lines (return_line_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_issue_cost numeric(18, 8) not null,
  status text not null default 'held' check (status in ('held', 'restocked', 'disposed')),
  decided_by text references public.employees (employee_id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  restock_lot_id uuid references public.lots (lot_id) on delete restrict,
  restock_movement_id uuid references public.inventory_movements (movement_id) on delete restrict
);

-- Each custody record can reverse its retail COGS at most once.
create table public.cogs_reversals (
  custody_id uuid primary key references public.return_custody (custody_id) on delete restrict,
  order_id uuid not null references public.orders (order_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  business_date date not null default private.business_date(),
  cost numeric(28, 14) not null check (cost >= 0),
  recorded_at timestamptz not null default now()
);

create table public.exchanges (
  exchange_id uuid primary key default gen_random_uuid(),
  return_id uuid not null unique references public.returns (return_id) on delete restrict,
  original_order_id uuid not null references public.orders (order_id) on delete restrict,
  new_order_id uuid not null unique references public.orders (order_id) on delete restrict,
  credit_cents bigint not null check (credit_cents >= 0),
  applied_cents bigint not null check (applied_cents >= 0),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  refunded_excess_cents bigint not null check (refunded_excess_cents >= 0),
  created_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['returns', 'return_lines', 'cogs_reversals', 'exchanges'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_update_delete()',
                   t || '_append_only', t);
  end loop;
end;
$$;

-- Validate and write a retail return (shared by returns and exchanges).
-- p_lines: [{order_line_id, quantity, condition, stock_returned?}]
create function private.write_return(p_order public.orders, p_lines jsonb, p_reason text, p_note text, p_actor text,
  p_approver text, p_request_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.return_policy;
  v_return_id uuid;
  r record;
  v_line public.order_lines;
  v_prior bigint;
  v_unit_cost numeric;
  v_return_line uuid;
begin
  perform private.require_gate('return_policy_configured');
  select * into v_policy from public.return_policy;
  if p_order.status <> 'completed' then perform private.raise_error('invalid_state:' || p_order.status || '->return'); end if;
  if private.business_date() - p_order.completed_business_date > v_policy.window_days then
    perform private.raise_error('validation:return_window_expired', jsonb_build_object('window_days', v_policy.window_days,
      'sale_date', p_order.completed_business_date));
  end if;
  perform private.require_reason(p_reason, 'return', p_note);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;

  insert into public.returns (return_number, order_id, location_id, reason_code, note, processed_by, approved_by, request_key)
  values (private.doc_number('RTN', p_order.location_id, 'private.return_number_seq'), p_order.order_id, p_order.location_id,
          p_reason, nullif(btrim(p_note), ''), p_actor, p_approver, p_request_key)
  returning return_id into v_return_id;

  for r in select * from jsonb_to_recordset(p_lines) as x(order_line_id uuid, quantity integer, condition text, stock_returned boolean) loop
    select * into v_line from public.order_lines l
    where l.order_line_id = r.order_line_id and l.order_id = p_order.order_id and l.revision = p_order.revision;
    if v_line.order_line_id is null then perform private.raise_error('validation:order_line'); end if;
    if v_line.item_type <> 'retail' then
      perform private.raise_error('validation:meals_are_refunded_not_returned', jsonb_build_object('item_id', v_line.item_id));
    end if;
    select coalesce(sum(rl.quantity), 0) into v_prior from public.return_lines rl where rl.order_line_id = v_line.order_line_id;
    if r.quantity is null or r.quantity < 1 or v_prior + r.quantity > v_line.quantity then
      perform private.raise_error('validation:return_exceeds_sold', jsonb_build_object('item_id', v_line.item_id,
        'sold', v_line.quantity, 'already_returned', v_prior));
    end if;
    if r.condition not in ('unopened_intact', 'opened', 'damaged') then perform private.raise_error('validation:condition'); end if;
    select coalesce(c.issued_cost / nullif(c.issued_qty, 0), 0) into v_unit_cost
    from public.order_issue_costs c where c.order_id = p_order.order_id and c.item_id = v_line.item_id and c.purpose = 'retail';
    insert into public.return_lines (return_id, order_line_id, item_id, quantity, condition, stock_returned, unit_issue_cost)
    values (v_return_id, v_line.order_line_id, v_line.item_id, r.quantity, r.condition, coalesce(r.stock_returned, true),
            round(coalesce(v_unit_cost, 0), 8))
    returning return_line_id into v_return_line;
    if coalesce(r.stock_returned, true) then
      insert into public.return_custody (return_line_id, location_id, item_id, quantity, unit_issue_cost)
      values (v_return_line, p_order.location_id, v_line.item_id, r.quantity, round(coalesce(v_unit_cost, 0), 8));
    end if;
  end loop;
  perform private.write_audit(p_actor, 'return.process', 'return', v_return_id::text, p_order.location_id, p_request_key, null,
    jsonb_build_object('order_id', p_order.order_id), p_note, p_approver);
  return v_return_id;
end;
$$;

-- Return retail units (original receipt = the original order; same location;
-- within the policy window) and optionally record the refund for them.
create function public.process_return(p_request_key uuid, p_order_id uuid, p_lines jsonb, p_reason_code text, p_note text default null,
  p_refund_method text default null, p_external_reference text default null, p_approver_employee_id text default null,
  p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_order public.orders := private.order_for_staff(p_order_id);
  v_cached jsonb;
  v_approval jsonb;
  v_return uuid;
  v_refund public.refunds;
begin
  v_cached := private.idem_begin(v_actor, 'process_return', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
  if v_approval ->> 'error' is not null then
    perform private.idem_abandon(v_actor, p_request_key);
    return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
  end if;
  v_return := private.write_return(v_order, p_lines, p_reason_code, p_note, v_actor, v_approval ->> 'approver', p_request_key);
  if p_refund_method is not null then
    if p_refund_method not in ('cash', 'card_external', 'other_external') then perform private.raise_error('validation:method'); end if;
    v_refund := private.record_sale_refund(v_order,
      (select jsonb_agg(jsonb_build_object('order_line_id', rl.order_line_id, 'quantity', rl.quantity))
         from public.return_lines rl where rl.return_id = v_return),
      p_refund_method, p_reason_code, p_note, p_external_reference, v_return, v_actor, v_approval ->> 'approver', p_request_key);
  end if;
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'return_id', v_return,
    'return_number', (select r.return_number from public.returns r where r.return_id = v_return),
    'refund_id', v_refund.refund_id, 'refund_amount_cents', coalesce(v_refund.amount_cents, 0)));
end;
$$;

-- Manager decision on returned goods. Restock only when the policy allows it,
-- the unit is unopened/intact and shelf-stable: restores the original issue
-- cost and reverses that retail COGS exactly once (AC15).
create function public.decide_return_custody(p_request_key uuid, p_custody_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_c public.return_custody;
  v_rl public.return_lines;
  v_item public.items;
  v_policy public.return_policy;
  v_order_id uuid;
  v_lot uuid;
  v_movement uuid;
begin
  select * into v_c from public.return_custody c where c.custody_id = p_custody_id;
  if v_c.custody_id is null then perform private.raise_error('validation:unknown_custody'); end if;
  perform private.require_location_role(v_c.location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'decide_return_custody', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_decision not in ('restock', 'dispose') then perform private.raise_error('validation:decision'); end if;
  select * into v_c from public.return_custody c where c.custody_id = p_custody_id for update;
  if v_c.status <> 'held' then perform private.raise_error('invalid_state:' || v_c.status || '->' || p_decision); end if;
  select * into v_rl from public.return_lines rl where rl.return_line_id = v_c.return_line_id;
  select r.order_id into v_order_id from public.returns r where r.return_id = v_rl.return_id;

  if p_decision = 'restock' then
    select * into v_policy from public.return_policy;
    if v_policy.singleton is null or not v_policy.allow_customer_restock then
      perform private.raise_error('forbidden:customer_restock_disabled');
    end if;
    select * into v_item from public.items i where i.item_id = v_c.item_id;
    if v_rl.condition <> 'unopened_intact' or v_item.item_type <> 'retail' or v_item.requires_use_by then
      perform private.raise_error('validation:not_resaleable', jsonb_build_object('condition', v_rl.condition));
    end if;
    perform private.require_posting_enabled();
    insert into public.lots (location_id, item_id, lot_code, source_type, source_id, created_by)
    values (v_c.location_id, v_c.item_id, 'RTN-' || left(p_custody_id::text, 8), 'return', p_custody_id, v_actor)
    returning lot_id into v_lot;
    perform private.value_incoming(v_c.location_id, v_c.item_id, v_c.quantity, v_c.unit_issue_cost);
    v_movement := private.post_movement(v_c.location_id, v_c.item_id, v_lot, 'sellable', v_c.quantity, v_c.unit_issue_cost,
      'return_restock', null, 'return_custody', p_custody_id, null, p_request_key, v_actor, v_actor);
    insert into public.cogs_reversals (custody_id, order_id, location_id, cost)
    values (p_custody_id, v_order_id, v_c.location_id, v_c.quantity * v_c.unit_issue_cost);
  elsif p_note is null or length(btrim(p_note)) < 3 then
    perform private.raise_error('validation:reason');
  end if;

  update public.return_custody
     set status = case when p_decision = 'restock' then 'restocked' else 'disposed' end, decided_by = v_actor, decided_at = now(),
         decision_note = nullif(btrim(p_note), ''), restock_lot_id = v_lot, restock_movement_id = v_movement
   where custody_id = p_custody_id;
  perform private.write_audit(v_actor, 'return_custody.' || p_decision, 'return_custody', p_custody_id::text, v_c.location_id,
    p_request_key, jsonb_build_object('status', 'held'), jsonb_build_object('status', p_decision), p_note, v_actor);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'custody_id', p_custody_id,
    'status', case when p_decision = 'restock' then 'restocked' else 'disposed' end));
end;
$$;

-- Exchange: return + replacement retail sale in one transaction (AC14).
-- The returned value is credited to the replacement order; any excess is
-- recorded as paid out by p_excess_refund_method; any shortfall stays due.
-- If replacement stock is short, nothing at all is posted.
create function public.process_exchange(p_request_key uuid, p_order_id uuid, p_return_lines jsonb, p_new_lines jsonb,
  p_reason_code text, p_note text default null, p_excess_refund_method text default null,
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
  v_approval jsonb;
  v_approver text;
  v_return uuid;
  v_refund public.refunds;
  v_today date := private.business_date();
  v_rate numeric;
  v_no integer;
  v_short text;
  v_new public.orders;
  v_credit bigint;
  v_applied bigint;
  v_excess bigint;
  v_due bigint;
  v_items text[];
begin
  v_cached := private.idem_begin(v_actor, 'process_exchange', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_order from public.orders o where o.order_id = p_order_id for update;
  v_approval := private.resolve_approval(v_actor, v_order.location_id, p_approver_employee_id, p_pin);
  if v_approval ->> 'error' is not null then
    perform private.idem_abandon(v_actor, p_request_key);
    return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
  end if;
  v_approver := v_approval ->> 'approver';
  perform private.require_gate('menu_prices_confirmed', v_order.location_id);
  perform private.require_gate('tax_rate_confirmed', v_order.location_id);
  if p_new_lines is null or jsonb_typeof(p_new_lines) <> 'array' or jsonb_array_length(p_new_lines) = 0
     or exists (select 1 from jsonb_array_elements(p_new_lines) e join public.items i on i.item_id = e ->> 'item_id' where i.item_type <> 'retail') then
    perform private.raise_error('validation:exchange_retail_only');
  end if;

  -- 1. Return the original units into custody and credit their value.
  v_return := private.write_return(v_order, p_return_lines, p_reason_code, p_note, v_actor, v_approver, p_request_key);

  -- 2. Replacement sale: priced, taxed and reserved like any order (raises → full rollback).
  v_rate := private.current_tax_rate(v_order.location_id, v_today);
  v_no := private.next_order_number(v_order.location_id, v_today);
  select l.short_code into v_short from public.locations l where l.location_id = v_order.location_id;
  insert into public.orders (order_number, location_id, business_date, pickup_code, status, customer_id, pickup_name, note,
    tender_mode, tax_rate, accepted_by, provenance)
  values (v_short || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0'), v_order.location_id, v_today,
    v_short || '-' || lpad(v_no::text, 4, '0'), 'accepted', v_order.customer_id, v_order.pickup_name,
    'Exchange for ' || v_order.order_number, v_order.tender_mode, v_rate, v_actor, v_order.provenance)
  returning * into v_new;
  perform private.build_order_revision(v_new.order_id, v_new.location_id, 1, p_new_lines, 0, v_rate);
  perform private.reserve_order(v_new.order_id, v_new.location_id, 1);
  select * into v_new from public.orders o where o.order_id = v_new.order_id;
  insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, approver_employee_id, request_key, note)
  values (v_new.order_id, null, 'accepted', 1, v_actor, v_approver, p_request_key, 'exchange for ' || v_order.order_number);

  -- 3. Credit: the returned units' original net + tax.
  select coalesce(sum(p.net + p.tax), 0) into v_credit
  from (select (private.plan_line_refund(ol, rl.quantity, null) ->> 'net')::bigint net,
               (private.plan_line_refund(ol, rl.quantity, null) ->> 'tax')::bigint tax
        from public.return_lines rl join public.order_lines ol on ol.order_line_id = rl.order_line_id
        where rl.return_id = v_return) p;
  v_applied := least(v_credit, v_new.total_cents);
  v_excess := v_credit - v_applied;
  if v_excess > 0 and (p_excess_refund_method is null or p_excess_refund_method not in ('cash', 'card_external', 'other_external')) then
    perform private.raise_error('validation:excess_refund_method_required', jsonb_build_object('excess_cents', v_excess));
  end if;
  v_refund := private.record_sale_refund(v_order,
    (select jsonb_agg(jsonb_build_object('order_line_id', rl.order_line_id, 'quantity', rl.quantity))
       from public.return_lines rl where rl.return_id = v_return),
    'exchange_credit', p_reason_code, p_note, null, v_return, v_actor, v_approver, p_request_key, v_excess, p_excess_refund_method);
  if v_applied > 0 then
    insert into public.tenders (order_id, location_id, tender_type, method, amount_cents, external_reference, recorded_by, request_key)
    values (v_new.order_id, v_new.location_id, v_new.tender_mode, 'exchange_credit', v_applied, v_refund.refund_number, v_actor, p_request_key);
  end if;
  v_due := v_new.total_cents - v_applied;

  -- 4. Retail-only replacement is ready immediately; hand over now if nothing is due.
  update public.orders set status = 'ready', ready_at = now(), version = version + 1 where order_id = v_new.order_id;
  insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, request_key)
  values (v_new.order_id, 'accepted', 'ready', 2, v_actor, p_request_key);
  if v_due = 0 then
    select array_agg(distinct a.item_id order by a.item_id) into v_items
    from public.reservation_allocations a where a.order_id = v_new.order_id and a.status = 'active';
    perform private.lock_stock(v_new.location_id, v_items);
    perform private.consume_allocations(v_new.order_id, v_new.location_id, 'retail', p_request_key, v_actor);
    update public.orders set status = 'completed', completed_at = now(), completed_by = v_actor,
           completed_business_date = v_today, version = version + 1
     where order_id = v_new.order_id;
    insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, request_key)
    values (v_new.order_id, 'ready', 'completed', 3, v_actor, p_request_key);
  end if;

  insert into public.exchanges (return_id, original_order_id, new_order_id, credit_cents, applied_cents, amount_due_cents,
    refunded_excess_cents, created_by)
  values (v_return, p_order_id, v_new.order_id, v_credit, v_applied, v_due, v_excess, v_actor);
  perform private.write_audit(v_actor, 'exchange.process', 'order', v_new.order_id::text, v_new.location_id, p_request_key, null,
    jsonb_build_object('original_order_id', p_order_id, 'credit_cents', v_credit, 'amount_due_cents', v_due,
      'refunded_excess_cents', v_excess), p_note, v_approver);
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true, 'return_id', v_return,
    'new_order', private.order_result(v_new.order_id), 'credit_cents', v_credit, 'applied_cents', v_applied,
    'amount_due_cents', v_due, 'refunded_excess_cents', v_excess));
end;
$$;

-- Lookup for the returns screen: an order's current lines with what remains refundable/returnable.
create function public.get_order_for_return(p_location_id text, p_lookup text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  select * into v_order from public.orders o
  where o.location_id = p_location_id and (upper(o.order_number) = upper(btrim(p_lookup)) or upper(o.pickup_code) = upper(btrim(p_lookup)))
  order by o.accepted_at desc limit 1;
  if v_order.order_id is null then return null; end if;
  return jsonb_build_object(
    'order', private.order_result(v_order.order_id) || jsonb_build_object('completed_business_date', v_order.completed_business_date,
      'customer_id', v_order.customer_id, 'pickup_name', v_order.pickup_name),
    'return_window_days', (select p.window_days from public.return_policy p),
    'refunded_cents', (select coalesce(sum(f.amount_cents), 0) from public.refunds f where f.order_id = v_order.order_id),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_line_id', l.order_line_id, 'line_no', l.line_no, 'item_id', l.item_id, 'name', i.name, 'item_type', l.item_type,
        'quantity', l.quantity, 'net_cents', l.net_cents, 'tax_cents', l.tax_cents,
        'refunded_quantity', (select coalesce(sum(rl.quantity), 0) from public.refund_lines rl where rl.order_line_id = l.order_line_id),
        'refunded_net_cents', (select coalesce(sum(rl.net_cents), 0) from public.refund_lines rl where rl.order_line_id = l.order_line_id),
        'returned_quantity', (select coalesce(sum(r.quantity), 0) from public.return_lines r where r.order_line_id = l.order_line_id))
        order by l.line_no)
      from public.order_lines l join public.items i on i.item_id = l.item_id
      where l.order_id = v_order.order_id and l.revision = v_order.revision), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants: refunds/returns are financial reversals (owner/manager only)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['return_policy', 'refunds', 'refund_lines', 'returns', 'return_lines', 'return_custody',
                           'cogs_reversals', 'exchanges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy return_policy_read on public.return_policy for select to authenticated using (true);
create policy refunds_read on public.refunds for select to authenticated using (location_id in (select private.managed_location_ids()));
create policy refund_lines_read on public.refund_lines for select to authenticated
  using (exists (select 1 from public.refunds f where f.refund_id = refund_lines.refund_id and f.location_id in (select private.managed_location_ids())));
create policy returns_read on public.returns for select to authenticated using (location_id in (select private.managed_location_ids()));
create policy return_lines_read on public.return_lines for select to authenticated
  using (exists (select 1 from public.returns r where r.return_id = return_lines.return_id and r.location_id in (select private.managed_location_ids())));
create policy return_custody_read on public.return_custody for select to authenticated using (location_id in (select private.managed_location_ids()));
create policy cogs_reversals_read on public.cogs_reversals for select to authenticated using (location_id in (select private.managed_location_ids()));
create policy exchanges_read on public.exchanges for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = exchanges.new_order_id and o.location_id in (select private.managed_location_ids())));

grant execute on function
  public.set_return_policy(uuid, integer, boolean),
  public.record_refund(uuid, uuid, jsonb, text, text, text, text, text, text),
  public.cancel_order(uuid, uuid, integer, text, text, text, text, text, text),
  public.process_return(uuid, uuid, jsonb, text, text, text, text, text, text),
  public.decide_return_custody(uuid, uuid, text, text),
  public.process_exchange(uuid, uuid, jsonb, jsonb, text, text, text, text, text),
  public.get_order_for_return(text, text)
to authenticated;

-- 0017 Supplier invoices, receipt matching, payments, credits and reversals (PRD §9; AC18, AC19, AC17 AP part)
-- Invoices are accounts-payable records only: they never post stock movements
-- or change weighted-average cost. Variances against receipts are shown and
-- must be accepted by a manager before payment; they are never revalued.
-- Payments and credits record money handled outside the app; corrections are
-- linked reversals, never edits.

create sequence private.ap_number_seq;

create table public.supplier_invoices (
  invoice_id uuid primary key default gen_random_uuid(),
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 60),
  invoice_date date not null,
  due_date date not null,
  due_date_source text not null check (due_date_source in ('supplier_terms', 'entered')),
  terms_days_snapshot integer,
  revision integer not null default 1 check (revision > 0),
  version integer not null default 1 check (version > 0),
  lines_cents bigint not null check (lines_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  other_cents bigint not null default 0 check (other_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  has_discrepancy boolean not null,
  discrepancy_accepted_revision integer,
  discrepancy_accepted_by text references public.employees (employee_id) on delete restrict,
  discrepancy_accepted_at timestamptz,
  discrepancy_note text,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'void')),
  record_mode text not null check (record_mode in ('SIMULATED', 'MANUAL_EXTERNAL')),
  note text,
  created_by text not null references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_by text references public.employees (employee_id) on delete restrict,
  voided_at timestamptz,
  void_reason text,
  provenance text not null default 'operational',
  constraint supplier_invoices_total check (total_cents = lines_cents + tax_cents + other_cents),
  constraint supplier_invoices_due check (due_date >= invoice_date),
  constraint supplier_invoices_void check ((status = 'void') = (voided_at is not null))
);

-- A new request key never bypasses the normalized invoice number (PRD §9, AC18).
create unique index supplier_invoices_number_unique on public.supplier_invoices (supplier_id, lower(btrim(invoice_number)));
create index supplier_invoices_loc_status on public.supplier_invoices (location_id, status);

-- One row per line per invoice revision; edits add a new revision (old lines stay traceable).
create table public.supplier_invoice_lines (
  invoice_line_id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices (invoice_id) on delete restrict,
  revision integer not null,
  line_no integer not null check (line_no > 0),
  receipt_line_id uuid references public.receipt_lines (receipt_line_id) on delete restrict,
  item_id text references public.items (item_id) on delete restrict,
  description text,
  quantity numeric(18, 6) not null check (quantity > 0),
  unit_price numeric(18, 8) not null check (unit_price >= 0),
  line_cents bigint not null check (line_cents >= 0),
  received_qty numeric(18, 6),
  receipt_unit_cost numeric(18, 8),
  qty_variance numeric(18, 6),
  price_variance_cents bigint,
  discrepancy text check (discrepancy in ('unmatched', 'quantity', 'price', 'quantity_and_price')),
  unique (invoice_id, revision, line_no),
  constraint supplier_invoice_lines_desc check (item_id is not null or description is not null)
);

create table public.supplier_payments (
  payment_id uuid primary key default gen_random_uuid(),
  payment_number text not null unique,
  invoice_id uuid not null references public.supplier_invoices (invoice_id) on delete restrict,
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('check', 'ach_external', 'card_external', 'cash', 'other_external')),
  paid_on date not null,
  record_mode text not null check (record_mode in ('SIMULATED', 'MANUAL_EXTERNAL')),
  external_reference text,
  note text,
  recorded_by text not null references public.employees (employee_id) on delete restrict,
  recorded_at timestamptz not null default now(),
  request_key uuid
);

create table public.supplier_credits (
  credit_id uuid primary key default gen_random_uuid(),
  credit_number text not null unique,
  invoice_id uuid not null references public.supplier_invoices (invoice_id) on delete restrict,
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  credit_memo_ref text,
  reason text not null check (length(btrim(reason)) >= 3),
  credited_on date not null,
  recorded_by text not null references public.employees (employee_id) on delete restrict,
  recorded_at timestamptz not null default now(),
  request_key uuid
);

-- Linked reversals: each payment or credit can be reversed exactly once.
create table public.supplier_payment_reversals (
  payment_id uuid primary key references public.supplier_payments (payment_id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 3),
  reversed_by text not null references public.employees (employee_id) on delete restrict,
  reversed_at timestamptz not null default now(),
  request_key uuid
);

create table public.supplier_credit_reversals (
  credit_id uuid primary key references public.supplier_credits (credit_id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 3),
  reversed_by text not null references public.employees (employee_id) on delete restrict,
  reversed_at timestamptz not null default now(),
  request_key uuid
);

do $$
declare
  t text;
begin
  foreach t in array array['supplier_invoice_lines', 'supplier_payments', 'supplier_credits', 'supplier_payment_reversals',
                           'supplier_credit_reversals'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.forbid_update_delete()',
                   t || '_append_only', t);
  end loop;
end;
$$;

create trigger supplier_invoices_no_delete before delete on public.supplier_invoices
  for each row execute function private.forbid_update_delete();
create trigger supplier_invoices_no_synthetic_in_pilot before insert or update on public.supplier_invoices
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.invoice_applied_cents(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paid', coalesce((select sum(p.amount_cents) from public.supplier_payments p
                      where p.invoice_id = p_invoice_id
                        and not exists (select 1 from public.supplier_payment_reversals r where r.payment_id = p.payment_id)), 0),
    'credited', coalesce((select sum(c.amount_cents) from public.supplier_credits c
                          where c.invoice_id = p_invoice_id
                            and not exists (select 1 from public.supplier_credit_reversals r where r.credit_id = c.credit_id)), 0));
$$;

create function private.refresh_invoice_status(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.supplier_invoices;
  v_applied jsonb := private.invoice_applied_cents(p_invoice_id);
  v_total_applied bigint;
  v_status text;
begin
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id;
  if v_inv.status = 'void' then return 'void'; end if;
  v_total_applied := (v_applied ->> 'paid')::bigint + (v_applied ->> 'credited')::bigint;
  v_status := case when v_total_applied = 0 and v_inv.total_cents > 0 then 'open'
                   when v_total_applied >= v_inv.total_cents then 'paid'
                   else 'partially_paid' end;
  update public.supplier_invoices set status = v_status, version = version + 1 where invoice_id = p_invoice_id;
  return v_status;
end;
$$;

-- Write one revision of invoice lines, matching receipt lines where given.
-- p_lines: [{receipt_line_id?, item_id?, description?, quantity, unit_price, line_cents?}]
-- Returns {lines_cents, has_discrepancy}.
create function private.write_invoice_lines(p_invoice public.supplier_invoices, p_revision integer, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_no integer := 0;
  v_rl public.receipt_lines;
  v_rc public.receipts;
  v_line_cents bigint;
  v_prior numeric;
  v_qty_var numeric;
  v_price_var bigint;
  v_disc text;
  v_total bigint := 0;
  v_any boolean := false;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    perform private.raise_error('validation:lines');
  end if;
  for r in select * from jsonb_to_recordset(p_lines) as x(receipt_line_id uuid, item_id text, description text,
                                                           quantity numeric, unit_price numeric, line_cents bigint) loop
    v_no := v_no + 1;
    if r.quantity is null or r.quantity <= 0 or r.quantity <> round(r.quantity, 6) then
      perform private.raise_error('validation:quantity', jsonb_build_object('line_no', v_no));
    end if;
    if r.unit_price is null or r.unit_price < 0 or r.unit_price <> round(r.unit_price, 8) then
      perform private.raise_error('validation:unit_price', jsonb_build_object('line_no', v_no));
    end if;
    v_line_cents := coalesce(r.line_cents, round(r.quantity * r.unit_price * 100)::bigint);
    if v_line_cents < 0 then perform private.raise_error('validation:line_cents', jsonb_build_object('line_no', v_no)); end if;
    v_rl := null; v_rc := null; v_qty_var := null; v_price_var := null; v_disc := null;
    if r.receipt_line_id is not null then
      select * into v_rl from public.receipt_lines l where l.receipt_line_id = r.receipt_line_id;
      select * into v_rc from public.receipts c where c.receipt_id = v_rl.receipt_id;
      if v_rl.receipt_line_id is null or v_rc.supplier_id <> p_invoice.supplier_id or v_rc.location_id <> p_invoice.location_id then
        perform private.raise_error('validation:receipt_line_mismatch', jsonb_build_object('line_no', v_no,
          'rule', 'receipt line must be from the same supplier and location'));
      end if;
      if r.item_id is not null and r.item_id <> v_rl.item_id then
        perform private.raise_error('validation:receipt_line_item', jsonb_build_object('line_no', v_no));
      end if;
      -- Quantity already invoiced for this receipt line on other live invoices.
      select coalesce(sum(il.quantity), 0) into v_prior
      from public.supplier_invoice_lines il join public.supplier_invoices i on i.invoice_id = il.invoice_id
      where il.receipt_line_id = v_rl.receipt_line_id and il.revision = i.revision and i.status <> 'void'
        and i.invoice_id <> p_invoice.invoice_id;
      v_qty_var := v_prior + r.quantity - v_rl.base_quantity;
      v_price_var := v_line_cents - round(r.quantity * v_rl.unit_cost * 100)::bigint;
      v_disc := case when v_qty_var <> 0 and v_price_var <> 0 then 'quantity_and_price'
                     when v_qty_var <> 0 then 'quantity'
                     when v_price_var <> 0 then 'price' end;
    elsif r.item_id is not null then
      -- An item invoiced without a matching receipt line is a discrepancy;
      -- description-only charges (freight, fees) are not.
      v_disc := 'unmatched';
    end if;
    v_any := v_any or v_disc is not null;
    insert into public.supplier_invoice_lines (invoice_id, revision, line_no, receipt_line_id, item_id, description, quantity,
      unit_price, line_cents, received_qty, receipt_unit_cost, qty_variance, price_variance_cents, discrepancy)
    values (p_invoice.invoice_id, p_revision, v_no, r.receipt_line_id, coalesce(r.item_id, v_rl.item_id),
      nullif(btrim(r.description), ''), r.quantity, r.unit_price, v_line_cents, v_rl.base_quantity, v_rl.unit_cost,
      v_qty_var, v_price_var, v_disc);
    v_total := v_total + v_line_cents;
  end loop;
  return jsonb_build_object('lines_cents', v_total, 'has_discrepancy', v_any);
end;
$$;

create function private.invoice_result(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'invoice_id', i.invoice_id, 'invoice_number', i.invoice_number, 'status', i.status,
    'version', i.version, 'revision', i.revision, 'total_cents', i.total_cents, 'due_date', i.due_date,
    'has_discrepancy', i.has_discrepancy,
    'discrepancy_accepted', i.has_discrepancy and coalesce(i.discrepancy_accepted_revision = i.revision, false),
    'paid_cents', (private.invoice_applied_cents(i.invoice_id) ->> 'paid')::bigint,
    'credited_cents', (private.invoice_applied_cents(i.invoice_id) ->> 'credited')::bigint,
    'balance_cents', i.total_cents - (private.invoice_applied_cents(i.invoice_id) ->> 'paid')::bigint
                     - (private.invoice_applied_cents(i.invoice_id) ->> 'credited')::bigint)
  from public.supplier_invoices i where i.invoice_id = p_invoice_id;
$$;

create function private.invoice_for_manager(p_invoice_id uuid)
returns public.supplier_invoices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.supplier_invoices;
begin
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id;
  if v_inv.invoice_id is null then perform private.raise_error('validation:unknown_invoice'); end if;
  perform private.require_location_role(v_inv.location_id, array['manager']);
  return v_inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create function public.create_supplier_invoice(p_request_key uuid, p_location_id text, p_supplier_id text, p_invoice_number text,
  p_invoice_date date, p_lines jsonb, p_tax_cents bigint default 0, p_other_cents bigint default 0,
  p_due_date date default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_supplier public.suppliers;
  v_inv public.supplier_invoices;
  v_lines jsonb;
  v_due date;
  v_source text;
  v_terms_ok boolean;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'create_supplier_invoice', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();

  select * into v_supplier from public.suppliers s where s.supplier_id = p_supplier_id and s.archived_at is null;
  if v_supplier.supplier_id is null then perform private.raise_error('validation:unknown_supplier'); end if;
  if p_invoice_number is null or length(btrim(p_invoice_number)) = 0 then perform private.raise_error('validation:invoice_number'); end if;
  if p_invoice_date is null or p_invoice_date > private.business_date() then
    perform private.raise_error('validation:invoice_date', jsonb_build_object('rule', 'required, not in the future'));
  end if;
  if coalesce(p_tax_cents, 0) < 0 or coalesce(p_other_cents, 0) < 0 then perform private.raise_error('validation:amount'); end if;
  if exists (select 1 from public.supplier_invoices i
             where i.supplier_id = p_supplier_id and lower(btrim(i.invoice_number)) = lower(btrim(p_invoice_number))) then
    perform private.raise_error('duplicate_business_key:invoice_number');
  end if;

  -- Due date defaults from supplier terms only once that supplier's master data is verified (pilot gate).
  v_terms_ok := v_supplier.payment_terms_days is not null and (private.data_mode() = 'demo' or exists (
    select 1 from public.pilot_setup_gates g where g.gate_key = 'supplier_master_verified' and g.scope_id = p_supplier_id
      and g.status = 'confirmed'));
  if p_due_date is not null then
    v_due := p_due_date; v_source := 'entered';
  elsif v_terms_ok then
    v_due := p_invoice_date + v_supplier.payment_terms_days; v_source := 'supplier_terms';
  else
    perform private.raise_error('validation:due_date_required',
      jsonb_build_object('reason', 'supplier terms are not verified; enter the due date from the invoice'));
  end if;
  if v_due < p_invoice_date then perform private.raise_error('validation:due_date'); end if;

  begin
    insert into public.supplier_invoices (supplier_id, location_id, invoice_number, invoice_date, due_date, due_date_source,
      terms_days_snapshot, lines_cents, tax_cents, other_cents, total_cents, has_discrepancy, record_mode, note, created_by, provenance)
    values (p_supplier_id, p_location_id, btrim(p_invoice_number), p_invoice_date, v_due, v_source,
      case when v_source = 'supplier_terms' then v_supplier.payment_terms_days end, 0, coalesce(p_tax_cents, 0),
      coalesce(p_other_cents, 0), coalesce(p_tax_cents, 0) + coalesce(p_other_cents, 0), false,
      case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end, nullif(btrim(p_note), ''), v_actor,
      case when private.data_mode() = 'demo' then 'demo_operational' else 'operational' end)
    returning * into v_inv;
  exception when unique_violation then
    perform private.raise_error('duplicate_business_key:invoice_number');
  end;
  v_lines := private.write_invoice_lines(v_inv, 1, p_lines);
  update public.supplier_invoices
     set lines_cents = (v_lines ->> 'lines_cents')::bigint,
         total_cents = (v_lines ->> 'lines_cents')::bigint + tax_cents + other_cents,
         has_discrepancy = (v_lines ->> 'has_discrepancy')::boolean
   where invoice_id = v_inv.invoice_id;
  perform private.write_audit(v_actor, 'supplier_invoice.create', 'supplier_invoice', v_inv.invoice_id::text, p_location_id,
    p_request_key, null, jsonb_build_object('invoice_number', v_inv.invoice_number, 'supplier_id', p_supplier_id,
      'total_cents', (v_lines ->> 'lines_cents')::bigint + v_inv.tax_cents + v_inv.other_cents), p_note);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(v_inv.invoice_id));
end;
$$;

-- Edit = new line revision (old revision stays for traceability). Never
-- touches stock or cost; any earlier discrepancy acceptance lapses.
create function public.revise_supplier_invoice(p_request_key uuid, p_invoice_id uuid, p_expected_version integer, p_lines jsonb,
  p_tax_cents bigint default 0, p_other_cents bigint default 0, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
  v_cached jsonb;
  v_lines jsonb;
  v_applied jsonb;
  v_total bigint;
begin
  v_cached := private.idem_begin(v_actor, 'revise_supplier_invoice', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id for update;
  if v_inv.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_inv.status = 'void' then perform private.raise_error('invalid_state:void->revise'); end if;
  if coalesce(p_tax_cents, 0) < 0 or coalesce(p_other_cents, 0) < 0 then perform private.raise_error('validation:amount'); end if;
  if p_note is null or length(btrim(p_note)) < 3 then perform private.raise_error('validation:note_required'); end if;
  v_lines := private.write_invoice_lines(v_inv, v_inv.revision + 1, p_lines);
  v_total := (v_lines ->> 'lines_cents')::bigint + coalesce(p_tax_cents, 0) + coalesce(p_other_cents, 0);
  v_applied := private.invoice_applied_cents(p_invoice_id);
  if v_total < (v_applied ->> 'paid')::bigint + (v_applied ->> 'credited')::bigint then
    perform private.raise_error('validation:total_below_applied', jsonb_build_object('applied_cents',
      (v_applied ->> 'paid')::bigint + (v_applied ->> 'credited')::bigint));
  end if;
  update public.supplier_invoices
     set revision = revision + 1, version = version + 1, lines_cents = (v_lines ->> 'lines_cents')::bigint,
         tax_cents = coalesce(p_tax_cents, 0), other_cents = coalesce(p_other_cents, 0), total_cents = v_total,
         has_discrepancy = (v_lines ->> 'has_discrepancy')::boolean
   where invoice_id = p_invoice_id;
  perform private.refresh_invoice_status(p_invoice_id);
  perform private.write_audit(v_actor, 'supplier_invoice.revise', 'supplier_invoice', p_invoice_id::text, v_inv.location_id,
    p_request_key, jsonb_build_object('revision', v_inv.revision, 'total_cents', v_inv.total_cents),
    jsonb_build_object('revision', v_inv.revision + 1, 'total_cents', v_total), p_note);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(p_invoice_id));
end;
$$;

create function public.accept_invoice_discrepancy(p_request_key uuid, p_invoice_id uuid, p_expected_version integer, p_note text,
  p_approver_employee_id text default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
  v_cached jsonb;
  v_approval jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'accept_invoice_discrepancy', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id for update;
  if v_inv.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_inv.status = 'void' or not v_inv.has_discrepancy then
    perform private.raise_error('invalid_state:no_open_discrepancy');
  end if;
  if p_note is null or length(btrim(p_note)) < 3 then perform private.raise_error('validation:note_required'); end if;
  v_approval := private.resolve_approval(v_actor, v_inv.location_id, p_approver_employee_id, p_pin);
  if v_approval ->> 'error' is not null then
    perform private.idem_abandon(v_actor, p_request_key);
    return jsonb_build_object('ok', false, 'error', v_approval ->> 'error');
  end if;
  update public.supplier_invoices
     set discrepancy_accepted_revision = revision, discrepancy_accepted_by = v_approval ->> 'approver',
         discrepancy_accepted_at = now(), discrepancy_note = btrim(p_note), version = version + 1
   where invoice_id = p_invoice_id;
  perform private.write_audit(v_actor, 'supplier_invoice.accept_discrepancy', 'supplier_invoice', p_invoice_id::text,
    v_inv.location_id, p_request_key, null, jsonb_build_object('revision', v_inv.revision), p_note, v_approval ->> 'approver');
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(p_invoice_id));
end;
$$;

create function public.record_supplier_payment(p_request_key uuid, p_invoice_id uuid, p_amount_cents bigint, p_method text,
  p_paid_on date default null, p_external_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
  v_cached jsonb;
  v_applied jsonb;
  v_balance bigint;
  v_payment public.supplier_payments;
begin
  v_cached := private.idem_begin(v_actor, 'record_supplier_payment', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id for update;
  if v_inv.status = 'void' then perform private.raise_error('invalid_state:void->payment'); end if;
  if v_inv.has_discrepancy and v_inv.discrepancy_accepted_revision is distinct from v_inv.revision then
    perform private.raise_error('invalid_state:discrepancy_not_accepted');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then perform private.raise_error('validation:amount'); end if;
  if p_method is null or p_method not in ('check', 'ach_external', 'card_external', 'cash', 'other_external') then
    perform private.raise_error('validation:method');
  end if;
  if p_paid_on is not null and (p_paid_on > private.business_date() or p_paid_on < v_inv.invoice_date - 30) then
    perform private.raise_error('validation:paid_on', jsonb_build_object('rule', 'not in the future'));
  end if;
  v_applied := private.invoice_applied_cents(p_invoice_id);
  v_balance := v_inv.total_cents - (v_applied ->> 'paid')::bigint - (v_applied ->> 'credited')::bigint;
  if p_amount_cents > v_balance then
    perform private.raise_error('validation:overpayment', jsonb_build_object('balance_cents', v_balance));
  end if;
  insert into public.supplier_payments (payment_number, invoice_id, supplier_id, location_id, amount_cents, method, paid_on,
    record_mode, external_reference, note, recorded_by, request_key)
  values (private.doc_number('SPY', v_inv.location_id, 'private.ap_number_seq'), p_invoice_id, v_inv.supplier_id,
    v_inv.location_id, p_amount_cents, p_method, coalesce(p_paid_on, private.business_date()),
    case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end,
    nullif(btrim(p_external_reference), ''), nullif(btrim(p_note), ''), v_actor, p_request_key)
  returning * into v_payment;
  perform private.refresh_invoice_status(p_invoice_id);
  perform private.write_audit(v_actor, 'supplier_payment.record', 'supplier_payment', v_payment.payment_id::text,
    v_inv.location_id, p_request_key, null, jsonb_build_object('invoice_id', p_invoice_id, 'amount_cents', p_amount_cents,
      'method', p_method, 'record_mode', v_payment.record_mode), p_note);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(p_invoice_id)
    || jsonb_build_object('payment_id', v_payment.payment_id, 'payment_number', v_payment.payment_number,
                          'record_mode', v_payment.record_mode));
end;
$$;

create function public.reverse_supplier_payment(p_request_key uuid, p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_payment public.supplier_payments;
  v_inv public.supplier_invoices;
begin
  select * into v_payment from public.supplier_payments p where p.payment_id = p_payment_id;
  if v_payment.payment_id is null then perform private.raise_error('validation:unknown_payment'); end if;
  v_inv := private.invoice_for_manager(v_payment.invoice_id);
  v_cached := private.idem_begin(v_actor, 'reverse_supplier_payment', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  perform 1 from public.supplier_invoices i where i.invoice_id = v_payment.invoice_id for update;
  if exists (select 1 from public.supplier_payment_reversals r where r.payment_id = p_payment_id) then
    perform private.raise_error('invalid_state:already_reversed');
  end if;
  insert into public.supplier_payment_reversals (payment_id, reason, reversed_by, request_key)
  values (p_payment_id, btrim(p_reason), v_actor, p_request_key);
  perform private.refresh_invoice_status(v_payment.invoice_id);
  perform private.write_audit(v_actor, 'supplier_payment.reverse', 'supplier_payment', p_payment_id::text, v_inv.location_id,
    p_request_key, jsonb_build_object('amount_cents', v_payment.amount_cents), jsonb_build_object('reversed', true), p_reason);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(v_payment.invoice_id));
end;
$$;

create function public.record_supplier_credit(p_request_key uuid, p_invoice_id uuid, p_amount_cents bigint, p_reason text,
  p_credit_memo_ref text default null, p_credited_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
  v_cached jsonb;
  v_applied jsonb;
  v_balance bigint;
  v_credit public.supplier_credits;
begin
  v_cached := private.idem_begin(v_actor, 'record_supplier_credit', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id for update;
  if v_inv.status = 'void' then perform private.raise_error('invalid_state:void->credit'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then perform private.raise_error('validation:amount'); end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  if p_credited_on is not null and p_credited_on > private.business_date() then perform private.raise_error('validation:credited_on'); end if;
  v_applied := private.invoice_applied_cents(p_invoice_id);
  v_balance := v_inv.total_cents - (v_applied ->> 'paid')::bigint - (v_applied ->> 'credited')::bigint;
  if p_amount_cents > v_balance then
    perform private.raise_error('validation:credit_exceeds_balance', jsonb_build_object('balance_cents', v_balance));
  end if;
  insert into public.supplier_credits (credit_number, invoice_id, supplier_id, location_id, amount_cents, credit_memo_ref, reason,
    credited_on, recorded_by, request_key)
  values (private.doc_number('SCR', v_inv.location_id, 'private.ap_number_seq'), p_invoice_id, v_inv.supplier_id, v_inv.location_id,
    p_amount_cents, nullif(btrim(p_credit_memo_ref), ''), btrim(p_reason), coalesce(p_credited_on, private.business_date()),
    v_actor, p_request_key)
  returning * into v_credit;
  perform private.refresh_invoice_status(p_invoice_id);
  perform private.write_audit(v_actor, 'supplier_credit.record', 'supplier_credit', v_credit.credit_id::text, v_inv.location_id,
    p_request_key, null, jsonb_build_object('invoice_id', p_invoice_id, 'amount_cents', p_amount_cents), p_reason);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(p_invoice_id)
    || jsonb_build_object('credit_id', v_credit.credit_id, 'credit_number', v_credit.credit_number));
end;
$$;

create function public.reverse_supplier_credit(p_request_key uuid, p_credit_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_credit public.supplier_credits;
  v_inv public.supplier_invoices;
begin
  select * into v_credit from public.supplier_credits c where c.credit_id = p_credit_id;
  if v_credit.credit_id is null then perform private.raise_error('validation:unknown_credit'); end if;
  v_inv := private.invoice_for_manager(v_credit.invoice_id);
  v_cached := private.idem_begin(v_actor, 'reverse_supplier_credit', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  perform 1 from public.supplier_invoices i where i.invoice_id = v_credit.invoice_id for update;
  if exists (select 1 from public.supplier_credit_reversals r where r.credit_id = p_credit_id) then
    perform private.raise_error('invalid_state:already_reversed');
  end if;
  insert into public.supplier_credit_reversals (credit_id, reason, reversed_by, request_key)
  values (p_credit_id, btrim(p_reason), v_actor, p_request_key);
  perform private.refresh_invoice_status(v_credit.invoice_id);
  perform private.write_audit(v_actor, 'supplier_credit.reverse', 'supplier_credit', p_credit_id::text, v_inv.location_id,
    p_request_key, jsonb_build_object('amount_cents', v_credit.amount_cents), jsonb_build_object('reversed', true), p_reason);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(v_credit.invoice_id));
end;
$$;

-- Void an invoice entered in error. Only while nothing is applied to it
-- (reverse payments and credits first). The number stays reserved.
create function public.void_supplier_invoice(p_request_key uuid, p_invoice_id uuid, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
  v_cached jsonb;
  v_applied jsonb;
begin
  v_cached := private.idem_begin(v_actor, 'void_supplier_invoice', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();
  select * into v_inv from public.supplier_invoices i where i.invoice_id = p_invoice_id for update;
  if v_inv.version <> p_expected_version then perform private.raise_error('conflict:stale_version'); end if;
  if v_inv.status = 'void' then perform private.raise_error('invalid_state:void->void'); end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  v_applied := private.invoice_applied_cents(p_invoice_id);
  if (v_applied ->> 'paid')::bigint + (v_applied ->> 'credited')::bigint > 0 then
    perform private.raise_error('invalid_state:payments_or_credits_applied');
  end if;
  update public.supplier_invoices
     set status = 'void', voided_by = v_actor, voided_at = now(), void_reason = btrim(p_reason), version = version + 1
   where invoice_id = p_invoice_id;
  perform private.write_audit(v_actor, 'supplier_invoice.void', 'supplier_invoice', p_invoice_id::text, v_inv.location_id,
    p_request_key, jsonb_build_object('status', v_inv.status), jsonb_build_object('status', 'void'), p_reason);
  return private.idem_finish(v_actor, p_request_key, private.invoice_result(p_invoice_id));
end;
$$;

-- Accounts-payable view: balances and overdue status from the due date and
-- the local (America/Denver) business date.
create function public.get_supplier_invoices(p_location_ids text[] default null, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_managed text[] := array(select private.managed_location_ids());
  v_targets text[];
begin
  perform private.require_actor();
  if cardinality(v_managed) = 0 then perform private.raise_error('unauthorized'); end if;
  v_targets := coalesce(p_location_ids, v_managed);
  if not (v_targets <@ v_managed) then
    perform private.raise_error('unauthorized', jsonb_build_object('reason', 'location_not_managed'));
  end if;
  return jsonb_build_object('business_date', v_today, 'timezone', 'America/Denver', 'currency', 'USD',
    'record_mode', case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end,
    'refreshed_at', now(),
    'invoices', coalesce((
      select jsonb_agg(x.j order by x.due_date, x.invoice_number) from (
        select i.due_date, i.invoice_number,
          jsonb_build_object('invoice_id', i.invoice_id, 'invoice_number', i.invoice_number, 'supplier_id', i.supplier_id,
            'supplier_name', s.name, 'location_id', i.location_id, 'invoice_date', i.invoice_date, 'due_date', i.due_date,
            'due_date_source', i.due_date_source, 'status', i.status, 'version', i.version, 'revision', i.revision,
            'total_cents', i.total_cents, 'lines_cents', i.lines_cents, 'tax_cents', i.tax_cents, 'other_cents', i.other_cents,
            'paid_cents', a.paid, 'credited_cents', a.credited, 'balance_cents', i.total_cents - a.paid - a.credited,
            'has_discrepancy', i.has_discrepancy,
            'discrepancy_accepted', i.has_discrepancy and coalesce(i.discrepancy_accepted_revision = i.revision, false),
            'discrepancy_note', i.discrepancy_note,
            'overdue', i.status in ('open', 'partially_paid') and i.total_cents - a.paid - a.credited > 0 and i.due_date < v_today,
            'days_overdue', case when i.status in ('open', 'partially_paid') and i.due_date < v_today then v_today - i.due_date end,
            'record_mode', i.record_mode, 'note', i.note) as j
        from public.supplier_invoices i
        join public.suppliers s on s.supplier_id = i.supplier_id
        cross join lateral (select (private.invoice_applied_cents(i.invoice_id) ->> 'paid')::bigint as paid,
                                   (private.invoice_applied_cents(i.invoice_id) ->> 'credited')::bigint as credited) a
        where i.location_id = any (v_targets) and (p_status is null or i.status = p_status)) x), '[]'::jsonb));
end;
$$;

create function public.get_supplier_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.supplier_invoices := private.invoice_for_manager(p_invoice_id);
begin
  return private.invoice_result(p_invoice_id) || jsonb_build_object(
    'supplier_id', v_inv.supplier_id, 'location_id', v_inv.location_id, 'invoice_date', v_inv.invoice_date,
    'record_mode', v_inv.record_mode, 'discrepancy_note', v_inv.discrepancy_note, 'void_reason', v_inv.void_reason,
    'tax_cents', v_inv.tax_cents, 'other_cents', v_inv.other_cents, 'lines_cents', v_inv.lines_cents,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('revision', l.revision, 'line_no', l.line_no,
        'receipt_line_id', l.receipt_line_id, 'item_id', l.item_id, 'description', l.description, 'quantity', l.quantity::text,
        'unit_price', l.unit_price::text, 'line_cents', l.line_cents, 'received_qty', l.received_qty::text,
        'receipt_unit_cost', l.receipt_unit_cost::text, 'qty_variance', l.qty_variance::text,
        'price_variance_cents', l.price_variance_cents, 'discrepancy', l.discrepancy) order by l.revision desc, l.line_no)
      from public.supplier_invoice_lines l where l.invoice_id = p_invoice_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.payment_id, 'payment_number', p.payment_number,
        'amount_cents', p.amount_cents, 'method', p.method, 'paid_on', p.paid_on, 'record_mode', p.record_mode,
        'external_reference', p.external_reference,
        'reversed', exists (select 1 from public.supplier_payment_reversals r where r.payment_id = p.payment_id)) order by p.recorded_at)
      from public.supplier_payments p where p.invoice_id = p_invoice_id), '[]'::jsonb),
    'credits', coalesce((select jsonb_agg(jsonb_build_object('credit_id', c.credit_id, 'credit_number', c.credit_number,
        'amount_cents', c.amount_cents, 'reason', c.reason, 'credit_memo_ref', c.credit_memo_ref, 'credited_on', c.credited_on,
        'reversed', exists (select 1 from public.supplier_credit_reversals r where r.credit_id = c.credit_id)) order by c.recorded_at)
      from public.supplier_credits c where c.invoice_id = p_invoice_id), '[]'::jsonb));
end;
$$;

-- Receipt lines available to match on an invoice (same supplier and location).
create function public.get_matchable_receipt_lines(p_location_id text, p_supplier_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_location_role(p_location_id, array['manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('receipt_line_id', l.receipt_line_id, 'receipt_number', r.receipt_number,
      'business_date', r.business_date, 'item_id', l.item_id, 'item_name', i.name, 'base_unit', i.base_unit,
      'base_quantity', l.base_quantity::text, 'unit_cost', l.unit_cost::text,
      'invoiced_quantity', (select coalesce(sum(il.quantity), 0)::text from public.supplier_invoice_lines il
                            join public.supplier_invoices v on v.invoice_id = il.invoice_id
                            where il.receipt_line_id = l.receipt_line_id and il.revision = v.revision and v.status <> 'void'))
      order by r.received_at desc, l.line_no)
    from public.receipt_lines l
    join public.receipts r on r.receipt_id = l.receipt_id
    join public.items i on i.item_id = l.item_id
    where r.location_id = p_location_id and r.supplier_id = p_supplier_id
      and r.received_at > now() - interval '180 days'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants: AP is owner/manager only (employees see nothing)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['supplier_invoices', 'supplier_invoice_lines', 'supplier_payments', 'supplier_credits',
                           'supplier_payment_reversals', 'supplier_credit_reversals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy supplier_invoices_read on public.supplier_invoices for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy supplier_invoice_lines_read on public.supplier_invoice_lines for select to authenticated
  using (exists (select 1 from public.supplier_invoices i where i.invoice_id = supplier_invoice_lines.invoice_id
                 and i.location_id in (select private.managed_location_ids())));
create policy supplier_payments_read on public.supplier_payments for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy supplier_credits_read on public.supplier_credits for select to authenticated
  using (location_id in (select private.managed_location_ids()));
create policy supplier_payment_reversals_read on public.supplier_payment_reversals for select to authenticated
  using (exists (select 1 from public.supplier_payments p where p.payment_id = supplier_payment_reversals.payment_id
                 and p.location_id in (select private.managed_location_ids())));
create policy supplier_credit_reversals_read on public.supplier_credit_reversals for select to authenticated
  using (exists (select 1 from public.supplier_credits c where c.credit_id = supplier_credit_reversals.credit_id
                 and c.location_id in (select private.managed_location_ids())));

grant execute on function
  public.create_supplier_invoice(uuid, text, text, text, date, jsonb, bigint, bigint, date, text),
  public.revise_supplier_invoice(uuid, uuid, integer, jsonb, bigint, bigint, text),
  public.accept_invoice_discrepancy(uuid, uuid, integer, text, text, text),
  public.record_supplier_payment(uuid, uuid, bigint, text, date, text, text),
  public.reverse_supplier_payment(uuid, uuid, text),
  public.record_supplier_credit(uuid, uuid, bigint, text, text, date),
  public.reverse_supplier_credit(uuid, uuid, text),
  public.void_supplier_invoice(uuid, uuid, integer, text),
  public.get_supplier_invoices(text[], text),
  public.get_supplier_invoice(uuid),
  public.get_matchable_receipt_lines(text, text)
to authenticated;

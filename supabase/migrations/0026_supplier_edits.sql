-- 0026 Supplier contact and lead-time edits, and manager change requests (ADR 0038).
--
-- Owner: edits a supplier's phone, e-mail, address and the lead days of each
-- ingredient it supplies, directly. Values become "owner-entered" (who and
-- when). The supplier stays 'not independently verified' until its
-- supplier_master_verified gate is confirmed separately; an edit never
-- confirms or reopens a gate.
--
-- Manager: proposes the same kind of change as a request (e.g. after a supplier
-- phoned with a new number). Nothing changes until the owner approves it. The
-- owner sees pending requests on the Overview page and approves (applies) or
-- rejects them with a note.
--
-- p_changes shape (every key optional; a key that is present is a change, and
-- an empty string clears the value; absent keys stay as they are):
--   {"phone": "...", "contact_email": "...", "address": "...",
--    "lead_days": {"<supplier_item_id>": <whole days 0-365>, ...}}

alter table public.suppliers
  add column version integer not null default 1 check (version > 0),
  add column contact_provenance text,
  add column contact_updated_by text references public.employees (employee_id) on delete restrict,
  add column contact_updated_at timestamptz;

alter table public.supplier_items
  add column lead_updated_by text references public.employees (employee_id) on delete restrict,
  add column lead_updated_at timestamptz;

create table public.supplier_change_requests (
  request_id uuid primary key default gen_random_uuid(),
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  location_id text not null references public.locations (location_id) on delete restrict,
  requested_by text not null references public.employees (employee_id) on delete restrict,
  requested_at timestamptz not null default now(),
  supplier_version_at_request integer not null,
  proposed jsonb not null check (jsonb_typeof(proposed) = 'object'),
  current_at_request jsonb not null,
  note text not null check (length(btrim(note)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  version integer not null default 1 check (version > 0),
  decided_by text references public.employees (employee_id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  constraint supplier_change_requests_decided check ((status = 'pending') = (decided_at is null)),
  constraint supplier_change_requests_reject_note check (status <> 'rejected' or coalesce(length(btrim(decision_note)), 0) >= 3)
);

create index supplier_change_requests_pending on public.supplier_change_requests (requested_at) where status = 'pending';

-- Decided requests are history: nothing changes after the decision.
create function private.supplier_change_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise_error('immutable:supplier_change_request');
  end if;
  if old.status <> 'pending' then
    perform private.raise_error('immutable:supplier_change_request', jsonb_build_object('status', old.status));
  end if;
  if (to_jsonb(new) - array['status', 'version', 'decided_by', 'decided_at', 'decision_note'])
     <> (to_jsonb(old) - array['status', 'version', 'decided_by', 'decided_at', 'decision_note']) then
    perform private.raise_error('immutable:supplier_change_request');
  end if;
  return new;
end;
$$;

create trigger supplier_change_requests_guard
  before update or delete on public.supplier_change_requests
  for each row execute function private.supplier_change_requests_guard();

-- Reads go through list_supplier_change_requests; direct reads: the owner sees
-- every request, a manager only their own.
alter table public.supplier_change_requests enable row level security;
grant select on public.supplier_change_requests to authenticated;
create policy supplier_change_requests_read on public.supplier_change_requests for select to authenticated
  using ((select private.is_owner()) or requested_by = (select private.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.supplier_contact_json(p_supplier_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'phone', s.phone, 'contact_email', s.contact_email, 'address', s.address,
    'lead_days', coalesce((select jsonb_object_agg(si.supplier_item_id::text, si.procurement_lead_days)
                           from public.supplier_items si
                           where si.supplier_id = s.supplier_id and si.archived_at is null), '{}'::jsonb))
  from public.suppliers s where s.supplier_id = p_supplier_id;
$$;

-- Validate and normalise p_changes for one supplier. Returns the normalised
-- object (trimmed text, '' -> null, lead days as integers). Raises on any
-- invalid field. Does not write.
create function private.normalise_supplier_changes(p_supplier_id text, p_changes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_text text;
  v_key text;
  v_val jsonb;
  v_days integer;
  v_leads jsonb := '{}'::jsonb;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    perform private.raise_error('validation:changes');
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('phone', 'contact_email', 'address', 'lead_days') then
      perform private.raise_error('validation:changes', jsonb_build_object('unknown_field', v_key));
    end if;
  end loop;

  if p_changes ? 'phone' then
    v_text := nullif(btrim(coalesce(p_changes ->> 'phone', '')), '');
    if v_text is not null and (length(v_text) > 40 or v_text !~ '^[0-9+()./ x-]+$'
                               or length(regexp_replace(v_text, '[^0-9]', '', 'g')) < 7) then
      perform private.raise_error('validation:phone', jsonb_build_object('rule', 'at least 7 digits; digits, spaces and + ( ) - . x only'));
    end if;
    v_out := v_out || jsonb_build_object('phone', v_text);
  end if;

  if p_changes ? 'contact_email' then
    v_text := nullif(lower(btrim(coalesce(p_changes ->> 'contact_email', ''))), '');
    if v_text is not null and (length(v_text) > 254 or v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      perform private.raise_error('validation:contact_email');
    end if;
    v_out := v_out || jsonb_build_object('contact_email', v_text);
  end if;

  if p_changes ? 'address' then
    v_text := nullif(btrim(coalesce(p_changes ->> 'address', '')), '');
    if v_text is not null and length(v_text) > 200 then
      perform private.raise_error('validation:address', jsonb_build_object('rule', 'at most 200 characters'));
    end if;
    v_out := v_out || jsonb_build_object('address', v_text);
  end if;

  if p_changes ? 'lead_days' then
    if jsonb_typeof(p_changes -> 'lead_days') <> 'object' then
      perform private.raise_error('validation:lead_days');
    end if;
    for v_key, v_val in select * from jsonb_each(p_changes -> 'lead_days') loop
      if not exists (select 1 from public.supplier_items si
                     where si.supplier_item_id::text = v_key and si.supplier_id = p_supplier_id and si.archived_at is null) then
        perform private.raise_error('validation:lead_days', jsonb_build_object('unknown_supplier_item', v_key));
      end if;
      if jsonb_typeof(v_val) not in ('number', 'string') or (v_val #>> '{}') !~ '^\s*[0-9]{1,3}\s*$' then
        perform private.raise_error('validation:lead_days', jsonb_build_object('supplier_item_id', v_key, 'rule', 'whole days 0-365'));
      end if;
      v_days := btrim(v_val #>> '{}')::integer;
      if v_days > 365 then
        perform private.raise_error('validation:lead_days', jsonb_build_object('supplier_item_id', v_key, 'rule', 'whole days 0-365'));
      end if;
      v_leads := v_leads || jsonb_build_object(v_key, v_days);
    end loop;
    v_out := v_out || jsonb_build_object('lead_days', v_leads);
  end if;
  return v_out;
end;
$$;

-- Only the entries that differ from the supplier's current values.
create function private.supplier_changes_diff(p_supplier_id text, p_changes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current jsonb := private.supplier_contact_json(p_supplier_id);
  v_out jsonb := '{}'::jsonb;
  v_leads jsonb := '{}'::jsonb;
  v_key text;
begin
  foreach v_key in array array['phone', 'contact_email', 'address'] loop
    if p_changes ? v_key and (p_changes -> v_key) is distinct from coalesce(v_current -> v_key, 'null'::jsonb) then
      v_out := v_out || jsonb_build_object(v_key, p_changes -> v_key);
    end if;
  end loop;
  for v_key in select jsonb_object_keys(coalesce(p_changes -> 'lead_days', '{}'::jsonb)) loop
    if (p_changes -> 'lead_days' -> v_key) is distinct from coalesce(v_current -> 'lead_days' -> v_key, 'null'::jsonb) then
      v_leads := v_leads || jsonb_build_object(v_key, p_changes -> 'lead_days' -> v_key);
    end if;
  end loop;
  if v_leads <> '{}'::jsonb then v_out := v_out || jsonb_build_object('lead_days', v_leads); end if;
  return v_out;
end;
$$;

-- Write normalised, already-diffed changes. Caller holds the supplier row lock
-- and has authorised the actor. Returns {before, after}.
create function private.apply_supplier_changes(p_supplier_id text, p_changes jsonb, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := private.supplier_contact_json(p_supplier_id);
  v_provenance text := case when private.data_mode() = 'demo' then 'demo_owner_entered' else 'pilot_owner_entered' end;
  v_key text;
  v_val jsonb;
begin
  if p_changes ?| array['phone', 'contact_email', 'address'] then
    update public.suppliers s
       set phone = case when p_changes ? 'phone' then p_changes ->> 'phone' else s.phone end,
           address = case when p_changes ? 'address' then p_changes ->> 'address' else s.address end,
           contact_email = case when p_changes ? 'contact_email' then p_changes ->> 'contact_email' else s.contact_email end,
           contact_email_provenance = case
             when not p_changes ? 'contact_email' then s.contact_email_provenance
             when p_changes ->> 'contact_email' is null then null
             else v_provenance end,
           contact_provenance = v_provenance,
           contact_updated_by = p_actor,
           contact_updated_at = now()
     where s.supplier_id = p_supplier_id;
  end if;
  for v_key, v_val in select * from jsonb_each(coalesce(p_changes -> 'lead_days', '{}'::jsonb)) loop
    update public.supplier_items si
       set procurement_lead_days = (v_val #>> '{}')::integer,
           lead_time_basis = 'Owner-entered',
           lead_updated_by = p_actor,
           lead_updated_at = now(),
           updated_at = now()
     where si.supplier_item_id::text = v_key and si.supplier_id = p_supplier_id;
  end loop;
  update public.suppliers s set version = s.version + 1, updated_at = now() where s.supplier_id = p_supplier_id;
  return jsonb_build_object('before', v_before, 'after', private.supplier_contact_json(p_supplier_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: edit directly
-- ---------------------------------------------------------------------------
create function public.update_supplier_details(p_request_key uuid, p_supplier_id text, p_expected_version integer,
  p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_supplier public.suppliers;
  v_changes jsonb;
  v_result jsonb;
  v_applied jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'update_supplier_details', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_supplier from public.suppliers s where s.supplier_id = p_supplier_id and s.archived_at is null for update;
  if v_supplier.supplier_id is null then perform private.raise_error('validation:unknown_supplier'); end if;
  if p_expected_version is null or v_supplier.version <> p_expected_version then
    perform private.raise_error('conflict:stale_version', jsonb_build_object('current_version', v_supplier.version));
  end if;
  v_changes := private.supplier_changes_diff(p_supplier_id, private.normalise_supplier_changes(p_supplier_id, p_changes));
  if v_changes = '{}'::jsonb then perform private.raise_error('validation:no_changes'); end if;
  v_applied := private.apply_supplier_changes(p_supplier_id, v_changes, v_actor);
  perform private.write_audit(v_actor, 'supplier.update_details', 'supplier', p_supplier_id, null, p_request_key,
    v_applied -> 'before', v_applied -> 'after');
  v_result := jsonb_build_object('ok', true, 'supplier_id', p_supplier_id,
    'version', (select s.version from public.suppliers s where s.supplier_id = p_supplier_id), 'changed', v_changes);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Manager: propose a change for the owner to review
-- ---------------------------------------------------------------------------
create function public.submit_supplier_change_request(p_request_key uuid, p_location_id text, p_supplier_id text,
  p_changes jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_supplier public.suppliers;
  v_changes jsonb;
  v_row public.supplier_change_requests;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'submit_supplier_change_request', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_note is null or length(btrim(p_note)) < 3 then
    perform private.raise_error('validation:note', jsonb_build_object('rule', 'say where the new details came from'));
  end if;
  select * into v_supplier from public.suppliers s where s.supplier_id = p_supplier_id and s.archived_at is null;
  if v_supplier.supplier_id is null then perform private.raise_error('validation:unknown_supplier'); end if;
  v_changes := private.supplier_changes_diff(p_supplier_id, private.normalise_supplier_changes(p_supplier_id, p_changes));
  if v_changes = '{}'::jsonb then perform private.raise_error('validation:no_changes'); end if;
  insert into public.supplier_change_requests (supplier_id, location_id, requested_by, supplier_version_at_request,
    proposed, current_at_request, note)
  values (p_supplier_id, p_location_id, v_actor, v_supplier.version, v_changes,
    private.supplier_contact_json(p_supplier_id), btrim(p_note))
  returning * into v_row;
  perform private.write_audit(v_actor, 'supplier_change_request.submit', 'supplier_change_request', v_row.request_id::text,
    p_location_id, p_request_key, null, jsonb_build_object('supplier_id', p_supplier_id, 'proposed', v_changes), btrim(p_note));
  v_result := jsonb_build_object('ok', true, 'request_id', v_row.request_id, 'status', 'pending', 'version', v_row.version,
    'proposed', v_changes);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: approve (apply) or reject a request
-- ---------------------------------------------------------------------------
create function public.decide_supplier_change_request(p_request_key uuid, p_request_id uuid, p_expected_version integer,
  p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_req public.supplier_change_requests;
  v_changes jsonb;
  v_applied jsonb;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'decide_supplier_change_request', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_decision not in ('approve', 'reject') then perform private.raise_error('validation:decision'); end if;
  if p_decision = 'reject' and (p_note is null or length(btrim(p_note)) < 3) then
    perform private.raise_error('validation:decision_note', jsonb_build_object('rule', 'say why it was rejected'));
  end if;
  -- Lock order: supplier, then request.
  perform 1 from public.suppliers s
  where s.supplier_id = (select r.supplier_id from public.supplier_change_requests r where r.request_id = p_request_id)
  for update;
  select * into v_req from public.supplier_change_requests r where r.request_id = p_request_id for update;
  if v_req.request_id is null then perform private.raise_error('validation:unknown_request'); end if;
  if v_req.status <> 'pending' then
    perform private.raise_error('invalid_state:' || v_req.status || '->' || p_decision);
  end if;
  if p_expected_version is null or v_req.version <> p_expected_version then
    perform private.raise_error('conflict:stale_version');
  end if;

  if p_decision = 'approve' then
    -- Re-validate against the supplier as it is now; apply only what still differs.
    v_changes := private.supplier_changes_diff(v_req.supplier_id,
      private.normalise_supplier_changes(v_req.supplier_id, v_req.proposed));
    if v_changes <> '{}'::jsonb then
      v_applied := private.apply_supplier_changes(v_req.supplier_id, v_changes, v_actor);
    end if;
  end if;

  update public.supplier_change_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         version = version + 1, decided_by = v_actor, decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where request_id = p_request_id
  returning * into v_req;

  perform private.write_audit(v_actor, 'supplier_change_request.' || v_req.status, 'supplier_change_request',
    v_req.request_id::text, v_req.location_id, p_request_key, v_applied -> 'before',
    jsonb_build_object('supplier_id', v_req.supplier_id, 'applied', coalesce(v_changes, '{}'::jsonb),
      'after', v_applied -> 'after', 'requested_by', v_req.requested_by),
    nullif(btrim(p_note), ''));
  v_result := jsonb_build_object('ok', true, 'request_id', v_req.request_id, 'status', v_req.status,
    'applied', coalesce(v_changes, '{}'::jsonb));
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read requests: owner sees all; a manager sees the ones they submitted.
-- p_status: 'pending' | 'decided' | null (both, decided within 60 days).
-- ---------------------------------------------------------------------------
create function public.list_supplier_change_requests(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me text := private.require_actor();
  v_owner boolean := private.is_owner();
begin
  if not private.is_owner_or_manager() then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'manager'));
  end if;
  if p_status is not null and p_status not in ('pending', 'decided') then
    perform private.raise_error('validation:status');
  end if;
  return jsonb_build_object(
    'is_owner', v_owner,
    'refreshed_at', now(),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request_id', r.request_id, 'version', r.version, 'status', r.status,
        'supplier_id', r.supplier_id, 'supplier_name', s.name,
        'location_id', r.location_id, 'location_name', l.name,
        'requested_by', e.display_name, 'requested_at', r.requested_at, 'note', r.note,
        'proposed', r.proposed, 'current_at_request', r.current_at_request,
        'current', private.supplier_contact_json(r.supplier_id),
        'supplier_changed_since', s.version <> r.supplier_version_at_request and r.status = 'pending',
        'lead_items', coalesce((select jsonb_object_agg(si.supplier_item_id::text,
                         jsonb_build_object('item_id', si.item_id, 'name', i.name))
                       from public.supplier_items si join public.items i on i.item_id = si.item_id
                       where si.supplier_id = r.supplier_id), '{}'::jsonb),
        'decided_by', (select d.display_name from public.employees d where d.employee_id = r.decided_by),
        'decided_at', r.decided_at, 'decision_note', r.decision_note)
        order by (r.status = 'pending') desc, r.requested_at desc)
      from public.supplier_change_requests r
      join public.suppliers s on s.supplier_id = r.supplier_id
      join public.locations l on l.location_id = r.location_id
      join public.employees e on e.employee_id = r.requested_by
      where (v_owner or r.requested_by = v_me)
        and (p_status is null and (r.status = 'pending' or r.decided_at > now() - interval '60 days')
             or p_status = 'pending' and r.status = 'pending'
             or p_status = 'decided' and r.status <> 'pending' and r.decided_at > now() - interval '60 days')), '[]'::jsonb));
end;
$$;

revoke all on function
  private.supplier_change_requests_guard(),
  private.supplier_contact_json(text),
  private.normalise_supplier_changes(text, jsonb),
  private.supplier_changes_diff(text, jsonb),
  private.apply_supplier_changes(text, jsonb, text)
from public, anon, authenticated;

revoke all on function
  public.update_supplier_details(uuid, text, integer, jsonb),
  public.submit_supplier_change_request(uuid, text, text, jsonb, text),
  public.decide_supplier_change_request(uuid, uuid, integer, text, text),
  public.list_supplier_change_requests(text)
from public, anon;
grant execute on function
  public.update_supplier_details(uuid, text, integer, jsonb),
  public.submit_supplier_change_request(uuid, text, text, jsonb, text),
  public.decide_supplier_change_request(uuid, uuid, integer, text, text),
  public.list_supplier_change_requests(text)
to authenticated;

-- Demo reset also clears change requests (they reference suppliers and staff).
-- Like the other history tables, they cannot be truncated outside demo mode.
create trigger supplier_change_requests_no_truncate
  before truncate on public.supplier_change_requests
  for each statement execute function private.forbid_truncate_outside_demo();

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
    public.supplier_change_requests,
    public.forecast_overrides,
    public.time_corrections,
    public.break_intervals,
    public.time_entries,
    public.shifts,
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

create or replace function public.get_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 26;
$$;

-- 0027 Public pickup website: ordering through the ERP (CLAUDE.md D12, ADR 0040,
-- docs/website/BUILD_PLAN.md §2–§5).
--
-- * Reference tables that any signed-in user could read are now staff-only:
--   website visitors sign in anonymously and also hold the `authenticated` role.
-- * One acceptance path: accept_order's body moves to private.accept_order_core,
--   shared by the POS and web_place_order (system actor EMP-WEB, channel 'web').
-- * New web tables: opening hours, per-location web settings, per-item website
--   content and the contact details of web orders (managers and owner only).
-- * Public web_* functions for anonymous visitors; owner RPCs for the settings.
-- * Gate web_ordering_enabled per location.

-- ---------------------------------------------------------------------------
-- Staff-only reads for reference tables (previously readable by any session)
-- ---------------------------------------------------------------------------
create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_employee_id() is not null;
$$;
revoke all on function private.is_staff() from public, anon;
-- RLS policies run as the caller, so policy helpers need execute (as in 0001).
grant execute on function private.is_staff() to authenticated;

alter policy locations_read on public.locations using (private.is_staff());
alter policy units_read on public.units using (private.is_staff());
alter policy reason_codes_read on public.reason_codes using (private.is_staff());
alter policy items_read on public.items using (private.is_staff());
alter policy item_unit_conversions_read on public.item_unit_conversions using (private.is_staff());
alter policy recipe_versions_read on public.recipe_versions using (private.is_staff());
alter policy recipe_components_read on public.recipe_components using (private.is_staff());
alter policy app_settings_read on public.app_settings using (private.is_staff());
alter policy pilot_setup_gates_read on public.pilot_setup_gates using (private.is_staff());
alter policy return_policy_read on public.return_policy using (private.is_staff());

-- ---------------------------------------------------------------------------
-- System employee that accepts web orders. It can never sign in or hold a role.
-- ---------------------------------------------------------------------------
create function private.ensure_system_employees()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.employees (employee_id, display_name, active, provenance)
  values ('EMP-WEB', 'Online ordering', true, 'system')
  on conflict (employee_id) do nothing;
$$;
revoke all on function private.ensure_system_employees() from public, anon, authenticated;
select private.ensure_system_employees();

alter table public.employees
  add constraint employees_system_no_login check (employee_id <> 'EMP-WEB' or auth_user_id is null);
alter table public.memberships
  add constraint memberships_no_system_employee check (employee_id <> 'EMP-WEB');

-- A pristine database now always holds the system employee EMP-WEB, which is
-- not staff: the demo switch ignores it (otherwise unchanged from 0008).
create or replace function private.enable_demo_mode(p_dataset_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := private.data_mode();
begin
  if p_dataset_id is null or p_dataset_id !~ '^demo-[a-z0-9-]+$' then
    perform private.raise_error('validation:dataset_id');
  end if;
  if v_mode = 'demo' then
    if (select s.dataset_id from public.app_settings s) is distinct from p_dataset_id then
      perform private.raise_error('validation:dataset_id_mismatch');
    end if;
    return;
  end if;
  if exists (select 1 from public.employees e where e.employee_id <> 'EMP-WEB')
     or exists (select 1 from public.customers)
     or exists (select 1 from public.historical_sales_orders)
     or exists (select 1 from public.location_item_prices)
     or exists (select 1 from public.location_tax_rates)
     or exists (select 1 from public.audit_log a where a.action not like 'import.source_master%')
     or exists (select 1 from public.pilot_setup_gates g where g.status = 'confirmed') then
    perform private.raise_error('forbidden:database_not_pristine');
  end if;

  perform set_config('app.allow_mode_change', 'on', true);
  update public.app_settings
     set data_mode = 'demo', dataset_id = p_dataset_id, mode_changed_at = now();
  perform set_config('app.allow_mode_change', 'off', true);

  perform private.write_audit(null, 'data_mode.enable_demo', 'app_settings', 'singleton', null, null,
    jsonb_build_object('data_mode', v_mode), jsonb_build_object('data_mode', 'demo', 'dataset_id', p_dataset_id),
    null, null, 'operator_tooling');
end;
$$;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.orders
  add column channel text not null default 'pos' check (channel in ('pos', 'web')),
  add column requested_pickup_at timestamptz,
  add column web_token uuid unique,
  add constraint orders_web_fields check (
    (channel = 'pos' and requested_pickup_at is null and web_token is null)
    or (channel = 'web' and requested_pickup_at is not null and web_token is not null));

create index orders_web_slot on public.orders (location_id, requested_pickup_at)
  where channel = 'web' and status <> 'cancelled';

-- Cook time on the pickup day; prep_lead_days (existing) counts the days before.
alter table public.items
  add column prep_minutes integer check (prep_minutes between 0 and 600);

create table public.location_opening_hours (
  location_id text not null references public.locations (location_id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens_at time not null,
  closes_at time not null,
  updated_by text references public.employees (employee_id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (location_id, weekday),
  constraint location_opening_hours_window check (opens_at < closes_at)
);

create table public.web_ordering_settings (
  location_id text primary key references public.locations (location_id) on delete restrict,
  enabled boolean not null default false,
  slot_minutes integer not null default 15 check (slot_minutes = 15),
  orders_per_slot integer not null default 4 check (orders_per_slot between 1 and 50),
  days_ahead integer not null default 7 check (days_ahead between 0 and 14),
  max_per_line integer not null default 10 check (max_per_line between 1 and 50),
  updated_by text references public.employees (employee_id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- Only items with a row here are offered on the website. An allergen note is
-- published only once the owner has reviewed it.
create table public.web_menu_content (
  item_id text primary key,
  is_sellable boolean not null default true check (is_sellable),
  country text check (length(btrim(country)) between 1 and 60),
  description text not null check (length(btrim(description)) between 1 and 400),
  image_path text check (image_path ~ '^[a-z0-9][a-z0-9/_.-]{0,119}$'),
  allergen_note text check (length(btrim(allergen_note)) between 1 and 400),
  allergen_reviewed_by text references public.employees (employee_id) on delete restrict,
  allergen_reviewed_at timestamptz,
  provenance text not null default 'pilot_operator_entered',
  updated_by text references public.employees (employee_id) on delete restrict,
  updated_at timestamptz not null default now(),
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable),
  constraint web_menu_content_review check (
    (allergen_reviewed_at is null and allergen_reviewed_by is null)
    or (allergen_reviewed_at is not null and allergen_reviewed_by is not null and allergen_note is not null))
);

-- Contact details a customer typed on the website. Append-only.
create table public.web_order_contacts (
  order_id uuid primary key references public.orders (order_id) on delete restrict,
  web_user_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  phone text not null check (phone ~ '^[0-9+() .-]{7,20}$'),
  phone_digits text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored,
  email text not null check (length(email) <= 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);
create index web_order_contacts_user on public.web_order_contacts (web_user_id);
create index web_order_contacts_email on public.web_order_contacts (lower(email));
create index web_order_contacts_phone on public.web_order_contacts (phone_digits);
create trigger web_order_contacts_append_only
  before update or delete on public.web_order_contacts
  for each row execute function private.forbid_update_delete();

do $$
declare
  t text;
begin
  foreach t in array array['location_opening_hours', 'web_ordering_settings', 'web_menu_content', 'web_order_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy location_opening_hours_read on public.location_opening_hours for select to authenticated
  using (private.is_staff());
create policy web_ordering_settings_read on public.web_ordering_settings for select to authenticated
  using (private.is_staff());
create policy web_menu_content_read on public.web_menu_content for select to authenticated
  using (private.is_staff());
create policy web_order_contacts_read on public.web_order_contacts for select to authenticated
  using (exists (select 1 from public.orders o where o.order_id = web_order_contacts.order_id
                 and o.location_id in (select private.managed_location_ids())));

-- ---------------------------------------------------------------------------
-- Setup gate web_ordering_enabled (per location)
-- ---------------------------------------------------------------------------
alter table public.pilot_setup_gates drop constraint pilot_setup_gates_key_scope;
alter table public.pilot_setup_gates add constraint pilot_setup_gates_key_scope check (
  (gate_key in ('roles_verified', 'perishables_confirmed', 'return_policy_configured',
                'backup_restore_tested', 'acceptance_suite_passed') and scope_type = 'company' and scope_id is null)
  or (gate_key in ('menu_prices_confirmed', 'tax_rate_confirmed', 'opening_counts_posted',
                   'planning_inputs_confirmed', 'web_ordering_enabled') and scope_type = 'location' and scope_id is not null)
  or (gate_key = 'supplier_master_verified' and scope_type = 'supplier' and scope_id is not null)
  or (gate_key = 'pack_conversions_verified' and scope_type = 'supplier_item' and scope_id is not null)
  or (gate_key = 'recipes_verified' and scope_type = 'item' and scope_id is not null));

create or replace function private.ensure_base_gates()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pilot_setup_gates (gate_key, scope_type, scope_id)
  select k, 'company', null
  from unnest(array['roles_verified', 'perishables_confirmed', 'return_policy_configured',
                    'backup_restore_tested', 'acceptance_suite_passed']) as k
  on conflict do nothing;

  insert into public.pilot_setup_gates (gate_key, scope_type, scope_id)
  select k, 'location', l.location_id
  from unnest(array['menu_prices_confirmed', 'tax_rate_confirmed', 'opening_counts_posted',
                    'planning_inputs_confirmed', 'web_ordering_enabled']) as k
  cross join public.locations l
  on conflict do nothing;
$$;
select private.ensure_base_gates();

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
    when 'web_ordering_enabled' then
      if not exists (select 1 from public.web_ordering_settings s where s.location_id = p_gate.scope_id) then
        return jsonb_build_object('reason', 'web_settings_not_entered');
      end if;
      if not exists (select 1 from public.location_opening_hours h where h.location_id = p_gate.scope_id) then
        return jsonb_build_object('reason', 'opening_hours_not_entered');
      end if;
      if not exists (select 1 from public.web_menu_content c join public.items i using (item_id) where i.archived_at is null) then
        return jsonb_build_object('reason', 'no_website_menu_content');
      end if;
      select jsonb_agg(i.item_id order by i.item_id) into v_missing
      from public.web_menu_content c join public.items i using (item_id)
      where i.item_type = 'finished_dish' and i.archived_at is null and i.prep_minutes is null;
      if v_missing is not null then
        return jsonb_build_object('reason', 'dishes_without_prep_minutes', 'item_ids', v_missing);
      end if;
    else
      null;
  end case;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- One acceptance path for the POS and the website
-- ---------------------------------------------------------------------------
-- Gates every order needs, checked before any order-specific validation.
create function private.require_order_gates(p_location_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_posting_enabled();
  perform private.require_gate('opening_counts_posted', p_location_id);
  perform private.require_gate('menu_prices_confirmed', p_location_id);
  perform private.require_gate('tax_rate_confirmed', p_location_id);
end;
$$;
revoke all on function private.require_order_gates(text) from public, anon, authenticated;

-- Insert the order, snapshot lines/prices/tax/BOM, reserve the whole order
-- (all-or-nothing) and write the state event and audit row. Callers have already
-- authorized, checked gates and validated their own inputs.
create function private.accept_order_core(p_actor text, p_request_key uuid, p_location_id text, p_lines jsonb,
  p_customer_id text, p_pickup_name text, p_note text, p_discount_percent numeric, p_discount_reason text,
  p_approver text, p_channel text, p_requested_pickup_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_rate numeric;
  v_no integer;
  v_short text;
  v_order public.orders;
begin
  v_rate := private.current_tax_rate(p_location_id, v_today);
  if v_rate is null then perform private.raise_error('validation:no_tax_rate'); end if;

  v_no := private.next_order_number(p_location_id, v_today);
  select l.short_code into v_short from public.locations l where l.location_id = p_location_id;
  insert into public.orders (order_number, location_id, business_date, pickup_code, status, customer_id, pickup_name, note,
    tender_mode, tax_rate, discount_percent, discount_reason, discount_approved_by, accepted_by, provenance,
    channel, requested_pickup_at, web_token)
  values (v_short || '-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(v_no::text, 4, '0'), p_location_id, v_today,
    v_short || '-' || lpad(v_no::text, 4, '0'), 'accepted', p_customer_id, p_pickup_name, nullif(btrim(p_note), ''),
    case when private.data_mode() = 'demo' then 'SIMULATED' else 'MANUAL_EXTERNAL' end, v_rate, p_discount_percent,
    case when p_discount_percent > 0 then btrim(p_discount_reason) end, p_approver, p_actor,
    case when private.data_mode() = 'demo' then 'demo_operational' else 'operational' end,
    p_channel, p_requested_pickup_at, case when p_channel = 'web' then gen_random_uuid() end)
  returning * into v_order;

  perform private.build_order_revision(v_order.order_id, p_location_id, 1, p_lines, p_discount_percent, v_rate);
  perform private.reserve_order(v_order.order_id, p_location_id, 1);

  insert into public.order_state_events (order_id, from_status, to_status, version, actor_employee_id, approver_employee_id, request_key)
  values (v_order.order_id, null, 'accepted', 1, p_actor, p_approver, p_request_key);
  perform private.write_audit(p_actor, 'order.accepted', 'order', v_order.order_id::text, p_location_id, p_request_key, null,
    jsonb_build_object('order_number', v_order.order_number, 'discount_percent', p_discount_percent, 'channel', p_channel),
    null, p_approver);
  return v_order.order_id;
end;
$$;
revoke all on function private.accept_order_core(text, uuid, text, jsonb, text, text, text, numeric, text, text, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.accept_order(p_request_key uuid, p_location_id text, p_lines jsonb,
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
  v_pct numeric := coalesce(p_discount_percent, 0);
  v_approval jsonb;
  v_approver text;
  v_customer public.customers;
  v_order_id uuid;
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_cached := private.idem_begin(v_actor, 'accept_order', p_request_key);
  if v_cached is not null then return v_cached; end if;

  perform private.require_order_gates(p_location_id);

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

  v_order_id := private.accept_order_core(v_actor, p_request_key, p_location_id, p_lines, p_customer_id,
    coalesce(nullif(btrim(p_pickup_name), ''), v_customer.display_name), p_note, v_pct, p_discount_reason, v_approver,
    'pos', null);
  return private.idem_finish(v_actor, p_request_key, private.order_result(v_order_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Web ordering helpers
-- ---------------------------------------------------------------------------
-- Idempotency actor for a website visitor (anonymous sign-in): never an employee ID.
create function private.require_web_actor()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.raise_error('unauthorized', jsonb_build_object('reason', 'no_session'));
  end if;
  return 'web:' || auth.uid()::text;
end;
$$;

-- Opening window of a location on a local date, or null when closed that day.
create function private.web_day_window(p_location_id text, p_date date, out opens timestamptz, out closes timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select (p_date + h.opens_at) at time zone 'America/Denver', (p_date + h.closes_at) at time zone 'America/Denver'
  from public.location_opening_hours h
  where h.location_id = p_location_id and h.weekday = extract(isodow from p_date)
    and not exists (select 1 from public.location_closures c where c.location_id = p_location_id and c.business_date = p_date);
$$;

-- Why web ordering is closed at a location right now, or null when it is open.
create function private.web_ordering_status(p_location_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.locations l where l.location_id = p_location_id) then 'unknown_location'
    when not coalesce((select s.posting_enabled from public.app_settings s), false) then 'posting_disabled'
    when not (private.gate_confirmed('web_ordering_enabled', p_location_id)
              and private.gate_confirmed('opening_counts_posted', p_location_id)
              and private.gate_confirmed('menu_prices_confirmed', p_location_id)
              and private.gate_confirmed('tax_rate_confirmed', p_location_id)) then 'setup_incomplete'
    when not coalesce((select w.enabled from public.web_ordering_settings w where w.location_id = p_location_id), false)
      then 'paused'
    when not exists (select 1 from public.location_opening_hours h where h.location_id = p_location_id) then 'no_hours'
  end;
$$;

-- Pickup slots this set of items can be ready for (BUILD_PLAN §4). The kitchen
-- starts at opening time. Every item's lead days and cook minutes must be met;
-- the slowest item decides. p_now is a parameter so tests can fix the clock.
create function private.web_pickup_slots(p_location_id text, p_item_ids text[], p_now timestamptz)
returns table (pickup_at timestamptz, taken integer, capacity integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.web_ordering_settings;
  v_today date := private.business_date(p_now);
  v_lead integer;
  v_minutes integer;
  v_first_day date;
  v_missing jsonb;
  v_day date;
  v_open integer := 0;
  v_window record;
  v_earliest timestamptz;
  v_slot interval;
begin
  select * into v_settings from public.web_ordering_settings w where w.location_id = p_location_id;
  if v_settings.location_id is null or p_item_ids is null or cardinality(p_item_ids) = 0 then
    return;
  end if;
  v_slot := make_interval(mins => v_settings.slot_minutes);

  select jsonb_agg(i.item_id order by i.item_id) into v_missing
  from public.items i where i.item_id = any (p_item_ids) and i.item_type = 'finished_dish' and i.prep_minutes is null;
  if v_missing is not null then
    perform private.raise_error('validation:prep_minutes_missing', jsonb_build_object('item_ids', v_missing));
  end if;
  select coalesce(max(coalesce(i.prep_lead_days, 0)), 0), coalesce(max(coalesce(i.prep_minutes, 0)), 0)
    into v_lead, v_minutes
  from public.items i where i.item_id = any (p_item_ids);

  -- The first day the slowest item can be ready: today, or the n-th following open day.
  v_first_day := v_today;
  if v_lead > 0 then
    v_first_day := null;
    for i in 1 .. 60 loop
      v_day := v_today + i;
      if (select w.opens from private.web_day_window(p_location_id, v_day) w) is not null then
        v_open := v_open + 1;
        if v_open = v_lead then v_first_day := v_day; exit; end if;
      end if;
    end loop;
    if v_first_day is null then return; end if;
  end if;

  for v_day in select d::date from generate_series(v_first_day, v_today + v_settings.days_ahead, interval '1 day') d loop
    select * into v_window from private.web_day_window(p_location_id, v_day);
    continue when v_window.opens is null;
    v_earliest := greatest(v_window.opens, case when v_day = v_today then p_now end) + make_interval(mins => v_minutes);
    return query
      select s.at, (select count(*)::integer from public.orders o
                    where o.location_id = p_location_id and o.channel = 'web' and o.status <> 'cancelled'
                      and o.requested_pickup_at = s.at),
             v_settings.orders_per_slot
      from generate_series(v_window.opens, v_window.closes - v_slot, v_slot) as s(at)
      where s.at >= v_earliest and s.at > p_now
      order by s.at;
  end loop;
end;
$$;

-- Portions a location could make of each sellable item right now (independent
-- potentials, not additive), as in get_pos_menu.
create function private.portions_available(p_location_id text)
returns table (item_id text, portions bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.item_id,
         case when i.item_type = 'retail' then floor(private.available_qty(p_location_id, i.item_id))::bigint
              else coalesce((select min(floor(private.available_qty(p_location_id, c.component_item_id) / c.quantity_per_serving))::bigint
                             from public.recipe_versions v
                             join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
                             where v.parent_item_id = i.item_id and v.status = 'active'), 0) end
  from public.items i
  where i.is_sellable and i.archived_at is null;
$$;

-- Order details a visitor may see: never another customer's contact details,
-- costs or staff names.
create function private.web_order_result(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'order_number', o.order_number, 'pickup_code', o.pickup_code,
    'web_token', o.web_token, 'status', o.status, 'requested_pickup_at', o.requested_pickup_at,
    'location', jsonb_build_object('location_id', l.location_id, 'name', l.name),
    'pickup_name', o.pickup_name, 'note', o.note,
    'lines', (select jsonb_agg(jsonb_build_object('item_id', ol.item_id, 'name', i.name, 'quantity', ol.quantity,
                'unit_price_cents', ol.unit_price_cents, 'gross_cents', ol.gross_cents, 'discount_cents', ol.discount_cents,
                'net_cents', ol.net_cents, 'tax_cents', ol.tax_cents) order by ol.line_no)
              from public.order_lines ol join public.items i on i.item_id = ol.item_id
              where ol.order_id = o.order_id and ol.revision = o.revision),
    'gross_cents', o.gross_cents, 'discount_cents', o.discount_cents, 'net_cents', o.net_cents,
    'tax_rate', o.tax_rate::text, 'tax_cents', o.tax_cents, 'total_cents', o.total_cents,
    'tender_mode', o.tender_mode, 'paid_cents', p.paid, 'balance_due_cents', o.total_cents - p.paid,
    'payment', case when o.tender_mode = 'SIMULATED' then 'simulated' else 'pay_at_pickup' end,
    'accepted_at', o.accepted_at)
  from public.orders o
  join public.locations l on l.location_id = o.location_id
  cross join lateral (select coalesce(sum(t.amount_cents), 0)::bigint as paid from public.tenders t where t.order_id = o.order_id) p
  where o.order_id = p_order_id and o.channel = 'web';
$$;

do $$
declare
  f text;
begin
  foreach f in array array['private.require_web_actor()', 'private.web_day_window(text, date)',
                           'private.web_ordering_status(text)', 'private.web_pickup_slots(text, text[], timestamptz)',
                           'private.portions_available(text)', 'private.web_order_result(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public functions for website visitors (anonymous sign-in)
-- ---------------------------------------------------------------------------
create function public.web_get_locations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_web_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('location_id', l.location_id, 'name', l.name,
      'ordering_open', private.web_ordering_status(l.location_id) is null,
      'status_reason', private.web_ordering_status(l.location_id),
      'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.weekday,
                           'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
                           order by h.weekday)
                         from public.location_opening_hours h where h.location_id = l.location_id), '[]'::jsonb))
      order by l.name)
    from public.locations l
  ), '[]'::jsonb);
end;
$$;

create function public.web_get_menu(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_date();
  v_status text;
  v_max integer;
begin
  perform private.require_web_actor();
  v_status := private.web_ordering_status(p_location_id);
  if v_status = 'unknown_location' then perform private.raise_error('validation:location'); end if;
  select w.max_per_line into v_max from public.web_ordering_settings w where w.location_id = p_location_id;
  v_max := coalesce(v_max, 0);

  return jsonb_build_object('location_id', p_location_id, 'ordering_open', v_status is null, 'status_reason', v_status,
    'max_per_line', v_max,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'name', x.name, 'item_type', x.item_type,
               'country', x.country, 'description', x.description, 'image_path', x.image_path,
               'allergen_note', x.allergen_note, 'price_cents', x.price_cents,
               'prep_lead_days', x.prep_lead_days, 'prep_minutes', x.prep_minutes,
               'available', x.available, 'max_orderable', case when x.available then least(x.portions, v_max) else 0 end)
             order by x.item_type, x.item_id)
      from (
        select i.item_id, i.name, i.item_type, c.country, c.description, c.image_path, i.prep_lead_days, i.prep_minutes,
               case when c.allergen_reviewed_at is not null then c.allergen_note end as allergen_note,
               pr.price_cents, coalesce(p.portions, 0) as portions,
               (v_status is null and pr.price_cents is not null and coalesce(p.portions, 0) >= 1 and v_max >= 1
                and coalesce(a.is_available, true)
                and (i.item_type = 'retail'
                     or (i.prep_minutes is not null and private.gate_confirmed('recipes_verified', i.item_id)))) as available
        from public.web_menu_content c
        join public.items i on i.item_id = c.item_id and i.is_sellable and i.archived_at is null
        left join private.portions_available(p_location_id) p on p.item_id = i.item_id
        left join public.location_item_availability a on a.location_id = p_location_id and a.item_id = i.item_id
        left join lateral (select (private.current_price(p_location_id, i.item_id, v_today)).price_cents) pr on true
      ) x
    ), '[]'::jsonb));
end;
$$;

-- p_lines: [{item_id, quantity}] (quantities do not change the slots; only which items).
create function public.web_get_pickup_slots(p_location_id text, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_items text[];
begin
  perform private.require_web_actor();
  v_status := private.web_ordering_status(p_location_id);
  if v_status = 'unknown_location' then perform private.raise_error('validation:location'); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:lines');
  end if;
  select array_agg(distinct x ->> 'item_id') into v_items from jsonb_array_elements(p_lines) x;
  if exists (select 1 from unnest(v_items) id where not exists (
               select 1 from public.web_menu_content c join public.items i using (item_id)
               where c.item_id = id and i.is_sellable and i.archived_at is null)) then
    perform private.raise_error('validation:item_not_offered');
  end if;
  return jsonb_build_object('location_id', p_location_id, 'ordering_open', v_status is null, 'status_reason', v_status,
    'slots', case when v_status is null then coalesce((
      select jsonb_agg(jsonb_build_object('pickup_at', s.pickup_at, 'available', s.taken < s.capacity) order by s.pickup_at)
      from private.web_pickup_slots(p_location_id, v_items, now()) s), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;

-- p_contact: {name, phone, email}. No discounts, customer records or card data.
create function public.web_place_order(p_request_key uuid, p_location_id text, p_lines jsonb, p_contact jsonb,
  p_pickup_at timestamptz, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_web_actor();
  v_cached jsonb;
  v_settings public.web_ordering_settings;
  v_name text := btrim(p_contact ->> 'name');
  v_phone text := btrim(p_contact ->> 'phone');
  v_email text := lower(btrim(p_contact ->> 'email'));
  v_items text[];
  v_slot record;
  v_order_id uuid;
  v_order public.orders;
  v_tender uuid;
begin
  v_cached := private.idem_begin(v_actor, 'web_place_order', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if not exists (select 1 from public.locations l where l.location_id = p_location_id) then
    perform private.raise_error('validation:location');
  end if;
  perform private.require_order_gates(p_location_id);
  perform private.require_gate('web_ordering_enabled', p_location_id);
  -- Serialises web placements per location so slot capacity cannot be overbooked.
  select * into v_settings from public.web_ordering_settings w where w.location_id = p_location_id for update;
  if v_settings.location_id is null or not v_settings.enabled then
    perform private.raise_error('web_ordering_paused');
  end if;

  if v_name is null or length(v_name) not between 1 and 80 then perform private.raise_error('validation:contact_name'); end if;
  if v_phone is null or v_phone !~ '^[0-9+() .-]{7,20}$' or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    perform private.raise_error('validation:contact_phone');
  end if;
  if v_email is null or length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.raise_error('validation:contact_email');
  end if;
  if p_note is not null and length(btrim(p_note)) > 300 then perform private.raise_error('validation:note'); end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 20 then
    perform private.raise_error('validation:lines');
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
             where jsonb_typeof(x -> 'quantity') <> 'number' or (x ->> 'quantity')::numeric <> trunc((x ->> 'quantity')::numeric)
                or (x ->> 'quantity')::numeric < 1 or (x ->> 'quantity')::numeric > v_settings.max_per_line) then
    perform private.raise_error('validation:quantity', jsonb_build_object('max_per_line', v_settings.max_per_line));
  end if;
  select array_agg(distinct x ->> 'item_id') into v_items from jsonb_array_elements(p_lines) x;
  if exists (select 1 from unnest(v_items) id where not exists (select 1 from public.web_menu_content c where c.item_id = id)) then
    perform private.raise_error('validation:item_not_offered');
  end if;

  if (select count(*) from public.web_order_contacts c join public.orders o using (order_id)
      where o.status in ('accepted', 'preparing', 'ready')
        and (c.web_user_id = auth.uid() or lower(c.email) = v_email
             or c.phone_digits = regexp_replace(v_phone, '[^0-9]', '', 'g'))) >= 3 then
    perform private.raise_error('rate_limited:open_orders', jsonb_build_object('max_open_orders', 3));
  end if;

  select * into v_slot from private.web_pickup_slots(p_location_id, v_items, now()) s where s.pickup_at = p_pickup_at;
  if v_slot.pickup_at is null then
    perform private.raise_error('slot_unavailable', jsonb_build_object('reason', 'not_offered'));
  end if;
  if v_slot.taken >= v_slot.capacity then
    perform private.raise_error('slot_unavailable', jsonb_build_object('reason', 'full'));
  end if;

  v_order_id := private.accept_order_core('EMP-WEB', p_request_key, p_location_id, p_lines, null, v_name, p_note,
    0, null, null, 'web', p_pickup_at);
  insert into public.web_order_contacts (order_id, web_user_id, name, phone, email)
  values (v_order_id, auth.uid(), v_name, v_phone, v_email);

  -- Demo only: the website's pretend payment is a SIMULATED tender for the total.
  -- The pilot records the real payment at pickup.
  select * into v_order from public.orders o where o.order_id = v_order_id;
  if v_order.tender_mode = 'SIMULATED' and v_order.total_cents > 0 then
    insert into public.tenders (order_id, location_id, tender_type, method, amount_cents, external_reference, recorded_by, request_key)
    values (v_order_id, p_location_id, 'SIMULATED', 'card_external', v_order.total_cents, 'Website (simulated)', 'EMP-WEB',
            p_request_key)
    returning tender_id into v_tender;
    perform private.write_audit('EMP-WEB', 'tender.record', 'tender', v_tender::text, p_location_id, p_request_key, null,
      jsonb_build_object('order_id', v_order_id, 'amount_cents', v_order.total_cents, 'tender_type', 'SIMULATED',
                         'method', 'card_external', 'channel', 'web'));
  end if;

  return private.idem_finish(v_actor, p_request_key, private.web_order_result(v_order_id));
end;
$$;

create function public.web_get_order(p_web_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_web_actor();
  select private.web_order_result(o.order_id) into v_result from public.orders o where o.web_token = p_web_token;
  if v_result is null then perform private.raise_error('not_found'); end if;
  return v_result;
end;
$$;

-- Outcome of a placement whose response was lost (AC29 for the website).
create function public.web_get_request_result(p_request_key uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_web_actor();
  v_row private.request_log;
begin
  select * into v_row from private.request_log r where r.actor_employee_id = v_actor and r.request_key = p_request_key;
  if v_row.request_key is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', case when v_row.result is null then 'in_progress' else 'committed' end,
    'rpc_name', v_row.rpc_name, 'result', v_row.result, 'committed_at', v_row.completed_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner settings for the website (Settings → Website arrives in W4)
-- ---------------------------------------------------------------------------
create function public.set_web_ordering_settings(p_request_key uuid, p_location_id text, p_enabled boolean,
  p_orders_per_slot integer, p_days_ahead integer, p_max_per_line integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before jsonb;
  v_row public.web_ordering_settings;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_web_ordering_settings', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if not exists (select 1 from public.locations l where l.location_id = p_location_id) then
    perform private.raise_error('validation:location');
  end if;
  if p_enabled is null then perform private.raise_error('validation:enabled'); end if;
  if p_orders_per_slot is null or p_orders_per_slot not between 1 and 50 then perform private.raise_error('validation:orders_per_slot'); end if;
  if p_days_ahead is null or p_days_ahead not between 0 and 14 then perform private.raise_error('validation:days_ahead'); end if;
  if p_max_per_line is null or p_max_per_line not between 1 and 50 then perform private.raise_error('validation:max_per_line'); end if;
  select to_jsonb(w) into v_before from public.web_ordering_settings w where w.location_id = p_location_id;
  insert into public.web_ordering_settings (location_id, enabled, orders_per_slot, days_ahead, max_per_line, updated_by)
  values (p_location_id, p_enabled, p_orders_per_slot, p_days_ahead, p_max_per_line, v_actor)
  on conflict (location_id) do update
    set enabled = excluded.enabled, orders_per_slot = excluded.orders_per_slot, days_ahead = excluded.days_ahead,
        max_per_line = excluded.max_per_line, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  perform private.write_audit(v_actor, 'web.settings', 'location', p_location_id, p_location_id, p_request_key,
    v_before, to_jsonb(v_row));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true) || to_jsonb(v_row));
end;
$$;

-- p_hours: [{weekday 1-7 (Monday = 1), opens_at 'HH:MI', closes_at 'HH:MI'}]; replaces the week.
-- A weekday left out is closed.
create function public.set_location_opening_hours(p_request_key uuid, p_location_id text, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_location_opening_hours', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if not exists (select 1 from public.locations l where l.location_id = p_location_id) then
    perform private.raise_error('validation:location');
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then perform private.raise_error('validation:hours'); end if;
  if exists (select 1 from jsonb_array_elements(p_hours) x
             where (x ->> 'weekday') !~ '^[1-7]$' or (x ->> 'opens_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                or (x ->> 'closes_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                or (x ->> 'opens_at')::time >= (x ->> 'closes_at')::time)
     or (select count(distinct x ->> 'weekday') from jsonb_array_elements(p_hours) x) <> jsonb_array_length(p_hours) then
    perform private.raise_error('validation:hours', jsonb_build_object('rule', 'one entry per weekday 1-7, HH:MI, opens before closes'));
  end if;
  select jsonb_agg(to_jsonb(h) order by h.weekday) into v_before from public.location_opening_hours h where h.location_id = p_location_id;
  delete from public.location_opening_hours h where h.location_id = p_location_id;
  insert into public.location_opening_hours (location_id, weekday, opens_at, closes_at, updated_by)
  select p_location_id, (x ->> 'weekday')::smallint, (x ->> 'opens_at')::time, (x ->> 'closes_at')::time, v_actor
  from jsonb_array_elements(p_hours) x;
  select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'),
           'closes_at', to_char(h.closes_at, 'HH24:MI')) order by h.weekday)
    into v_after from public.location_opening_hours h where h.location_id = p_location_id;
  perform private.write_audit(v_actor, 'web.opening_hours', 'location', p_location_id, p_location_id, p_request_key,
    v_before, v_after);
  return private.idem_finish(v_actor, p_request_key,
    jsonb_build_object('ok', true, 'location_id', p_location_id, 'hours', coalesce(v_after, '[]'::jsonb)));
end;
$$;

create function public.set_item_prep_minutes(p_request_key uuid, p_item_id text, p_prep_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before integer;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_item_prep_minutes', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select i.prep_minutes into v_before from public.items i
  where i.item_id = p_item_id and i.is_sellable and i.archived_at is null for update;
  if not found then perform private.raise_error('validation:item_not_sellable'); end if;
  if p_prep_minutes is null or p_prep_minutes not between 0 and 600 then
    perform private.raise_error('validation:prep_minutes', jsonb_build_object('rule', '0 to 600 minutes'));
  end if;
  update public.items set prep_minutes = p_prep_minutes where item_id = p_item_id;
  perform private.write_audit(v_actor, 'item.prep_minutes', 'item', p_item_id, null, p_request_key,
    jsonb_build_object('prep_minutes', v_before), jsonb_build_object('prep_minutes', p_prep_minutes));
  return private.idem_finish(v_actor, p_request_key,
    jsonb_build_object('ok', true, 'item_id', p_item_id, 'prep_minutes', p_prep_minutes));
end;
$$;

-- Saving content clears an earlier allergen review unless p_allergen_reviewed
-- confirms the note again, so a changed note is never published unreviewed.
create function public.set_web_menu_content(p_request_key uuid, p_item_id text, p_country text, p_description text,
  p_image_path text, p_allergen_note text, p_allergen_reviewed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before jsonb;
  v_row public.web_menu_content;
  v_reviewed boolean := coalesce(p_allergen_reviewed, false);
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_web_menu_content', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_sellable and i.archived_at is null) then
    perform private.raise_error('validation:item_not_sellable');
  end if;
  if p_description is null or length(btrim(p_description)) not between 1 and 400 then
    perform private.raise_error('validation:description');
  end if;
  if p_country is not null and length(btrim(p_country)) not between 1 and 60 then perform private.raise_error('validation:country'); end if;
  if p_image_path is not null and p_image_path !~ '^[a-z0-9][a-z0-9/_.-]{0,119}$' then
    perform private.raise_error('validation:image_path');
  end if;
  if p_allergen_note is not null and length(btrim(p_allergen_note)) not between 1 and 400 then
    perform private.raise_error('validation:allergen_note');
  end if;
  if v_reviewed and p_allergen_note is null then perform private.raise_error('validation:allergen_note'); end if;
  select to_jsonb(c) into v_before from public.web_menu_content c where c.item_id = p_item_id;
  insert into public.web_menu_content (item_id, country, description, image_path, allergen_note, allergen_reviewed_by,
    allergen_reviewed_at, provenance, updated_by)
  values (p_item_id, nullif(btrim(p_country), ''), btrim(p_description), p_image_path, nullif(btrim(p_allergen_note), ''),
    case when v_reviewed then v_actor end, case when v_reviewed then now() end,
    case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end, v_actor)
  on conflict (item_id) do update
    set country = excluded.country, description = excluded.description, image_path = excluded.image_path,
        allergen_note = excluded.allergen_note, allergen_reviewed_by = excluded.allergen_reviewed_by,
        allergen_reviewed_at = excluded.allergen_reviewed_at, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  perform private.write_audit(v_actor, 'web.menu_content', 'item', p_item_id, null, p_request_key, v_before, to_jsonb(v_row));
  return private.idem_finish(v_actor, p_request_key, jsonb_build_object('ok', true) || to_jsonb(v_row));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.web_get_locations()', 'public.web_get_menu(text)', 'public.web_get_pickup_slots(text, jsonb)',
    'public.web_place_order(uuid, text, jsonb, jsonb, timestamptz, text)', 'public.web_get_order(uuid)',
    'public.web_get_request_result(uuid)',
    'public.set_web_ordering_settings(uuid, text, boolean, integer, integer, integer)',
    'public.set_location_opening_hours(uuid, text, jsonb)', 'public.set_item_prep_minutes(uuid, text, integer)',
    'public.set_web_menu_content(uuid, text, text, text, text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo reset covers the new tables and restores the system employee
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
    public.web_order_contacts,
    public.web_menu_content,
    public.web_ordering_settings,
    public.location_opening_hours,
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
  perform private.ensure_system_employees();
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
  select 27;
$$;

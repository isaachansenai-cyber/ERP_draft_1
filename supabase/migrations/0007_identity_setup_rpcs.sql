-- 0007 Identity, access and setup RPCs (PRD §4, §16; CLAUDE.md D5, §5.4, §7).
-- Every write RPC: authorize → idempotency → validate → lock → write → audit.

-- ---------------------------------------------------------------------------
-- Read helpers for the frontend
-- ---------------------------------------------------------------------------
create function public.get_public_app_mode()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('data_mode', s.data_mode, 'company_name', s.company_name)
  from public.app_settings s;
$$;

create function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_is_owner boolean;
  v_roles jsonb;
  v_settings public.app_settings;
begin
  select * into v_settings from public.app_settings;
  select * into v_employee from public.employees e where e.auth_user_id = auth.uid() and e.active;
  if v_employee.employee_id is null then
    return jsonb_build_object(
      'signed_in', auth.uid() is not null,
      'employee', null,
      'is_owner', false,
      'roles', '[]'::jsonb,
      'data_mode', v_settings.data_mode,
      'posting_enabled', v_settings.posting_enabled,
      'company_name', v_settings.company_name,
      'business_date', private.business_date());
  end if;

  v_is_owner := private.is_owner();
  if v_is_owner then
    select jsonb_agg(jsonb_build_object('location_id', l.location_id, 'location_name', l.name,
             'short_code', l.short_code, 'role', 'owner') order by l.name)
      into v_roles
    from public.locations l where l.archived_at is null;
  else
    select coalesce(jsonb_agg(jsonb_build_object('location_id', l.location_id, 'location_name', l.name,
             'short_code', l.short_code, 'role', m.role) order by l.name), '[]'::jsonb)
      into v_roles
    from public.memberships m
    join public.locations l on l.location_id = m.location_id
    where m.employee_id = v_employee.employee_id and m.active and l.archived_at is null;
  end if;

  return jsonb_build_object(
    'signed_in', true,
    'employee', jsonb_build_object('employee_id', v_employee.employee_id, 'display_name', v_employee.display_name),
    'is_owner', v_is_owner,
    'roles', v_roles,
    'can_set_manager_pin', v_is_owner or exists (
      select 1 from public.memberships m where m.employee_id = v_employee.employee_id and m.active and m.role = 'manager'),
    'has_manager_pin', exists (select 1 from private.manager_pins p where p.employee_id = v_employee.employee_id),
    'data_mode', v_settings.data_mode,
    'posting_enabled', v_settings.posting_enabled,
    'company_name', v_settings.company_name,
    'business_date', private.business_date());
end;
$$;

-- Lets a client resolve an uncertain outcome before retrying (AC29).
create function public.get_request_result(p_request_key uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_row private.request_log;
begin
  select * into v_row from private.request_log r
  where r.actor_employee_id = v_actor and r.request_key = p_request_key;
  if v_row.request_key is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', case when v_row.result is null then 'in_progress' else 'committed' end,
    'rpc_name', v_row.rpc_name,
    'result', v_row.result,
    'committed_at', v_row.completed_at);
end;
$$;

-- Owner view of staff access, including the linked sign-in email. Managers see
-- staff at their locations without emails.
create function public.list_staff_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := private.is_owner();
begin
  perform private.require_actor();
  if not private.is_owner_or_manager() then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'owner_or_manager'));
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee_id', e.employee_id,
      'display_name', e.display_name,
      'active', e.active,
      'provenance', e.provenance,
      'auth_linked', e.auth_user_id is not null,
      'email', case when v_is_owner then u.email else null end,
      'memberships', coalesce((
        select jsonb_agg(jsonb_build_object('membership_id', m.membership_id, 'role', m.role,
                 'location_id', m.location_id, 'created_at', m.created_at) order by m.location_id nulls first)
        from public.memberships m where m.employee_id = e.employee_id and m.active), '[]'::jsonb)
    ) order by e.display_name)
    from public.employees e
    left join auth.users u on u.id = e.auth_user_id
    where private.can_view_employee(e.employee_id)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Employees and memberships (owner only; PRD §4 "Memberships ... Manage all")
-- ---------------------------------------------------------------------------
create function public.create_employee(p_request_key uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_employee public.employees;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'create_employee', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then
    perform private.raise_error('validation:display_name');
  end if;

  insert into public.employees (employee_id, display_name, provenance)
  values ('EMP-' || lpad(nextval('private.employee_number_seq')::text, 4, '0'), btrim(p_display_name),
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end)
  returning * into v_employee;

  perform private.write_audit(v_actor, 'employee.create', 'employee', v_employee.employee_id,
    null, p_request_key, null, to_jsonb(v_employee));
  v_result := jsonb_build_object('ok', true, 'employee_id', v_employee.employee_id);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Link a staff record to a Supabase Auth user that the operator invited.
create function public.link_employee_auth_user(p_request_key uuid, p_employee_id text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_user_id uuid;
  v_before public.employees;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'link_employee_auth_user', p_request_key);
  if v_cached is not null then return v_cached; end if;

  select * into v_before from public.employees e where e.employee_id = p_employee_id for update;
  if v_before.employee_id is null then
    perform private.raise_error('validation:unknown_employee');
  end if;
  if v_before.auth_user_id is not null then
    perform private.raise_error('conflict:employee_already_linked');
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    perform private.raise_error('validation:auth_user_not_found');
  end if;
  if exists (select 1 from public.employees e where e.auth_user_id = v_user_id) then
    perform private.raise_error('conflict:auth_user_already_linked');
  end if;

  update public.employees set auth_user_id = v_user_id, updated_at = now()
  where employee_id = p_employee_id;

  perform private.write_audit(v_actor, 'employee.link_auth_user', 'employee', p_employee_id,
    null, p_request_key, jsonb_build_object('auth_linked', false), jsonb_build_object('auth_linked', true));
  v_result := jsonb_build_object('ok', true, 'employee_id', p_employee_id);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function private.active_owner_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.memberships m
  join public.employees e on e.employee_id = m.employee_id
  where m.active and m.role = 'owner' and e.active;
$$;

create function public.set_employee_active(p_request_key uuid, p_employee_id text, p_active boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before public.employees;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_employee_active', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_active is null then perform private.raise_error('validation:active'); end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  select * into v_before from public.employees e where e.employee_id = p_employee_id for update;
  if v_before.employee_id is null then perform private.raise_error('validation:unknown_employee'); end if;
  if v_before.active = p_active then
    perform private.raise_error('invalid_state:' || v_before.active::text || '->' || p_active::text);
  end if;

  update public.employees set active = p_active, updated_at = now() where employee_id = p_employee_id;
  if not p_active and private.active_owner_count() = 0 then
    perform private.raise_error('validation:last_owner');
  end if;

  perform private.write_audit(v_actor, 'employee.set_active', 'employee', p_employee_id, null, p_request_key,
    jsonb_build_object('active', v_before.active), jsonb_build_object('active', p_active), p_reason);
  v_result := jsonb_build_object('ok', true, 'employee_id', p_employee_id, 'active', p_active);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function public.grant_membership(p_request_key uuid, p_employee_id text, p_role text, p_location_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_row public.memberships;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'grant_membership', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_role not in ('owner', 'manager', 'employee') then perform private.raise_error('validation:role'); end if;
  if (p_role = 'owner') <> (p_location_id is null) then
    perform private.raise_error('validation:location_id', jsonb_build_object('reason', 'owner_is_company_wide_others_need_location'));
  end if;
  if p_location_id is not null and not exists (select 1 from public.locations l where l.location_id = p_location_id) then
    perform private.raise_error('validation:unknown_location');
  end if;
  perform 1 from public.employees e where e.employee_id = p_employee_id and e.active for update;
  if not found then perform private.raise_error('validation:unknown_or_inactive_employee'); end if;
  if exists (select 1 from public.memberships m where m.employee_id = p_employee_id and m.active
             and coalesce(m.location_id, '*') = coalesce(p_location_id, '*')) then
    perform private.raise_error('conflict:membership_exists');
  end if;

  insert into public.memberships (employee_id, role, location_id, created_by, provenance)
  values (p_employee_id, p_role, p_location_id, v_actor,
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end)
  returning * into v_row;

  perform private.write_audit(v_actor, 'membership.grant', 'membership', v_row.membership_id::text,
    p_location_id, p_request_key, null, to_jsonb(v_row));
  v_result := jsonb_build_object('ok', true, 'membership_id', v_row.membership_id);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function public.revoke_membership(p_request_key uuid, p_membership_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_before public.memberships;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'revoke_membership', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  select * into v_before from public.memberships m where m.membership_id = p_membership_id for update;
  if v_before.membership_id is null then perform private.raise_error('validation:unknown_membership'); end if;
  if not v_before.active then perform private.raise_error('invalid_state:revoked->revoked'); end if;

  update public.memberships
     set active = false, revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(p_reason)
   where membership_id = p_membership_id;
  if v_before.role = 'owner' and private.active_owner_count() = 0 then
    perform private.raise_error('validation:last_owner');
  end if;

  perform private.write_audit(v_actor, 'membership.revoke', 'membership', p_membership_id::text,
    v_before.location_id, p_request_key, to_jsonb(v_before), null, p_reason);
  v_result := jsonb_build_object('ok', true, 'membership_id', p_membership_id);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- First owner for a fresh pilot. Operator runs this once as the database owner
-- (SQL editor / psql) after inviting the owner through Supabase Auth. Not
-- callable through the API.
create function private.bootstrap_owner(p_email text, p_display_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_employee_id text;
begin
  if private.active_owner_count() > 0 then
    perform private.raise_error('forbidden:owner_already_exists');
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    perform private.raise_error('validation:auth_user_not_found');
  end if;
  v_employee_id := 'EMP-' || lpad(nextval('private.employee_number_seq')::text, 4, '0');
  insert into public.employees (employee_id, auth_user_id, display_name)
  values (v_employee_id, v_user_id, btrim(p_display_name));
  insert into public.memberships (employee_id, role, location_id) values (v_employee_id, 'owner', null);
  perform private.write_audit(null, 'owner.bootstrap', 'employee', v_employee_id,
    null, null, null, jsonb_build_object('employee_id', v_employee_id), null, null, 'operator_tooling');
  return v_employee_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manager PIN override (CLAUDE.md D5)
-- ---------------------------------------------------------------------------
create table private.manager_pins (
  employee_id text primary key references public.employees (employee_id) on delete restrict,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create function private.pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_pin ~ '^(\d)\1+$'
      or position(p_pin in '01234567890123456789') > 0
      or position(p_pin in '98765432109876543210') > 0;
$$;

create function public.set_manager_pin(p_request_key uuid, p_new_pin text)
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
  if not (private.is_owner() or exists (
      select 1 from public.memberships m where m.employee_id = v_actor and m.active and m.role = 'manager')) then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'owner_or_manager'));
  end if;
  v_cached := private.idem_begin(v_actor, 'set_manager_pin', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_new_pin is null or p_new_pin !~ '^[0-9]{6,12}$' then
    perform private.raise_error('validation:pin_format', jsonb_build_object('rule', '6 to 12 digits'));
  end if;
  if private.pin_is_weak(p_new_pin) then
    perform private.raise_error('validation:pin_too_simple');
  end if;

  insert into private.manager_pins (employee_id, pin_hash)
  values (v_actor, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)))
  on conflict (employee_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();

  -- The PIN itself is never logged.
  perform private.write_audit(v_actor, 'manager_pin.set', 'employee', v_actor, null, p_request_key);
  v_result := jsonb_build_object('ok', true);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- Returns NULL when the approval is valid, otherwise an error code. It never
-- raises, so failed-attempt counters commit even though the caller rejects the
-- action; callers must return the code (and abandon their idempotency row)
-- rather than raising after a PIN failure.
create function private.check_manager_pin(p_approver_employee_id text, p_pin text, p_location_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin private.manager_pins;
begin
  if not exists (
    select 1 from public.memberships m
    join public.employees e on e.employee_id = m.employee_id
    where m.employee_id = p_approver_employee_id and m.active and e.active
      and (m.role = 'owner' or (m.role = 'manager' and m.location_id = p_location_id))
  ) then
    return 'approver_not_authorized';
  end if;

  select * into v_pin from private.manager_pins p where p.employee_id = p_approver_employee_id for update;
  if v_pin.employee_id is null then
    return 'pin_not_set';
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return 'pin_locked';
  end if;
  if p_pin is null or v_pin.pin_hash <> extensions.crypt(p_pin, v_pin.pin_hash) then
    if v_pin.failed_attempts + 1 >= 5 then
      update private.manager_pins
         set failed_attempts = 0, locked_until = now() + interval '15 minutes', updated_at = now()
       where employee_id = p_approver_employee_id;
      return 'pin_locked';
    end if;
    update private.manager_pins
       set failed_attempts = v_pin.failed_attempts + 1, updated_at = now()
     where employee_id = p_approver_employee_id;
    return 'pin_invalid';
  end if;
  update private.manager_pins
     set failed_attempts = 0, locked_until = null, updated_at = now()
   where employee_id = p_approver_employee_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup gates (owner only)
-- ---------------------------------------------------------------------------
create function public.confirm_setup_gate(p_request_key uuid, p_gate_id uuid, p_evidence_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_gate public.pilot_setup_gates;
  v_failure jsonb;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'confirm_setup_gate', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_evidence_note is null or length(btrim(p_evidence_note)) < 10 then
    perform private.raise_error('validation:evidence_note', jsonb_build_object('min_length', 10));
  end if;
  select * into v_gate from public.pilot_setup_gates g where g.gate_id = p_gate_id for update;
  if v_gate.gate_id is null then perform private.raise_error('validation:unknown_gate'); end if;
  if v_gate.status = 'confirmed' then perform private.raise_error('invalid_state:confirmed->confirmed'); end if;

  v_failure := private.gate_precondition_failure(v_gate);
  if v_failure is not null then
    perform private.raise_error('setup_gate_precondition:' || v_gate.gate_key, v_failure);
  end if;

  update public.pilot_setup_gates
     set status = 'confirmed', confirmed_by = v_actor, confirmed_at = now(),
         evidence_note = btrim(p_evidence_note), updated_at = now()
   where gate_id = p_gate_id;

  perform private.write_audit(v_actor, 'setup_gate.confirm', 'pilot_setup_gate', p_gate_id::text,
    case when v_gate.scope_type = 'location' then v_gate.scope_id end, p_request_key,
    jsonb_build_object('status', 'open'), jsonb_build_object('status', 'confirmed', 'gate_key', v_gate.gate_key,
      'scope_id', v_gate.scope_id), p_evidence_note);
  v_result := jsonb_build_object('ok', true, 'gate_id', p_gate_id, 'status', 'confirmed');
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function public.reopen_setup_gate(p_request_key uuid, p_gate_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_gate public.pilot_setup_gates;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'reopen_setup_gate', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if p_reason is null or length(btrim(p_reason)) < 3 then perform private.raise_error('validation:reason'); end if;
  select * into v_gate from public.pilot_setup_gates g where g.gate_id = p_gate_id for update;
  if v_gate.gate_id is null then perform private.raise_error('validation:unknown_gate'); end if;
  if v_gate.status = 'open' then perform private.raise_error('invalid_state:open->open'); end if;

  update public.pilot_setup_gates
     set status = 'open', confirmed_by = null, confirmed_at = null, updated_at = now()
   where gate_id = p_gate_id;

  -- Reopening a gate the final switch depends on turns posting off again.
  if v_gate.gate_key in ('roles_verified', 'backup_restore_tested', 'acceptance_suite_passed') then
    update public.app_settings set posting_enabled = false, posting_enabled_at = null, posting_enabled_by = null;
  end if;

  perform private.write_audit(v_actor, 'setup_gate.reopen', 'pilot_setup_gate', p_gate_id::text,
    case when v_gate.scope_type = 'location' then v_gate.scope_id end, p_request_key,
    jsonb_build_object('status', 'confirmed', 'evidence_note', v_gate.evidence_note),
    jsonb_build_object('status', 'open'), p_reason);
  v_result := jsonb_build_object('ok', true, 'gate_id', p_gate_id, 'status', 'open');
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function public.enable_posting(p_request_key uuid, p_evidence_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_open jsonb;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'enable_posting', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if (select s.posting_enabled from public.app_settings s) then
    perform private.raise_error('invalid_state:enabled->enabled');
  end if;
  if p_evidence_note is null or length(btrim(p_evidence_note)) < 10 then
    perform private.raise_error('validation:evidence_note', jsonb_build_object('min_length', 10));
  end if;
  select jsonb_agg(g.gate_key order by g.gate_key) into v_open
  from public.pilot_setup_gates g
  where g.gate_key in ('roles_verified', 'backup_restore_tested', 'acceptance_suite_passed') and g.status <> 'confirmed';
  if v_open is not null then
    perform private.raise_error('setup_gate_closed:posting_prerequisites', jsonb_build_object('open_gates', v_open));
  end if;

  update public.app_settings set posting_enabled = true, posting_enabled_at = now(), posting_enabled_by = v_actor;
  perform private.write_audit(v_actor, 'posting.enable', 'app_settings', 'singleton', null, p_request_key,
    jsonb_build_object('posting_enabled', false), jsonb_build_object('posting_enabled', true), p_evidence_note);
  v_result := jsonb_build_object('ok', true, 'posting_enabled', true);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Location tax rates (owner) and menu prices (owner, or manager for own location)
-- Effective-dated and append-only: a new row never rewrites history (AC09).
-- ---------------------------------------------------------------------------
create function public.set_location_tax_rate(p_request_key uuid, p_location_id text, p_rate numeric, p_effective_from date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_row public.location_tax_rates;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'set_location_tax_rate', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if not exists (select 1 from public.locations l where l.location_id = p_location_id) then
    perform private.raise_error('validation:unknown_location');
  end if;
  if p_rate is null or p_rate < 0 or p_rate >= 1 or p_rate <> round(p_rate, 6) then
    perform private.raise_error('validation:rate', jsonb_build_object('rule', 'decimal fraction 0 <= rate < 1, max 6 places'));
  end if;
  if p_effective_from is null or p_effective_from < private.business_date() then
    perform private.raise_error('validation:effective_from', jsonb_build_object('rule', 'today or later'));
  end if;
  if exists (select 1 from public.location_tax_rates t where t.location_id = p_location_id and t.effective_from = p_effective_from) then
    perform private.raise_error('duplicate_business_key:tax_rate_effective_date');
  end if;

  insert into public.location_tax_rates (location_id, effective_from, rate, provenance, confirmed_by, confirmed_at)
  values (p_location_id, p_effective_from, p_rate,
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end,
          v_actor, now())
  returning * into v_row;

  perform private.write_audit(v_actor, 'tax_rate.set', 'location_tax_rate', p_location_id || '@' || p_effective_from,
    p_location_id, p_request_key, null, to_jsonb(v_row));
  v_result := jsonb_build_object('ok', true, 'location_id', p_location_id, 'effective_from', p_effective_from, 'rate', p_rate::text);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create function public.set_location_item_price(p_request_key uuid, p_location_id text, p_item_id text,
  p_price_cents bigint, p_effective_from date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_row public.location_item_prices;
  v_result jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'set_location_item_price', p_request_key);
  if v_cached is not null then return v_cached; end if;

  if not exists (select 1 from public.items i where i.item_id = p_item_id and i.is_sellable and i.archived_at is null) then
    perform private.raise_error('validation:item_not_sellable', jsonb_build_object('item_id', p_item_id));
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000 then
    perform private.raise_error('validation:price_cents', jsonb_build_object('rule', '0 to 100000 cents'));
  end if;
  if p_effective_from is null or p_effective_from < private.business_date() then
    perform private.raise_error('validation:effective_from', jsonb_build_object('rule', 'today or later'));
  end if;
  if exists (select 1 from public.location_item_prices p
             where p.location_id = p_location_id and p.item_id = p_item_id and p.effective_from = p_effective_from) then
    perform private.raise_error('duplicate_business_key:price_effective_date');
  end if;

  insert into public.location_item_prices (location_id, item_id, price_cents, effective_from, provenance, created_by)
  values (p_location_id, p_item_id, p_price_cents, p_effective_from,
          case when private.data_mode() = 'demo' then 'demo_operator_entered' else 'pilot_operator_entered' end, v_actor)
  returning * into v_row;

  perform private.write_audit(v_actor, 'price.set', 'location_item_price',
    p_location_id || '/' || p_item_id || '@' || p_effective_from, p_location_id, p_request_key, null, to_jsonb(v_row));
  v_result := jsonb_build_object('ok', true, 'location_id', p_location_id, 'item_id', p_item_id,
    'price_cents', p_price_cents, 'effective_from', p_effective_from);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only these entry points are reachable through the API.
-- ---------------------------------------------------------------------------
grant execute on function public.get_public_app_mode() to anon, authenticated;
grant execute on function
  public.get_my_context(),
  public.get_request_result(uuid),
  public.list_staff_access(),
  public.create_employee(uuid, text),
  public.link_employee_auth_user(uuid, text, text),
  public.set_employee_active(uuid, text, boolean, text),
  public.grant_membership(uuid, text, text, text),
  public.revoke_membership(uuid, uuid, text),
  public.set_manager_pin(uuid, text),
  public.confirm_setup_gate(uuid, uuid, text),
  public.reopen_setup_gate(uuid, uuid, text),
  public.enable_posting(uuid, text),
  public.set_location_tax_rate(uuid, text, numeric, date),
  public.set_location_item_price(uuid, text, text, bigint, date)
to authenticated;

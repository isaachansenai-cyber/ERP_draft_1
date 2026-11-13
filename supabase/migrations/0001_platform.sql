-- 0001 Platform foundation (PRD §4, §14, §15)
-- Extensions, private schema, default privileges, identity (locations, employees,
-- memberships), app settings/data mode, idempotency log, audit log and shared
-- guard/trigger helpers.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Privileges. Nothing in public is readable, writable or executable by the API
-- roles unless a migration grants it explicitly. Functions no longer get the
-- implicit PUBLIC execute grant.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- authenticated needs USAGE only so RLS policies can call the helper functions
-- that are explicitly granted below. No private table is granted to any API role.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Error helper: every business error is raised with a stable machine code as
-- the message (CLAUDE.md §5.4) and optional JSON detail.
-- ---------------------------------------------------------------------------
-- Declared STABLE (it has no side effects other than raising) so STABLE
-- helpers can call it.
create function private.raise_error(p_code text, p_detail jsonb default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  raise exception using
    message = p_code,
    detail = coalesce(p_detail::text, ''),
    errcode = 'P0001';
end;
$$;

-- Local business date (America/Denver calendar date, day boundary at local midnight).
create function private.business_date(p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'America/Denver')::date;
$$;

-- Generic immutability trigger (append-only tables).
create function private.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.raise_error('immutable:' || tg_table_name,
    jsonb_build_object('operation', tg_op));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Locations (PRD §1: exactly three; American Fork is not a location).
-- ---------------------------------------------------------------------------
create table public.locations (
  location_id text primary key check (location_id ~ '^LOC-[A-Z]{3}$'),
  short_code text not null unique check (short_code ~ '^[A-Z]{3}$'),
  name text not null unique,
  city text not null,
  timezone text not null default 'America/Denver' check (timezone = 'America/Denver'),
  source text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

insert into public.locations (location_id, short_code, name, city, source) values
  ('LOC-PRO', 'PRO', 'Provo', 'Provo', 'Rosie''s To-do list.docx'),
  ('LOC-SFO', 'SFO', 'Spanish Fork', 'Spanish Fork', 'Rosie''s To-do list.docx'),
  ('LOC-SLC', 'SLC', 'Salt Lake City', 'Salt Lake City', 'Rosie''s To-do list.docx');

-- ---------------------------------------------------------------------------
-- App settings singleton. data_mode is set to 'pilot' here and can only change
-- through private.enable_demo_mode() (0008) on a pristine database.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  singleton boolean primary key default true check (singleton),
  data_mode text not null check (data_mode in ('pilot', 'demo')),
  dataset_id text,
  posting_enabled boolean not null default false,
  posting_enabled_at timestamptz,
  posting_enabled_by text,
  company_name text not null default 'Meats Around the World',
  currency text not null default 'USD' check (currency = 'USD'),
  business_timezone text not null default 'America/Denver' check (business_timezone = 'America/Denver'),
  mode_changed_at timestamptz not null default now(),
  constraint app_settings_dataset_only_in_demo check (data_mode = 'demo' or dataset_id is null)
);

insert into public.app_settings (data_mode) values ('pilot');

create function private.app_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.raise_error('immutable:app_settings');
  end if;
  if new.data_mode is distinct from old.data_mode
     and coalesce(current_setting('app.allow_mode_change', true), '') <> 'on' then
    perform private.raise_error('forbidden:data_mode_change');
  end if;
  return new;
end;
$$;

create trigger app_settings_guard
  before update or delete on public.app_settings
  for each row execute function private.app_settings_guard();

create function private.data_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.data_mode from public.app_settings s;
$$;

-- Reject synthetic/demo-only values while the database is in pilot mode
-- (PRD §15/§16, AC02). TG_ARGV lists the columns to inspect.
create function private.guard_no_synthetic_in_pilot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_col text;
  v_val text;
begin
  if (select s.data_mode from public.app_settings s) = 'demo' then
    return new;
  end if;
  foreach v_col in array tg_argv loop
    v_val := coalesce(v_row ->> v_col, '');
    if v_val ilike 'synthetic%' or v_val ilike '%example.invalid%' or v_val ilike 'demo-%' then
      perform private.raise_error('forbidden:synthetic_data_in_pilot',
        jsonb_build_object('table', tg_table_name, 'column', v_col));
    end if;
  end loop;
  return new;
end;
$$;

-- TRUNCATE is only allowed on protected tables in a demo database (demo reset).
create function private.forbid_truncate_outside_demo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select s.data_mode from public.app_settings s) <> 'demo' then
    perform private.raise_error('forbidden:truncate_outside_demo',
      jsonb_build_object('table', tg_table_name));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Employees and memberships (PRD §4, §11). Customers are not app users.
-- ---------------------------------------------------------------------------
create sequence private.employee_number_seq;

create table public.employees (
  employee_id text primary key check (employee_id ~ '^[A-Z0-9][A-Z0-9-]{2,40}$'),
  auth_user_id uuid unique references auth.users (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  active boolean not null default true,
  provenance text not null default 'pilot_operator_entered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger employees_no_synthetic_in_pilot
  before insert or update on public.employees
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'employee_id');

create table public.memberships (
  membership_id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (employee_id) on delete restrict,
  role text not null check (role in ('owner', 'manager', 'employee')),
  location_id text references public.locations (location_id) on delete restrict,
  active boolean not null default true,
  provenance text not null default 'pilot_operator_entered',
  created_at timestamptz not null default now(),
  created_by text references public.employees (employee_id) on delete restrict,
  revoked_at timestamptz,
  revoked_by text references public.employees (employee_id) on delete restrict,
  revoke_reason text,
  constraint memberships_owner_scope check ((role = 'owner') = (location_id is null)),
  constraint memberships_revocation check (active = (revoked_at is null))
);

-- One active role per employee per scope (owner scope = company).
create unique index memberships_one_active_per_scope
  on public.memberships (employee_id, coalesce(location_id, '*'))
  where active;
create index memberships_location_idx on public.memberships (location_id) where active;

create trigger memberships_no_synthetic_in_pilot
  before insert or update on public.memberships
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER so RLS policies can call them without
-- recursive policy evaluation. They only ever resolve the caller's own auth.uid().
-- ---------------------------------------------------------------------------
create function private.current_employee_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.employee_id
  from public.employees e
  where e.auth_user_id = auth.uid() and e.active;
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.employees e on e.employee_id = m.employee_id
    where e.auth_user_id = auth.uid() and e.active and m.active and m.role = 'owner'
  );
$$;

create function private.has_location_role(p_location_id text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner() or exists (
    select 1
    from public.memberships m
    join public.employees e on e.employee_id = m.employee_id
    where e.auth_user_id = auth.uid() and e.active and m.active
      and m.location_id = p_location_id and m.role = any (p_roles)
  );
$$;

-- Locations the caller may operate in (any role). Owner: all.
create function private.accessible_location_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select l.location_id from public.locations l where private.is_owner()
  union
  select m.location_id
  from public.memberships m
  join public.employees e on e.employee_id = m.employee_id
  where e.auth_user_id = auth.uid() and e.active and m.active and m.location_id is not null;
$$;

-- Locations the caller manages. Owner: all.
create function private.managed_location_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select l.location_id from public.locations l where private.is_owner()
  union
  select m.location_id
  from public.memberships m
  join public.employees e on e.employee_id = m.employee_id
  where e.auth_user_id = auth.uid() and e.active and m.active
    and m.role = 'manager' and m.location_id is not null;
$$;

create function private.is_owner_or_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner() or exists (select 1 from private.managed_location_ids());
$$;

-- Employees visible to the caller: self, owner sees all, managers see staff with
-- a membership at a location they manage.
create function private.can_view_employee(p_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner()
    or p_employee_id = private.current_employee_id()
    or exists (
      select 1 from public.memberships m
      where m.employee_id = p_employee_id and m.active
        and m.location_id in (select private.managed_location_ids())
    );
$$;

-- Resolve the calling employee or raise 'unauthorized'.
create function private.require_actor()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id text := private.current_employee_id();
begin
  if v_employee_id is null then
    perform private.raise_error('unauthorized', jsonb_build_object('reason', 'no_active_employee_for_session'));
  end if;
  return v_employee_id;
end;
$$;

create function private.require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'owner'));
  end if;
end;
$$;

create function private.require_location_role(p_location_id text, p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_location_id is null or not private.has_location_role(p_location_id, p_roles) then
    perform private.raise_error('unauthorized',
      jsonb_build_object('location_id', p_location_id, 'required_roles', p_roles));
  end if;
end;
$$;

grant execute on function
  private.current_employee_id(),
  private.is_owner(),
  private.has_location_role(text, text[]),
  private.accessible_location_ids(),
  private.managed_location_ids(),
  private.is_owner_or_manager(),
  private.can_view_employee(text),
  private.business_date(timestamptz),
  private.data_mode()
to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency (PRD §6, AC07, AC29). Scope = (actor employee, request key); the
-- RPC name is stored and a key reused for a different RPC is rejected.
-- A pending row is inserted first so a concurrent duplicate blocks on the unique
-- key and then reads the committed result instead of executing twice.
-- ---------------------------------------------------------------------------
create table private.request_log (
  actor_employee_id text not null,
  request_key uuid not null,
  rpc_name text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_employee_id, request_key)
);

create function private.idem_begin(p_actor text, p_rpc text, p_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.request_log;
begin
  if p_key is null then
    perform private.raise_error('validation:request_key');
  end if;
  insert into private.request_log (actor_employee_id, request_key, rpc_name)
  values (p_actor, p_key, p_rpc)
  on conflict do nothing;
  if found then
    return null; -- first execution: caller proceeds
  end if;
  select * into v_row from private.request_log r
  where r.actor_employee_id = p_actor and r.request_key = p_key;
  if v_row.rpc_name <> p_rpc then
    perform private.raise_error('conflict:request_key_reused',
      jsonb_build_object('original_rpc', v_row.rpc_name));
  end if;
  if v_row.result is null then
    perform private.raise_error('conflict:request_in_progress');
  end if;
  return v_row.result || jsonb_build_object('replayed', true);
end;
$$;

create function private.idem_finish(p_actor text, p_key uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.request_log r
     set result = p_result, completed_at = now()
   where r.actor_employee_id = p_actor and r.request_key = p_key;
  return p_result;
end;
$$;

-- Used when an RPC returns a non-raised failure (e.g. wrong PIN) so a later
-- retry with the same key can still succeed.
create function private.idem_abandon(p_actor text, p_key uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.request_log r
  where r.actor_employee_id = p_actor and r.request_key = p_key and r.result is null;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (PRD §14). Append-only; written only by RPCs/importers.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  audit_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_employee_id text references public.employees (employee_id) on delete restrict,
  approver_employee_id text references public.employees (employee_id) on delete restrict,
  actor_kind text not null default 'employee' check (actor_kind in ('employee', 'operator_tooling', 'migration')),
  action text not null,
  object_type text not null,
  object_id text,
  location_id text references public.locations (location_id) on delete restrict,
  request_key uuid,
  before_data jsonb,
  after_data jsonb,
  note text
);

create index audit_log_location_idx on public.audit_log (location_id, occurred_at desc);
create index audit_log_object_idx on public.audit_log (object_type, object_id);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_update_delete();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.forbid_truncate_outside_demo();

create function private.write_audit(
  p_actor text,
  p_action text,
  p_object_type text,
  p_object_id text,
  p_location_id text default null,
  p_request_key uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_note text default null,
  p_approver text default null,
  p_actor_kind text default 'employee'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_employee_id, approver_employee_id, actor_kind, action,
    object_type, object_id, location_id, request_key, before_data, after_data, note)
  values (p_actor, p_approver, p_actor_kind, p_action, p_object_type, p_object_id,
    p_location_id, p_request_key, p_before, p_after, p_note);
$$;

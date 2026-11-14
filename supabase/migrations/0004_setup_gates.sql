-- 0004 Pilot setup gates (CLAUDE.md §7, PRD §16 "Pilot import gates").
-- Each gate keeps a dependent workflow disabled until the owner confirms it.
-- Gates are never auto-confirmed. In a demo database the demo seed marks them
-- confirmed with synthetic provenance.

create table public.pilot_setup_gates (
  gate_id uuid primary key default gen_random_uuid(),
  gate_key text not null,
  scope_type text not null check (scope_type in ('company', 'location', 'supplier', 'supplier_item', 'item')),
  scope_id text,
  status text not null default 'open' check (status in ('open', 'confirmed')),
  confirmed_by text references public.employees (employee_id) on delete restrict,
  confirmed_at timestamptz,
  evidence_note text,
  provenance text not null default 'pilot_setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_setup_gates_key_scope check (
    (gate_key in ('roles_verified', 'perishables_confirmed', 'return_policy_configured',
                  'backup_restore_tested', 'acceptance_suite_passed') and scope_type = 'company' and scope_id is null)
    or (gate_key in ('menu_prices_confirmed', 'tax_rate_confirmed', 'opening_counts_posted',
                     'planning_inputs_confirmed') and scope_type = 'location' and scope_id is not null)
    or (gate_key = 'supplier_master_verified' and scope_type = 'supplier' and scope_id is not null)
    or (gate_key = 'pack_conversions_verified' and scope_type = 'supplier_item' and scope_id is not null)
    or (gate_key = 'recipes_verified' and scope_type = 'item' and scope_id is not null)),
  constraint pilot_setup_gates_confirmation check (
    (status = 'open' and confirmed_at is null and confirmed_by is null)
    or (status = 'confirmed' and confirmed_at is not null and evidence_note is not null
        and (confirmed_by is not null or provenance ilike 'synthetic%')))
);

create unique index pilot_setup_gates_unique_scope
  on public.pilot_setup_gates (gate_key, coalesce(scope_id, ''));

create trigger pilot_setup_gates_no_synthetic_in_pilot
  before insert or update on public.pilot_setup_gates
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- Company- and location-scope gates always exist. Supplier, supplier-item and
-- recipe gates are created by the source import when those records arrive.
create function private.ensure_base_gates()
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
                    'planning_inputs_confirmed']) as k
  cross join public.locations l
  on conflict do nothing;
$$;

select private.ensure_base_gates();

create function private.gate_confirmed(p_gate_key text, p_scope_id text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select g.status = 'confirmed'
    from public.pilot_setup_gates g
    where g.gate_key = p_gate_key and coalesce(g.scope_id, '') = coalesce(p_scope_id, '')
  ), false);
$$;

-- Raise setup_gate_closed:<gate> unless confirmed. Used by operational RPCs.
create function private.require_gate(p_gate_key text, p_scope_id text default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.gate_confirmed(p_gate_key, p_scope_id) then
    perform private.raise_error('setup_gate_closed:' || p_gate_key,
      jsonb_build_object('gate_key', p_gate_key, 'scope_id', p_scope_id));
  end if;
end;
$$;

-- Operational posting (orders, clocking, etc.) also requires the final switch.
create function private.require_posting_enabled()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select s.posting_enabled from public.app_settings s), false) then
    perform private.raise_error('setup_gate_closed:posting_enabled');
  end if;
end;
$$;

-- Preconditions checked when the owner confirms a gate. A gate whose underlying
-- data model is delivered in a later milestone cannot be confirmed yet.
create function private.gate_precondition_failure(p_gate public.pilot_setup_gates)
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
    when 'opening_counts_posted', 'planning_inputs_confirmed', 'return_policy_configured' then
      return jsonb_build_object('reason', 'workflow_not_yet_available',
        'note', 'The screen that records this value is delivered in a later milestone.');
    else
      null; -- attestation gates: evidence note is the precondition
  end case;
  return null;
end;
$$;

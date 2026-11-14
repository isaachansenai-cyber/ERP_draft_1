-- 0008 Demo mode controls (PRD §15, §16; CLAUDE.md §7, AC02).
-- None of these functions is granted to an API role: they run only for the
-- database owner through operator tooling (scripts/demo/*), which additionally
-- checks the project ref against DEMO_PROJECT_REF_ALLOWLIST.

-- Switch a pristine database to demo mode. A database that holds any staff,
-- customer, history or audit record (i.e. any real pilot use) is refused, so a
-- pilot project can never be turned into a resettable demo.
create function private.enable_demo_mode(p_dataset_id text)
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
  if exists (select 1 from public.employees)
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

-- Mark every gate confirmed with synthetic provenance and enable posting.
-- Demo only (the gate table guard also rejects synthetic rows in pilot).
create function private.confirm_gates_for_demo()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if private.data_mode() <> 'demo' then
    perform private.raise_error('forbidden:not_demo_database');
  end if;
  update public.pilot_setup_gates
     set status = 'confirmed', confirmed_at = now(), confirmed_by = null,
         evidence_note = 'Synthetic demo seed; not a verified operating value.',
         provenance = 'synthetic_demo_seed', updated_at = now()
   where status = 'open';
  get diagnostics v_count = row_count;
  update public.app_settings set posting_enabled = true, posting_enabled_at = now(), posting_enabled_by = null
   where not posting_enabled;
  return v_count;
end;
$$;

-- Wipe all demo data back to the post-migration state so the importers can
-- rebuild it. Refuses unless the database is in demo mode. Auth users are left
-- in place; scripts/demo/create-demo-users.ts relinks them.
create function private.reset_demo_data()
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
    public.employees;
  perform private.ensure_base_gates();
  update public.app_settings set posting_enabled = false, posting_enabled_at = null, posting_enabled_by = null;
  perform private.write_audit(null, 'demo.reset', 'app_settings', 'singleton', null, null, null, null,
    null, null, 'operator_tooling');
end;
$$;

revoke all on function private.enable_demo_mode(text), private.confirm_gates_for_demo(),
  private.reset_demo_data(), private.bootstrap_owner(text, text) from public, anon, authenticated;

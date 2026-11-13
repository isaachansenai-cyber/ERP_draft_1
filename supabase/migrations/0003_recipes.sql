-- 0003 Recipes (PRD §5): immutable versions with per-serving components.
-- Components must be ingredients in their catalog base unit; parents must be
-- finished dishes. No nested recipes, substitutions or modifiers.

create table public.recipe_versions (
  recipe_version_id uuid primary key default gen_random_uuid(),
  parent_item_id text not null,
  parent_item_type text not null default 'finished_dish' check (parent_item_type = 'finished_dish'),
  parent_base_unit text not null default 'serving' check (parent_base_unit = 'serving'),
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  basis text not null,
  source text not null,
  provenance text not null,
  created_by text references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  foreign key (parent_item_id, parent_item_type, parent_base_unit)
    references public.items (item_id, item_type, base_unit),
  unique (parent_item_id, version_no),
  constraint recipe_versions_activation check ((status = 'draft') = (activated_at is null)),
  constraint recipe_versions_superseded check ((status = 'superseded') = (superseded_at is not null))
);

create unique index recipe_versions_one_active on public.recipe_versions (parent_item_id) where status = 'active';

create table public.recipe_components (
  recipe_version_id uuid not null references public.recipe_versions (recipe_version_id) on delete restrict,
  line_no integer not null check (line_no > 0),
  component_item_id text not null,
  component_item_type text not null default 'ingredient' check (component_item_type = 'ingredient'),
  unit text not null,
  quantity_per_serving numeric(18, 6) not null check (quantity_per_serving > 0),
  basis text not null,
  source text not null,
  primary key (recipe_version_id, component_item_id),
  unique (recipe_version_id, line_no),
  foreign key (component_item_id, component_item_type, unit)
    references public.items (item_id, item_type, base_unit)
);

-- Versions: only draft→active and active→superseded transitions; nothing else
-- changes once a version leaves draft. Deleting a non-draft version is refused.
create function private.recipe_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      perform private.raise_error('immutable:recipe_version', jsonb_build_object('status', old.status));
    end if;
    return old;
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if old.status = 'active' and new.status = 'superseded'
     and (to_jsonb(new) - array['status', 'superseded_at']) = (to_jsonb(old) - array['status', 'superseded_at']) then
    return new;
  end if;
  perform private.raise_error('immutable:recipe_version', jsonb_build_object('status', old.status));
  return null;
end;
$$;

create trigger recipe_versions_guard
  before update or delete on public.recipe_versions
  for each row execute function private.recipe_versions_guard();

create trigger recipe_versions_no_synthetic_in_pilot
  before insert or update on public.recipe_versions
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- Components can change only while their version is a draft.
create function private.recipe_components_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid := case when tg_op = 'DELETE' then old.recipe_version_id else new.recipe_version_id end;
  v_status text;
begin
  select v.status into v_status from public.recipe_versions v where v.recipe_version_id = v_version;
  if v_status is distinct from 'draft' then
    perform private.raise_error('immutable:recipe_version', jsonb_build_object('status', v_status));
  end if;
  if tg_op = 'UPDATE' and old.recipe_version_id <> new.recipe_version_id then
    perform private.raise_error('immutable:recipe_component_version');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger recipe_components_guard
  before insert or update or delete on public.recipe_components
  for each row execute function private.recipe_components_guard();

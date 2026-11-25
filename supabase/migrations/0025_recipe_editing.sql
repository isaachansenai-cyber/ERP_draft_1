-- 0025 Owner recipe editing (ADR 0037).
--
-- Recipes stay versioned and immutable once active (0003). The owner edits a
-- dish by working on a DRAFT copy of its active version, then activates it:
-- the old version becomes 'superseded' and is kept. Order lines already point
-- at the version and requirements they were accepted with, so accepted,
-- preparing and completed orders are unaffected. New orders, order edits
-- (which build a new revision at current prices) and planning use the newly
-- active version.
--
-- The 'recipes_verified' pilot gate is NOT reopened by an activation: the
-- owner who edits is the person who confirms that gate (operator decision,
-- 2026-11-25). The audit log keeps both versions' lines.

alter table public.recipe_versions
  add column draft_revision integer not null default 1 check (draft_revision > 0),
  add column activated_by text references public.employees (employee_id) on delete restrict,
  add column change_note text;

-- At most one draft per dish.
create unique index recipe_versions_one_draft on public.recipe_versions (parent_item_id) where status = 'draft';

-- Shared check for the draft functions: owner only, draft exists, revision matches.
create function private.lock_recipe_draft(p_recipe_version_id uuid, p_expected_revision integer)
returns public.recipe_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.recipe_versions;
begin
  select * into v_draft from public.recipe_versions v where v.recipe_version_id = p_recipe_version_id for update;
  if v_draft.recipe_version_id is null then perform private.raise_error('validation:unknown_recipe_version'); end if;
  if v_draft.status <> 'draft' then
    perform private.raise_error('invalid_state:' || v_draft.status || '->edit', jsonb_build_object('status', v_draft.status));
  end if;
  if p_expected_revision is null or v_draft.draft_revision <> p_expected_revision then
    perform private.raise_error('conflict:stale_version', jsonb_build_object('current_revision', v_draft.draft_revision));
  end if;
  return v_draft;
end;
$$;

create function private.recipe_lines_json(p_recipe_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_no', c.line_no, 'item_id', c.component_item_id, 'name', i.name,
           'unit', c.unit, 'quantity_per_serving', c.quantity_per_serving::text, 'basis', c.basis, 'source', c.source)
           order by c.line_no), '[]'::jsonb)
  from public.recipe_components c join public.items i on i.item_id = c.component_item_id
  where c.recipe_version_id = p_recipe_version_id;
$$;

-- ---------------------------------------------------------------------------
-- Start (or resume) a draft for one dish, copied from its active version.
-- ---------------------------------------------------------------------------
create function public.start_recipe_draft(p_request_key uuid, p_dish_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_dish public.items;
  v_active public.recipe_versions;
  v_draft public.recipe_versions;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'start_recipe_draft', p_request_key);
  if v_cached is not null then return v_cached; end if;
  select * into v_dish from public.items i
  where i.item_id = p_dish_id and i.item_type = 'finished_dish' and i.archived_at is null for update;
  if v_dish.item_id is null then perform private.raise_error('validation:unknown_dish'); end if;

  select * into v_draft from public.recipe_versions v where v.parent_item_id = p_dish_id and v.status = 'draft';
  if v_draft.recipe_version_id is null then
    select * into v_active from public.recipe_versions v where v.parent_item_id = p_dish_id and v.status = 'active';
    insert into public.recipe_versions (parent_item_id, version_no, status, basis, source, provenance, created_by)
    values (p_dish_id,
            (select coalesce(max(v.version_no), 0) + 1 from public.recipe_versions v where v.parent_item_id = p_dish_id),
            'draft', 'owner_entered', 'Recipe editor',
            case when private.data_mode() = 'demo' then 'demo_owner_entered' else 'pilot_owner_entered' end, v_actor)
    returning * into v_draft;
    if v_active.recipe_version_id is not null then
      insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
      select v_draft.recipe_version_id, c.line_no, c.component_item_id, c.unit, c.quantity_per_serving, c.basis, c.source
      from public.recipe_components c where c.recipe_version_id = v_active.recipe_version_id;
    end if;
    perform private.write_audit(v_actor, 'recipe.draft_start', 'recipe_version', v_draft.recipe_version_id::text, null,
      p_request_key, null, jsonb_build_object('dish_id', p_dish_id, 'version_no', v_draft.version_no,
        'copied_from_version_no', v_active.version_no));
  end if;

  v_result := jsonb_build_object('ok', true, 'recipe_version_id', v_draft.recipe_version_id, 'dish_id', p_dish_id,
    'version_no', v_draft.version_no, 'draft_revision', v_draft.draft_revision,
    'lines', private.recipe_lines_json(v_draft.recipe_version_id));
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace a draft's lines. p_lines: [{item_id, quantity_per_serving}] where the
-- quantity is in the ingredient's base unit and is sent as text or number.
-- ---------------------------------------------------------------------------
create function public.save_recipe_draft(p_request_key uuid, p_recipe_version_id uuid, p_expected_revision integer,
  p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_draft public.recipe_versions;
  v_before jsonb;
  v_item public.items;
  v_old public.recipe_components;
  r record;
  v_no integer := 0;
  v_seen text[] := array[]::text[];
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'save_recipe_draft', p_request_key);
  if v_cached is not null then return v_cached; end if;
  v_draft := private.lock_recipe_draft(p_recipe_version_id, p_expected_revision);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_error('validation:recipe_lines', jsonb_build_object('rule', 'at least one ingredient'));
  end if;
  if jsonb_array_length(p_lines) > 40 then
    perform private.raise_error('validation:recipe_lines', jsonb_build_object('rule', 'at most 40 ingredients'));
  end if;
  v_before := private.recipe_lines_json(v_draft.recipe_version_id);

  -- Validate every line before writing anything.
  for r in select x.item_id, x.quantity_per_serving as q
           from jsonb_to_recordset(p_lines) as x(item_id text, quantity_per_serving text) loop
    v_no := v_no + 1;
    select * into v_item from public.items i where i.item_id = r.item_id and i.item_type = 'ingredient' and i.archived_at is null;
    if v_item.item_id is null then
      perform private.raise_error('validation:recipe_ingredient', jsonb_build_object('line_no', v_no, 'item_id', r.item_id));
    end if;
    if r.item_id = any (v_seen) then
      perform private.raise_error('validation:recipe_duplicate_ingredient', jsonb_build_object('item_id', r.item_id));
    end if;
    v_seen := v_seen || r.item_id;
    if r.q is null or r.q !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' or btrim(r.q)::numeric <= 0
       or btrim(r.q)::numeric <> round(btrim(r.q)::numeric, 6) or btrim(r.q)::numeric > 100000 then
      perform private.raise_error('validation:recipe_quantity',
        jsonb_build_object('line_no', v_no, 'item_id', r.item_id, 'rule', 'greater than 0, at most 6 decimals'));
    end if;
  end loop;

  delete from public.recipe_components c where c.recipe_version_id = v_draft.recipe_version_id;
  v_no := 0;
  for r in select t.e ->> 'item_id' as item_id, btrim(t.e ->> 'quantity_per_serving')::numeric as q
           from jsonb_array_elements(p_lines) with ordinality as t(e, n)
           order by t.n loop
    v_no := v_no + 1;
    -- A line the owner did not change keeps its source label; anything else is owner-entered.
    select c.* into v_old
    from public.recipe_versions v join public.recipe_components c on c.recipe_version_id = v.recipe_version_id
    where v.parent_item_id = v_draft.parent_item_id and v.status = 'active' and c.component_item_id = r.item_id
      and c.quantity_per_serving = r.q;
    insert into public.recipe_components (recipe_version_id, line_no, component_item_id, unit, quantity_per_serving, basis, source)
    select v_draft.recipe_version_id, v_no, i.item_id, i.base_unit, r.q,
           coalesce(v_old.basis, 'owner_entered'), coalesce(v_old.source, 'Recipe editor')
    from public.items i where i.item_id = r.item_id;
    v_old := null;
  end loop;

  update public.recipe_versions set draft_revision = draft_revision + 1
  where recipe_version_id = v_draft.recipe_version_id
  returning * into v_draft;
  perform private.write_audit(v_actor, 'recipe.draft_save', 'recipe_version', v_draft.recipe_version_id::text, null,
    p_request_key, jsonb_build_object('lines', v_before),
    jsonb_build_object('lines', private.recipe_lines_json(v_draft.recipe_version_id)));
  v_result := jsonb_build_object('ok', true, 'recipe_version_id', v_draft.recipe_version_id,
    'draft_revision', v_draft.draft_revision, 'lines', private.recipe_lines_json(v_draft.recipe_version_id));
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Activate a saved draft: the current active version is superseded.
-- ---------------------------------------------------------------------------
create function public.activate_recipe_version(p_request_key uuid, p_recipe_version_id uuid, p_expected_revision integer,
  p_change_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_draft public.recipe_versions;
  v_active public.recipe_versions;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'activate_recipe_version', p_request_key);
  if v_cached is not null then return v_cached; end if;
  if p_change_note is null or length(btrim(p_change_note)) < 3 then
    perform private.raise_error('validation:change_note', jsonb_build_object('rule', 'at least 3 characters'));
  end if;
  -- Lock order: the dish's active version, then the draft.
  select * into v_active from public.recipe_versions v
  where v.parent_item_id = (select d.parent_item_id from public.recipe_versions d where d.recipe_version_id = p_recipe_version_id)
    and v.status = 'active' for update;
  v_draft := private.lock_recipe_draft(p_recipe_version_id, p_expected_revision);
  if not exists (select 1 from public.recipe_components c where c.recipe_version_id = v_draft.recipe_version_id) then
    perform private.raise_error('validation:recipe_lines', jsonb_build_object('rule', 'at least one ingredient'));
  end if;
  if v_active.recipe_version_id is not null
     and (select jsonb_agg(jsonb_build_array(c.component_item_id, c.quantity_per_serving) order by c.component_item_id)
          from public.recipe_components c where c.recipe_version_id = v_active.recipe_version_id)
       = (select jsonb_agg(jsonb_build_array(c.component_item_id, c.quantity_per_serving) order by c.component_item_id)
          from public.recipe_components c where c.recipe_version_id = v_draft.recipe_version_id) then
    perform private.raise_error('validation:recipe_unchanged');
  end if;

  if v_active.recipe_version_id is not null then
    update public.recipe_versions set status = 'superseded', superseded_at = now()
    where recipe_version_id = v_active.recipe_version_id;
  end if;
  update public.recipe_versions
     set status = 'active', activated_at = now(), activated_by = v_actor, change_note = btrim(p_change_note)
   where recipe_version_id = v_draft.recipe_version_id
  returning * into v_draft;

  perform private.write_audit(v_actor, 'recipe.activate', 'recipe_version', v_draft.recipe_version_id::text, null,
    p_request_key,
    case when v_active.recipe_version_id is not null then jsonb_build_object('version_no', v_active.version_no,
      'recipe_version_id', v_active.recipe_version_id, 'lines', private.recipe_lines_json(v_active.recipe_version_id)) end,
    jsonb_build_object('dish_id', v_draft.parent_item_id, 'version_no', v_draft.version_no,
      'lines', private.recipe_lines_json(v_draft.recipe_version_id)),
    btrim(p_change_note));
  v_result := jsonb_build_object('ok', true, 'recipe_version_id', v_draft.recipe_version_id,
    'dish_id', v_draft.parent_item_id, 'version_no', v_draft.version_no, 'status', 'active',
    'superseded_version_no', v_active.version_no);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Throw a draft away (drafts were never used by any order).
-- ---------------------------------------------------------------------------
create function public.discard_recipe_draft(p_request_key uuid, p_recipe_version_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  v_draft public.recipe_versions;
  v_result jsonb;
begin
  perform private.require_owner();
  v_cached := private.idem_begin(v_actor, 'discard_recipe_draft', p_request_key);
  if v_cached is not null then return v_cached; end if;
  v_draft := private.lock_recipe_draft(p_recipe_version_id, p_expected_revision);
  perform private.write_audit(v_actor, 'recipe.draft_discard', 'recipe_version', v_draft.recipe_version_id::text, null,
    p_request_key, jsonb_build_object('dish_id', v_draft.parent_item_id, 'version_no', v_draft.version_no,
      'lines', private.recipe_lines_json(v_draft.recipe_version_id)), null);
  delete from public.recipe_components c where c.recipe_version_id = v_draft.recipe_version_id;
  delete from public.recipe_versions v where v.recipe_version_id = v_draft.recipe_version_id;
  v_result := jsonb_build_object('ok', true, 'recipe_version_id', v_draft.recipe_version_id, 'discarded', true);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read: every dish with its active recipe, version history and (owner) draft.
-- Owner and managers. Recipes hold no costs, so managers may read them.
-- ---------------------------------------------------------------------------
create function public.get_recipes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean;
begin
  perform private.require_actor();
  if not private.is_owner_or_manager() then
    perform private.raise_error('unauthorized', jsonb_build_object('required_role', 'manager'));
  end if;
  v_owner := private.is_owner();
  return jsonb_build_object(
    'can_edit', v_owner,
    'dishes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dish_id', d.item_id, 'name', d.name, 'category', d.category,
        'recipes_verified', private.gate_confirmed('recipes_verified', d.item_id),
        'active', (select jsonb_build_object('recipe_version_id', v.recipe_version_id, 'version_no', v.version_no,
                     'basis', v.basis, 'provenance', v.provenance, 'activated_at', v.activated_at,
                     'activated_by', (select e.display_name from public.employees e where e.employee_id = v.activated_by),
                     'change_note', v.change_note, 'lines', private.recipe_lines_json(v.recipe_version_id))
                   from public.recipe_versions v where v.parent_item_id = d.item_id and v.status = 'active'),
        'draft', case when v_owner then (
                   select jsonb_build_object('recipe_version_id', v.recipe_version_id, 'version_no', v.version_no,
                     'draft_revision', v.draft_revision, 'created_at', v.created_at,
                     'lines', private.recipe_lines_json(v.recipe_version_id))
                   from public.recipe_versions v where v.parent_item_id = d.item_id and v.status = 'draft') end,
        'history', (select coalesce(jsonb_agg(jsonb_build_object('version_no', v.version_no, 'status', v.status,
                       'activated_at', v.activated_at, 'superseded_at', v.superseded_at, 'change_note', v.change_note,
                       'activated_by', (select e.display_name from public.employees e where e.employee_id = v.activated_by))
                       order by v.version_no desc), '[]'::jsonb)
                    from public.recipe_versions v where v.parent_item_id = d.item_id and v.status <> 'draft'))
        order by d.item_id)
      from public.items d where d.item_type = 'finished_dish' and d.archived_at is null), '[]'::jsonb),
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', i.name, 'base_unit', i.base_unit,
               'category', i.category) order by i.item_id)
      from public.items i where i.item_type = 'ingredient' and i.archived_at is null), '[]'::jsonb));
end;
$$;

revoke all on function
  private.lock_recipe_draft(uuid, integer),
  private.recipe_lines_json(uuid)
from public, anon, authenticated;

revoke all on function
  public.start_recipe_draft(uuid, text),
  public.save_recipe_draft(uuid, uuid, integer, jsonb),
  public.activate_recipe_version(uuid, uuid, integer, text),
  public.discard_recipe_draft(uuid, uuid, integer),
  public.get_recipes()
from public, anon;
grant execute on function
  public.start_recipe_draft(uuid, text),
  public.save_recipe_draft(uuid, uuid, integer, jsonb),
  public.activate_recipe_version(uuid, uuid, integer, text),
  public.discard_recipe_draft(uuid, uuid, integer),
  public.get_recipes()
to authenticated;

create or replace function public.get_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 25;
$$;

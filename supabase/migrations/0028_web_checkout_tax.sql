-- 0028 Website checkout and settings (W4, BUILD_PLAN §6.3):
-- * web_get_menu also returns the location's current tax rate, so the checkout
--   page can show the exact total before the order is placed. The server still
--   computes and snapshots the total.
-- * set_web_menu_content treats blank text as "none", so the owner's form can
--   send empty fields (otherwise unchanged from 0027).

create or replace function public.web_get_menu(p_location_id text)
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
  v_status := private.web_ordering_status(p_location_id);
  if v_status = 'unknown_location' then perform private.raise_error('validation:location'); end if;
  select w.max_per_line into v_max from public.web_ordering_settings w where w.location_id = p_location_id;
  v_max := coalesce(v_max, 0);

  return jsonb_build_object('location_id', p_location_id, 'ordering_open', v_status is null, 'status_reason', v_status,
    'max_per_line', v_max,
    -- The rate orders accepted now are taxed at, so checkout can show the exact total.
    'tax_rate', (private.current_tax_rate(p_location_id, v_today))::text,
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

-- Saving content clears an earlier allergen review unless p_allergen_reviewed
-- confirms the note again, so a changed note is never published unreviewed.
create or replace function public.set_web_menu_content(p_request_key uuid, p_item_id text, p_country text, p_description text,
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
  -- Blank text means "none", so forms can send empty fields.
  v_country text := nullif(btrim(p_country), '');
  v_image text := nullif(btrim(p_image_path), '');
  v_note text := nullif(btrim(p_allergen_note), '');
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
  if v_country is not null and length(v_country) > 60 then perform private.raise_error('validation:country'); end if;
  if v_image is not null and v_image !~ '^[a-z0-9][a-z0-9/_.-]{0,119}$' then
    perform private.raise_error('validation:image_path');
  end if;
  if v_note is not null and length(v_note) > 400 then perform private.raise_error('validation:allergen_note'); end if;
  if v_reviewed and v_note is null then perform private.raise_error('validation:allergen_note'); end if;
  select to_jsonb(c) into v_before from public.web_menu_content c where c.item_id = p_item_id;
  insert into public.web_menu_content (item_id, country, description, image_path, allergen_note, allergen_reviewed_by,
    allergen_reviewed_at, provenance, updated_by)
  values (p_item_id, v_country, btrim(p_description), v_image, v_note,
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

create or replace function public.get_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 28;
$$;

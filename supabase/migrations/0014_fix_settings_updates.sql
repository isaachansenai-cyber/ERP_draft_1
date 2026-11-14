-- 0014 Fix: single-row settings updates need a WHERE clause.
-- Supabase API sessions load pg-safeupdate, which rejects UPDATE without WHERE
-- ("UPDATE requires a WHERE clause"). enable_posting and reopen_setup_gate
-- (0007) updated the app_settings singleton without one, so the success path
-- failed through the API. Redefined here with `where singleton`; behavior is
-- otherwise unchanged. Found by the Milestone 2 pilot-operations setup test.

create or replace function public.reopen_setup_gate(p_request_key uuid, p_gate_id uuid, p_reason text)
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
    update public.app_settings set posting_enabled = false, posting_enabled_at = null, posting_enabled_by = null
     where singleton;
  end if;

  perform private.write_audit(v_actor, 'setup_gate.reopen', 'pilot_setup_gate', p_gate_id::text,
    case when v_gate.scope_type = 'location' then v_gate.scope_id end, p_request_key,
    jsonb_build_object('status', 'confirmed', 'evidence_note', v_gate.evidence_note),
    jsonb_build_object('status', 'open'), p_reason);
  v_result := jsonb_build_object('ok', true, 'gate_id', p_gate_id, 'status', 'open');
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

create or replace function public.enable_posting(p_request_key uuid, p_evidence_note text)
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

  update public.app_settings set posting_enabled = true, posting_enabled_at = now(), posting_enabled_by = v_actor
   where singleton;
  perform private.write_audit(v_actor, 'posting.enable', 'app_settings', 'singleton', null, p_request_key,
    jsonb_build_object('posting_enabled', false), jsonb_build_object('posting_enabled', true), p_evidence_note);
  v_result := jsonb_build_object('ok', true, 'posting_enabled', true);
  return private.idem_finish(v_actor, p_request_key, v_result);
end;
$$;

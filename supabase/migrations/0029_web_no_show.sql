-- 0029 Website no-shows (W5; owner decision 2026-11-25: orders not collected
-- are cancelled by a manager at end of day; BUILD_PLAN §5.4, ADR 0045).
--
-- One manager action cancels every website order at the location whose pickup
-- time has passed and that is still open. Each order goes through the existing
-- cancel_order, so the rules stay in one place:
-- * not started: reservations are released;
-- * started or ready: the issued cost is recorded as waste (nothing restocks);
-- * a demo SIMULATED payment gets its linked simulated refund.
-- A pilot order with a recorded real payment is NOT cancelled here: it is listed
-- for the manager to handle at the counter, so no refund is ever automatic.

insert into public.reason_codes (code, description, applies_to, requires_note)
values ('NO_SHOW', 'Customer did not collect the order', array['cancellation'], false)
on conflict (code) do nothing;

create function public.cancel_uncollected_web_orders(p_request_key uuid, p_location_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.require_actor();
  v_cached jsonb;
  r record;
  v_result jsonb;
  v_cancelled jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform private.require_location_role(p_location_id, array['manager']);
  v_cached := private.idem_begin(v_actor, 'cancel_uncollected_web_orders', p_request_key);
  if v_cached is not null then return v_cached; end if;
  perform private.require_posting_enabled();

  for r in
    select o.order_id, o.order_number, o.version, o.tender_mode,
           coalesce((select sum(t.amount_cents) from public.tenders t where t.order_id = o.order_id), 0) as paid
    from public.orders o
    where o.location_id = p_location_id and o.channel = 'web' and o.status in ('accepted', 'preparing', 'ready')
      and o.requested_pickup_at < now()
    order by o.requested_pickup_at, o.order_number
  loop
    if r.paid > 0 and r.tender_mode <> 'SIMULATED' then
      v_skipped := v_skipped || jsonb_build_object('order_number', r.order_number, 'reason', 'payment_recorded');
      continue;
    end if;
    v_result := public.cancel_order(gen_random_uuid(), r.order_id, r.version, 'NO_SHOW',
      'Website order not collected', null, null, case when r.paid > 0 then 'card_external' end, null);
    if coalesce((v_result ->> 'ok')::boolean, false) then
      v_cancelled := v_cancelled || to_jsonb(r.order_number);
    else
      v_skipped := v_skipped || jsonb_build_object('order_number', r.order_number, 'reason', v_result ->> 'error');
    end if;
  end loop;

  perform private.write_audit(v_actor, 'web.no_show_sweep', 'location', p_location_id, p_location_id, p_request_key, null,
    jsonb_build_object('cancelled', v_cancelled, 'skipped', v_skipped));
  return private.idem_finish(v_actor, p_request_key,
    jsonb_build_object('ok', true, 'cancelled', v_cancelled, 'skipped', v_skipped));
end;
$$;
revoke all on function public.cancel_uncollected_web_orders(uuid, text) from public, anon;
grant execute on function public.cancel_uncollected_web_orders(uuid, text) to authenticated;

create or replace function public.get_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 29;
$$;

-- 0019 Milestone 3 reads: employees may see the waste reports they submitted,
-- but never their cost (PRD §4). Cost columns are hidden from direct API reads;
-- the list function returns costs only to managers and the owner.

revoke select on table public.waste_reports from authenticated;
grant select (waste_report_id, report_number, location_id, status, version, reason_code, note, submitted_by, submitted_at,
              decided_by, decided_at, decision_note, business_date) on table public.waste_reports to authenticated;
revoke select on table public.waste_report_lines from authenticated;
grant select (waste_report_id, line_no, item_id, lot_id, quantity) on table public.waste_report_lines to authenticated;

create function public.list_waste_reports(p_location_id text, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
  v_me text := private.require_actor();
begin
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  v_manager := private.has_location_role(p_location_id, array['manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'waste_report_id', w.waste_report_id, 'report_number', w.report_number, 'status', w.status, 'version', w.version,
      'reason_code', w.reason_code, 'note', w.note, 'submitted_by', e.display_name, 'submitted_at', w.submitted_at,
      'decided_at', w.decided_at, 'decision_note', w.decision_note,
      'total_cost', case when v_manager then round(w.total_cost, 4)::text end,
      'lines', (select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_id', l.item_id, 'name', i.name,
                  'base_unit', i.base_unit, 'quantity', l.quantity::text,
                  'posted_cost', case when v_manager then round(l.posted_cost, 4)::text end) order by l.line_no)
                from public.waste_report_lines l join public.items i on i.item_id = l.item_id
                where l.waste_report_id = w.waste_report_id))
      order by w.submitted_at desc)
    from public.waste_reports w join public.employees e on e.employee_id = w.submitted_by
    where w.location_id = p_location_id and (p_status is null or w.status = p_status)
      and (v_manager or w.submitted_by = v_me)
      and w.submitted_at > now() - interval '60 days'), '[]'::jsonb);
end;
$$;

-- Returned goods awaiting a decision, and recent decisions (managers).
create function public.list_return_custody(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['manager']);
  return jsonb_build_object(
    'policy', (select jsonb_build_object('window_days', p.window_days, 'allow_customer_restock', p.allow_customer_restock,
                 'provenance', p.provenance, 'configured_at', p.configured_at) from public.return_policy p),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('custody_id', c.custody_id, 'status', c.status, 'item_id', c.item_id, 'name', i.name,
        'quantity', c.quantity, 'condition', rl.condition, 'return_number', r.return_number, 'order_number', o.order_number,
        'processed_at', r.processed_at, 'decided_at', c.decided_at, 'decision_note', c.decision_note,
        'unit_issue_cost', c.unit_issue_cost::text,
        'resaleable', rl.condition = 'unopened_intact' and i.item_type = 'retail' and not i.requires_use_by)
        order by (c.status = 'held') desc, r.processed_at desc)
      from public.return_custody c
      join public.return_lines rl on rl.return_line_id = c.return_line_id
      join public.returns r on r.return_id = rl.return_id
      join public.orders o on o.order_id = r.order_id
      join public.items i on i.item_id = c.item_id
      where c.location_id = p_location_id and (c.status = 'held' or c.decided_at > now() - interval '30 days')), '[]'::jsonb));
end;
$$;

grant execute on function public.list_waste_reports(text, text), public.list_return_custody(text) to authenticated;

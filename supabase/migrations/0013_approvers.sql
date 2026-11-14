-- 0013 Approver list for the manager PIN dialog (CLAUDE.md D5).
-- Staff at a location may see which managers/owners can approve there (names
-- and staff IDs only; never PIN state or contact details).
create function public.list_location_approvers(p_location_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_actor();
  perform private.require_location_role(p_location_id, array['employee', 'manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'display_name', x.display_name, 'role', x.role)
                     order by x.role desc, x.display_name)
    from (select distinct e.employee_id, e.display_name, m.role
          from public.memberships m
          join public.employees e on e.employee_id = m.employee_id
          where m.active and e.active
            and (m.role = 'owner' or (m.role = 'manager' and m.location_id = p_location_id))) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_location_approvers(text) to authenticated;

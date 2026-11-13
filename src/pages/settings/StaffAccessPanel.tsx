import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge,
  Button,
  Empty,
  Field,
  inputClass,
  Loading,
  MutationStatus,
  Notice,
  QueryError,
} from '../../components/ui';
import { callRpc } from '../../lib/rpc';
import { useRpcMutation } from '../../lib/useRpcMutation';

interface StaffRow {
  employee_id: string;
  display_name: string;
  active: boolean;
  provenance: string;
  auth_linked: boolean;
  email: string | null;
  memberships: Array<{ membership_id: string; role: string; location_id: string | null }>;
}

function useStaff() {
  return useQuery({ queryKey: ['staff'], queryFn: () => callRpc<StaffRow[]>('list_staff_access', {}) });
}

function useInvalidateStaff() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['staff'] });
}

function CreateEmployee() {
  const [name, setName] = useState('');
  const invalidate = useInvalidateStaff();
  const m = useRpcMutation<{ employee_id: string }>('create_employee', 'create-employee', { onSuccess: invalidate });
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_display_name: name });
      }}
    >
      <h3 className="font-semibold">Add staff record</h3>
      <Field
        label="Display name"
        htmlFor="new-employee-name"
        hint="No pay rates, tax IDs or personal identifiers are stored (PRD §11)."
      >
        <input id="new-employee-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Button type="submit" disabled={!m.canPost || !name.trim()}>
        Add staff record
      </Button>
      <MutationStatus
        state={m.state}
        successText={
          'kind' in m.state && m.state.kind === 'success' ? `Created ${m.state.result.employee_id}.` : 'Created.'
        }
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function LinkAccount({ staff }: { staff: StaffRow[] }) {
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const invalidate = useInvalidateStaff();
  const m = useRpcMutation('link_employee_auth_user', 'link-employee', { onSuccess: invalidate });
  const unlinked = staff.filter((s) => !s.auth_linked && s.active);
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_employee_id: employeeId, p_email: email });
      }}
    >
      <h3 className="font-semibold">Link sign-in account</h3>
      <p className="text-xs text-slate-700">
        Invite the person through Supabase Auth first, then link their email here.
      </p>
      <Field label="Staff record" htmlFor="link-employee">
        <select
          id="link-employee"
          className={inputClass}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">Choose…</option>
          {unlinked.map((s) => (
            <option key={s.employee_id} value={s.employee_id}>
              {s.display_name} ({s.employee_id})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Invited email" htmlFor="link-email">
        <input
          id="link-email"
          type="email"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost || !employeeId || !email.trim()}>
        Link account
      </Button>
      <MutationStatus
        state={m.state}
        successText="Account linked."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function GrantRole({
  staff,
  locations,
}: {
  staff: StaffRow[];
  locations: Array<{ location_id: string; location_name: string }>;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState<'employee' | 'manager' | 'owner'>('employee');
  const [locationId, setLocationId] = useState('');
  const invalidate = useInvalidateStaff();
  const m = useRpcMutation('grant_membership', 'grant-membership', { onSuccess: invalidate });
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // The owner role is company-wide; the server rejects a location for it.
        void m.submit({
          p_employee_id: employeeId,
          p_role: role,
          p_location_id: role === 'owner' ? (null as unknown as string) : locationId,
        });
      }}
    >
      <h3 className="font-semibold">Grant a role</h3>
      <Field label="Staff member" htmlFor="grant-employee">
        <select
          id="grant-employee"
          className={inputClass}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">Choose…</option>
          {staff
            .filter((s) => s.active)
            .map((s) => (
              <option key={s.employee_id} value={s.employee_id}>
                {s.display_name} ({s.employee_id})
              </option>
            ))}
        </select>
      </Field>
      <Field label="Role" htmlFor="grant-role">
        <select
          id="grant-role"
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="employee">Employee</option>
          <option value="manager">Location manager</option>
          <option value="owner">Owner (all locations)</option>
        </select>
      </Field>
      {role !== 'owner' ? (
        <Field label="Location" htmlFor="grant-location">
          <select
            id="grant-location"
            className={inputClass}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Choose…</option>
            {locations.map((l) => (
              <option key={l.location_id} value={l.location_id}>
                {l.location_name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Button type="submit" disabled={!m.canPost || !employeeId || (role !== 'owner' && !locationId)}>
        Grant role
      </Button>
      <MutationStatus
        state={m.state}
        successText="Role granted."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function RevokeButton({ membershipId }: { membershipId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const invalidate = useInvalidateStaff();
  const m = useRpcMutation('revoke_membership', `revoke-membership:${membershipId}`, { onSuccess: invalidate });
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Revoke…
      </Button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_membership_id: membershipId, p_reason: reason });
      }}
    >
      <Field label="Reason" htmlFor={`revoke-${membershipId}`}>
        <input
          id={`revoke-${membershipId}`}
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={!m.canPost || reason.trim().length < 3}>
          Revoke role
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <MutationStatus
        state={m.state}
        successText="Role revoked."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

export function StaffAccessPanel() {
  const { context } = useAuth();
  const staff = useStaff();
  const isOwner = Boolean(context?.is_owner);
  const managerAnywhere = isOwner || Boolean(context?.roles.some((r) => r.role === 'manager'));

  if (!managerAnywhere)
    return (
      <Notice tone="warning" title="Not permitted">
        Staff access is managed by the owner and location managers.
      </Notice>
    );
  if (staff.isPending) return <Loading label="Loading staff…" />;
  if (staff.error) return <QueryError error={staff.error} onRetry={() => void staff.refetch()} />;
  const locations = context?.roles.map((r) => ({ location_id: r.location_id, location_name: r.location_name })) ?? [];
  const nameOf = (id: string | null) =>
    id ? (locations.find((l) => l.location_id === id)?.location_name ?? id) : 'All locations';

  return (
    <div className="flex flex-col gap-6">
      {isOwner ? null : (
        <Notice tone="info">Managers can view staff at their locations. Only the owner changes roles.</Notice>
      )}
      {staff.data.length === 0 ? (
        <Empty>No staff records yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {staff.data.map((s) => (
            <li key={s.employee_id} className="rounded-md border border-slate-300 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto font-semibold">
                  {s.display_name} <span className="font-mono text-xs text-slate-600">{s.employee_id}</span>
                </p>
                {!s.active ? <Badge tone="bad">Inactive</Badge> : null}
                {s.provenance.startsWith('synthetic') ? <Badge tone="warn">Synthetic demo fixture</Badge> : null}
                <Badge tone={s.auth_linked ? 'good' : 'warn'}>
                  {s.auth_linked ? 'Sign-in linked' : 'No sign-in yet'}
                </Badge>
              </div>
              {s.email ? <p className="text-xs text-slate-700">{s.email}</p> : null}
              <ul className="mt-2 flex flex-col gap-2">
                {s.memberships.length === 0 ? <li className="text-sm text-slate-700">No active role.</li> : null}
                {s.memberships.map((m) => (
                  <li key={m.membership_id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold uppercase">{m.role}</span> — {nameOf(m.location_id)}
                    {isOwner ? <RevokeButton membershipId={m.membership_id} /> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <CreateEmployee />
          <LinkAccount staff={staff.data} />
          <GrantRole staff={staff.data} locations={locations} />
        </div>
      ) : null}
    </div>
  );
}

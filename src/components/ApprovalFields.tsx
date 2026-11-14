import { useQuery } from '@tanstack/react-query';
import { callRpc } from '../lib/rpc';
import { Field, inputClass } from './ui';

export interface Approval {
  approverId: string;
  pin: string;
}

interface Approver {
  employee_id: string;
  display_name: string;
  role: string;
}

/**
 * Manager PIN override for shared tablets (CLAUDE.md D5). The PIN is sent once
 * with the action it approves and is never stored on the client.
 */
export function ApprovalFields({
  locationId,
  value,
  onChange,
  idPrefix,
}: {
  locationId: string;
  value: Approval;
  onChange: (next: Approval) => void;
  idPrefix: string;
}) {
  const approvers = useQuery({
    queryKey: ['approvers', locationId],
    queryFn: () => callRpc<Approver[]>('list_location_approvers', { p_location_id: locationId }),
    staleTime: 300_000,
  });
  return (
    <fieldset className="grid gap-2 rounded-md border border-amber-600 bg-amber-50 p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold">Manager approval</legend>
      <Field label="Approving manager" htmlFor={`${idPrefix}-approver`}>
        <select
          id={`${idPrefix}-approver`}
          className={inputClass}
          value={value.approverId}
          onChange={(e) => onChange({ ...value, approverId: e.target.value })}
        >
          <option value="">Choose…</option>
          {(approvers.data ?? []).map((a) => (
            <option key={a.employee_id} value={a.employee_id}>
              {a.display_name} ({a.role})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Manager PIN" htmlFor={`${idPrefix}-pin`}>
        <input
          id={`${idPrefix}-pin`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className={inputClass}
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.target.value.replace(/\D/g, '') })}
        />
      </Field>
    </fieldset>
  );
}

export const emptyApproval: Approval = { approverId: '', pin: '' };

/** RPC arguments for an approval; omitted when the signed-in user is a manager. */
export function approvalArgs(approval: Approval, needed: boolean) {
  return needed && approval.approverId
    ? { p_approver_employee_id: approval.approverId, p_pin: approval.pin }
    : { p_approver_employee_id: undefined, p_pin: undefined };
}

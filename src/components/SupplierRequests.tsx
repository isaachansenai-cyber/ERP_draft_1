import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Json } from '../lib/database.types';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { useRpcMutation } from '../lib/useRpcMutation';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from './ui';

// Supplier contact / lead-time edits (ADR 0038). The owner edits directly; a
// manager proposes a change that the owner approves or rejects.

export interface SupplierContactFields {
  phone: string | null;
  contact_email: string | null;
  address: string | null;
  lead_days: Record<string, number | null>;
}

export interface EditableSupplier {
  supplier_id: string;
  name: string;
  version: number;
  phone: string | null;
  contact_email: string | null;
  address: string | null;
  supplier_items: Array<{
    supplier_item_id: string;
    item_id: string;
    procurement_lead_days: number | null;
    items: { name: string } | null;
  }>;
}

interface ChangeRequest {
  request_id: string;
  version: number;
  status: 'pending' | 'approved' | 'rejected';
  supplier_id: string;
  supplier_name: string;
  location_name: string;
  requested_by: string;
  requested_at: string;
  note: string;
  proposed: Partial<SupplierContactFields>;
  current: SupplierContactFields;
  supplier_changed_since: boolean;
  lead_items: Record<string, { item_id: string; name: string }>;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

interface ChangeRequests {
  is_owner: boolean;
  refreshed_at: string;
  requests: ChangeRequest[];
}

export const SUPPLIER_REQUESTS_KEY = ['supplier-change-requests'];

export function useSupplierRequests(status?: 'pending' | 'decided') {
  return useQuery({
    queryKey: [...SUPPLIER_REQUESTS_KEY, status ?? 'all'],
    queryFn: () => callRpc<ChangeRequests>('list_supplier_change_requests', status ? { p_status: status } : {}),
  });
}

const FIELD_LABELS: Record<'phone' | 'contact_email' | 'address', string> = {
  phone: 'Phone',
  contact_email: 'Email',
  address: 'Address',
};

const PHONE_OK = (v: string) => v === '' || (/^[0-9+()./ x-]+$/.test(v) && v.replace(/[^0-9]/g, '').length >= 7);
const EMAIL_OK = (v: string) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const DAYS_OK = (v: string) => /^\d{1,3}$/.test(v) && Number(v) <= 365;

/**
 * Edit form for one supplier. mode 'edit' (owner) saves at once; mode
 * 'request' (manager) submits a change request with a required note.
 */
export function SupplierDetailsForm({
  supplier,
  mode,
  locationId,
  onDone,
  onCancel,
}: {
  supplier: EditableSupplier;
  mode: 'edit' | 'request';
  locationId: string;
  /** Called after the server confirms; the form closes, so the parent shows the message. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [email, setEmail] = useState(supplier.contact_email ?? '');
  const [address, setAddress] = useState(supplier.address ?? '');
  const [leads, setLeads] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      supplier.supplier_items.map((si) => [si.supplier_item_id, si.procurement_lead_days?.toString() ?? '']),
    ),
  );
  const [note, setNote] = useState('');
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    void queryClient.invalidateQueries({ queryKey: SUPPLIER_REQUESTS_KEY });
    onDone(message);
  };
  const edit = useRpcMutation('update_supplier_details', `supplier-edit:${supplier.supplier_id}:${supplier.version}`, {
    onSuccess: () => done('Supplier details saved.'),
  });
  const request = useRpcMutation('submit_supplier_change_request', `supplier-request:${supplier.supplier_id}`, {
    onSuccess: () => done('Request sent to the owner. Nothing changes until the owner approves it.'),
  });
  const m = mode === 'edit' ? edit : request;

  // Only send what changed; a cleared field is sent as '' and stored as blank.
  const changes: { [key: string]: Json } = {};
  if (phone.trim() !== (supplier.phone ?? '')) changes.phone = phone.trim();
  if (email.trim().toLowerCase() !== (supplier.contact_email ?? '')) changes.contact_email = email.trim();
  if (address.trim() !== (supplier.address ?? '')) changes.address = address.trim();
  const leadChanges: Record<string, number> = {};
  for (const si of supplier.supplier_items) {
    const v = (leads[si.supplier_item_id] ?? '').trim();
    if (v !== '' && v !== (si.procurement_lead_days?.toString() ?? '')) leadChanges[si.supplier_item_id] = Number(v);
  }
  if (Object.keys(leadChanges).length) changes.lead_days = leadChanges;

  const leadErrors = supplier.supplier_items.some((si) => {
    const v = (leads[si.supplier_item_id] ?? '').trim();
    return v !== '' && !DAYS_OK(v);
  });
  const valid =
    PHONE_OK(phone.trim()) &&
    EMAIL_OK(email.trim()) &&
    address.trim().length <= 200 &&
    !leadErrors &&
    Object.keys(changes).length > 0 &&
    (mode === 'edit' || note.trim().length >= 3);
  const stale =
    'kind' in edit.state && edit.state.kind === 'rejected' && edit.state.error.code === 'conflict:stale_version';
  const id = (f: string) => `supplier-${supplier.supplier_id}-${f}`;

  return (
    <form
      className="mt-2 flex flex-col gap-3 rounded-md border-2 border-sky-700 bg-sky-50 p-3"
      aria-label={`${mode === 'edit' ? 'Edit' : 'Request a change to'} ${supplier.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'edit')
          void edit.submit({
            p_supplier_id: supplier.supplier_id,
            p_expected_version: supplier.version,
            p_changes: changes,
          });
        else
          void request.submit({
            p_location_id: locationId,
            p_supplier_id: supplier.supplier_id,
            p_changes: changes,
            p_note: note.trim(),
          });
      }}
    >
      <p className="text-sm">
        {mode === 'edit'
          ? 'Changes are saved as owner-entered. Leave a field blank if you do not have a confirmed value.'
          : 'The owner reviews your request before anything changes.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Field label="Phone" htmlFor={id('phone')}>
          <input
            id={id('phone')}
            className={`${inputClass} w-48`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor={id('email')}>
          <input
            id={id('email')}
            type="email"
            className={`${inputClass} w-64`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Address" htmlFor={id('address')}>
          <input
            id={id('address')}
            className={`${inputClass} w-80`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
      </div>
      {!PHONE_OK(phone.trim()) ? <p className="text-sm text-red-800">Phone needs at least 7 digits.</p> : null}
      {!EMAIL_OK(email.trim()) ? <p className="text-sm text-red-800">Enter a valid email address.</p> : null}
      {supplier.supplier_items.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="font-semibold">Lead time (days from order to delivery)</legend>
          <div className="flex flex-wrap gap-2">
            {supplier.supplier_items.map((si) => (
              <Field
                key={si.supplier_item_id}
                label={`${si.item_id} ${si.items?.name ?? ''}`}
                htmlFor={id(`lead-${si.supplier_item_id}`)}
              >
                <input
                  id={id(`lead-${si.supplier_item_id}`)}
                  inputMode="numeric"
                  className={`${inputClass} w-24`}
                  value={leads[si.supplier_item_id] ?? ''}
                  onChange={(e) => setLeads((l) => ({ ...l, [si.supplier_item_id]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          {leadErrors ? <p className="text-sm text-red-800">Lead times are whole days from 0 to 365.</p> : null}
        </fieldset>
      ) : null}
      {mode === 'request' ? (
        <Field label="Where did this come from? (required)" htmlFor={id('note')}>
          <input id={id('note')} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!m.canPost || !valid}>
          {mode === 'edit' ? 'Save supplier details' : 'Send request to owner'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <MutationStatus
        state={m.state}
        successText={mode === 'edit' ? 'Supplier details saved.' : 'Request sent to the owner.'}
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
      {stale ? (
        <Notice tone="warning" title="Changed elsewhere">
          <p>This supplier was changed after you opened the form. Reload it to see the latest details.</p>
          <Button
            className="mt-2"
            variant="secondary"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
              onCancel();
            }}
          >
            Reload supplier
          </Button>
        </Notice>
      ) : null}
    </form>
  );
}

function show(v: unknown): string {
  return v === null || v === undefined || v === '' ? 'blank' : String(v);
}

/** Current vs proposed, one row per changed field. */
function RequestDiff({ r }: { r: ChangeRequest }) {
  const rows: Array<{ label: string; from: string; to: string }> = [];
  for (const f of ['phone', 'contact_email', 'address'] as const) {
    if (f in r.proposed) rows.push({ label: FIELD_LABELS[f], from: show(r.current[f]), to: show(r.proposed[f]) });
  }
  for (const [siId, days] of Object.entries(r.proposed.lead_days ?? {})) {
    const item = r.lead_items[siId];
    rows.push({
      label: `Lead time ${item ? `${item.item_id} ${item.name}` : siId}`,
      from: `${show(r.current.lead_days?.[siId])} d`,
      to: `${show(days)} d`,
    });
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-400 text-left">
          <th scope="col" className="p-1">
            Field
          </th>
          <th scope="col" className="p-1">
            Now
          </th>
          <th scope="col" className="p-1">
            Proposed
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-slate-200">
            <td className="p-1">{row.label}</td>
            <td className="p-1">{row.from}</td>
            <td className="p-1 font-semibold">{row.to}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DecideRequest({ r }: { r: ChangeRequest }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: SUPPLIER_REQUESTS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  };
  const approve = useRpcMutation(
    'decide_supplier_change_request',
    `supplier-request-approve:${r.request_id}:${r.version}`,
    {
      onSuccess: done,
    },
  );
  const reject = useRpcMutation(
    'decide_supplier_change_request',
    `supplier-request-reject:${r.request_id}:${r.version}`,
    {
      onSuccess: done,
    },
  );
  const busy = approve.busy || reject.busy;
  return (
    <div className="flex flex-col gap-2">
      <Field label="Note (required to reject)" htmlFor={`req-note-${r.request_id}`}>
        <input
          id={`req-note-${r.request_id}`}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!approve.canPost || busy}
          onClick={() =>
            void approve.submit({
              p_request_id: r.request_id,
              p_expected_version: r.version,
              p_decision: 'approve',
              p_note: note.trim() || undefined,
            })
          }
        >
          Approve and apply
        </Button>
        <Button
          variant="danger"
          disabled={!reject.canPost || busy || note.trim().length < 3}
          onClick={() =>
            void reject.submit({
              p_request_id: r.request_id,
              p_expected_version: r.version,
              p_decision: 'reject',
              p_note: note.trim(),
            })
          }
        >
          Reject
        </Button>
      </div>
      <MutationStatus
        state={approve.state}
        successText="Approved and applied."
        onRetry={() => void approve.retry()}
        onCheckAgain={() => void approve.checkAgain()}
      />
      <MutationStatus
        state={reject.state}
        successText="Rejected."
        onRetry={() => void reject.retry()}
        onCheckAgain={() => void reject.checkAgain()}
      />
    </div>
  );
}

function statusBadge(status: ChangeRequest['status']) {
  if (status === 'pending') return <Badge tone="warn">Waiting for owner</Badge>;
  if (status === 'approved') return <Badge tone="good">Approved</Badge>;
  return <Badge tone="bad">Rejected</Badge>;
}

/**
 * Owner: pending requests with approve/reject (Overview and Suppliers).
 * Manager: the requests they submitted and what happened to them.
 */
export function SupplierRequestsList({
  status,
  compact = false,
}: {
  status?: 'pending' | 'decided';
  compact?: boolean;
}) {
  const requests = useSupplierRequests(status);
  if (requests.isPending) return <Loading label="Loading supplier change requests…" />;
  if (requests.error) return <QueryError error={requests.error} onRetry={() => void requests.refetch()} />;
  const list = requests.data.requests;
  if (list.length === 0)
    return (
      <Empty>
        {status === 'pending' ? 'No supplier change requests are waiting.' : 'No supplier change requests.'}
      </Empty>
    );
  return (
    <ul className="flex flex-col gap-3">
      {list.map((r) => (
        <li
          key={r.request_id}
          className="rounded-md border border-slate-300 bg-white p-3"
          data-testid={`supplier-request-${r.request_id}`}
        >
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {r.supplier_id} {r.supplier_name}
            </span>
            {statusBadge(r.status)}
            <span>
              from {r.requested_by} ({r.location_name}) · {formatDateTime(r.requested_at)}
            </span>
          </p>
          <p className="text-sm">“{r.note}”</p>
          {r.supplier_changed_since ? (
            <Notice tone="warning">This supplier was edited after the request was made. Check the “Now” column.</Notice>
          ) : null}
          {!compact || r.status === 'pending' ? <RequestDiff r={r} /> : null}
          {r.status !== 'pending' ? (
            <p className="text-xs text-slate-700">
              {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decided_by} · {formatDateTime(r.decided_at)}
              {r.decision_note ? ` · “${r.decision_note}”` : ''}
            </p>
          ) : requests.data.is_owner ? (
            <DecideRequest r={r} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

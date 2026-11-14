// Refunds, retail returns, exchanges and returned-goods custody (PRD §7, §8).
// Refunds and exchanges record money handled outside the app; the server caps
// them by the original line snapshots and the recorded payments.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApprovalFields, approvalArgs, emptyApproval, type Approval } from '../components/ApprovalFields';
import { ReasonSelect } from '../components/ReasonSelect';
import { Badge, Button, Empty, Field, inputClass, Loading, Notice, QueryError } from '../components/ui';
import { formatCents, formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { useRpcMutation } from '../lib/useRpcMutation';
import { Status } from './inventory/ControlsPanels';
import { usePosMenu } from './PosPage';

interface ReturnLine {
  order_line_id: string;
  line_no: number;
  item_id: string;
  name: string;
  item_type: string;
  quantity: number;
  net_cents: number;
  tax_cents: number;
  refunded_quantity: number;
  refunded_net_cents: number;
  returned_quantity: number;
}

interface OrderForReturn {
  order: {
    order_id: string;
    order_number: string;
    pickup_code: string;
    status: string;
    version: number;
    total_cents: number;
    paid_cents: number;
    tender_mode: string;
    completed_business_date: string | null;
    pickup_name: string | null;
  };
  return_window_days: number | null;
  refunded_cents: number;
  lines: ReturnLine[];
}

const REFUND_METHODS = [
  { id: 'cash', label: 'Cash (handled outside the app)' },
  { id: 'card_external', label: 'Card terminal (external)' },
  { id: 'other_external', label: 'Other external method' },
];

function MethodSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {REFUND_METHODS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function moneyWord(mode: string) {
  return mode === 'SIMULATED'
    ? 'Simulated refund (demo — no money moves)'
    : 'Recorded refund (handled outside the app)';
}

function RefundForm({ data, locationId, needsApproval, onDone }: FormProps) {
  const [units, setUnits] = useState<Record<string, string>>({});
  const [method, setMethod] = useState('card_external');
  const [reason, setReason] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [approval, setApproval] = useState<Approval>(emptyApproval);
  const m = useRpcMutation('record_refund', `refund:${data.order.order_id}:${data.refunded_cents}`, {
    onSuccess: () => {
      setUnits({});
      onDone();
    },
  });
  const lines = data.lines
    .filter((l) => Number(units[l.order_line_id] ?? 0) > 0)
    .map((l) => ({ order_line_id: l.order_line_id, quantity: Number(units[l.order_line_id]) }));
  const valid =
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(l.quantity)) &&
    reason &&
    (!needsNote || note.trim().length >= 3) &&
    (!needsApproval || (approval.approverId && approval.pin.length >= 6));
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_order_id: data.order.order_id,
          p_lines: lines,
          p_method: method,
          p_reason_code: reason,
          p_note: note || undefined,
          p_external_reference: reference || undefined,
          ...approvalArgs(approval, needsApproval),
        });
      }}
    >
      <h3 className="font-semibold">{moneyWord(data.order.tender_mode)}</h3>
      <p className="text-xs text-slate-700">
        Refunds use the original price, discount and tax of each line. Meals are refunded, never returned to stock.
      </p>
      <ul className="flex flex-col gap-1">
        {data.lines.map((l) => {
          const left = l.quantity - l.refunded_quantity;
          return (
            <li key={l.order_line_id} className="flex flex-wrap items-end gap-2 text-sm">
              <span className="mr-auto">
                {l.quantity} × {l.name} · line {formatCents(l.net_cents + l.tax_cents)} · refunded{' '}
                {formatCents(l.refunded_net_cents)} net ({l.refunded_quantity} unit(s))
              </span>
              <Field label={`Units to refund (max ${left})`} htmlFor={`rf-${l.order_line_id}`}>
                <input
                  id={`rf-${l.order_line_id}`}
                  inputMode="numeric"
                  className={`${inputClass} w-24`}
                  disabled={left <= 0}
                  value={units[l.order_line_id] ?? ''}
                  onChange={(e) => setUnits((u) => ({ ...u, [l.order_line_id]: e.target.value.replace(/\D/g, '') }))}
                />
              </Field>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <MethodSelect id="refund-method" label="Paid back by" value={method} onChange={setMethod} />
        <ReasonSelect
          use="refund"
          id="refund-reason"
          value={reason}
          onChange={(c, n) => {
            setReason(c);
            setNeedsNote(n);
          }}
        />
        <Field label={needsNote ? 'Note (required)' : 'Note'} htmlFor="refund-note">
          <input id="refund-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="External reference" htmlFor="refund-ref" hint="e.g. terminal slip number">
          <input
            id="refund-ref"
            className={inputClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>
      {needsApproval ? (
        <ApprovalFields locationId={locationId} value={approval} onChange={setApproval} idPrefix="refund" />
      ) : null}
      <Button type="submit" disabled={!m.canPost || !valid}>
        Record refund
      </Button>
      <Status m={m} text="Refund recorded." />
    </form>
  );
}

interface FormProps {
  data: OrderForReturn;
  locationId: string;
  needsApproval: boolean;
  onDone: () => void;
}

function useReturnRows(data: OrderForReturn) {
  const [rows, setRows] = useState<Record<string, { quantity: string; condition: string }>>({});
  const retail = data.lines.filter((l) => l.item_type === 'retail');
  const set = (id: string, patch: Partial<{ quantity: string; condition: string }>) =>
    setRows((r) => ({ ...r, [id]: { quantity: '', condition: 'unopened_intact', ...r[id], ...patch } }));
  const entries = retail
    .filter((l) => Number(rows[l.order_line_id]?.quantity ?? 0) > 0)
    .map((l) => ({
      order_line_id: l.order_line_id,
      quantity: Number(rows[l.order_line_id]!.quantity),
      condition: rows[l.order_line_id]!.condition,
    }));
  const editor = (prefix: string) => (
    <ul className="flex flex-col gap-1">
      {retail.length === 0 ? <Empty>This order has no retail items. Meals are refunded instead.</Empty> : null}
      {retail.map((l) => (
        <li key={l.order_line_id} className="flex flex-wrap items-end gap-2 text-sm">
          <span className="mr-auto">
            {l.quantity} × {l.name} · already returned {l.returned_quantity}
          </span>
          <Field label="Units" htmlFor={`${prefix}-q-${l.order_line_id}`}>
            <input
              id={`${prefix}-q-${l.order_line_id}`}
              inputMode="numeric"
              className={`${inputClass} w-20`}
              value={rows[l.order_line_id]?.quantity ?? ''}
              onChange={(e) => set(l.order_line_id, { quantity: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="Condition" htmlFor={`${prefix}-c-${l.order_line_id}`}>
            <select
              id={`${prefix}-c-${l.order_line_id}`}
              className={inputClass}
              value={rows[l.order_line_id]?.condition ?? 'unopened_intact'}
              onChange={(e) => set(l.order_line_id, { condition: e.target.value })}
            >
              <option value="unopened_intact">Unopened, seal intact</option>
              <option value="opened">Opened</option>
              <option value="damaged">Damaged</option>
            </select>
          </Field>
        </li>
      ))}
    </ul>
  );
  return { entries, editor };
}

function ReturnForm({ data, locationId, needsApproval, onDone }: FormProps) {
  const { entries, editor } = useReturnRows(data);
  const [reason, setReason] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState(true);
  const [method, setMethod] = useState('cash');
  const [approval, setApproval] = useState<Approval>(emptyApproval);
  const m = useRpcMutation('process_return', `return:${data.order.order_id}:${data.refunded_cents}`, {
    onSuccess: onDone,
  });
  const valid =
    entries.length > 0 &&
    reason &&
    (!needsNote || note.trim().length >= 3) &&
    (!needsApproval || (approval.approverId && approval.pin.length >= 6));
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_order_id: data.order.order_id,
          p_lines: entries,
          p_reason_code: reason,
          p_note: note || undefined,
          p_refund_method: refund ? method : undefined,
          ...approvalArgs(approval, needsApproval),
        });
      }}
    >
      <h3 className="font-semibold">Retail return</h3>
      <p className="text-xs text-slate-700">
        Returned bottles go to a held custody record outside sellable stock until a manager decides. Window:{' '}
        {data.return_window_days ?? '—'} days from the sale.
      </p>
      {editor('ret')}
      <div className="flex flex-wrap items-end gap-2">
        <ReasonSelect
          use="return"
          id="return-reason"
          value={reason}
          onChange={(c, n) => {
            setReason(c);
            setNeedsNote(n);
          }}
        />
        <Field label={needsNote ? 'Note (required)' : 'Note'} htmlFor="return-note">
          <input id="return-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="h-5 w-5" />
          Refund the returned units
        </label>
        {refund ? <MethodSelect id="return-method" label="Paid back by" value={method} onChange={setMethod} /> : null}
      </div>
      {needsApproval ? (
        <ApprovalFields locationId={locationId} value={approval} onChange={setApproval} idPrefix="return" />
      ) : null}
      <Button type="submit" disabled={!m.canPost || !valid}>
        Record return
      </Button>
      <Status m={m} text="Return recorded; goods are in custody." />
    </form>
  );
}

function ExchangeForm({ data, locationId, needsApproval, onDone }: FormProps) {
  const { entries, editor } = useReturnRows(data);
  const menu = usePosMenu(locationId);
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [reason, setReason] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [note, setNote] = useState('');
  const [excessMethod, setExcessMethod] = useState('cash');
  const [approval, setApproval] = useState<Approval>(emptyApproval);
  const m = useRpcMutation<{
    amount_due_cents: number;
    refunded_excess_cents: number;
    new_order: { pickup_code: string };
  }>('process_exchange', `exchange:${data.order.order_id}:${data.refunded_cents}`, { onSuccess: onDone });
  const retailMenu = (menu.data ?? []).filter((i) => i.item_type === 'retail');
  const valid =
    entries.length > 0 &&
    newItem &&
    Number(newQty) >= 1 &&
    reason &&
    (!needsNote || note.trim().length >= 3) &&
    (!needsApproval || (approval.approverId && approval.pin.length >= 6));
  const done = 'kind' in m.state && m.state.kind === 'success' ? m.state.result : null;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_order_id: data.order.order_id,
          p_return_lines: entries,
          p_new_lines: [{ item_id: newItem, quantity: Number(newQty) }],
          p_reason_code: reason,
          p_note: note || undefined,
          p_excess_refund_method: excessMethod,
          ...approvalArgs(approval, needsApproval),
        });
      }}
    >
      <h3 className="font-semibold">Exchange (retail)</h3>
      <p className="text-xs text-slate-700">
        One step: the returned units go to custody, their original value is credited to a replacement sale, and the
        replacement is reserved and handed over. If the replacement is out of stock, nothing is recorded.
      </p>
      {editor('exc')}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Replacement item" htmlFor="exchange-item">
          <select
            id="exchange-item"
            className={inputClass}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
          >
            <option value="">Choose…</option>
            {retailMenu.map((i) => (
              <option key={i.item_id} value={i.item_id} disabled={!i.is_available}>
                {i.name} — {formatCents(i.price_cents)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" htmlFor="exchange-qty">
          <input
            id="exchange-qty"
            inputMode="numeric"
            className={`${inputClass} w-20`}
            value={newQty}
            onChange={(e) => setNewQty(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <ReasonSelect
          use="return"
          id="exchange-reason"
          value={reason}
          onChange={(c, n) => {
            setReason(c);
            setNeedsNote(n);
          }}
        />
        <Field label={needsNote ? 'Note (required)' : 'Note'} htmlFor="exchange-note">
          <input id="exchange-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <MethodSelect
          id="exchange-excess"
          label="If the credit exceeds the replacement, pay back by"
          value={excessMethod}
          onChange={setExcessMethod}
        />
      </div>
      {needsApproval ? (
        <ApprovalFields locationId={locationId} value={approval} onChange={setApproval} idPrefix="exchange" />
      ) : null}
      <Button type="submit" disabled={!m.canPost || !valid}>
        Record exchange
      </Button>
      <Status m={m} text="Exchange recorded." />
      {done ? (
        <Notice
          tone={done.amount_due_cents > 0 ? 'warning' : 'success'}
          title={`Replacement ${done.new_order.pickup_code}`}
        >
          {done.amount_due_cents > 0
            ? `Balance due ${formatCents(done.amount_due_cents)}: record it on the kitchen/pickup screen, then complete pickup.`
            : 'Handed over; nothing more is due.'}
          {done.refunded_excess_cents > 0 ? ` Difference paid back: ${formatCents(done.refunded_excess_cents)}.` : ''}
        </Notice>
      ) : null}
    </form>
  );
}

function OrderActions({ locationId, isManager }: { locationId: string; isManager: boolean }) {
  const queryClient = useQueryClient();
  const [lookup, setLookup] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<'refund' | 'return' | 'exchange'>('refund');
  const order = useQuery({
    queryKey: ['order-for-return', locationId, submitted],
    enabled: submitted.length > 0,
    queryFn: () =>
      callRpc<OrderForReturn | null>('get_order_for_return', { p_location_id: locationId, p_lookup: submitted }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['order-for-return', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['custody', locationId] });
  };
  const data = order.data;
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(lookup.trim());
        }}
      >
        <Field label="Order number or pickup code" htmlFor="return-lookup" hint="Returns need the original sale">
          <input id="return-lookup" className={inputClass} value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!lookup.trim()}>
          Find order
        </Button>
      </form>
      {!submitted ? null : order.isPending ? (
        <Loading />
      ) : order.error ? (
        <QueryError error={order.error} onRetry={() => void order.refetch()} />
      ) : !data ? (
        <Empty>No order with that number or pickup code at this location.</Empty>
      ) : (
        <>
          <div className="rounded-md border border-slate-300 bg-white p-3 text-sm">
            <p className="font-semibold">
              {data.order.order_number} · pickup {data.order.pickup_code}{' '}
              {data.order.pickup_name ? `· ${data.order.pickup_name}` : ''}
            </p>
            <p>
              <Badge tone={data.order.status === 'completed' ? 'good' : 'warn'}>{data.order.status}</Badge> · total{' '}
              {formatCents(data.order.total_cents)} · recorded payments {formatCents(data.order.paid_cents)} · refunded{' '}
              {formatCents(data.refunded_cents)}
              {data.order.completed_business_date ? ` · sold ${data.order.completed_business_date}` : ''}
            </p>
          </div>
          {data.order.status !== 'completed' ? (
            <Notice tone="warning">
              Only completed orders are refunded or returned here. An order not yet picked up is cancelled from the
              kitchen screen, which records any refund.
            </Notice>
          ) : (
            <>
              <div role="tablist" aria-label="Action" className="flex flex-wrap gap-2">
                {(['refund', 'return', 'exchange'] as const).map((t) => (
                  <Button
                    key={t}
                    role="tab"
                    aria-selected={mode === t}
                    variant={mode === t ? 'primary' : 'secondary'}
                    onClick={() => setMode(t)}
                  >
                    {t === 'refund' ? 'Refund' : t === 'return' ? 'Retail return' : 'Exchange'}
                  </Button>
                ))}
              </div>
              {!isManager ? (
                <p className="text-xs text-slate-700">A manager approves with their PIN on this tablet.</p>
              ) : null}
              {mode === 'refund' ? (
                <RefundForm data={data} locationId={locationId} needsApproval={!isManager} onDone={refresh} />
              ) : mode === 'return' ? (
                <ReturnForm data={data} locationId={locationId} needsApproval={!isManager} onDone={refresh} />
              ) : (
                <ExchangeForm data={data} locationId={locationId} needsApproval={!isManager} onDone={refresh} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface CustodyItem {
  custody_id: string;
  status: string;
  item_id: string;
  name: string;
  quantity: number;
  condition: string;
  return_number: string;
  order_number: string;
  processed_at: string;
  decided_at: string | null;
  decision_note: string | null;
  unit_issue_cost: string;
  resaleable: boolean;
}

function CustodyRow({ c, restockAllowed, onDone }: { c: CustodyItem; restockAllowed: boolean; onDone: () => void }) {
  const [note, setNote] = useState('');
  const m = useRpcMutation('decide_return_custody', `custody:${c.custody_id}`, { onSuccess: onDone });
  return (
    <li className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 text-sm">
      <p>
        {c.quantity} × {c.name} · {c.condition.replace('_', ', ')} · {c.return_number} (order {c.order_number}) ·{' '}
        {formatDateTime(c.processed_at)}{' '}
        <Badge tone={c.status === 'held' ? 'warn' : c.status === 'restocked' ? 'good' : 'neutral'}>{c.status}</Badge>
      </p>
      {c.status === 'held' ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Note" htmlFor={`custody-note-${c.custody_id}`} hint="Required to dispose">
            <input
              id={`custody-note-${c.custody_id}`}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Button
            disabled={!m.canPost || !restockAllowed || !c.resaleable}
            title={
              !restockAllowed
                ? 'The return policy does not allow restocking'
                : !c.resaleable
                  ? 'Not resaleable'
                  : undefined
            }
            onClick={() =>
              void m.submit({ p_custody_id: c.custody_id, p_decision: 'restock', p_note: note || undefined })
            }
          >
            Restock at original cost
          </Button>
          <Button
            variant="secondary"
            disabled={!m.canPost || note.trim().length < 3}
            onClick={() => void m.submit({ p_custody_id: c.custody_id, p_decision: 'dispose', p_note: note })}
          >
            Dispose
          </Button>
        </div>
      ) : c.decision_note ? (
        <p className="text-xs">Decision: {c.decision_note}</p>
      ) : null}
      <Status m={m} text="Decision recorded." />
    </li>
  );
}

function CustodyPanel({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const custody = useQuery({
    queryKey: ['custody', locationId],
    queryFn: () =>
      callRpc<{
        policy: { window_days: number; allow_customer_restock: boolean; provenance: string } | null;
        items: CustodyItem[];
      }>('list_return_custody', { p_location_id: locationId }),
  });
  if (custody.isPending) return <Loading />;
  if (custody.error) return <QueryError error={custody.error} onRetry={() => void custody.refetch()} />;
  const policy = custody.data.policy;
  return (
    <div className="flex flex-col gap-3">
      {policy ? (
        <Notice tone="info" title="Return policy">
          {policy.window_days}-day window. Restocking returned goods is{' '}
          {policy.allow_customer_restock ? 'allowed for unopened, shelf-stable retail units' : 'disabled'}.
          {policy.provenance.startsWith('synthetic') ? <Badge tone="warn">synthetic demo</Badge> : null}
        </Notice>
      ) : (
        <Notice tone="warning" title="No return policy">
          The owner sets it under Settings → Return policy. Retail returns stay closed until then.
        </Notice>
      )}
      {custody.data.items.length === 0 ? (
        <Empty>No returned goods held or decided in the last 30 days.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {custody.data.items.map((c) => (
            <CustodyRow
              key={c.custody_id}
              c={c}
              restockAllowed={Boolean(policy?.allow_customer_restock)}
              onDone={() => {
                void queryClient.invalidateQueries({ queryKey: ['custody', locationId] });
                void queryClient.invalidateQueries({ queryKey: ['stock', locationId] });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReturnsPage() {
  const { selectedLocation } = useAuth();
  const { tab } = useParams();
  if (!selectedLocation) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  const current = tab ?? 'orders';
  if (current !== 'orders' && !(current === 'custody' && isManager)) return <Navigate to="/returns" replace />;
  return (
    <section aria-labelledby="returns-heading" className="flex flex-col gap-4">
      <h1 id="returns-heading" className="text-2xl font-bold">
        Refunds &amp; returns — {selectedLocation.location_name}
      </h1>
      {isManager ? (
        <nav aria-label="Returns sections" className="flex gap-2">
          {[
            { id: 'orders', to: '/returns', label: 'Refund, return or exchange' },
            { id: 'custody', to: '/returns/custody', label: 'Returned goods' },
          ].map((t) => (
            <NavLink
              key={t.id}
              to={t.to}
              end
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${isActive ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white'}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
      {current === 'custody' ? (
        <CustodyPanel locationId={selectedLocation.location_id} />
      ) : (
        <OrderActions locationId={selectedLocation.location_id} isManager={isManager} />
      )}
    </section>
  );
}

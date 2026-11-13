import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApprovalFields, approvalArgs, emptyApproval, type Approval } from '../components/ApprovalFields';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../components/ui';
import { formatCents, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useRpcMutation } from '../lib/useRpcMutation';
import { RecordTender, type OrderResult } from './PosPage';

interface KitchenOrder {
  order_id: string;
  order_number: string;
  pickup_code: string;
  status: 'accepted' | 'preparing' | 'ready';
  version: number;
  revision: number;
  pickup_name: string | null;
  note: string | null;
  has_kitchen_items: boolean;
  total_cents: number;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  tax_cents: number;
  tender_mode: 'SIMULATED' | 'MANUAL_EXTERNAL';
  accepted_at: string;
  estimated_ready_at: string | null;
  order_lines: Array<{
    line_no: number;
    revision: number;
    quantity: number;
    item_id: string;
    items: { name: string; lead_time_note: string | null; prep_lead_days: number | null } | null;
  }>;
  tenders: Array<{ amount_cents: number }>;
}

const COLUMNS: Array<{ status: KitchenOrder['status']; title: string }> = [
  { status: 'accepted', title: 'Accepted' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready for pickup' },
];

function useKitchenQueue(locationId: string | undefined) {
  return useQuery({
    queryKey: ['kitchen', locationId],
    enabled: Boolean(locationId),
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'order_id, order_number, pickup_code, status, version, revision, pickup_name, note, has_kitchen_items, total_cents, gross_cents, discount_cents, net_cents, tax_cents, tender_mode, accepted_at, estimated_ready_at, order_lines(line_no, revision, quantity, item_id, items!order_lines_item_id_is_sellable_fkey(name, lead_time_note, prep_lead_days)), tenders(amount_cents)',
        )
        .eq('location_id', locationId!)
        .in('status', ['accepted', 'preparing', 'ready'])
        .order('accepted_at');
      if (error) throw error;
      return data as unknown as KitchenOrder[];
    },
  });
}

function ageMinutes(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function OrderCard({ order, locationId, isManager }: { order: KitchenOrder; locationId: string; isManager: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['kitchen', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['pos-menu'] });
  };
  const [eta, setEta] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [approval, setApproval] = useState<Approval>(emptyApproval);
  const [refundMethod, setRefundMethod] = useState('cash');
  const start = useRpcMutation('start_order_preparation', `start:${order.order_id}:${order.version}`, {
    onSuccess: refresh,
  });
  const ready = useRpcMutation('mark_order_ready', `ready:${order.order_id}:${order.version}`, { onSuccess: refresh });
  const complete = useRpcMutation('complete_order_pickup', `complete:${order.order_id}:${order.version}`, {
    onSuccess: refresh,
  });
  const cancel = useRpcMutation('cancel_order', `cancel:${order.order_id}:${order.version}`, { onSuccess: refresh });

  const lines = order.order_lines.filter((l) => l.revision === order.revision).sort((a, b) => a.line_no - b.line_no);
  const paid = order.tenders.reduce((s, t) => s + t.amount_cents, 0);
  const balance = order.total_cents - paid;
  const afterStart = order.status !== 'accepted';
  const needsApproval = (afterStart || paid > 0) && !isManager;
  const asResult: OrderResult = { ...order, paid_cents: paid, balance_due_cents: balance };

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      data-testid={`kitchen-${order.pickup_code}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-lg font-bold">
          <span className="font-mono">{order.pickup_code}</span> {order.pickup_name ? `· ${order.pickup_name}` : ''}
        </p>
        <Badge tone={ageMinutes(order.accepted_at) > 30 ? 'warn' : 'neutral'}>
          {ageMinutes(order.accepted_at)} min
        </Badge>
      </div>
      <ul className="text-sm">
        {lines.map((l) => (
          <li key={l.line_no}>
            <span className="font-semibold">{l.quantity} ×</span> {l.items?.name ?? l.item_id}
            {l.items?.prep_lead_days ? (
              <span className="block text-xs text-amber-800">Prep context: {l.items.lead_time_note}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {order.note ? <p className="text-sm italic">Note: {order.note}</p> : null}
      {order.estimated_ready_at ? <p className="text-xs">ETA {formatDateTime(order.estimated_ready_at)}</p> : null}

      {order.status === 'accepted' && order.has_kitchen_items ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Estimated ready (optional)" htmlFor={`eta-${order.order_id}`}>
            <input
              id={`eta-${order.order_id}`}
              type="time"
              className={inputClass}
              value={eta}
              onChange={(e) => setEta(e.target.value)}
            />
          </Field>
          <Button
            disabled={!start.canPost}
            onClick={() => {
              let estimated: string | undefined;
              if (eta) {
                const [h, m] = eta.split(':').map(Number);
                const d = new Date();
                d.setHours(h ?? 0, m ?? 0, 0, 0);
                estimated = d.toISOString();
              }
              void start.submit({
                p_order_id: order.order_id,
                p_expected_version: order.version,
                p_estimated_ready_at: estimated,
              });
            }}
          >
            Start preparation
          </Button>
        </div>
      ) : null}
      {order.status === 'preparing' || (order.status === 'accepted' && !order.has_kitchen_items) ? (
        <Button
          disabled={!ready.canPost}
          onClick={() => void ready.submit({ p_order_id: order.order_id, p_expected_version: order.version })}
        >
          Mark ready
        </Button>
      ) : null}
      {order.status === 'ready' ? (
        <>
          {balance > 0 ? (
            <RecordTender order={asResult} onRecorded={refresh} />
          ) : (
            <Badge tone="good">Payment recorded in full</Badge>
          )}
          <Button
            disabled={!complete.canPost || balance > 0}
            onClick={() => void complete.submit({ p_order_id: order.order_id, p_expected_version: order.version })}
          >
            Complete pickup
          </Button>
        </>
      ) : null}
      {order.status !== 'ready' && balance > 0 && paid === 0 ? (
        <p className="text-xs">Balance due {formatCents(balance)}</p>
      ) : null}

      <MutationStatus
        state={start.state}
        successText="Preparation started; ingredients issued."
        onRetry={() => void start.retry()}
        onCheckAgain={() => void start.checkAgain()}
      />
      <MutationStatus
        state={ready.state}
        successText="Marked ready."
        onRetry={() => void ready.retry()}
        onCheckAgain={() => void ready.checkAgain()}
      />
      <MutationStatus
        state={complete.state}
        successText="Pickup completed."
        onRetry={() => void complete.retry()}
        onCheckAgain={() => void complete.checkAgain()}
      />

      {!cancelOpen ? (
        <Button variant="secondary" onClick={() => setCancelOpen(true)}>
          Cancel order…
        </Button>
      ) : (
        <form
          className="flex flex-col gap-2 rounded-md border border-red-700 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void cancel.submit({
              p_order_id: order.order_id,
              p_expected_version: order.version,
              p_reason_code: reason,
              p_note: note || undefined,
              p_refund_method: paid > 0 ? refundMethod : undefined,
              ...approvalArgs(approval, needsApproval),
            });
          }}
        >
          <p className="text-sm">
            {afterStart
              ? 'Cooking has started: issued ingredients are recorded as waste. Nothing returns to stock. Manager approval required.'
              : 'Not started: reserved ingredients are released.'}
            {paid > 0
              ? ` A payment of ${formatCents(paid)} was recorded: the refund is recorded with the cancellation (handled outside the app; manager approval required).`
              : ''}
          </p>
          {paid > 0 ? (
            <Field label="Refund paid back by" htmlFor={`cancel-refund-${order.order_id}`}>
              <select
                id={`cancel-refund-${order.order_id}`}
                className={inputClass}
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value)}
              >
                <option value="cash">Cash (handled outside the app)</option>
                <option value="card_external">Card terminal (external)</option>
                <option value="other_external">Other external method</option>
              </select>
            </Field>
          ) : null}
          <Field label="Reason" htmlFor={`cancel-reason-${order.order_id}`}>
            <select
              id={`cancel-reason-${order.order_id}`}
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Choose…</option>
              {['CUSTOMER_COMPLAINT', 'WRONG_ITEM', 'PREP_ERROR', 'BURNT', 'OTHER'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note" htmlFor={`cancel-note-${order.order_id}`}>
            <input
              id={`cancel-note-${order.order_id}`}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {needsApproval ? (
            <ApprovalFields
              locationId={locationId}
              value={approval}
              onChange={setApproval}
              idPrefix={`cancel-${order.order_id}`}
            />
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={!cancel.canPost || !reason}>
              Cancel order
            </Button>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
          </div>
          <MutationStatus
            state={cancel.state}
            successText="Order cancelled."
            onRetry={() => void cancel.retry()}
            onCheckAgain={() => void cancel.checkAgain()}
          />
        </form>
      )}
    </li>
  );
}

export function KitchenPage() {
  const { selectedLocation } = useAuth();
  const locationId = selectedLocation?.location_id;
  const queue = useKitchenQueue(locationId);
  if (!selectedLocation || !locationId) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  return (
    <section aria-labelledby="kitchen-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="kitchen-heading" className="mr-auto text-2xl font-bold">
          Kitchen &amp; pickup — {selectedLocation.location_name}
        </h1>
        <Button variant="secondary" onClick={() => void queue.refetch()}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-slate-700">
        Staff start and complete each step. Nothing advances on a timer; prep lead times are shown as context only.
      </p>
      {queue.isPending ? (
        <Loading />
      ) : queue.error ? (
        <QueryError error={queue.error} onRetry={() => void queue.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((c) => {
            const orders = queue.data.filter((o) => o.status === c.status);
            return (
              <div key={c.status} className="rounded-lg bg-slate-100 p-3">
                <h2 className="mb-2 text-lg font-semibold">
                  {c.title} ({orders.length})
                </h2>
                {orders.length === 0 ? (
                  <Empty>No orders.</Empty>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {orders.map((o) => (
                      <OrderCard
                        key={`${o.order_id}:${o.version}`}
                        order={o}
                        locationId={locationId}
                        isManager={isManager}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApprovalFields, approvalArgs, emptyApproval, type Approval } from '../components/ApprovalFields';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../components/ui';
import {
  clearDraft,
  interpretScan,
  loadDraft,
  newDraft,
  saveDraft,
  setLineQuantity,
  type PosDraft,
} from '../lib/draft';
import { formatCents } from '../lib/format';
import { estimateOrder } from '../lib/money';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useRpcMutation } from '../lib/useRpcMutation';

export interface MenuItem {
  item_id: string;
  name: string;
  item_type: 'finished_dish' | 'retail';
  category: string;
  price_cents: number | null;
  is_available: boolean;
  unavailable_reason: string | null;
  portions_available: number;
  bottleneck_item_id: string | null;
  bottleneck_name: string | null;
  prep_lead_days: number | null;
  lead_time_note: string | null;
}

export interface OrderResult {
  order_id: string;
  order_number: string;
  pickup_code: string;
  status: string;
  version: number;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_due_cents: number;
  tender_mode: 'SIMULATED' | 'MANUAL_EXTERNAL';
}

export function usePosMenu(locationId: string | undefined) {
  return useQuery({
    queryKey: ['pos-menu', locationId],
    queryFn: () => callRpc<MenuItem[]>('get_pos_menu', { p_location_id: locationId! }),
    enabled: Boolean(locationId),
    refetchInterval: 30_000,
  });
}

function useTaxRate(locationId: string | undefined, today: string | undefined) {
  return useQuery({
    queryKey: ['tax-rate-current', locationId, today],
    enabled: Boolean(locationId && today),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_tax_rates')
        .select('rate, effective_from')
        .eq('location_id', locationId!)
        .lte('effective_from', today!)
        .order('effective_from', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data[0]?.rate != null ? String(data[0].rate) : null;
    },
  });
}

export function tenderLabel(mode: string): string {
  return mode === 'SIMULATED'
    ? 'Simulated payment (demo — no money moves)'
    : 'Recorded payment (handled outside the app)';
}

export function RecordTender({ order, onRecorded }: { order: OrderResult; onRecorded: (o: OrderResult) => void }) {
  const [amount, setAmount] = useState((order.balance_due_cents / 100).toFixed(2));
  const [method, setMethod] = useState('card_external');
  const [reference, setReference] = useState('');
  const m = useRpcMutation<OrderResult>('record_tender', `tender:${order.order_id}:${order.paid_cents}`, {
    onSuccess: onRecorded,
  });
  const cents = Math.round(Number(amount) * 100);
  if (order.balance_due_cents <= 0) {
    return (
      <div className="flex flex-col gap-2">
        <Badge tone="good">Balance due $0.00 — payment recorded</Badge>
        <MutationStatus
          state={m.state}
          successText="Payment recorded."
          onRetry={() => void m.retry()}
          onCheckAgain={() => void m.checkAgain()}
        />
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_order_id: order.order_id,
          p_amount_cents: cents,
          p_method: method,
          p_external_reference: reference || undefined,
        });
      }}
    >
      <h3 className="font-semibold">{tenderLabel(order.tender_mode)}</h3>
      <p className="text-sm">
        Balance due: <span className="font-semibold">{formatCents(order.balance_due_cents)}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Amount ($)" htmlFor={`tender-amount-${order.order_id}`}>
          <input
            id={`tender-amount-${order.order_id}`}
            inputMode="decimal"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Method" htmlFor={`tender-method-${order.order_id}`}>
          <select
            id={`tender-method-${order.order_id}`}
            className={inputClass}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="card_external">Card (external terminal)</option>
            <option value="cash">Cash</option>
            <option value="other_external">Other external</option>
          </select>
        </Field>
        <Field label="External reference (optional)" htmlFor={`tender-ref-${order.order_id}`}>
          <input
            id={`tender-ref-${order.order_id}`}
            className={inputClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" disabled={!m.canPost || !(cents > 0)}>
        Record payment
      </Button>
      <MutationStatus
        state={m.state}
        successText="Payment recorded."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function CustomerPicker({
  locationId,
  draft,
  update,
}: {
  locationId: string;
  draft: PosDraft;
  update: (d: Partial<PosDraft>) => void;
}) {
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const results = useQuery({
    queryKey: ['customer-search', locationId, query],
    enabled: query.trim().length >= 2,
    queryFn: () =>
      callRpc<Array<{ customer_id: string; display_name: string }>>('search_customers', {
        p_location_id: locationId,
        p_query: query,
      }),
  });
  const create = useRpcMutation<{ customer_id: string; display_name: string }>(
    'create_customer',
    `create-customer:${draft.draftId}`,
    {
      onSuccess: (c) => update({ customerId: c.customer_id, customerName: c.display_name }),
    },
  );
  if (draft.customerId) {
    return (
      <p className="flex items-center gap-2 text-sm">
        Customer: <span className="font-semibold">{draft.customerName}</span>
        <Button variant="secondary" onClick={() => update({ customerId: null, customerName: null })}>
          Remove
        </Button>
      </p>
    );
  }
  return (
    <details className="rounded-md border border-slate-300 p-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
        Customer (optional — walk-ins need none)
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <Field label="Find customer" htmlFor="customer-search">
          <input id="customer-search" className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        {results.data?.length ? (
          <ul className="flex flex-col gap-1">
            {results.data.map((c) => (
              <li key={c.customer_id}>
                <Button
                  variant="secondary"
                  className="w-full text-left"
                  onClick={() => update({ customerId: c.customer_id, customerName: c.display_name })}
                >
                  {c.display_name}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create.submit({ p_location_id: locationId, p_display_name: newName });
          }}
        >
          <Field label="New customer name" htmlFor="customer-new">
            <input
              id="customer-new"
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!create.canPost || !newName.trim()}>
            Add customer
          </Button>
        </form>
        <MutationStatus
          state={create.state}
          successText="Customer added."
          onRetry={() => void create.retry()}
          onCheckAgain={() => void create.checkAgain()}
        />
      </div>
    </details>
  );
}

export function PosPage() {
  const { context, selectedLocation } = useAuth();
  const queryClient = useQueryClient();
  const locationId = selectedLocation?.location_id;
  const menu = usePosMenu(locationId);
  const taxRate = useTaxRate(locationId, context?.business_date);
  const [draft, setDraft] = useState<PosDraft>(() => (locationId ? loadDraft(locationId) : newDraft()));
  const [scan, setScan] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval>(emptyApproval);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (locationId) setDraft(loadDraft(locationId));
    setOrder(null);
  }, [locationId]);

  const update = (patch: Partial<PosDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (locationId) saveDraft(locationId, next);
      return next;
    });
  };

  const accept = useRpcMutation<OrderResult>('accept_order', `accept-order:${draft.draftId}`, {
    onSuccess: (result) => {
      setOrder(result);
      if (locationId) clearDraft(locationId);
      setDraft(newDraft());
      setApproval(emptyApproval);
      void queryClient.invalidateQueries({ queryKey: ['pos-menu'] });
      void queryClient.invalidateQueries({ queryKey: ['kitchen'] });
    },
  });

  if (!selectedLocation || !locationId) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  const items = menu.data ?? [];
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const lines = draft.lines.map((l) => ({ ...l, item: byId.get(l.item_id) }));
  const estimate = estimateOrder(
    lines.map((l) => ({ unitPrice: l.item?.price_cents ?? 0, quantity: l.quantity })),
    draft.discountPercent || '0',
    taxRate.data ?? null,
  );
  const discountNum = Number(draft.discountPercent || 0);
  const discountValid =
    draft.discountPercent === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(draft.discountPercent) && discountNum <= 100);
  const needsApproval = discountNum > 0 && !isManager;

  const add = (itemId: string) => {
    const current = draft.lines.find((l) => l.item_id === itemId)?.quantity ?? 0;
    update({ lines: setLineQuantity(draft.lines, itemId, current + 1) });
  };

  function onScan(e: FormEvent) {
    e.preventDefault();
    if (!menu.data) {
      // A scan that arrives before the menu has loaded must not be reported as an unknown code.
      setScanMessage(
        menu.error
          ? 'The menu could not be loaded. Nothing was added.'
          : 'Menu still loading — scan again in a moment. Nothing was added.',
      );
      setScan('');
      scanRef.current?.focus();
      return;
    }
    const result = interpretScan(scan, items);
    if (result.kind === 'add') {
      add(result.itemId);
      setScanMessage(`Added ${byId.get(result.itemId)?.name}.`);
    } else if (result.kind === 'ingredient')
      setScanMessage(`${result.code}: Ingredient — not sellable. Nothing was added.`);
    else if (result.kind === 'unavailable') setScanMessage(`${result.itemId} is switched off on this menu.`);
    else setScanMessage(`Unknown code "${result.code}".`);
    setScan('');
    scanRef.current?.focus();
  }

  function submitOrder() {
    void accept.submit({
      p_location_id: locationId!,
      p_lines: draft.lines,
      p_customer_id: draft.customerId ?? undefined,
      p_pickup_name: draft.pickupName || undefined,
      p_note: draft.note || undefined,
      p_discount_percent: discountNum,
      p_discount_reason: discountNum > 0 ? draft.discountReason : undefined,
      ...approvalArgs(approval, needsApproval),
    });
  }

  return (
    <section aria-labelledby="pos-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="pos-heading" className="mr-auto text-2xl font-bold">
          Staff POS — {selectedLocation.location_name}
        </h1>
        <form onSubmit={onScan} className="flex items-end gap-2">
          <Field label="Scan or type item code" htmlFor="scan-input">
            <input
              id="scan-input"
              ref={scanRef}
              autoComplete="off"
              className={inputClass}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </div>
      {scanMessage ? (
        <p role="status" className="text-sm font-semibold">
          {scanMessage}
        </p>
      ) : null}

      {order ? (
        <div
          className="flex flex-col gap-3 rounded-lg border-2 border-emerald-700 bg-emerald-50 p-4"
          data-testid="accepted-order"
        >
          <p className="text-lg font-bold">
            Order {order.order_number} accepted — pickup code <span className="font-mono">{order.pickup_code}</span>
          </p>
          <p className="text-sm">
            Subtotal {formatCents(order.gross_cents)} · Discount {formatCents(order.discount_cents)} · Tax{' '}
            {formatCents(order.tax_cents)} ·{' '}
            <span className="font-semibold">Total {formatCents(order.total_cents)}</span>
          </p>
          <RecordTender order={order} onRecorded={(o) => setOrder(o)} />
          <Button
            variant="secondary"
            onClick={() => {
              setOrder(null);
              accept.reset();
            }}
          >
            Start a new order
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Menu</h2>
          {menu.isPending ? (
            <Loading />
          ) : menu.error ? (
            <QueryError error={menu.error} onRetry={() => void menu.refetch()} />
          ) : items.length === 0 ? (
            <Empty>No sellable items. Import the catalog first.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((i) => {
                const blocked = !i.is_available || i.portions_available < 1 || i.price_cents === null;
                return (
                  <li key={i.item_id}>
                    <button
                      type="button"
                      onClick={() => add(i.item_id)}
                      disabled={blocked}
                      className="flex min-h-20 w-full flex-col items-start rounded-md border border-slate-400 bg-white p-3 text-left hover:bg-slate-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:bg-slate-200"
                    >
                      <span className="font-semibold">{i.name}</span>
                      <span className="text-sm">
                        {i.price_cents === null ? 'No price set' : formatCents(i.price_cents)}
                      </span>
                      <span className="text-xs text-slate-700">
                        {!i.is_available
                          ? `Off menu: ${i.unavailable_reason ?? 'manager override'}`
                          : `${i.portions_available} available now${i.bottleneck_name ? ` · limited by ${i.bottleneck_name}` : ''}`}
                      </span>
                      {i.prep_lead_days ? (
                        <span className="text-xs text-amber-800">Prep note: {i.lead_time_note}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-600">
            Availability counts are independent per dish; dishes share ingredients, so they cannot all be sold at once.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Cart</h2>
            {draft.lines.length ? <Badge tone="warn">Unsent draft — not an order yet</Badge> : null}
          </div>
          {lines.length === 0 ? (
            <Empty>Tap a menu item or scan a code.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((l) => (
                <li key={l.item_id} className="flex items-center gap-2">
                  <span className="mr-auto text-sm">{l.item?.name ?? l.item_id}</span>
                  <Button
                    variant="secondary"
                    aria-label={`Remove one ${l.item?.name}`}
                    onClick={() => update({ lines: setLineQuantity(draft.lines, l.item_id, l.quantity - 1) })}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center font-semibold" aria-label="quantity">
                    {l.quantity}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={`Add one ${l.item?.name}`}
                    onClick={() => update({ lines: setLineQuantity(draft.lines, l.item_id, l.quantity + 1) })}
                  >
                    +
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <CustomerPicker locationId={locationId} draft={draft} update={update} />
          <Field label="Pickup name (optional)" htmlFor="pickup-name">
            <input
              id="pickup-name"
              className={inputClass}
              value={draft.pickupName}
              onChange={(e) => update({ pickupName: e.target.value })}
            />
          </Field>
          <Field label="Kitchen note (no ingredient substitutions)" htmlFor="order-note">
            <input
              id="order-note"
              className={inputClass}
              value={draft.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Discount %" htmlFor="discount-pct" hint="Manager approval required">
              <input
                id="discount-pct"
                inputMode="decimal"
                className={inputClass}
                value={draft.discountPercent}
                onChange={(e) => update({ discountPercent: e.target.value })}
              />
            </Field>
            <Field label="Discount reason" htmlFor="discount-reason">
              <input
                id="discount-reason"
                className={inputClass}
                value={draft.discountReason}
                onChange={(e) => update({ discountReason: e.target.value })}
              />
            </Field>
          </div>
          {needsApproval ? (
            <ApprovalFields locationId={locationId} value={approval} onChange={setApproval} idPrefix="pos" />
          ) : null}
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt>Subtotal</dt>
            <dd className="text-right">{formatCents(estimate.gross)}</dd>
            <dt>Discount</dt>
            <dd className="text-right">−{formatCents(estimate.discount)}</dd>
            <dt>Tax {taxRate.data ? `(${(Number(taxRate.data) * 100).toFixed(2)}%)` : ''}</dt>
            <dd className="text-right">{formatCents(estimate.tax)}</dd>
            <dt className="font-bold">Total (estimate)</dt>
            <dd className="text-right font-bold">{formatCents(estimate.total)}</dd>
          </dl>
          <p className="text-xs text-slate-600">
            The server recalculates prices, discount and tax and reserves stock when you accept.
          </p>
          <Button
            onClick={submitOrder}
            disabled={
              !accept.canPost ||
              draft.lines.length === 0 ||
              !discountValid ||
              (discountNum > 0 && draft.discountReason.trim().length < 3) ||
              (needsApproval && (!approval.approverId || approval.pin.length < 6))
            }
          >
            Accept order
          </Button>
          <MutationStatus
            state={accept.state}
            successText="Order accepted and ingredients reserved."
            onRetry={() => void accept.retry()}
            onCheckAgain={() => void accept.checkAgain()}
          />
          {draft.lines.length ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (locationId) clearDraft(locationId);
                setDraft(newDraft());
                accept.reset();
              }}
            >
              Discard draft
            </Button>
          ) : null}
        </div>
      </div>
      {context?.posting_enabled ? null : (
        <Notice tone="warning">Posting is disabled until the pilot setup gates pass. Orders will be refused.</Notice>
      )}
    </section>
  );
}

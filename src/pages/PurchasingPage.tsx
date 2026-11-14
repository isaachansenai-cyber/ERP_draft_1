import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../components/ui';
import { formatCents, formatDateTime, parseDollarsToCents } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useRpcMutation } from '../lib/useRpcMutation';
import { qty } from './InventoryPage';

interface SupplierItem {
  supplier_item_id: string;
  supplier_id: string;
  item_id: string;
  is_primary: boolean;
  pack_description: string | null;
  pack_base_qty: string | null;
  pack_cost_cents: number | null;
  cost_basis: string | null;
  procurement_lead_days: number | null;
  lead_time_basis: string | null;
  items: { name: string; base_unit: string; requires_use_by: boolean } | null;
}

interface Supplier {
  supplier_id: string;
  name: string;
  phone: string | null;
  contact_email: string | null;
  contact_verification: string;
  payment_terms_days: number | null;
  payment_terms_provenance: string | null;
  supplier_items: SupplierItem[];
}

interface PoLine {
  po_line_id: string;
  line_no: number;
  item_id: string;
  ordered_packs: string;
  received_packs: string;
  cancelled_packs: string;
  pack_base_qty: string;
  pack_cost_cents: number;
  items: { name: string; base_unit: string; requires_use_by: boolean } | null;
}

interface PurchaseOrder {
  po_id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  version: number;
  expected_date: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  purchase_order_lines: PoLine[];
}

function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select(
          'supplier_id, name, phone, contact_email, contact_verification, payment_terms_days, payment_terms_provenance, supplier_items(supplier_item_id, supplier_id, item_id, is_primary, pack_description, pack_base_qty, pack_cost_cents, cost_basis, procurement_lead_days, lead_time_basis, items!supplier_items_item_id_is_purchasable_fkey(name, base_unit, requires_use_by))',
        )
        .order('supplier_id');
      if (error) throw error;
      return data as unknown as Supplier[];
    },
  });
}

function provenanceBadge(p: string | null) {
  if (!p) return <Badge tone="bad">Not entered</Badge>;
  if (p.startsWith('synthetic')) return <Badge tone="warn">Synthetic demo</Badge>;
  return <Badge tone="good">Operator entered</Badge>;
}

function CreatePurchaseOrder({
  locationId,
  suppliers,
  onCreated,
}: {
  locationId: string;
  suppliers: Supplier[];
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [packs, setPacks] = useState<Record<string, string>>({});
  const m = useRpcMutation('create_purchase_order', `create-po:${locationId}`, {
    onSuccess: () => {
      setPacks({});
      onCreated();
    },
  });
  const supplier = suppliers.find((s) => s.supplier_id === supplierId);
  const orderable = (supplier?.supplier_items ?? []).filter((si) => si.pack_base_qty !== null);
  const lines = Object.entries(packs)
    .filter(([, v]) => Number(v) > 0)
    .map(([id, v]) => ({ supplier_item_id: id, packs: v }));
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_supplier_id: supplierId,
          // The RPC parameter has no default: send an explicit null (an omitted key would not match).
          p_expected_date: expected || (null as unknown as string),
          p_lines: lines,
        });
      }}
    >
      <h2 className="text-lg font-semibold">New purchase order (draft)</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="po-supplier">
          <select
            id="po-supplier"
            className={inputClass}
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setPacks({});
            }}
          >
            <option value="">Choose…</option>
            {suppliers.map((s) => (
              <option key={s.supplier_id} value={s.supplier_id}>
                {s.supplier_id} {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected delivery date" htmlFor="po-expected">
          <input
            id="po-expected"
            type="date"
            className={inputClass}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
      </div>
      {supplier && orderable.length === 0 ? (
        <Notice tone="warning">
          No items from this supplier have a pack size yet. The owner sets packs under Suppliers &amp; packs.
        </Notice>
      ) : null}
      {orderable.length ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-400 text-left">
              <th className="p-1">Item</th>
              <th className="p-1">Pack</th>
              <th className="p-1">Pack cost</th>
              <th className="p-1">Lead time</th>
              <th className="p-1">Packs to order</th>
            </tr>
          </thead>
          <tbody>
            {orderable.map((si) => (
              <tr key={si.supplier_item_id} className="border-b border-slate-200">
                <td className="p-1">
                  <span className="font-mono">{si.item_id}</span> {si.items?.name}
                </td>
                <td className="p-1">
                  {si.pack_description} ({qty(si.pack_base_qty)} {si.items?.base_unit})
                </td>
                <td className="p-1">{formatCents(si.pack_cost_cents)}</td>
                <td className="p-1">
                  {si.procurement_lead_days ?? '—'} d{' '}
                  <span className="text-xs">({si.lead_time_basis ?? 'unknown'})</span>
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${si.item_id} packs`}
                    inputMode="decimal"
                    className={`${inputClass} w-24`}
                    value={packs[si.supplier_item_id] ?? ''}
                    onChange={(e) => setPacks((p) => ({ ...p, [si.supplier_item_id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Button type="submit" disabled={!m.canPost || !supplierId || lines.length === 0}>
        Create draft PO
      </Button>
      <MutationStatus
        state={m.state}
        successText="Draft purchase order created."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function ReceiveForm({ po, onDone }: { po: PurchaseOrder; onDone: () => void }) {
  // All lines are shown: an over-receipt is allowed with an explicit acknowledgement.
  const open = po.purchase_order_lines;
  const [slip, setSlip] = useState('');
  const [ack, setAck] = useState(false);
  const [rows, setRows] = useState<Record<string, { packs: string; lot: string; useBy: string; packCost: string }>>({});
  const m = useRpcMutation('receive_purchase_order', `receive:${po.po_id}:${po.version}`, { onSuccess: onDone });
  const set = (id: string, patch: Partial<{ packs: string; lot: string; useBy: string; packCost: string }>) =>
    setRows((r) => ({ ...r, [id]: { packs: '', lot: '', useBy: '', packCost: '', ...r[id], ...patch } }));
  const lines = Object.entries(rows)
    .filter(([, r]) => Number(r.packs) > 0)
    .map(([id, r]) => ({
      po_line_id: id,
      packs: r.packs,
      supplier_lot: r.lot || undefined,
      use_by_date: r.useBy || undefined,
      pack_cost_cents: r.packCost ? (parseDollarsToCents(r.packCost) ?? undefined) : undefined,
    }));
  const over = open.some(
    (l) => Number(rows[l.po_line_id]?.packs ?? 0) + Number(l.received_packs) > Number(l.ordered_packs),
  );
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-md border border-emerald-700 bg-emerald-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_po_id: po.po_id,
          p_expected_version: po.version,
          p_packing_slip_ref: slip || (null as unknown as string),
          p_lines: lines,
          p_acknowledge_over_receipt: ack,
        });
      }}
    >
      <h3 className="font-semibold">Receive delivery — enter only what actually arrived</h3>
      <Field label="Packing slip / reference" htmlFor={`slip-${po.po_id}`}>
        <input id={`slip-${po.po_id}`} className={inputClass} value={slip} onChange={(e) => setSlip(e.target.value)} />
      </Field>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-400 text-left">
            <th className="p-1">Item</th>
            <th className="p-1">Open packs</th>
            <th className="p-1">Packs received</th>
            <th className="p-1">Supplier lot</th>
            <th className="p-1">Use-by</th>
            <th className="p-1">Actual pack cost $</th>
          </tr>
        </thead>
        <tbody>
          {open.map((l) => (
            <tr key={l.po_line_id} className="border-b border-slate-200">
              <td className="p-1">
                {l.items?.name}
                {l.items?.requires_use_by ? (
                  <>
                    {' '}
                    <Badge tone="warn">use-by</Badge>
                  </>
                ) : null}
              </td>
              <td className="p-1">{qty(String(Number(l.ordered_packs) - Number(l.received_packs)))}</td>
              <td className="p-1">
                <input
                  aria-label={`${l.item_id} packs received`}
                  inputMode="decimal"
                  className={`${inputClass} w-20`}
                  value={rows[l.po_line_id]?.packs ?? ''}
                  onChange={(e) => set(l.po_line_id, { packs: e.target.value })}
                />
              </td>
              <td className="p-1">
                <input
                  aria-label={`${l.item_id} supplier lot`}
                  className={`${inputClass} w-28`}
                  value={rows[l.po_line_id]?.lot ?? ''}
                  onChange={(e) => set(l.po_line_id, { lot: e.target.value })}
                />
              </td>
              <td className="p-1">
                <input
                  aria-label={`${l.item_id} use-by`}
                  type="date"
                  className={inputClass}
                  value={rows[l.po_line_id]?.useBy ?? ''}
                  onChange={(e) => set(l.po_line_id, { useBy: e.target.value })}
                />
              </td>
              <td className="p-1">
                <input
                  aria-label={`${l.item_id} actual pack cost`}
                  inputMode="decimal"
                  placeholder={(l.pack_cost_cents / 100).toFixed(2)}
                  className={`${inputClass} w-24`}
                  value={rows[l.po_line_id]?.packCost ?? ''}
                  onChange={(e) => set(l.po_line_id, { packCost: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {over ? (
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-6 w-6" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
          acknowledge this is more than was ordered (recorded in the audit log)
        </label>
      ) : null}
      <Button type="submit" disabled={!m.canPost || lines.length === 0 || (over && !ack)}>
        Post receipt
      </Button>
      <MutationStatus
        state={m.state}
        successText="Receipt posted; stock and average cost updated."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function PoCard({ po, onChange }: { po: PurchaseOrder; onChange: () => void }) {
  const [receiving, setReceiving] = useState(false);
  const [reason, setReason] = useState('');
  const submit = useRpcMutation('submit_purchase_order', `submit-po:${po.po_id}:${po.version}`, {
    onSuccess: onChange,
  });
  const cancel = useRpcMutation('cancel_purchase_order_balance', `cancel-po:${po.po_id}:${po.version}`, {
    onSuccess: onChange,
  });
  const openForReceipt = po.status === 'submitted' || po.status === 'partially_received';
  return (
    <li className="rounded-md border border-slate-400 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto font-semibold">
          {po.po_number} · {po.suppliers?.name}
        </p>
        <Badge tone={po.status === 'received' ? 'good' : po.status === 'cancelled' ? 'bad' : 'neutral'}>
          {po.status.replace('_', ' ')}
        </Badge>
      </div>
      <p className="text-xs text-slate-600">
        Created {formatDateTime(po.created_at)}
        {po.expected_date ? ` · expected ${po.expected_date}` : ''}
      </p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left">
            <th className="p-1">Item</th>
            <th className="p-1">Ordered</th>
            <th className="p-1">Received</th>
            <th className="p-1">Cancelled</th>
            <th className="p-1">Pack</th>
          </tr>
        </thead>
        <tbody>
          {po.purchase_order_lines
            .sort((a, b) => a.line_no - b.line_no)
            .map((l) => (
              <tr key={l.po_line_id} className="border-b border-slate-100">
                <td className="p-1">{l.items?.name}</td>
                <td className="p-1">{qty(l.ordered_packs)}</td>
                <td className="p-1">{qty(l.received_packs)}</td>
                <td className="p-1">{qty(l.cancelled_packs)}</td>
                <td className="p-1">
                  {qty(l.pack_base_qty)} {l.items?.base_unit} @ {formatCents(l.pack_cost_cents)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2">
        {po.status === 'draft' ? (
          <Button
            disabled={!submit.canPost}
            onClick={() => void submit.submit({ p_po_id: po.po_id, p_expected_version: po.version })}
          >
            Submit (placed outside the app)
          </Button>
        ) : null}
        {openForReceipt ? (
          <Button variant="secondary" onClick={() => setReceiving((r) => !r)}>
            {receiving ? 'Close receiving' : 'Receive…'}
          </Button>
        ) : null}
      </div>
      <MutationStatus
        state={submit.state}
        successText="Purchase order submitted."
        onRetry={() => void submit.retry()}
        onCheckAgain={() => void submit.checkAgain()}
      />
      {receiving && openForReceipt ? (
        <ReceiveForm
          po={po}
          onDone={() => {
            setReceiving(false);
            onChange();
          }}
        />
      ) : null}
      {['draft', 'submitted', 'partially_received'].includes(po.status) ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void cancel.submit({ p_po_id: po.po_id, p_expected_version: po.version, p_reason: reason });
          }}
        >
          <Field
            label={po.status === 'draft' ? 'Cancel draft — reason' : 'Close unreceived balance — reason'}
            htmlFor={`po-cancel-${po.po_id}`}
          >
            <input
              id={`po-cancel-${po.po_id}`}
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="danger" disabled={!cancel.canPost || reason.trim().length < 3}>
            Cancel balance
          </Button>
          <div className="w-full">
            <MutationStatus
              state={cancel.state}
              successText="Open balance cancelled."
              onRetry={() => void cancel.retry()}
              onCheckAgain={() => void cancel.checkAgain()}
            />
          </div>
        </form>
      ) : null}
    </li>
  );
}

function PurchaseOrders({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const pos = useQuery({
    queryKey: ['purchase-orders', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(
          'po_id, po_number, supplier_id, status, version, expected_date, created_at, suppliers(name), purchase_order_lines(po_line_id, line_no, item_id, ordered_packs, received_packs, cancelled_packs, pack_base_qty, pack_cost_cents, items!purchase_order_lines_item_id_fkey(name, base_unit, requires_use_by))',
        )
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as PurchaseOrder[];
    },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['stock', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['pos-menu'] });
  };
  return (
    <div className="flex flex-col gap-4">
      {suppliers.data ? (
        <CreatePurchaseOrder locationId={locationId} suppliers={suppliers.data} onCreated={refresh} />
      ) : suppliers.error ? (
        <QueryError error={suppliers.error} />
      ) : (
        <Loading />
      )}
      <h2 className="text-lg font-semibold">Purchase orders</h2>
      {pos.isPending ? (
        <Loading />
      ) : pos.error ? (
        <QueryError error={pos.error} onRetry={() => void pos.refetch()} />
      ) : pos.data.length === 0 ? (
        <Empty>No purchase orders yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {pos.data.map((po) => (
            <PoCard key={`${po.po_id}:${po.version}`} po={po} onChange={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SupplierTerms({ supplier, canEdit }: { supplier: Supplier; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(supplier.payment_terms_days?.toString() ?? '');
  const m = useRpcMutation('set_supplier_terms', `terms:${supplier.supplier_id}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_supplier_id: supplier.supplier_id, p_payment_terms_days: Number(days) });
      }}
    >
      <p className="text-sm">
        Payment terms: {supplier.payment_terms_days ?? '—'} days {provenanceBadge(supplier.payment_terms_provenance)}
      </p>
      {canEdit ? (
        <>
          <Field label="Terms (days)" htmlFor={`terms-${supplier.supplier_id}`}>
            <input
              id={`terms-${supplier.supplier_id}`}
              inputMode="numeric"
              className={`${inputClass} w-24`}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!m.canPost || !/^\d{1,3}$/.test(days)}>
            Save terms
          </Button>
        </>
      ) : null}
      <div className="w-full">
        <MutationStatus
          state={m.state}
          successText="Terms saved."
          onRetry={() => void m.retry()}
          onCheckAgain={() => void m.checkAgain()}
        />
      </div>
    </form>
  );
}

function PackEditor({ si, canEdit }: { si: SupplierItem; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [desc, setDesc] = useState(si.pack_description ?? '');
  const [baseQty, setBaseQty] = useState(si.pack_base_qty ? qty(si.pack_base_qty) : '');
  const [cost, setCost] = useState(si.pack_cost_cents != null ? (si.pack_cost_cents / 100).toFixed(2) : '');
  const [basis, setBasis] = useState(si.cost_basis === 'quoted' ? 'quoted' : 'estimated');
  const m = useRpcMutation('set_supplier_item_pack', `pack:${si.supplier_item_id}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });
  const cents = parseDollarsToCents(cost);
  return (
    <li className="border-b border-slate-200 py-2 text-sm">
      <p>
        <span className="font-mono">{si.item_id}</span> {si.items?.name} ·{' '}
        {si.pack_base_qty
          ? `${si.pack_description} = ${qty(si.pack_base_qty)} ${si.items?.base_unit} @ ${formatCents(si.pack_cost_cents)}`
          : 'No pack yet'}{' '}
        {si.cost_basis ? (
          si.cost_basis.startsWith('synthetic') ? (
            <Badge tone="warn">Synthetic demo</Badge>
          ) : (
            <Badge tone="good">{si.cost_basis}</Badge>
          )
        ) : (
          <Badge tone="bad">Not entered</Badge>
        )}{' '}
        <span className="text-xs">
          Lead time {si.procurement_lead_days ?? '—'} d ({si.lead_time_basis ?? 'unknown'}; not a supplier quote)
        </span>
      </p>
      {canEdit ? (
        <form
          className="mt-1 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null)
              void m.submit({
                p_supplier_item_id: si.supplier_item_id,
                p_pack_description: desc,
                p_pack_base_qty: Number(baseQty),
                p_pack_cost_cents: cents,
                p_cost_basis: basis,
              });
          }}
        >
          <Field label="Pack description" htmlFor={`pack-desc-${si.supplier_item_id}`}>
            <input
              id={`pack-desc-${si.supplier_item_id}`}
              className={`${inputClass} w-40`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Field>
          <Field label={`Pack size (${si.items?.base_unit})`} htmlFor={`pack-qty-${si.supplier_item_id}`}>
            <input
              id={`pack-qty-${si.supplier_item_id}`}
              inputMode="decimal"
              className={`${inputClass} w-28`}
              value={baseQty}
              onChange={(e) => setBaseQty(e.target.value)}
            />
          </Field>
          <Field label="Pack cost $" htmlFor={`pack-cost-${si.supplier_item_id}`}>
            <input
              id={`pack-cost-${si.supplier_item_id}`}
              inputMode="decimal"
              className={`${inputClass} w-24`}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
          <Field label="Cost basis" htmlFor={`pack-basis-${si.supplier_item_id}`}>
            <select
              id={`pack-basis-${si.supplier_item_id}`}
              className={inputClass}
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
            >
              <option value="quoted">Quoted</option>
              <option value="estimated">Estimated</option>
            </select>
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={!m.canPost || !desc.trim() || !(Number(baseQty) > 0) || cents === null}
          >
            Save pack
          </Button>
          <div className="w-full">
            <MutationStatus
              state={m.state}
              successText="Pack saved."
              onRetry={() => void m.retry()}
              onCheckAgain={() => void m.checkAgain()}
            />
          </div>
        </form>
      ) : null}
    </li>
  );
}

function SuppliersPanel({ canEdit }: { canEdit: boolean }) {
  const suppliers = useSuppliers();
  if (suppliers.isPending) return <Loading />;
  if (suppliers.error) return <QueryError error={suppliers.error} onRetry={() => void suppliers.refetch()} />;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info">
        Supplier contacts come from the source list and are <strong>not independently verified</strong>. Missing phone
        numbers stay blank.{' '}
        {canEdit
          ? 'Enter real terms and packs, then confirm the matching gates under Settings → Pilot setup.'
          : 'Only the owner edits terms and packs.'}
      </Notice>
      <ul className="flex flex-col gap-3">
        {suppliers.data.map((s) => (
          <li key={s.supplier_id} className="rounded-md border border-slate-300 bg-white p-3">
            <p className="font-semibold">
              {s.supplier_id} {s.name}
            </p>
            <p className="text-xs text-slate-700">
              Phone {s.phone ?? 'not supplied'} · Email {s.contact_email ?? 'not supplied'} · {s.contact_verification}
            </p>
            <SupplierTerms supplier={s} canEdit={canEdit} />
            <ul>
              {s.supplier_items.map((si) => (
                <PackEditor key={si.supplier_item_id} si={si} canEdit={canEdit} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PurchasingPage() {
  const { context, selectedLocation } = useAuth();
  const { tab } = useParams();
  if (!selectedLocation) return <Notice tone="warning">Choose a location.</Notice>;
  if (selectedLocation.role === 'employee')
    return (
      <Notice tone="warning" title="Not permitted">
        Purchasing and supplier costs are available to managers and the owner.
      </Notice>
    );
  if (tab !== 'orders' && tab !== 'suppliers') return <Navigate to="/purchasing/orders" replace />;
  return (
    <section aria-labelledby="purchasing-heading" className="flex flex-col gap-4">
      <h1 id="purchasing-heading" className="text-2xl font-bold">
        Purchasing — {selectedLocation.location_name}
      </h1>
      <nav aria-label="Purchasing sections" className="flex gap-2">
        {[
          { id: 'orders', label: 'Purchase orders & receiving' },
          { id: 'suppliers', label: 'Suppliers & packs' },
        ].map((t) => (
          <NavLink
            key={t.id}
            to={`/purchasing/${t.id}`}
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${isActive ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {tab === 'orders' ? (
        <PurchaseOrders locationId={selectedLocation.location_id} />
      ) : (
        <SuppliersPanel canEdit={Boolean(context?.is_owner)} />
      )}
    </section>
  );
}

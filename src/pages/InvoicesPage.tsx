// Supplier invoices, receipt matching, payments, credits and reversals (PRD §9).
// Accounts-payable records only: nothing here changes stock or cost, and
// payments record money handled outside the app.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Empty, Field, inputClass, Loading, Notice, QueryError, ScrollRegion } from '../components/ui';
import { formatCents, formatDateTime, parseDollarsToCents } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useRpcMutation } from '../lib/useRpcMutation';
import { Status } from './inventory/ControlsPanels';
import { qty } from './InventoryPage';

interface InvoiceRow {
  invoice_id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string;
  invoice_date: string;
  due_date: string;
  due_date_source: string;
  status: string;
  version: number;
  revision: number;
  total_cents: number;
  paid_cents: number;
  credited_cents: number;
  balance_cents: number;
  has_discrepancy: boolean;
  discrepancy_accepted: boolean;
  overdue: boolean;
  days_overdue: number | null;
  record_mode: string;
}

interface InvoiceList {
  business_date: string;
  record_mode: string;
  refreshed_at: string;
  invoices: InvoiceRow[];
}

interface InvoiceLine {
  revision: number;
  line_no: number;
  receipt_line_id: string | null;
  item_id: string | null;
  description: string | null;
  quantity: string;
  unit_price: string;
  line_cents: number;
  received_qty: string | null;
  receipt_unit_cost: string | null;
  qty_variance: string | null;
  price_variance_cents: number | null;
  discrepancy: string | null;
}

interface InvoiceDetail extends InvoiceRow {
  tax_cents: number;
  other_cents: number;
  lines: InvoiceLine[];
  payments: Array<{
    payment_id: string;
    payment_number: string;
    amount_cents: number;
    method: string;
    paid_on: string;
    external_reference: string | null;
    reversed: boolean;
  }>;
  credits: Array<{
    credit_id: string;
    credit_number: string;
    amount_cents: number;
    reason: string;
    credit_memo_ref: string | null;
    credited_on: string;
    reversed: boolean;
  }>;
  discrepancy_note: string | null;
  void_reason: string | null;
}

interface Matchable {
  receipt_line_id: string;
  receipt_number: string;
  business_date: string;
  item_id: string;
  item_name: string;
  base_unit: string;
  base_quantity: string;
  unit_cost: string;
  invoiced_quantity: string;
}

const PAY_METHODS = [
  { id: 'check', label: 'Check' },
  { id: 'ach_external', label: 'Bank transfer (external)' },
  { id: 'card_external', label: 'Card (external)' },
  { id: 'cash', label: 'Cash' },
  { id: 'other_external', label: 'Other external method' },
];

function modeLabel(mode: string) {
  return mode === 'SIMULATED' ? 'Simulated (demo — no money moves)' : 'Recorded (paid outside the app)';
}

function NewInvoice({ locationId, today, onDone }: { locationId: string; today: string; onDone: () => void }) {
  const suppliers = useQuery({
    queryKey: ['suppliers-lite'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name, payment_terms_days')
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return data;
    },
  });
  const [supplierId, setSupplierId] = useState('');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today);
  const [due, setDue] = useState('');
  const [tax, setTax] = useState('0.00');
  const [other, setOther] = useState('0.00');
  const [note, setNote] = useState('');
  const [matched, setMatched] = useState<Record<string, { quantity: string; unit_price: string }>>({});
  const [charges, setCharges] = useState<Array<{ description: string; amount: string }>>([]);
  const receipts = useQuery({
    queryKey: ['matchable', locationId, supplierId],
    enabled: Boolean(supplierId),
    queryFn: () =>
      callRpc<Matchable[]>('get_matchable_receipt_lines', { p_location_id: locationId, p_supplier_id: supplierId }),
  });
  const m = useRpcMutation(
    'create_supplier_invoice',
    `invoice-create:${locationId}:${supplierId}:${number.trim().toLowerCase()}`,
    {
      onSuccess: () => {
        setNumber('');
        setMatched({});
        setCharges([]);
        onDone();
      },
    },
  );
  const lines = [
    ...Object.entries(matched)
      .filter(([, v]) => v.quantity.trim() !== '' && v.unit_price.trim() !== '')
      .map(([id, v]) => ({ receipt_line_id: id, quantity: v.quantity.trim(), unit_price: v.unit_price.trim() })),
    ...charges
      .filter((c) => c.description.trim() && parseDollarsToCents(c.amount) !== null)
      .map((c) => ({
        description: c.description.trim(),
        quantity: 1,
        unit_price: (parseDollarsToCents(c.amount)! / 100).toFixed(2),
      })),
  ];
  const taxCents = parseDollarsToCents(tax);
  const otherCents = parseDollarsToCents(other);
  const valid = supplierId && number.trim() && date && lines.length > 0 && taxCents !== null && otherCents !== null;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_supplier_id: supplierId,
          p_invoice_number: number,
          p_invoice_date: date,
          p_lines: lines,
          p_tax_cents: taxCents ?? 0,
          p_other_cents: otherCents ?? 0,
          p_due_date: due || undefined,
          p_note: note || undefined,
        });
      }}
    >
      <h2 className="text-lg font-semibold">Enter a supplier invoice</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Supplier" htmlFor="inv-supplier">
          <select
            id="inv-supplier"
            className={inputClass}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose…</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.supplier_id} value={s.supplier_id}>
                {s.name} ({s.supplier_id})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invoice number" htmlFor="inv-number" hint="Compared ignoring case and spaces">
          <input id="inv-number" className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Invoice date" htmlFor="inv-date">
          <input
            id="inv-date"
            type="date"
            max={today}
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Due date" htmlFor="inv-due" hint="Blank = invoice date + verified supplier terms">
          <input id="inv-due" type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Tax ($)" htmlFor="inv-tax">
          <input
            id="inv-tax"
            inputMode="decimal"
            className={inputClass}
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          />
        </Field>
        <Field label="Other charges ($)" htmlFor="inv-other">
          <input
            id="inv-other"
            inputMode="decimal"
            className={inputClass}
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        </Field>
      </div>
      {supplierId ? (
        receipts.isPending ? (
          <Loading />
        ) : receipts.error ? (
          <QueryError error={receipts.error} />
        ) : receipts.data.length === 0 ? (
          <Empty>No receipts from this supplier at this location in the last 180 days.</Empty>
        ) : (
          <ScrollRegion label="Supplier invoices">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="p-1">Receipt line</th>
                  <th className="p-1">Received</th>
                  <th className="p-1">Already invoiced</th>
                  <th className="p-1">Invoiced qty</th>
                  <th className="p-1">Invoice $ / base unit</th>
                </tr>
              </thead>
              <tbody>
                {receipts.data.map((r) => (
                  <tr key={r.receipt_line_id} className="border-b border-slate-200">
                    <td className="p-1">
                      {r.receipt_number} · {r.business_date} · {r.item_id} {r.item_name}
                    </td>
                    <td className="p-1">
                      {qty(r.base_quantity)} {r.base_unit} @ ${qty(r.unit_cost)}
                    </td>
                    <td className="p-1">{qty(r.invoiced_quantity)}</td>
                    <td className="p-1">
                      <input
                        aria-label={`Invoiced quantity ${r.receipt_number} ${r.item_id}`}
                        inputMode="decimal"
                        className={`${inputClass} w-28`}
                        value={matched[r.receipt_line_id]?.quantity ?? ''}
                        placeholder={qty(r.base_quantity)}
                        onChange={(e) =>
                          setMatched((m) => ({
                            ...m,
                            [r.receipt_line_id]: {
                              unit_price: m[r.receipt_line_id]?.unit_price ?? r.unit_cost,
                              quantity: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td className="p-1">
                      <input
                        aria-label={`Invoice unit price ${r.receipt_number} ${r.item_id}`}
                        inputMode="decimal"
                        className={`${inputClass} w-32`}
                        value={matched[r.receipt_line_id]?.unit_price ?? ''}
                        placeholder={qty(r.unit_cost)}
                        onChange={(e) =>
                          setMatched((m) => ({
                            ...m,
                            [r.receipt_line_id]: {
                              quantity: m[r.receipt_line_id]?.quantity ?? r.base_quantity,
                              unit_price: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )
      ) : null}
      {charges.map((c, idx) => (
        <div key={idx} className="flex flex-wrap items-end gap-2">
          <Field label="Charge description" htmlFor={`inv-charge-d-${idx}`}>
            <input
              id={`inv-charge-d-${idx}`}
              className={inputClass}
              value={c.description}
              onChange={(e) =>
                setCharges((cs) => cs.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
              }
            />
          </Field>
          <Field label="Amount ($)" htmlFor={`inv-charge-a-${idx}`}>
            <input
              id={`inv-charge-a-${idx}`}
              inputMode="decimal"
              className={`${inputClass} w-28`}
              value={c.amount}
              onChange={(e) => setCharges((cs) => cs.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
            />
          </Field>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCharges((cs) => [...cs, { description: '', amount: '' }])}>
          Add charge line (freight, fee)
        </Button>
        <Field label="Note" htmlFor="inv-note">
          <input id="inv-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" disabled={!m.canPost || !valid}>
        Save invoice ({lines.length} line(s))
      </Button>
      <Status m={m} text="Invoice saved. Stock and costs are unchanged." />
    </form>
  );
}

function ReviseInvoice({ d, onDone }: { d: InvoiceDetail; onDone: () => void }) {
  const current = d.lines.filter((l) => l.revision === d.revision);
  const [rows, setRows] = useState(current.map((l) => ({ ...l })));
  const [tax, setTax] = useState((d.tax_cents / 100).toFixed(2));
  const [other, setOther] = useState((d.other_cents / 100).toFixed(2));
  const [note, setNote] = useState('');
  const m = useRpcMutation('revise_supplier_invoice', `inv-revise:${d.invoice_id}:${d.version}`, { onSuccess: onDone });
  const taxCents = tax.trim() === '' ? null : parseDollarsToCents(tax);
  const otherCents = other.trim() === '' ? null : parseDollarsToCents(other);
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
        Correct this invoice (adds a revision)
      </summary>
      <form
        className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void m.submit({
            p_invoice_id: d.invoice_id,
            p_expected_version: d.version,
            p_lines: rows.map((r) => ({
              receipt_line_id: r.receipt_line_id ?? undefined,
              item_id: r.receipt_line_id ? undefined : (r.item_id ?? undefined),
              description: r.description ?? undefined,
              quantity: r.quantity,
              unit_price: r.unit_price,
            })),
            p_tax_cents: taxCents ?? 0,
            p_other_cents: otherCents ?? 0,
            p_note: note,
          });
        }}
      >
        {rows.map((r, idx) => (
          <div key={r.line_no} className="flex flex-wrap items-end gap-2">
            <span className="text-sm">{r.item_id ?? r.description}</span>
            <Field label="Quantity" htmlFor={`rev-q-${r.line_no}`}>
              <input
                id={`rev-q-${r.line_no}`}
                inputMode="decimal"
                className={`${inputClass} w-28`}
                value={r.quantity}
                onChange={(e) =>
                  setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="$ / unit" htmlFor={`rev-p-${r.line_no}`}>
              <input
                id={`rev-p-${r.line_no}`}
                inputMode="decimal"
                className={`${inputClass} w-32`}
                value={r.unit_price}
                onChange={(e) =>
                  setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, unit_price: e.target.value } : x)))
                }
              />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Tax ($)" htmlFor="rev-tax">
            <input
              id="rev-tax"
              inputMode="decimal"
              className={inputClass}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </Field>
          <Field label="Other charges ($)" htmlFor="rev-other">
            <input
              id="rev-other"
              inputMode="decimal"
              className={inputClass}
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          </Field>
          <Field label="Why it changed" htmlFor="rev-note">
            <input id="rev-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button
          type="submit"
          disabled={
            !m.canPost ||
            note.trim().length < 3 ||
            (tax.trim() !== '' && taxCents === null) ||
            (other.trim() !== '' && otherCents === null)
          }
        >
          Save correction
        </Button>
        <Status m={m} text="Correction saved as a new revision. Any earlier discrepancy acceptance must be renewed." />
      </form>
    </details>
  );
}

function InvoiceDetailPanel({ invoiceId, onChanged }: { invoiceId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => callRpc<InvoiceDetail>('get_supplier_invoice', { p_invoice_id: invoiceId }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    onChanged();
  };
  const d = detail.data;
  const v = d?.version ?? 0;
  const [discNote, setDiscNote] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [paidOn, setPaidOn] = useState('');
  const [reference, setReference] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditRef, setCreditRef] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const accept = useRpcMutation('accept_invoice_discrepancy', `inv-accept:${invoiceId}:${v}`, { onSuccess: refresh });
  const pay = useRpcMutation('record_supplier_payment', `inv-pay:${invoiceId}:${v}`, {
    onSuccess: () => {
      setAmount('');
      refresh();
    },
  });
  const credit = useRpcMutation('record_supplier_credit', `inv-credit:${invoiceId}:${v}`, {
    onSuccess: () => {
      setCreditAmount('');
      refresh();
    },
  });
  const reversePay = useRpcMutation('reverse_supplier_payment', `inv-revpay:${invoiceId}:${v}`, { onSuccess: refresh });
  const reverseCredit = useRpcMutation('reverse_supplier_credit', `inv-revcr:${invoiceId}:${v}`, {
    onSuccess: refresh,
  });
  const voidInv = useRpcMutation('void_supplier_invoice', `inv-void:${invoiceId}:${v}`, { onSuccess: refresh });

  if (detail.isPending) return <Loading />;
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!d) return null;
  const current = d.lines.filter((l) => l.revision === d.revision);
  const older = d.lines.filter((l) => l.revision !== d.revision);
  const payCents = parseDollarsToCents(amount);
  const creditCents = parseDollarsToCents(creditAmount);
  const blocked = d.has_discrepancy && !d.discrepancy_accepted;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-slate-500 bg-slate-50 p-3"
      data-testid="invoice-detail"
    >
      <h3 className="text-lg font-semibold">
        Invoice {d.invoice_number} · revision {d.revision} · {modeLabel(d.record_mode)}
      </h3>
      <p className="text-sm">
        Total {formatCents(d.total_cents)} · paid {formatCents(d.paid_cents)} · credited {formatCents(d.credited_cents)}{' '}
        · <span className="font-semibold">balance {formatCents(d.balance_cents)}</span> · due {d.due_date}
      </p>
      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-400 text-left">
            <th className="p-1">Line</th>
            <th className="p-1">Invoiced</th>
            <th className="p-1">Received</th>
            <th className="p-1">Variance</th>
          </tr>
        </thead>
        <tbody>
          {current.map((l) => (
            <tr key={l.line_no} className="border-b border-slate-200">
              <td className="p-1">{l.item_id ? `${l.item_id}` : l.description}</td>
              <td className="p-1">
                {qty(l.quantity)} @ ${qty(l.unit_price)} = {formatCents(l.line_cents)}
              </td>
              <td className="p-1">
                {l.received_qty
                  ? `${qty(l.received_qty)} @ $${qty(l.receipt_unit_cost)}`
                  : l.item_id
                    ? 'not matched'
                    : 'charge'}
              </td>
              <td className="p-1">
                {l.discrepancy ? (
                  <Badge tone="warn">
                    {l.discrepancy.replaceAll('_', ' ')}
                    {l.qty_variance && Number(l.qty_variance) !== 0 ? ` qty ${qty(l.qty_variance)}` : ''}
                    {l.price_variance_cents ? ` ${formatCents(l.price_variance_cents)}` : ''}
                  </Badge>
                ) : (
                  <Badge tone="good">matches</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {older.length > 0 ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm">
            Earlier revisions ({older.length} line(s), kept for traceability)
          </summary>
          <ul className="text-xs">
            {older.map((l) => (
              <li key={`${l.revision}-${l.line_no}`}>
                rev {l.revision} line {l.line_no}: {qty(l.quantity)} @ ${qty(l.unit_price)} ={' '}
                {formatCents(l.line_cents)} {l.discrepancy ?? ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {d.status === 'void' ? (
        <Notice tone="warning" title="Void">
          {d.void_reason}
        </Notice>
      ) : (
        <ReviseInvoice key={d.version} d={d} onDone={refresh} />
      )}

      {blocked && d.status !== 'void' ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-amber-600 bg-amber-50 p-2">
          <p className="w-full text-sm">
            This invoice differs from what was received. Payment is blocked until a manager accepts the discrepancy.
            Stock and cost are never revalued from an invoice.
          </p>
          <Field label="Why it is accepted" htmlFor="inv-disc-note">
            <input
              id="inv-disc-note"
              className={inputClass}
              value={discNote}
              onChange={(e) => setDiscNote(e.target.value)}
            />
          </Field>
          <Button
            disabled={!accept.canPost || discNote.trim().length < 3}
            onClick={() =>
              void accept.submit({ p_invoice_id: invoiceId, p_expected_version: d.version, p_note: discNote })
            }
          >
            Accept discrepancy
          </Button>
          <div className="w-full">
            <Status m={accept} text="Discrepancy accepted (audited)." />
          </div>
        </div>
      ) : d.has_discrepancy ? (
        <p className="text-sm">Discrepancy accepted: {d.discrepancy_note}</p>
      ) : null}

      {d.status !== 'void' && d.balance_cents > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <form
            className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void pay.submit({
                p_invoice_id: invoiceId,
                p_amount_cents: payCents!,
                p_method: method,
                p_paid_on: paidOn || undefined,
                p_external_reference: reference || undefined,
              });
            }}
          >
            <h4 className="font-semibold">Record a payment ({modeLabel(d.record_mode)})</h4>
            <Field label="Amount ($)" htmlFor="pay-amount">
              <input
                id="pay-amount"
                inputMode="decimal"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Method" htmlFor="pay-method">
              <select id="pay-method" className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid on" htmlFor="pay-date" hint="Blank = today">
              <input
                id="pay-date"
                type="date"
                className={inputClass}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <Field label="Reference (check no., confirmation)" htmlFor="pay-ref">
              <input
                id="pay-ref"
                className={inputClass}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!pay.canPost || blocked || !payCents || payCents <= 0}>
              Record payment
            </Button>
            <Status m={pay} text="Payment recorded." />
          </form>
          <form
            className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void credit.submit({
                p_invoice_id: invoiceId,
                p_amount_cents: creditCents!,
                p_reason: creditReason,
                p_credit_memo_ref: creditRef || undefined,
              });
            }}
          >
            <h4 className="font-semibold">Record a supplier credit</h4>
            <Field label="Amount ($)" htmlFor="credit-amount">
              <input
                id="credit-amount"
                inputMode="decimal"
                className={inputClass}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
              />
            </Field>
            <Field label="Reason" htmlFor="credit-reason">
              <input
                id="credit-reason"
                className={inputClass}
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
              />
            </Field>
            <Field label="Credit memo reference" htmlFor="credit-ref">
              <input
                id="credit-ref"
                className={inputClass}
                value={creditRef}
                onChange={(e) => setCreditRef(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              disabled={!credit.canPost || !creditCents || creditCents <= 0 || creditReason.trim().length < 3}
            >
              Record credit
            </Button>
            <Status m={credit} text="Credit recorded." />
          </form>
        </div>
      ) : null}

      {d.payments.length + d.credits.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">Payments and credits</h4>
          <Field
            label="Reason for a reversal"
            htmlFor="reverse-reason"
            hint="Reversals add a linked record; nothing is edited"
          >
            <input
              id="reverse-reason"
              className={inputClass}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </Field>
          <ul className="text-sm">
            {d.payments.map((p) => (
              <li key={p.payment_id} className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-1">
                <span className="mr-auto">
                  {p.payment_number} · {formatCents(p.amount_cents)} · {p.method} · {p.paid_on}
                  {p.external_reference ? ` · ${p.external_reference}` : ''}{' '}
                  {p.reversed ? <Badge>reversed</Badge> : null}
                </span>
                {!p.reversed ? (
                  <Button
                    variant="secondary"
                    disabled={!reversePay.canPost || reverseReason.trim().length < 3}
                    onClick={() => void reversePay.submit({ p_payment_id: p.payment_id, p_reason: reverseReason })}
                  >
                    Reverse payment
                  </Button>
                ) : null}
              </li>
            ))}
            {d.credits.map((c) => (
              <li key={c.credit_id} className="flex flex-wrap items-center gap-2 border-b border-slate-200 py-1">
                <span className="mr-auto">
                  {c.credit_number} · credit {formatCents(c.amount_cents)} · {c.reason}
                  {c.credit_memo_ref ? ` · ${c.credit_memo_ref}` : ''} {c.reversed ? <Badge>reversed</Badge> : null}
                </span>
                {!c.reversed ? (
                  <Button
                    variant="secondary"
                    disabled={!reverseCredit.canPost || reverseReason.trim().length < 3}
                    onClick={() => void reverseCredit.submit({ p_credit_id: c.credit_id, p_reason: reverseReason })}
                  >
                    Reverse credit
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <Status m={reversePay} text="Payment reversed." />
          <Status m={reverseCredit} text="Credit reversed." />
        </div>
      ) : null}

      {d.status !== 'void' ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Void reason"
            htmlFor="void-reason"
            hint="Only when nothing is paid or credited; the number stays reserved"
          >
            <input
              id="void-reason"
              className={inputClass}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            disabled={!voidInv.canPost || voidReason.trim().length < 3 || d.paid_cents + d.credited_cents > 0}
            onClick={() =>
              void voidInv.submit({ p_invoice_id: invoiceId, p_expected_version: d.version, p_reason: voidReason })
            }
          >
            Void invoice
          </Button>
          <div className="w-full">
            <Status m={voidInv} text="Invoice voided." />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InvoicesPage() {
  const { selectedLocation, context } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const locationId = selectedLocation?.location_id;
  const list = useQuery({
    queryKey: ['invoices', locationId, status],
    enabled: Boolean(locationId) && selectedLocation?.role !== 'employee',
    queryFn: () =>
      callRpc<InvoiceList>('get_supplier_invoices', { p_location_ids: [locationId!], p_status: status || undefined }),
  });
  if (!selectedLocation || !locationId) return <Notice tone="warning">Choose a location.</Notice>;
  if (selectedLocation.role === 'employee')
    return (
      <Notice tone="warning" title="Not permitted">
        Supplier invoices and payments are available to managers and the owner.
      </Notice>
    );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['invoices', locationId] });
  const rows = list.data?.invoices ?? [];
  const outstanding = rows.filter((r) => r.status === 'open' || r.status === 'partially_paid');
  return (
    <section aria-labelledby="invoices-heading" className="flex flex-col gap-4">
      <h1 id="invoices-heading" className="text-2xl font-bold">
        Supplier invoices — {selectedLocation.location_name}
      </h1>
      <p className="text-sm text-slate-700">
        Accounts payable records only. Invoices never change stock or cost; payments record money handled outside the
        app. Overdue is judged by the due date against today&apos;s date in America/Denver.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Show" htmlFor="inv-status">
          <select id="inv-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        </Field>
        <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((c) => !c)}>
          {creating ? 'Close new invoice' : 'Enter invoice'}
        </Button>
      </div>
      {creating ? <NewInvoice locationId={locationId} today={context?.business_date ?? ''} onDone={refresh} /> : null}
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Empty>No supplier invoices for this location.</Empty>
      ) : (
        <>
          <p className="text-sm">
            Outstanding {formatCents(outstanding.reduce((s, r) => s + r.balance_cents, 0))} · overdue{' '}
            {formatCents(outstanding.filter((r) => r.overdue).reduce((s, r) => s + r.balance_cents, 0))} · as of{' '}
            {list.data.business_date} · refreshed {formatDateTime(list.data.refreshed_at)} · USD
          </p>
          <ScrollRegion label="Supplier invoices">
            <table className="w-full border-collapse bg-white text-sm">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="p-2">Invoice</th>
                  <th className="p-2">Supplier</th>
                  <th className="p-2">Due</th>
                  <th className="p-2">Total</th>
                  <th className="p-2">Balance</th>
                  <th className="p-2">Status</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoice_id} className="border-b border-slate-200">
                    <td className="p-2 font-mono">{r.invoice_number}</td>
                    <td className="p-2">{r.supplier_name}</td>
                    <td className="p-2">
                      {r.due_date}
                      {r.due_date_source === 'supplier_terms' ? (
                        <span className="block text-xs">from terms</span>
                      ) : null}
                    </td>
                    <td className="p-2">{formatCents(r.total_cents)}</td>
                    <td className="p-2 font-semibold">{formatCents(r.balance_cents)}</td>
                    <td className="p-2">
                      <Badge tone={r.status === 'paid' ? 'good' : r.status === 'void' ? 'neutral' : 'warn'}>
                        {r.status.replace('_', ' ')}
                      </Badge>{' '}
                      {r.overdue ? <Badge tone="bad">overdue {r.days_overdue} d</Badge> : null}{' '}
                      {r.has_discrepancy && !r.discrepancy_accepted ? <Badge tone="warn">discrepancy</Badge> : null}
                    </td>
                    <td className="p-2">
                      <Button
                        variant="secondary"
                        onClick={() => setSelected(selected === r.invoice_id ? null : r.invoice_id)}
                      >
                        {selected === r.invoice_id ? 'Close' : 'Open'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </>
      )}
      {selected ? <InvoiceDetailPanel key={selected} invoiceId={selected} onChanged={refresh} /> : null}
    </section>
  );
}

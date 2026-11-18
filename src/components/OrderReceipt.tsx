// A customer receipt for one order: shown on the POS once the order is paid, and on the Customer
// invoices tab for any past order. Refunds only show for managers and the owner (refunds_read policy).
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { formatCents, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { Button, Loading, QueryError } from './ui';

export const INVOICE_SELECT =
  'order_id, order_number, pickup_code, pickup_name, status, revision, accepted_at, completed_at, discount_percent, gross_cents, discount_cents, tax_cents, total_cents, order_lines(revision, line_no, quantity, unit_price_cents, gross_cents, discount_cents, items!order_lines_item_id_is_sellable_fkey(name)), tenders(method, amount_cents, recorded_at), refunds(refund_number, method, amount_cents, recorded_at)';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card_external: 'Card',
  other_external: 'Other',
  exchange_credit: 'Exchange credit',
};

export interface InvoiceLine {
  revision: number;
  line_no: number;
  quantity: number;
  unit_price_cents: number;
  gross_cents: number;
  discount_cents: number;
  items: { name: string } | null;
}

export interface Invoice {
  order_id: string;
  order_number: string;
  pickup_code: string;
  pickup_name: string | null;
  status: string;
  revision: number;
  accepted_at: string;
  completed_at: string | null;
  discount_percent: number;
  gross_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  order_lines: InvoiceLine[];
  tenders: Array<{ method: string; amount_cents: number; recorded_at: string }>;
  refunds: Array<{ refund_number: string; method: string; amount_cents: number; recorded_at: string }>;
}

function currentLines(o: Invoice): InvoiceLine[] {
  return o.order_lines.filter((l) => l.revision === o.revision).sort((a, b) => a.line_no - b.line_no);
}

export function sum(rows: Array<{ amount_cents: number }>): number {
  return rows.reduce((t, r) => t + Number(r.amount_cents), 0);
}

/** Loads one order and shows its receipt (used on the POS right after payment). */
export function OrderReceipt({
  orderId,
  locationName,
  version,
}: {
  orderId: string;
  locationName: string;
  version?: number;
}) {
  const q = useQuery({
    queryKey: ['order-receipt', orderId, version ?? 0],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select(INVOICE_SELECT).eq('order_id', orderId).single();
      if (error) throw error;
      return data as unknown as Invoice;
    },
  });
  if (q.isPending) return <Loading label="Loading receipt…" />;
  if (q.error) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  return <Receipt o={q.data} locationName={locationName} />;
}

export function Receipt({ o, locationName }: { o: Invoice; locationName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const paid = sum(o.tenders);
  const refunded = sum(o.refunds);

  function print() {
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w || !ref.current) return;
    w.document.write(
      `<html><head><title>Receipt ${o.order_number}</title><style>body{font-family:Arial,sans-serif;font-size:13px;margin:16px}table{width:100%;border-collapse:collapse}td{padding:2px 0}.r{text-align:right}.b{font-weight:bold}hr{border:0;border-top:1px dashed #000}</style></head><body>${ref.current.innerHTML}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="rounded-md border border-slate-300 bg-white p-4 text-sm">
        <p className="b font-bold">Meats Around the World — {locationName}</p>
        <p>
          Order {o.order_number} · Pickup code {o.pickup_code}
        </p>
        <p>{formatDateTime(o.completed_at ?? o.accepted_at)}</p>
        {o.pickup_name ? <p>Customer: {o.pickup_name}</p> : null}
        <hr className="my-2 border-dashed border-slate-400" />
        <table className="w-full">
          <tbody>
            {currentLines(o).map((l) => (
              <tr key={l.line_no}>
                <td>
                  {l.quantity} × {l.items?.name ?? 'Item'} @ {formatCents(l.unit_price_cents)}
                </td>
                <td className="r text-right">{formatCents(l.gross_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr className="my-2 border-dashed border-slate-400" />
        <table className="w-full">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="r text-right">{formatCents(o.gross_cents)}</td>
            </tr>
            {Number(o.discount_cents) > 0 ? (
              <tr>
                <td>Discount ({o.discount_percent}%)</td>
                <td className="r text-right">−{formatCents(o.discount_cents)}</td>
              </tr>
            ) : null}
            <tr>
              <td>Tax</td>
              <td className="r text-right">{formatCents(o.tax_cents)}</td>
            </tr>
            <tr className="b font-bold">
              <td>Total</td>
              <td className="r text-right">{formatCents(o.total_cents)}</td>
            </tr>
            {o.tenders.map((t, i) => (
              <tr key={`t${i}`}>
                <td>Paid ({METHOD_LABEL[t.method] ?? t.method})</td>
                <td className="r text-right">{formatCents(t.amount_cents)}</td>
              </tr>
            ))}
            {o.refunds.map((f) => (
              <tr key={f.refund_number}>
                <td>
                  Refund {f.refund_number} ({METHOD_LABEL[f.method] ?? f.method})
                </td>
                <td className="r text-right">−{formatCents(f.amount_cents)}</td>
              </tr>
            ))}
            {o.tenders.length === 0 ? (
              <tr>
                <td colSpan={2}>Not paid yet</td>
              </tr>
            ) : (
              <tr className="b font-bold">
                <td>Net paid</td>
                <td className="r text-right">{formatCents(paid - refunded)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2">Status: {o.status}</p>
      </div>
      <Button variant="secondary" onClick={print}>
        Print receipt
      </Button>
    </div>
  );
}

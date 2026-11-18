// Customer invoices (managers and owner): the 10 newest orders at the selected location, or a
// database search across all orders by customer name, pickup code / order number and date range.
// Click a result to open its receipt. Read-only; refunds show because managers can read them.
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { INVOICE_SELECT, Receipt, sum, type Invoice } from '../components/OrderReceipt';
import { Badge, Button, Empty, Field, inputClass, Loading, Notice, QueryError } from '../components/ui';
import { formatCents, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';

interface Search {
  name: string;
  code: string;
  from: string;
  to: string;
}

const EMPTY: Search = { name: '', code: '', from: '', to: '' };

// Strip characters that have meaning inside a PostgREST filter so typed text is matched literally.
function clean(text: string): string {
  return text.replace(/[%*,()\\]/g, '').trim();
}

function isEmpty(s: Search): boolean {
  return !clean(s.name) && !clean(s.code) && !s.from && !s.to;
}

export function CustomerInvoicesPage() {
  const { selectedLocation } = useAuth();
  const [form, setForm] = useState<Search>(EMPTY);
  const [search, setSearch] = useState<Search>(EMPTY);
  const [openId, setOpenId] = useState<string | null>(null);
  const locationId = selectedLocation?.location_id ?? '';
  const searching = !isEmpty(search);

  const invoices = useQuery({
    queryKey: ['customer-invoices', locationId, search],
    enabled: Boolean(locationId) && selectedLocation?.role !== 'employee',
    queryFn: async () => {
      let q = supabase.from('orders').select(INVOICE_SELECT).eq('location_id', locationId);
      const name = clean(search.name);
      const code = clean(search.code);
      if (name) q = q.ilike('pickup_name', `%${name}%`);
      if (code) q = q.or(`pickup_code.ilike.%${code}%,order_number.ilike.%${code}%`);
      if (search.from) q = q.gte('accepted_at', new Date(`${search.from}T00:00:00`).toISOString());
      if (search.to) q = q.lte('accepted_at', new Date(`${search.to}T23:59:59.999`).toISOString());
      const { data, error } = await q.order('accepted_at', { ascending: false }).limit(searching ? 50 : 10);
      if (error) throw error;
      return data as unknown as Invoice[];
    },
  });

  if (!selectedLocation) return <Notice tone="warning">Choose a location.</Notice>;
  if (selectedLocation.role === 'employee') return <Navigate to="/" replace />;

  const rows = invoices.data ?? [];
  const open = rows.find((o) => o.order_id === openId) ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setOpenId(null);
    setSearch(form);
  }

  function clear() {
    setOpenId(null);
    setForm(EMPTY);
    setSearch(EMPTY);
  }

  return (
    <section aria-labelledby="invoices-heading" className="flex flex-col gap-4">
      <h1 id="invoices-heading" className="text-2xl font-bold">
        Customer invoices — {selectedLocation.location_name}
      </h1>
      <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
        <Field label="Customer name" htmlFor="invoice-name">
          <input
            id="invoice-name"
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Pickup code or order #" htmlFor="invoice-code">
          <input
            id="invoice-code"
            className={inputClass}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <Field label="From" htmlFor="invoice-from">
          <input
            id="invoice-from"
            type="date"
            className={inputClass}
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
        </Field>
        <Field label="To" htmlFor="invoice-to">
          <input
            id="invoice-to"
            type="date"
            className={inputClass}
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
        </Field>
        <Button type="submit">Search</Button>
        <Button variant="secondary" onClick={clear}>
          Clear
        </Button>
      </form>
      <h2 className="text-lg font-semibold">
        {searching ? 'Search results (up to 50, newest first)' : 'Newest 10 orders'}
      </h2>
      {invoices.isPending ? (
        <Loading />
      ) : invoices.error ? (
        <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : rows.length === 0 ? (
        <Empty>{searching ? 'No orders match that search.' : 'No orders at this location yet.'}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Pickup code</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const refunded = sum(o.refunds);
                  return (
                    <tr
                      key={o.order_id}
                      onClick={() => setOpenId(o.order_id)}
                      className={`cursor-pointer border-t border-slate-200 ${openId === o.order_id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-2">{formatDateTime(o.accepted_at)}</td>
                      <td className="p-2 font-mono">
                        <button type="button" className="underline" onClick={() => setOpenId(o.order_id)}>
                          {o.pickup_code}
                        </button>
                      </td>
                      <td className="p-2">{o.pickup_name ?? '—'}</td>
                      <td className="p-2 text-right">{formatCents(o.total_cents)}</td>
                      <td className="p-2">
                        {o.status}
                        {refunded > 0 ? (
                          <>
                            {' '}
                            <Badge tone="warn">refunded {formatCents(refunded)}</Badge>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {open ? (
            <Receipt o={open} locationName={selectedLocation.location_name} />
          ) : (
            <Empty>Click an order to see its receipt.</Empty>
          )}
        </div>
      )}
    </section>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../../components/ui';
import { formatCents, parseDollarsToCents, percentToRate, rateToPercent } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useRpcMutation } from '../../lib/useRpcMutation';

function provenanceLabel(p: string): string {
  if (p.startsWith('synthetic')) return 'synthetic demo';
  if (p.startsWith('demo')) return 'demo entry';
  return 'operator entered';
}

function TaxRates({ locationId, canEdit, today }: { locationId: string; canEdit: boolean; today: string }) {
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState('');
  const [effective, setEffective] = useState(today);
  const rates = useQuery({
    queryKey: ['tax-rates', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_tax_rates')
        .select('effective_from, rate, provenance, confirmed_by, confirmed_at')
        .eq('location_id', locationId)
        .order('effective_from', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const m = useRpcMutation('set_location_tax_rate', `tax-rate:${locationId}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tax-rates', locationId] }),
  });
  const rate = percentToRate(percent);

  return (
    <section aria-labelledby="tax-heading" className="flex flex-col gap-3">
      <h2 id="tax-heading" className="text-lg font-semibold">
        Sales tax rate
      </h2>
      {rates.isPending ? (
        <Loading />
      ) : rates.error ? (
        <QueryError error={rates.error} onRetry={() => void rates.refetch()} />
      ) : rates.data.length === 0 ? (
        <Empty>
          No tax rate entered. Orders that take money stay disabled until a rate is entered and the gate is confirmed.
        </Empty>
      ) : (
        <table className="w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-slate-400 text-left">
              <th className="p-2">Effective from</th>
              <th className="p-2">Rate</th>
              <th className="p-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {rates.data.map((r) => (
              <tr key={r.effective_from} className="border-b border-slate-200">
                <td className="p-2">{r.effective_from}</td>
                <td className="p-2">{rateToPercent(r.rate)}</td>
                <td className="p-2">{provenanceLabel(r.provenance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (rate) void m.submit({ p_location_id: locationId, p_rate: Number(rate), p_effective_from: effective });
          }}
        >
          <Field
            label="New rate (%)"
            htmlFor="tax-percent"
            hint="e.g. 7.25 — confirm the rate with the tax authority first"
          >
            <input
              id="tax-percent"
              inputMode="decimal"
              className={inputClass}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
          <Field label="Effective from" htmlFor="tax-effective">
            <input
              id="tax-effective"
              type="date"
              min={today}
              className={inputClass}
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!m.canPost || !rate || !effective}>
            Add rate
          </Button>
          <div className="sm:col-span-3">
            <MutationStatus
              state={m.state}
              successText="Tax rate saved."
              onRetry={() => void m.retry()}
              onCheckAgain={() => void m.checkAgain()}
            />
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-700">Only the owner can enter tax rates.</p>
      )}
    </section>
  );
}

function MenuPrices({ locationId, canEdit, today }: { locationId: string; canEdit: boolean; today: string }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [dollars, setDollars] = useState('');
  const [effective, setEffective] = useState(today);
  const data = useQuery({
    queryKey: ['prices', locationId],
    queryFn: async () => {
      const [items, prices] = await Promise.all([
        supabase
          .from('items')
          .select('item_id, name, item_type')
          .eq('is_sellable', true)
          .is('archived_at', null)
          .order('item_id'),
        supabase
          .from('location_item_prices')
          .select('item_id, price_cents, effective_from, provenance')
          .eq('location_id', locationId)
          .order('effective_from', { ascending: false }),
      ]);
      if (items.error) throw items.error;
      if (prices.error) throw prices.error;
      return items.data.map((i) => {
        const rows = prices.data.filter((p) => p.item_id === i.item_id);
        return {
          ...i,
          current: rows.find((p) => p.effective_from <= today) ?? null,
          upcoming: rows.filter((p) => p.effective_from > today),
        };
      });
    },
  });
  const m = useRpcMutation('set_location_item_price', `price:${locationId}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prices', locationId] }),
  });
  const cents = parseDollarsToCents(dollars);

  return (
    <section aria-labelledby="price-heading" className="flex flex-col gap-3">
      <h2 id="price-heading" className="text-lg font-semibold">
        Menu prices
      </h2>
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <QueryError error={data.error} onRetry={() => void data.refetch()} />
      ) : data.data.length === 0 ? (
        <Empty>No sellable items exist yet. Import the source master data first.</Empty>
      ) : (
        <table className="w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-slate-400 text-left">
              <th className="p-2">Item</th>
              <th className="p-2">Current price</th>
              <th className="p-2">Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((i) => (
              <tr key={i.item_id} className="border-b border-slate-200">
                <td className="p-2">
                  <span className="font-mono">{i.item_id}</span> {i.name}
                </td>
                <td className="p-2">
                  {i.current ? (
                    `${formatCents(i.current.price_cents)} (${provenanceLabel(i.current.provenance)})`
                  ) : (
                    <span className="font-semibold text-red-800">Not set</span>
                  )}
                </td>
                <td className="p-2">
                  {i.upcoming.map((u) => `${formatCents(u.price_cents)} from ${u.effective_from}`).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && data.data ? (
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null && itemId)
              void m.submit({
                p_location_id: locationId,
                p_item_id: itemId,
                p_price_cents: cents,
                p_effective_from: effective,
              });
          }}
        >
          <Field label="Item" htmlFor="price-item">
            <select id="price-item" className={inputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose…</option>
              {data.data.map((i) => (
                <option key={i.item_id} value={i.item_id}>
                  {i.item_id} {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price ($)" htmlFor="price-dollars">
            <input
              id="price-dollars"
              inputMode="decimal"
              className={inputClass}
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
            />
          </Field>
          <Field label="Effective from" htmlFor="price-effective">
            <input
              id="price-effective"
              type="date"
              min={today}
              className={inputClass}
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!m.canPost || cents === null || !itemId}>
            Add price
          </Button>
          <div className="sm:col-span-4">
            <MutationStatus
              state={m.state}
              successText="Price saved."
              onRetry={() => void m.retry()}
              onCheckAgain={() => void m.checkAgain()}
            />
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function TaxesPricesPanel() {
  const { context, selectedLocation } = useAuth();
  if (!context || !selectedLocation) return <Notice tone="warning">Choose a location you have access to.</Notice>;
  const isManagerHere = context.is_owner || selectedLocation.role === 'manager';
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-slate-700">
        Showing <span className="font-semibold">{selectedLocation.location_name}</span>. Rates and prices are
        effective-dated: a new entry never rewrites past orders.
      </p>
      <TaxRates locationId={selectedLocation.location_id} canEdit={context.is_owner} today={context.business_date} />
      <MenuPrices locationId={selectedLocation.location_id} canEdit={isManagerHere} today={context.business_date} />
    </div>
  );
}

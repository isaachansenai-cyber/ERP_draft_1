// "What can we serve?" (PRD §10): independent dish potentials with the
// limiting ingredient, today's demand and the next delivery, plus a manager
// menu-mix preview that aggregates shared ingredients. Nothing here saves.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Field, inputClass, Loading, Notice, QueryError } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { qty } from './InventoryPage';
import { usePosMenu } from './PosPage';

interface Dish {
  item_id: string;
  name: string;
  portions_now: number;
  bottleneck_item_id: string;
  bottleneck_name: string;
  bottleneck_base_unit: string;
  bottleneck_available: string;
  bottleneck_per_serving: string;
  accepted_today: number | null;
  in_progress_today: number | null;
  fulfilled_today: number | null;
  planned_today: string | null;
  planned_remaining_today: string | null;
  forecast_method: string | null;
  next_delivery: { po_number: string; expected_date: string | null; quantity: string } | null;
  lead_time_note: string | null;
  prep_lead_days: number | null;
}

interface MixResult {
  feasible: boolean;
  preview_only: boolean;
  components: Array<{
    item_id: string;
    name: string;
    base_unit: string;
    required: string;
    available: string;
    shortfall: string;
    shared: boolean;
    used_by: Array<{ dish: string; quantity: string }>;
    proposed_quantity: string | null;
    proposed_packs: string | null;
    supplier_id: string | null;
    lead_days: number | null;
    earliest_arrival: string | null;
  }>;
}

function MenuMix({ locationId }: { locationId: string }) {
  const menu = usePosMenu(locationId);
  const [mix, setMix] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MixResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const entries = Object.entries(mix)
    .filter(([, v]) => Number(v) > 0)
    .map(([item_id, v]) => ({ item_id, quantity: Number(v) }));
  return (
    <section
      aria-labelledby="mix-heading"
      className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-3"
    >
      <h2 id="mix-heading" className="text-lg font-semibold">
        Menu-mix simulator (preview only)
      </h2>
      <p className="text-sm text-slate-700">
        Enter a combination to see combined ingredient needs. Shared ingredients (such as chicken and garlic) are added
        up across dishes. Nothing is reserved or ordered.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(menu.data ?? []).map((i) => (
          <Field key={i.item_id} label={`${i.name} (${i.item_id})`} htmlFor={`mix-${i.item_id}`}>
            <input
              id={`mix-${i.item_id}`}
              inputMode="numeric"
              className={inputClass}
              value={mix[i.item_id] ?? ''}
              onChange={(e) => setMix((m) => ({ ...m, [i.item_id]: e.target.value.replace(/\D/g, '') }))}
            />
          </Field>
        ))}
      </div>
      <Button
        disabled={busy || entries.length === 0}
        onClick={() => {
          setBusy(true);
          setError(null);
          callRpc<MixResult>('simulate_menu_mix', { p_location_id: locationId, p_mix: entries })
            .then(setResult)
            .catch((e: unknown) => {
              setResult(null);
              setError(e);
            })
            .finally(() => setBusy(false));
        }}
      >
        Simulate
      </Button>
      {error ? <QueryError error={error} /> : null}
      {result ? (
        <>
          <Notice
            tone={result.feasible ? 'success' : 'warning'}
            title={result.feasible ? 'Feasible with current stock' : 'Not enough stock'}
          >
            Preview only. A proposed replenishment becomes an order only when saved from Planning → Ingredient
            projection or Purchasing.
          </Notice>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="mix-table">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="p-1">Ingredient</th>
                  <th className="p-1">Needed</th>
                  <th className="p-1">Available</th>
                  <th className="p-1">Short</th>
                  <th className="p-1">Used by</th>
                  <th className="p-1">Proposed replenishment</th>
                </tr>
              </thead>
              <tbody>
                {result.components.map((c) => (
                  <tr key={c.item_id} className="border-b border-slate-200" data-testid={`mix-${c.item_id}`}>
                    <td className="p-1">
                      <span className="font-mono">{c.item_id}</span> {c.name} {c.shared ? <Badge>shared</Badge> : null}
                    </td>
                    <td className="p-1">
                      {qty(c.required)} {c.base_unit}
                    </td>
                    <td className="p-1">{qty(c.available)}</td>
                    <td className="p-1">
                      {Number(c.shortfall) > 0 ? <Badge tone="bad">{qty(c.shortfall)}</Badge> : '—'}
                    </td>
                    <td className="p-1 text-xs">{c.used_by.map((u) => `${u.dish} ${qty(u.quantity)}`).join(', ')}</td>
                    <td className="p-1 text-xs">
                      {c.proposed_quantity
                        ? `${qty(c.proposed_quantity)} ${c.base_unit}${c.proposed_packs ? ` (${c.proposed_packs} packs)` : ''} from ${c.supplier_id ?? '—'}, earliest ${c.earliest_arrival ?? '—'} (lead ${c.lead_days ?? '—'} d)`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function ServePage() {
  const { selectedLocation } = useAuth();
  const locationId = selectedLocation?.location_id;
  const view = useQuery({
    queryKey: ['serve', locationId],
    enabled: Boolean(locationId),
    refetchInterval: 30_000,
    queryFn: () =>
      callRpc<{ note: string; business_date: string; refreshed_at: string; dishes: Dish[] }>('get_serve_view', {
        p_location_id: locationId!,
      }),
  });
  if (!selectedLocation || !locationId) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  return (
    <section aria-labelledby="serve-heading" className="flex flex-col gap-4">
      <h1 id="serve-heading" className="text-2xl font-bold">
        What can we serve? — {selectedLocation.location_name}
      </h1>
      {view.isPending ? (
        <Loading />
      ) : view.error ? (
        <QueryError error={view.error} onRetry={() => void view.refetch()} />
      ) : (
        <>
          <Notice tone="info" title="Independent potentials">
            {view.data.note} Business date {view.data.business_date} · refreshed{' '}
            {formatDateTime(view.data.refreshed_at)}.
          </Notice>
          <ul className="grid gap-3 md:grid-cols-2">
            {view.data.dishes.map((d) => (
              <li
                key={d.item_id}
                className="flex flex-col gap-1 rounded-md border border-slate-400 bg-white p-3 text-sm"
                data-testid={`serve-${d.item_id}`}
              >
                <p className="text-base font-semibold">
                  {d.name} <span className="font-mono text-xs">{d.item_id}</span>
                </p>
                <p className="text-2xl font-bold">
                  {d.portions_now} <span className="text-sm font-normal">portions possible now (if made alone)</span>
                </p>
                <p>
                  Limited by <span className="font-semibold">{d.bottleneck_name}</span> ({d.bottleneck_item_id}):{' '}
                  {qty(d.bottleneck_available)} {d.bottleneck_base_unit} available, {qty(d.bottleneck_per_serving)} per
                  serving
                </p>
                <p>
                  Today: {d.fulfilled_today ?? 0} served, {d.in_progress_today ?? 0} cooking, {d.accepted_today ?? 0}{' '}
                  accepted
                  {isManager ? (
                    <>
                      {' '}
                      · planned{' '}
                      {d.planned_today != null ? qty(d.planned_today) : <Badge tone="warn">no forecast</Badge>}
                      {d.planned_remaining_today != null ? `, ${qty(d.planned_remaining_today)} still to come` : ''}
                    </>
                  ) : null}
                </p>
                <p className="text-xs">
                  Next delivery of the limiting ingredient:{' '}
                  {d.next_delivery
                    ? `${d.next_delivery.po_number}, ${qty(d.next_delivery.quantity)} ${d.bottleneck_base_unit}, expected ${d.next_delivery.expected_date ?? 'date not set'}`
                    : 'none on order'}
                </p>
                {d.prep_lead_days ? <p className="text-xs text-amber-800">Prep context: {d.lead_time_note}</p> : null}
              </li>
            ))}
          </ul>
          {isManager ? <MenuMix locationId={locationId} /> : null}
        </>
      )}
    </section>
  );
}

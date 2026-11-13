import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Empty, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { useRpcMutation } from '../lib/useRpcMutation';
import { usePosMenu } from './PosPage';

interface StockLot {
  lot_id: string;
  lot_code: string;
  supplier_lot: string | null;
  use_by_date: string | null;
  condition: string;
  on_hand: string;
  reserved: string;
  eligible: boolean;
  received_at: string;
}

interface StockItem {
  item_id: string;
  name: string;
  item_type: string;
  category: string;
  base_unit: string;
  requires_use_by: boolean;
  on_hand: string;
  quarantined: string;
  reserved: string;
  expired_on_hand: string;
  available: string;
  avg_unit_cost: string | null;
  stock_value: string | null;
  reorder_point: string | null;
  below_reorder_point: boolean | null;
  lots: StockLot[];
}

interface StockOverview {
  location_id: string;
  business_date: string;
  shows_costs: boolean;
  opening_count_posted: boolean;
  items: StockItem[];
}

/**
 * Display a NUMERIC quantity without trailing zeros. RPCs return quantities as
 * text; direct table reads (PostgREST) may return JSON numbers. Display only.
 */
export function qty(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const text = String(value);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function OpeningCountForm({
  locationId,
  items,
  onPosted,
}: {
  locationId: string;
  items: StockItem[];
  onPosted: () => void;
}) {
  const [rows, setRows] = useState<Record<string, { quantity: string; unitCost: string; lot: string; useBy: string }>>(
    {},
  );
  const m = useRpcMutation('post_opening_count', `opening:${locationId}`, { onSuccess: onPosted });
  const set = (id: string, patch: Partial<{ quantity: string; unitCost: string; lot: string; useBy: string }>) =>
    setRows((r) => ({ ...r, [id]: { quantity: '', unitCost: '', lot: '', useBy: '', ...r[id], ...patch } }));
  const entered = Object.entries(rows).filter(([, r]) => r.quantity.trim() !== '');
  const valid =
    entered.length > 0 &&
    entered.every(([, r]) => Number(r.quantity) > 0 && r.unitCost.trim() !== '' && Number(r.unitCost) >= 0);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-amber-600 bg-amber-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_lines: entered.map(([itemId, r]) => ({
            item_id: itemId,
            quantity_base: r.quantity.trim(),
            unit_cost: r.unitCost.trim(),
            lot_code: r.lot.trim() || undefined,
            use_by_date: r.useBy || undefined,
          })),
        });
      }}
    >
      <h2 className="text-lg font-semibold">Post opening count (once per location)</h2>
      <p className="text-sm">
        Enter the verified physical count in each item&apos;s base unit and its verified unit cost (USD per base unit).
        Leave an item blank if there is none. Items marked “use-by” need a date in the pilot. Posting is final; later
        differences go through counts and reason-coded adjustments.
      </p>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse bg-white text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-400 text-left">
              <th className="p-1">Item</th>
              <th className="p-1">Quantity</th>
              <th className="p-1">Unit cost $</th>
              <th className="p-1">Lot code</th>
              <th className="p-1">Use-by</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.item_id} className="border-b border-slate-200">
                <td className="p-1">
                  <span className="font-mono">{i.item_id}</span> {i.name}{' '}
                  <span className="text-xs">({i.base_unit})</span>
                  {i.requires_use_by ? <Badge tone="warn">use-by</Badge> : null}
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${i.item_id} quantity`}
                    inputMode="decimal"
                    className={`${inputClass} w-28`}
                    value={rows[i.item_id]?.quantity ?? ''}
                    onChange={(e) => set(i.item_id, { quantity: e.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${i.item_id} unit cost`}
                    inputMode="decimal"
                    className={`${inputClass} w-28`}
                    value={rows[i.item_id]?.unitCost ?? ''}
                    onChange={(e) => set(i.item_id, { unitCost: e.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${i.item_id} lot code`}
                    className={`${inputClass} w-32`}
                    value={rows[i.item_id]?.lot ?? ''}
                    onChange={(e) => set(i.item_id, { lot: e.target.value })}
                  />
                </td>
                <td className="p-1">
                  <input
                    aria-label={`${i.item_id} use-by`}
                    type="date"
                    className={inputClass}
                    value={rows[i.item_id]?.useBy ?? ''}
                    onChange={(e) => set(i.item_id, { useBy: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="submit" disabled={!m.canPost || !valid}>
        Post opening count ({entered.length} items)
      </Button>
      <MutationStatus
        state={m.state}
        successText="Opening count posted."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function AvailabilityToggle({
  locationId,
  itemId,
  name,
  available,
}: {
  locationId: string;
  itemId: string;
  name: string;
  available: boolean;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useRpcMutation('set_menu_availability', `availability:${locationId}:${itemId}:${available}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pos-menu'] }),
  });
  return (
    <li className="flex flex-wrap items-end gap-2 rounded-md border border-slate-300 bg-white p-2">
      <p className="mr-auto text-sm">
        <span className="font-semibold">{name}</span> —{' '}
        {available ? <Badge tone="good">On menu</Badge> : <Badge tone="bad">Off menu</Badge>}
      </p>
      {available ? (
        <Field label="Reason to switch off" htmlFor={`avail-${itemId}`}>
          <input
            id={`avail-${itemId}`}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      ) : null}
      <Button
        variant="secondary"
        disabled={!m.canPost || (available && reason.trim().length < 3)}
        onClick={() =>
          void m.submit({
            p_location_id: locationId,
            p_item_id: itemId,
            p_available: !available,
            p_reason: available ? reason : undefined,
          })
        }
      >
        {available ? 'Switch off' : 'Switch on'}
      </Button>
      <div className="w-full">
        <MutationStatus
          state={m.state}
          successText="Menu updated."
          onRetry={() => void m.retry()}
          onCheckAgain={() => void m.checkAgain()}
        />
      </div>
    </li>
  );
}

export function InventoryPage() {
  const { selectedLocation } = useAuth();
  const queryClient = useQueryClient();
  const locationId = selectedLocation?.location_id;
  const stock = useQuery({
    queryKey: ['stock', locationId],
    enabled: Boolean(locationId),
    queryFn: () => callRpc<StockOverview>('get_stock_overview', { p_location_id: locationId! }),
  });
  const menu = usePosMenu(locationId);
  const [filter, setFilter] = useState('');

  if (!selectedLocation || !locationId) return <Notice tone="warning">Choose a location.</Notice>;
  const isManager = selectedLocation.role !== 'employee';
  const items = (stock.data?.items ?? []).filter((i) =>
    `${i.item_id} ${i.name}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <section aria-labelledby="inventory-heading" className="flex flex-col gap-4">
      <h1 id="inventory-heading" className="text-2xl font-bold">
        Inventory — {selectedLocation.location_name}
      </h1>
      {stock.isPending ? (
        <Loading />
      ) : stock.error ? (
        <QueryError error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <>
          {!stock.data.opening_count_posted ? (
            isManager ? (
              <OpeningCountForm
                locationId={locationId}
                items={stock.data.items}
                onPosted={() => void queryClient.invalidateQueries({ queryKey: ['stock', locationId] })}
              />
            ) : (
              <Notice tone="warning">No opening count has been posted for this location yet.</Notice>
            )
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Filter items" htmlFor="stock-filter">
              <input
                id="stock-filter"
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
            <p className="text-xs text-slate-600">
              Available = eligible sellable on hand − reservations. Expired or quarantined stock is never available.
            </p>
          </div>
          {items.length === 0 ? (
            <Empty>No stocked items match.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse bg-white text-sm">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th className="p-2">Item</th>
                    <th className="p-2">On hand</th>
                    <th className="p-2">Reserved</th>
                    <th className="p-2">Quarantined</th>
                    <th className="p-2">Available</th>
                    {stock.data.shows_costs ? (
                      <>
                        <th className="p-2">Avg cost / unit</th>
                        <th className="p-2">Value</th>
                      </>
                    ) : null}
                    <th className="p-2">Lots</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.item_id} className="border-b border-slate-200 align-top">
                      <td className="p-2">
                        <span className="font-mono">{i.item_id}</span> {i.name}
                        {i.below_reorder_point ? (
                          <>
                            {' '}
                            <Badge tone="warn">Below reorder point</Badge>
                          </>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {qty(i.on_hand)} {i.base_unit}
                      </td>
                      <td className="p-2">{qty(i.reserved)}</td>
                      <td className="p-2">{qty(i.quarantined)}</td>
                      <td className="p-2 font-semibold">
                        {qty(i.available)}
                        {Number(i.expired_on_hand) > 0 ? (
                          <span className="block text-xs text-red-800">{qty(i.expired_on_hand)} expired</span>
                        ) : null}
                      </td>
                      {stock.data.shows_costs ? (
                        <>
                          <td className="p-2">${qty(i.avg_unit_cost)}</td>
                          <td className="p-2">${i.stock_value ?? '0.00'}</td>
                        </>
                      ) : null}
                      <td className="p-2">
                        {i.lots.length === 0 ? (
                          '—'
                        ) : (
                          <details>
                            <summary className="min-h-11 cursor-pointer py-2">{i.lots.length} lot(s)</summary>
                            <ul className="text-xs">
                              {i.lots.map((l) => (
                                <li key={`${l.lot_id}-${l.condition}`}>
                                  {l.lot_code} · {qty(l.on_hand)} on hand, {qty(l.reserved)} reserved · use-by{' '}
                                  {l.use_by_date ?? 'none'} · {l.condition}
                                  {!l.eligible ? ' · not eligible' : ''} · received {formatDateTime(l.received_at)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {isManager ? (
        <section aria-labelledby="availability-heading" className="flex flex-col gap-2">
          <h2 id="availability-heading" className="text-lg font-semibold">
            Menu availability at this location
          </h2>
          <p className="text-sm text-slate-700">Switching an item off blocks it on the POS. It never creates stock.</p>
          {menu.isPending ? (
            <Loading />
          ) : menu.error ? (
            <QueryError error={menu.error} />
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {menu.data.map((m) => (
                <AvailabilityToggle
                  key={`${m.item_id}:${m.is_available}`}
                  locationId={locationId}
                  itemId={m.item_id}
                  name={m.name}
                  available={m.is_available}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}

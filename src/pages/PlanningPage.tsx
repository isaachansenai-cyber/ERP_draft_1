// Planning (PRD §10): forecast with provenance and overrides, ingredient
// projection with proposed orders, and ROP/EOQ settings. Everything is a
// preview until a manager saves an override, a setting or a draft PO.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Empty, Field, inputClass, Loading, Notice, QueryError, ScrollRegion } from '../components/ui';
import { formatCents, formatDateTime, parseDollarsToCents } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useRpcMutation } from '../lib/useRpcMutation';
import { Status } from './inventory/ControlsPanels';
import { qty } from './InventoryPage';

type Source = 'operational' | 'historical';

interface ForecastDay {
  date: string;
  method: string;
  observations: number;
  window_from: string | null;
  window_to: string | null;
  base_qty: string | null;
  override_qty: number | null;
  override_reason: string | null;
  forecast_qty: string | null;
  fulfilled_qty: number;
  in_progress_qty: number;
  accepted_qty: number;
  residual_qty: string | null;
}
interface Forecast {
  as_of: string;
  data_label: string;
  refreshed_at: string;
  history: { first_date: string | null; last_date: string | null };
  items: Array<{ item_id: string; name: string; item_type: string; days: ForecastDay[] }>;
}

const METHOD_LABEL: Record<string, string> = {
  same_weekday_8w: 'same weekday, 8 weeks',
  trailing_28d: 'trailing 28 days',
  manager_required: 'manager forecast required',
  closed: 'closed',
};

function SourceSelect({ value, onChange, demo }: { value: Source; onChange: (s: Source) => void; demo: boolean }) {
  if (!demo) return null;
  return (
    <Field
      label="Demand source"
      htmlFor="planning-source"
      hint="Demo only: the synthetic history is an explicit, labeled alternative"
    >
      <select
        id="planning-source"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value as Source)}
      >
        <option value="operational">Demo operational orders</option>
        <option value="historical">Demo historical (synthetic)</option>
      </select>
    </Field>
  );
}

function OverrideForm({
  locationId,
  itemId,
  date,
  onDone,
}: {
  locationId: string;
  itemId: string;
  date: string;
  onDone: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const m = useRpcMutation('set_forecast_override', `override:${locationId}:${itemId}:${date}`, { onSuccess: onDone });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_item_id: itemId,
          p_business_date: date,
          p_quantity: Number(quantity),
          p_reason: reason,
        });
      }}
    >
      <Field label={`Manager forecast ${itemId} ${date}`} htmlFor={`ovr-${itemId}-${date}`}>
        <input
          id={`ovr-${itemId}-${date}`}
          inputMode="numeric"
          className={`${inputClass} w-24`}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field label="Reason" htmlFor={`ovr-r-${itemId}-${date}`}>
        <input
          id={`ovr-r-${itemId}-${date}`}
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost || quantity === '' || reason.trim().length < 3}>
        Save forecast
      </Button>
      <div className="w-full">
        <Status m={m} text="Manager forecast saved." />
      </div>
    </form>
  );
}

function ForecastPanel({ locationId, demo, today }: { locationId: string; demo: boolean; today: string }) {
  const queryClient = useQueryClient();
  const [asOf, setAsOf] = useState(today);
  const [source, setSource] = useState<Source>('operational');
  const [selected, setSelected] = useState<{ item: string; date: string } | null>(null);
  const f = useQuery({
    queryKey: ['forecast', locationId, asOf, source],
    queryFn: () =>
      callRpc<Forecast>('get_demand_forecast', {
        p_location_id: locationId,
        p_as_of: asOf,
        p_days: 14,
        p_source: source,
      }),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['forecast', locationId] });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="As of" htmlFor="forecast-asof" hint="History used: dates before this day only">
          <input
            id="forecast-asof"
            type="date"
            className={inputClass}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </Field>
        <SourceSelect value={source} onChange={setSource} demo={demo} />
      </div>
      {f.isPending ? (
        <Loading />
      ) : f.error ? (
        <QueryError error={f.error} onRetry={() => void f.refetch()} />
      ) : (
        <>
          <p className="text-xs text-slate-600" data-testid="forecast-scope">
            {f.data.data_label} · as of {f.data.as_of} · history {f.data.history.first_date ?? 'none'} to{' '}
            {f.data.history.last_date ?? '—'} · America/Denver · refreshed {formatDateTime(f.data.refreshed_at)}
          </p>
          <p className="text-xs text-slate-600">
            Each cell: forecast servings/units, then what remains after today&apos;s fulfilled, in-progress and accepted
            orders (those already hold their ingredients). Retail demand is kept separate from the dish recipes.
          </p>
          <ScrollRegion label="Forecast by day">
            <table className="border-collapse bg-white text-xs" data-testid="forecast-table">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="p-1">Item</th>
                  {f.data.items[0]?.days.map((d) => (
                    <th key={d.date} className="p-1 whitespace-nowrap">
                      {d.date.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.data.items.map((i) => (
                  <tr key={i.item_id} className="border-b border-slate-200 align-top">
                    <td className="p-1 whitespace-nowrap">
                      <span className="font-mono">{i.item_id}</span> {i.name}
                    </td>
                    {i.days.map((d) => (
                      <td key={d.date} className="p-1">
                        <button
                          type="button"
                          className="min-h-11 min-w-11 rounded px-1 text-left focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500"
                          title={`${METHOD_LABEL[d.method] ?? d.method}; ${d.observations} observation(s)${d.window_from ? `; window ${d.window_from}–${d.window_to}` : ''}${d.override_qty != null ? `; manager forecast: ${d.override_reason}` : ''}`}
                          onClick={() => setSelected({ item: i.item_id, date: d.date })}
                        >
                          {d.forecast_qty == null ? (
                            <Badge tone="warn">needed</Badge>
                          ) : (
                            <>
                              <span className="font-semibold">{qty(d.forecast_qty)}</span>
                              {d.override_qty != null ? <span className="block text-amber-800">override</span> : null}
                              {Number(d.residual_qty) !== Number(d.forecast_qty) ? (
                                <span className="block text-slate-600">left {qty(d.residual_qty)}</span>
                              ) : null}
                            </>
                          )}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {selected ? (
            (() => {
              const d = f.data.items
                .find((i) => i.item_id === selected.item)!
                .days.find((x) => x.date === selected.date)!;
              return (
                <div className="rounded-md border border-slate-400 bg-white p-3 text-sm">
                  <p className="font-semibold">
                    {selected.item} on {selected.date}
                  </p>
                  <p>
                    Method: {METHOD_LABEL[d.method] ?? d.method} · observations {d.observations}
                    {d.window_from ? ` · window ${d.window_from} to ${d.window_to}` : ''} · computed {qty(d.base_qty)}
                    {d.override_qty != null ? ` · manager forecast ${d.override_qty} (“${d.override_reason}”)` : ''}
                  </p>
                  <p>
                    Today&apos;s orders: fulfilled {d.fulfilled_qty}, in preparation {d.in_progress_qty}, accepted{' '}
                    {d.accepted_qty} · remaining to plan {qty(d.residual_qty)}
                  </p>
                  {selected.date >= today ? (
                    <OverrideForm
                      key={`${selected.item}:${selected.date}`}
                      locationId={locationId}
                      itemId={selected.item}
                      date={selected.date}
                      onDone={refresh}
                    />
                  ) : null}
                </div>
              );
            })()
          ) : (
            <p className="text-xs">Select a cell to see how it was computed or to enter a manager forecast.</p>
          )}
        </>
      )}
    </div>
  );
}

interface PlanItem {
  item_id: string;
  name: string;
  base_unit: string;
  available_now: string;
  safety_stock: string | null;
  reorder_point: string | null;
  suggested_reorder_point: string;
  lead_days: number | null;
  lead_time_basis: string | null;
  supplier_id: string | null;
  supplier_item_id: string | null;
  pack_base_qty: string | null;
  days: Array<{ date: string; receipts: string; requirement: string; projected: string; forecast_missing: boolean }>;
  forecast_missing: boolean;
  shortage_date: string | null;
  proposed_order_date: string | null;
  proposed_order_late: boolean;
  proposed_quantity: string | null;
  proposed_packs: string | null;
  late_receipts: Array<{ po_number: string; expected_date: string | null; quantity: string }>;
  below_reorder_point_date: string | null;
}

function ProposalButton({
  locationId,
  item,
  today,
  onDone,
}: {
  locationId: string;
  item: PlanItem;
  today: string;
  onDone: () => void;
}) {
  const m = useRpcMutation('create_purchase_order', `proposal:${locationId}:${item.item_id}:${item.shortage_date}`, {
    onSuccess: onDone,
  });
  if (!item.proposed_packs || !item.supplier_item_id || !item.supplier_id) return null;
  const expected = new Date(`${today}T12:00:00Z`);
  expected.setUTCDate(expected.getUTCDate() + (item.lead_days ?? 0));
  return (
    <div>
      <Button
        variant="secondary"
        disabled={!m.canPost}
        onClick={() =>
          void m.submit({
            p_location_id: locationId,
            p_supplier_id: item.supplier_id!,
            p_expected_date: expected.toISOString().slice(0, 10),
            p_lines: [{ supplier_item_id: item.supplier_item_id, packs: Number(item.proposed_packs) }],
            p_note: `Proposal from planning: shortage ${item.shortage_date}`,
          })
        }
      >
        Save as draft PO ({item.proposed_packs} pack(s))
      </Button>
      <Status m={m} text="Draft PO saved. Review and submit it under Purchasing; nothing was sent to the supplier." />
    </div>
  );
}

function ProjectionPanel({ locationId, demo, today }: { locationId: string; demo: boolean; today: string }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>('operational');
  const [onlyShort, setOnlyShort] = useState(true);
  const plan = useQuery({
    queryKey: ['plan', locationId, source],
    queryFn: () =>
      callRpc<{ data_label: string; as_of: string; refreshed_at: string; items: PlanItem[] }>(
        'get_replenishment_plan',
        {
          p_location_id: locationId,
          p_days: 14,
          p_source: source,
        },
      ),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['plan', locationId] });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <SourceSelect value={source} onChange={setSource} demo={demo} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={onlyShort}
            onChange={(e) => setOnlyShort(e.target.checked)}
          />
          Only items with a projected shortage
        </label>
      </div>
      {plan.isPending ? (
        <Loading />
      ) : plan.error ? (
        <QueryError error={plan.error} onRetry={() => void plan.refetch()} />
      ) : (
        <>
          <p className="text-xs text-slate-600">
            {plan.data.data_label} · from {plan.data.as_of} · projected = previous + receipts on their expected date −
            requirements · starts from available stock (reservations and quarantine excluded) · refreshed{' '}
            {formatDateTime(plan.data.refreshed_at)}
          </p>
          {plan.data.items.filter((i) => !onlyShort || i.shortage_date).length === 0 ? (
            <Empty>No projected shortages in the next 14 days.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {plan.data.items
                .filter((i) => !onlyShort || i.shortage_date)
                .map((i) => (
                  <li
                    key={i.item_id}
                    className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 text-sm"
                    data-testid={`plan-${i.item_id}`}
                  >
                    <p>
                      <span className="font-mono">{i.item_id}</span> <span className="font-semibold">{i.name}</span> ·
                      available {qty(i.available_now)} {i.base_unit} · safety{' '}
                      {qty(i.safety_stock) === '—' ? '0' : qty(i.safety_stock)} · ROP {qty(i.reorder_point)} (suggested{' '}
                      {qty(i.suggested_reorder_point)}) · lead {i.lead_days ?? '—'} d{' '}
                      {i.lead_time_basis ? <Badge tone="warn">{i.lead_time_basis}</Badge> : null}
                    </p>
                    {i.shortage_date ? (
                      <p>
                        <Badge tone="bad">Shortage {i.shortage_date}</Badge> · order by {i.proposed_order_date}{' '}
                        {i.proposed_order_late ? <Badge tone="bad">late</Badge> : null} · proposed{' '}
                        {qty(i.proposed_quantity)} {i.base_unit}
                      </p>
                    ) : null}
                    {i.forecast_missing ? (
                      <p className="text-xs text-amber-800">
                        Some days have no forecast yet; their demand is counted as 0 until a manager enters one.
                      </p>
                    ) : null}
                    {i.late_receipts.length > 0 ? (
                      <p className="text-xs text-red-800">
                        Not counted (late or undated):{' '}
                        {i.late_receipts.map((l) => `${l.po_number} ${l.expected_date ?? 'no date'}`).join(', ')}
                      </p>
                    ) : null}
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-xs">Daily projection</summary>
                      <table className="text-xs">
                        <thead>
                          <tr>
                            <th className="p-1 text-left">Date</th>
                            <th className="p-1 text-left">Receipts</th>
                            <th className="p-1 text-left">Requirement</th>
                            <th className="p-1 text-left">Projected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {i.days.map((d) => (
                            <tr key={d.date}>
                              <td className="p-1">{d.date}</td>
                              <td className="p-1">{qty(d.receipts)}</td>
                              <td className="p-1">{qty(d.requirement)}</td>
                              <td className="p-1">{qty(d.projected)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                    <ProposalButton locationId={locationId} item={i} today={today} onDone={refresh} />
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface EoqInputs {
  data_label: string;
  window_from: string;
  window_to: string;
  open_days_observed: number;
  fulfilled_use: string;
  demand_status: 'insufficient' | 'estimated';
  estimated_annual_demand: string | null;
  annual_demand_override: string | null;
  annual_demand_used: string | null;
  annual_demand_source: string | null;
  settings: {
    reorder_point: string | null;
    safety_stock: string | null;
    ordering_cost_cents: number | null;
    holding_cost: string | null;
    max_cover_days: number | null;
    provenance: string;
    approved_at: string | null;
    units: Record<string, string>;
  } | null;
  pack_base_qty: string | null;
  lead_days: number | null;
  eoq: {
    eoq: string;
    actionable_quantity: string;
    actionable_packs: string | null;
    cover_cap_quantity: string | null;
    warnings: string[];
  } | null;
}

function SettingsForm({
  locationId,
  itemId,
  inputs,
  onDone,
}: {
  locationId: string;
  itemId: string;
  inputs: EoqInputs;
  onDone: () => void;
}) {
  const s = inputs.settings;
  const [rop, setRop] = useState(s?.reorder_point ?? '');
  const [safety, setSafety] = useState(s?.safety_stock ?? '');
  const [orderCost, setOrderCost] = useState(
    s?.ordering_cost_cents != null ? (s.ordering_cost_cents / 100).toFixed(2) : '',
  );
  const [holding, setHolding] = useState(s?.holding_cost ?? '');
  const [cover, setCover] = useState(s?.max_cover_days != null ? String(s.max_cover_days) : '');
  const [demand, setDemand] = useState(inputs.annual_demand_override ?? '');
  const save = useRpcMutation('set_location_item_settings', `settings:${locationId}:${itemId}`, { onSuccess: onDone });
  const [previewResult, setPreviewResult] = useState<NonNullable<EoqInputs['eoq']> | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const sCents = parseDollarsToCents(orderCost);
  const d =
    demand.trim() !== ''
      ? Number(demand)
      : inputs.estimated_annual_demand != null
        ? Number(inputs.estimated_annual_demand)
        : null;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save.submit({
          p_location_id: locationId,
          p_item_id: itemId,
          p_reorder_point: Number(rop),
          p_safety_stock: Number(safety),
          p_ordering_cost_cents: sCents ?? 0,
          p_holding_cost: Number(holding),
          p_max_cover_days: cover ? Number(cover) : undefined,
          p_annual_demand_override: demand.trim() !== '' ? Number(demand) : undefined,
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Reorder point (base units)" htmlFor="set-rop">
          <input
            id="set-rop"
            inputMode="decimal"
            className={inputClass}
            value={rop}
            onChange={(e) => setRop(e.target.value)}
          />
        </Field>
        <Field label="Safety stock (base units)" htmlFor="set-safety">
          <input
            id="set-safety"
            inputMode="decimal"
            className={inputClass}
            value={safety}
            onChange={(e) => setSafety(e.target.value)}
          />
        </Field>
        <Field label="S: ordering cost (USD per order)" htmlFor="set-s">
          <input
            id="set-s"
            inputMode="decimal"
            className={inputClass}
            value={orderCost}
            onChange={(e) => setOrderCost(e.target.value)}
          />
        </Field>
        <Field label="H: holding cost (USD per base unit per year)" htmlFor="set-h">
          <input
            id="set-h"
            inputMode="decimal"
            className={inputClass}
            value={holding}
            onChange={(e) => setHolding(e.target.value)}
          />
        </Field>
        <Field label="Max cover days (freshness cap)" htmlFor="set-cover" hint="Manager-confirmed; never inferred">
          <input
            id="set-cover"
            inputMode="numeric"
            className={inputClass}
            value={cover}
            onChange={(e) => setCover(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field
          label="Annual demand input (base units/year)"
          htmlFor="set-demand"
          hint={
            inputs.demand_status === 'insufficient'
              ? 'Required: under 28 observed days'
              : 'Optional: overrides the estimate'
          }
        >
          <input
            id="set-demand"
            inputMode="decimal"
            className={inputClass}
            value={demand}
            onChange={(e) => setDemand(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={d == null || sCents == null || holding === ''}
          onClick={() => {
            setPreviewError(null);
            callRpc<NonNullable<EoqInputs['eoq']>>('calculate_eoq', {
              p_annual_demand: d!,
              p_ordering_cost_cents: sCents!,
              p_holding_cost: Number(holding),
              p_pack_base_qty: inputs.pack_base_qty ? Number(inputs.pack_base_qty) : undefined,
              p_max_cover_days: cover ? Number(cover) : undefined,
            })
              .then(setPreviewResult)
              .catch((err: unknown) => {
                setPreviewResult(null);
                setPreviewError(err);
              });
          }}
        >
          Preview EOQ
        </Button>
        <Button
          type="submit"
          disabled={!save.canPost || rop === '' || safety === '' || sCents == null || holding === ''}
        >
          Save as approved settings
        </Button>
      </div>
      {previewResult ? (
        <Notice tone="info" title="EOQ preview (not saved)">
          Unconstrained EOQ {previewResult.eoq} · actionable {qty(previewResult.actionable_quantity)}
          {previewResult.actionable_packs ? ` (${qty(previewResult.actionable_packs)} packs)` : ''}
          {previewResult.cover_cap_quantity ? ` · cover cap ${qty(previewResult.cover_cap_quantity)}` : ''}
          {previewResult.warnings.length ? ` · ${previewResult.warnings.join('; ')}` : ''}
        </Notice>
      ) : previewError ? (
        <QueryError error={previewError} />
      ) : null}
      <Status m={save} text="Settings saved and approved (audited)." />
    </form>
  );
}

function SettingsPanel({ locationId, demo }: { locationId: string; demo: boolean }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [source, setSource] = useState<Source>('operational');
  const items = useQuery({
    queryKey: ['stock-items-lite'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('item_id, name, base_unit, item_type')
        .neq('item_type', 'finished_dish')
        .is('archived_at', null)
        .order('item_id');
      if (error) throw error;
      return data;
    },
  });
  const inputs = useQuery({
    queryKey: ['eoq-inputs', locationId, itemId, source],
    enabled: Boolean(itemId),
    queryFn: () =>
      callRpc<EoqInputs>('get_eoq_inputs', { p_location_id: locationId, p_item_id: itemId, p_source: source }),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Item" htmlFor="settings-item">
          <select id="settings-item" className={inputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose…</option>
            {(items.data ?? []).map((i) => (
              <option key={i.item_id} value={i.item_id}>
                {i.item_id} {i.name} ({i.base_unit})
              </option>
            ))}
          </select>
        </Field>
        <SourceSelect value={source} onChange={setSource} demo={demo} />
      </div>
      {!itemId ? (
        <p className="text-sm">Choose an item to see its demand estimate, settings and EOQ.</p>
      ) : inputs.isPending ? (
        <Loading />
      ) : inputs.error ? (
        <QueryError error={inputs.error} onRetry={() => void inputs.refetch()} />
      ) : (
        <>
          <div className="rounded-md border border-slate-300 bg-white p-3 text-sm" data-testid="eoq-inputs">
            <p>
              {inputs.data.data_label} · window {inputs.data.window_from} to {inputs.data.window_to} ·{' '}
              {inputs.data.open_days_observed} open day(s) observed · fulfilled use {qty(inputs.data.fulfilled_use)}
            </p>
            <p>
              Annual demand D:{' '}
              {inputs.data.demand_status === 'insufficient' ? (
                <Badge tone="warn">insufficient history (under 28 days)</Badge>
              ) : (
                <span className="font-semibold">
                  {qty(inputs.data.estimated_annual_demand)} base units/year (estimated)
                </span>
              )}
              {inputs.data.annual_demand_override ? ` · manager input ${qty(inputs.data.annual_demand_override)}` : ''}
            </p>
            <p>
              Pack {qty(inputs.data.pack_base_qty)} · lead {inputs.data.lead_days ?? '—'} d
              {inputs.data.settings ? (
                <>
                  {' '}
                  · S {formatCents(inputs.data.settings.ordering_cost_cents)} per order · H $
                  {qty(inputs.data.settings.holding_cost)} per base unit per year ·{' '}
                  {inputs.data.settings.provenance.startsWith('synthetic') ? (
                    <Badge tone="warn">synthetic demo</Badge>
                  ) : null}
                  {inputs.data.settings.approved_at
                    ? ` approved ${formatDateTime(inputs.data.settings.approved_at)}`
                    : ' not approved'}
                </>
              ) : (
                ' · no settings saved'
              )}
            </p>
            {inputs.data.eoq ? (
              <p className="font-semibold">
                EOQ {inputs.data.eoq.eoq} (unconstrained) · actionable {qty(inputs.data.eoq.actionable_quantity)}
                {inputs.data.eoq.actionable_packs ? ` = ${qty(inputs.data.eoq.actionable_packs)} packs` : ''}
                {inputs.data.eoq.warnings.length ? ` · ${inputs.data.eoq.warnings.join('; ')}` : ''}
              </p>
            ) : (
              <p className="text-amber-800">EOQ not available: it needs D (or a manager input), S and H &gt; 0.</p>
            )}
          </div>
          <SettingsForm
            key={`${itemId}:${inputs.data.settings?.approved_at ?? 'none'}`}
            locationId={locationId}
            itemId={itemId}
            inputs={inputs.data}
            onDone={() => void queryClient.invalidateQueries({ queryKey: ['eoq-inputs', locationId, itemId] })}
          />
        </>
      )}
    </div>
  );
}

export function PlanningPage() {
  const { selectedLocation, context } = useAuth();
  const { tab } = useParams();
  if (!selectedLocation || !context) return <Notice tone="warning">Choose a location.</Notice>;
  if (selectedLocation.role === 'employee')
    return (
      <Notice tone="warning" title="Not permitted">
        Planning is available to managers and the owner.
      </Notice>
    );
  const current = tab ?? 'forecast';
  if (!['forecast', 'projection', 'settings'].includes(current)) return <Navigate to="/planning" replace />;
  const demo = context.data_mode === 'demo';
  return (
    <section aria-labelledby="planning-heading" className="flex flex-col gap-4">
      <h1 id="planning-heading" className="text-2xl font-bold">
        Planning — {selectedLocation.location_name}
      </h1>
      <nav aria-label="Planning sections" className="flex flex-wrap gap-2">
        {[
          { id: 'forecast', to: '/planning', label: 'Forecast' },
          { id: 'projection', to: '/planning/projection', label: 'Ingredient projection' },
          { id: 'settings', to: '/planning/settings', label: 'ROP / EOQ settings' },
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
      {current === 'forecast' ? (
        <ForecastPanel locationId={selectedLocation.location_id} demo={demo} today={context.business_date} />
      ) : current === 'projection' ? (
        <ProjectionPanel locationId={selectedLocation.location_id} demo={demo} today={context.business_date} />
      ) : (
        <SettingsPanel locationId={selectedLocation.location_id} demo={demo} />
      )}
    </section>
  );
}

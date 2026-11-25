import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SupplierRequestsList, useSupplierRequests } from '../components/SupplierRequests';
import { Badge, Empty, Loading, Notice, QueryError, ScrollRegion } from '../components/ui';
import { formatCents, formatDateTime } from '../lib/format';
import { cell, type SalesSummary, type SummaryRow } from '../lib/salesSummary';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';

interface ReorderAlerts {
  refreshed_at: string;
  locations: Array<{
    location_id: string;
    location_name: string;
    items: Array<{
      item_id: string;
      name: string;
      base_unit: string;
      available: string;
      reorder_point: string;
      on_order: string;
      next_expected_date: string | null;
    }>;
  }>;
}

function trim(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/**
 * Low-stock card for the location's manager (not the owner, ADR 0034). Live:
 * re-checked on open and every minute; an item drops off once stock is back at
 * or above its reorder point. Nothing is stored.
 */
function ReorderAlertsCard({ locationId }: { locationId: string }) {
  const alerts = useQuery({
    queryKey: ['reorder-alerts'],
    queryFn: () => callRpc<ReorderAlerts>('get_reorder_alerts', {}),
    refetchInterval: 60_000,
  });
  if (alerts.isPending) return <Loading label="Checking reorder points…" />;
  if (alerts.error) return <QueryError error={alerts.error} onRetry={() => void alerts.refetch()} />;
  const here = alerts.data.locations.find((l) => l.location_id === locationId);
  const items = here?.items ?? [];
  return (
    <section
      aria-labelledby="reorder-heading"
      className={`rounded-lg border-2 bg-white p-4 ${items.length ? 'border-amber-600' : 'border-slate-300'}`}
      data-testid="reorder-alerts"
    >
      <h2 id="reorder-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Needs reordering{here ? ` — ${here.location_name}` : ''}
        {items.length ? (
          <Badge tone="warn">{items.length} below reorder point</Badge>
        ) : (
          <Badge tone="good">All above</Badge>
        )}
      </h2>
      <p className="text-xs text-slate-600">
        Checked {formatDateTime(alerts.data.refreshed_at)} · refreshes every minute
      </p>
      {items.length === 0 ? (
        <div className="mt-2">
          <Empty>No item is below its reorder point.</Empty>
        </div>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={i.item_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 pb-2 text-sm"
              data-testid={`reorder-${i.item_id}`}
            >
              <span className="mr-auto">
                <span className="font-mono">{i.item_id}</span> <span className="font-semibold">{i.name}</span> ·
                available {trim(i.available)} {i.base_unit} · reorder point {trim(i.reorder_point)} {i.base_unit}
                {Number(i.on_order) > 0
                  ? ` · on order ${trim(i.on_order)}${i.next_expected_date ? ` (next ${i.next_expected_date})` : ''}`
                  : ' · nothing on order'}
              </span>
              <Link
                to={`/inventory?chart=${encodeURIComponent(i.item_id)}`}
                className="inline-flex min-h-11 items-center underline"
              >
                View chart
              </Link>
              <Link to="/purchasing/orders" className="inline-flex min-h-11 items-center underline">
                Purchasing
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TODAY_COLUMNS: Array<{ key: keyof SummaryRow; label: string; money?: boolean; sum?: boolean }> = [
  { key: 'completed_orders', label: 'Completed orders', sum: true },
  { key: 'net_sales_cents', label: 'Net sales', money: true, sum: true },
  { key: 'recorded_tenders_cents', label: 'Recorded payments', money: true, sum: true },
  { key: 'average_order_value_cents', label: 'Avg order value', money: true },
  { key: 'cancelled_orders', label: 'Cancelled orders', sum: true },
  { key: 'average_fulfillment_minutes', label: 'Avg fulfillment (min)' },
];

/**
 * Today's sales at a glance (ADR 0039): the manager's own location, or every
 * location plus a total for the owner. Same server function as the Dashboard.
 */
function TodaySummaryCard({
  businessDate,
  locationId,
  isOwner,
}: {
  businessDate: string;
  locationId: string;
  isOwner: boolean;
}) {
  const ids = isOwner ? undefined : [locationId];
  const summary = useQuery({
    queryKey: ['sales-summary', businessDate, businessDate, ids?.join(','), 'operational'],
    queryFn: () =>
      callRpc<SalesSummary>('get_sales_summary', {
        p_from: businessDate,
        p_to: businessDate,
        p_location_ids: ids,
        p_source: 'operational',
      }),
    refetchInterval: 60_000,
  });
  return (
    <section
      aria-labelledby="today-heading"
      className="rounded-lg border border-slate-300 bg-white p-4"
      data-testid="today-summary"
    >
      <h2 id="today-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Today’s sales
        <Link to="/dashboard/sales" className="ml-auto inline-flex min-h-11 items-center text-sm font-normal underline">
          Open full dashboard
        </Link>
      </h2>
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <p className="text-xs text-slate-600" data-testid="today-scope">
            {summary.data.data_label} · {summary.data.date_from} ({summary.data.timezone}) · {summary.data.currency} ·
            refreshed {formatDateTime(summary.data.refreshed_at)}
          </p>
          {summary.data.locations.length === 0 ? (
            <Empty>No locations in scope.</Empty>
          ) : (
            <ScrollRegion label="Today’s sales by location">
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th scope="col" className="p-2">
                      Location
                    </th>
                    {TODAY_COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className="p-2">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.data.locations.map((r) => (
                    <tr
                      key={r.location_id}
                      className="border-b border-slate-200"
                      data-testid={`today-${r.location_id}`}
                    >
                      <th scope="row" className="p-2 text-left font-semibold">
                        {r.location_name}
                      </th>
                      {TODAY_COLUMNS.map((c) => (
                        <td key={c.key} className="p-2">
                          {cell(r, c.key, c.money)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {isOwner && summary.data.locations.length > 1 ? (
                    <tr className="font-semibold" data-testid="today-total">
                      <th scope="row" className="p-2 text-left">
                        All locations
                      </th>
                      {TODAY_COLUMNS.map((c) => {
                        if (!c.sum)
                          return (
                            <td key={c.key} className="p-2">
                              —
                            </td>
                          );
                        // Display-only sum of whole cents / counts the server returned.
                        const total = summary.data.locations.reduce((acc, r) => acc + Number(r[c.key] ?? 0), 0);
                        return (
                          <td key={c.key} className="p-2">
                            {c.money ? formatCents(total) : total}
                          </td>
                        );
                      })}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </>
      )}
    </section>
  );
}

/** Owner: supplier change requests from managers, reviewed at login (ADR 0038). */
function SupplierRequestsCard() {
  const pending = useSupplierRequests('pending');
  const count = pending.data?.requests.length ?? 0;
  return (
    <section
      aria-labelledby="supplier-requests-overview-heading"
      className={`rounded-lg border-2 bg-white p-4 ${count ? 'border-amber-600' : 'border-slate-300'}`}
      data-testid="supplier-requests-card"
    >
      <h2 id="supplier-requests-overview-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        Supplier change requests
        {pending.data ? (
          count ? (
            <Badge tone="warn">{count} waiting for review</Badge>
          ) : (
            <Badge tone="good">None waiting</Badge>
          )
        ) : null}
      </h2>
      <div className="mt-2">
        <SupplierRequestsList status="pending" />
      </div>
    </section>
  );
}

export function OverviewPage() {
  const { context, selectedLocation } = useAuth();
  const gates = useQuery({
    queryKey: ['gate-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pilot_setup_gates').select('status');
      if (error) throw error;
      return { open: data.filter((g) => g.status === 'open').length, total: data.length };
    },
  });

  if (!context) return <Loading />;
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="overview-heading" className="text-2xl font-bold">
          Overview
        </h1>
        <p className="text-sm text-slate-700">Business date {context.business_date} (America/Denver)</p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Signed in as</dt>
          <dd className="text-lg font-semibold">{context.employee?.display_name}</dd>
          <dd className="text-xs text-slate-600">{context.employee?.employee_id}</dd>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Location and role</dt>
          <dd className="text-lg font-semibold">{selectedLocation?.location_name ?? '—'}</dd>
          <dd className="text-xs uppercase text-slate-600">{selectedLocation?.role ?? 'no location access'}</dd>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Operational posting</dt>
          <dd className="mt-1">
            {context.posting_enabled ? (
              <Badge tone="good">Enabled</Badge>
            ) : (
              <Badge tone="warn">Disabled until setup gates pass</Badge>
            )}
          </dd>
          <dd className="mt-2 text-xs text-slate-600">
            {gates.isPending
              ? 'Checking setup gates…'
              : gates.error
                ? null
                : `${gates.data?.open} of ${gates.data?.total} setup gates open`}
          </dd>
        </div>
      </dl>
      {gates.error ? <QueryError error={gates.error} onRetry={() => void gates.refetch()} /> : null}

      {selectedLocation && selectedLocation.role !== 'employee' ? (
        <TodaySummaryCard
          businessDate={context.business_date}
          locationId={selectedLocation.location_id}
          isOwner={Boolean(context.is_owner)}
        />
      ) : null}

      {context.is_owner ? <SupplierRequestsCard /> : null}

      {selectedLocation?.role === 'manager' ? <ReorderAlertsCard locationId={selectedLocation.location_id} /> : null}

      {context.roles.length === 0 ? (
        <Notice tone="warning" title="No location access">
          Your account is signed in but has no active role. Ask the owner to grant a location membership.
        </Notice>
      ) : null}
    </section>
  );
}

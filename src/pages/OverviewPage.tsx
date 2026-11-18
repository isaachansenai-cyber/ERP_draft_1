import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Loading, Notice, QueryError } from '../components/ui';
import { formatDateTime } from '../lib/format';
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

      {selectedLocation?.role === 'manager' ? <ReorderAlertsCard locationId={selectedLocation.location_id} /> : null}

      {context.roles.length === 0 ? (
        <Notice tone="warning" title="No location access">
          Your account is signed in but has no active role. Ask the owner to grant a location membership.
        </Notice>
      ) : null}
    </section>
  );
}

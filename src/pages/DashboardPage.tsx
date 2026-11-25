import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Empty, Field, inputClass, Loading, QueryError, ScrollRegion } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';
import { cell, rowsForTab, TABS, toCsv, type SalesSummary } from '../lib/salesSummary';

export { cell, ACCOUNTING_COLUMNS, rowsForTab, SALES_COLUMNS, TABS, toCsv } from '../lib/salesSummary';
export type { DashboardTab, SalesSummary, SummaryRow } from '../lib/salesSummary';

export function DashboardPage() {
  const { context, selectedLocation } = useAuth();
  const { tab } = useParams();
  const today = context?.business_date ?? '';
  const isEmployee = !context?.is_owner && !context?.roles.some((r) => r.role === 'manager');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState<'all' | 'selected'>(isEmployee ? 'selected' : 'all');
  const [source, setSource] = useState<'operational' | 'historical'>('operational');
  const effectiveTo = isEmployee ? from : to;
  const locationIds = scope === 'selected' && selectedLocation ? [selectedLocation.location_id] : undefined;

  const summary = useQuery({
    queryKey: ['sales-summary', from, effectiveTo, locationIds?.join(','), source],
    enabled: Boolean(from && effectiveTo),
    queryFn: () =>
      callRpc<SalesSummary>('get_sales_summary', {
        p_from: from,
        p_to: effectiveTo,
        p_location_ids: locationIds,
        p_source: source,
      }),
    // Flatten the waste breakdown into columns (display and CSV only; values come from the server).
    select: (data) => ({
      ...data,
      locations: data.locations.map((r) => ({
        ...r,
        cancellation_waste_cents: r.waste_breakdown?.post_start_cancellations_cents,
        waste_reports_cents: r.waste_breakdown?.waste_reports_cents,
        transit_loss_cents: r.waste_breakdown?.transit_loss_cents,
      })),
    }),
  });

  if (tab !== 'sales' && tab !== 'accounting') return <Navigate to="/dashboard/sales" replace />;
  const current = TABS.find((t) => t.id === tab)!;
  const rows = summary.data ? rowsForTab(summary.data.locations, current.id) : [];

  function exportCsv() {
    if (!summary.data) return;
    const blob = new Blob([toCsv(summary.data, current.id)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${current.id}-${summary.data.source}-${summary.data.date_from}-${summary.data.date_to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
      <h1 id="dashboard-heading" className="text-2xl font-bold">
        Dashboard
      </h1>
      <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/dashboard/${t.id}`}
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${isActive ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field label={isEmployee ? 'Business date' : 'From'} htmlFor="dash-from">
          <input
            id="dash-from"
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        {isEmployee ? null : (
          <Field label="To" htmlFor="dash-to">
            <input id="dash-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        )}
        {isEmployee ? null : (
          <Field label="Locations" htmlFor="dash-scope">
            <select
              id="dash-scope"
              className={inputClass}
              value={scope}
              onChange={(e) => setScope(e.target.value as 'all' | 'selected')}
            >
              <option value="all">All locations</option>
              <option value="selected">{selectedLocation?.location_name ?? 'Selected location'}</option>
            </select>
          </Field>
        )}
        {context?.data_mode === 'demo' && !isEmployee ? (
          <Field label="Data source" htmlFor="dash-source">
            <select
              id="dash-source"
              className={inputClass}
              value={source}
              onChange={(e) => setSource(e.target.value as 'operational' | 'historical')}
            >
              <option value="operational">Demo operational</option>
              <option value="historical">Demo historical (synthetic)</option>
            </select>
          </Field>
        ) : null}
        <Button variant="secondary" onClick={() => void summary.refetch()}>
          Refresh
        </Button>
        {!isEmployee && summary.data ? (
          <Button variant="secondary" onClick={exportCsv}>
            Export CSV
          </Button>
        ) : null}
      </form>

      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <p className="text-sm text-slate-700" data-testid="report-scope">
            Source: <span className="font-semibold">{summary.data.data_label}</span> · {summary.data.date_from} to{' '}
            {summary.data.date_to} ({summary.data.timezone}) · {summary.data.currency} · refreshed{' '}
            {formatDateTime(summary.data.refreshed_at)}
          </p>
          {current.id === 'sales' ? (
            <p className="text-xs text-slate-600">{summary.data.payments_note}</p>
          ) : summary.data.source === 'historical' ? (
            <p className="text-xs text-slate-600">
              Demo historical data holds sales only; cost, waste, stock and supplier figures show “—”.
            </p>
          ) : null}
          {rows.length === 0 ? (
            <Empty>
              {current.id === 'accounting' && summary.data.locations.length > 0
                ? 'Accounting figures are shown only for the locations you manage.'
                : 'No locations in scope.'}
            </Empty>
          ) : (
            <ScrollRegion label={`${current.label} summary by location`}>
              <table className="w-full border-collapse bg-white text-sm">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th className="p-2">Location</th>
                    {current.columns.map((c) => (
                      <th key={c.key} className="p-2">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.location_id}
                      className="border-b border-slate-200"
                      data-testid={`summary-${r.location_id}`}
                    >
                      <td className="p-2 font-semibold">
                        {r.location_name}
                        {r.access === 'summary' ? (
                          <span className="block text-xs font-normal">Sales totals only</span>
                        ) : null}
                      </td>
                      {current.columns.map((c) => (
                        <td key={c.key} className="p-2">
                          {cell(r, c.key, c.money)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </>
      )}
    </section>
  );
}

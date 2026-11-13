import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Empty, Field, inputClass, Loading, Notice, QueryError } from '../components/ui';
import { formatCents, formatDateTime } from '../lib/format';
import { callRpc } from '../lib/rpc';

export interface SummaryRow {
  location_id: string;
  location_name: string;
  access: 'full' | 'summary' | 'employee';
  completed_orders: number;
  net_sales_cents: number;
  gross_sales_cents?: number;
  discount_cents?: number;
  refund_cents?: number;
  tax_cents?: number;
  recorded_tenders_cents?: number;
  average_order_value_cents?: number | null;
  cogs_cents?: number | null;
  gross_margin_cents?: number | null;
  waste_cost_cents?: number | null;
  pending_preparation_cost_cents?: number | null;
  low_stock_items?: number | null;
  average_fulfillment_minutes?: number | null;
  fulfillment_samples?: number;
  cancelled_orders?: number;
}

export interface SalesSummary {
  source: 'operational' | 'historical';
  data_label: string;
  date_from: string;
  date_to: string;
  timezone: string;
  currency: string;
  refreshed_at: string;
  payments_note: string;
  locations: SummaryRow[];
}

const COLUMNS: Array<{ key: keyof SummaryRow; label: string; money?: boolean }> = [
  { key: 'completed_orders', label: 'Completed orders' },
  { key: 'gross_sales_cents', label: 'Gross sales', money: true },
  { key: 'discount_cents', label: 'Discounts', money: true },
  { key: 'refund_cents', label: 'Refunds', money: true },
  { key: 'net_sales_cents', label: 'Net sales', money: true },
  { key: 'tax_cents', label: 'Tax (separate)', money: true },
  { key: 'recorded_tenders_cents', label: 'Recorded payments', money: true },
  { key: 'average_order_value_cents', label: 'Avg order value', money: true },
  { key: 'cogs_cents', label: 'COGS', money: true },
  { key: 'gross_margin_cents', label: 'Gross margin', money: true },
  { key: 'waste_cost_cents', label: 'Waste cost', money: true },
  { key: 'pending_preparation_cost_cents', label: 'Pending prep cost', money: true },
  { key: 'low_stock_items', label: 'Low-stock items' },
  { key: 'average_fulfillment_minutes', label: 'Avg fulfillment (min)' },
  { key: 'cancelled_orders', label: 'Cancelled orders' },
];

/** Render a metric; null/undefined (not permitted or zero denominator) shows "—". */
export function cell(row: SummaryRow, key: keyof SummaryRow, money?: boolean): string {
  const v = row[key];
  if (v === null || v === undefined) return '—';
  return money ? formatCents(Number(v)) : String(v);
}

/** CSV built from exactly the rows the server returned for this filter (same authorization). */
export function toCsv(summary: SalesSummary): string {
  const header = [
    'location_id',
    'location_name',
    'access',
    ...COLUMNS.map((c) => c.key),
    'data_source',
    'date_from',
    'date_to',
    'currency',
    'refreshed_at',
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = summary.locations.map((r) =>
    [
      r.location_id,
      r.location_name,
      r.access,
      ...COLUMNS.map((c) => r[c.key]),
      summary.data_label,
      summary.date_from,
      summary.date_to,
      summary.currency,
      summary.refreshed_at,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export function DashboardPage() {
  const { context, selectedLocation } = useAuth();
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
  });

  function exportCsv() {
    if (!summary.data) return;
    const blob = new Blob([toCsv(summary.data)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales-${summary.data.source}-${summary.data.date_from}-${summary.data.date_to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-4">
      <h1 id="dashboard-heading" className="text-2xl font-bold">
        Sales dashboard
      </h1>
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
          <p className="text-xs text-slate-600">
            Net sales = gross − discounts − refunds (tax excluded), by completion date. {summary.data.payments_note}{' '}
            COGS uses issue-cost snapshots; costs of orders cancelled after kitchen start appear only as waste. Gross
            margin is not net profit.
          </p>
          {summary.data.locations.length === 0 ? (
            <Empty>No locations in scope.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse bg-white text-sm">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th className="p-2">Location</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="p-2">
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
                      data-testid={`summary-${r.location_id}`}
                    >
                      <td className="p-2 font-semibold">
                        {r.location_name}
                        {r.access === 'summary' ? (
                          <span className="block text-xs font-normal">Sales totals only</span>
                        ) : null}
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="p-2">
                          {cell(r, c.key, c.money)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Notice tone="info">
            Supplier balances, worked hours and the waste-report detail join this dashboard in Milestones 3–4.
          </Notice>
        </>
      )}
    </section>
  );
}

import { formatCents } from './format';

// Shape of get_sales_summary (shared by the Dashboard and the Overview card).
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
  recorded_refunds_cents?: number;
  refunded_orders?: number;
  cogs_reversed_cents?: number | null;
  waste_breakdown?: {
    post_start_cancellations_cents: number;
    waste_reports_cents: number;
    transit_loss_cents: number;
    posted_waste_reports: number;
  } | null;
  waste_reports_cents?: number | null;
  transit_loss_cents?: number | null;
  cancellation_waste_cents?: number | null;
  count_variance_cents?: number | null;
  inventory_value_cents?: number | null;
  in_transit_value_cents?: number | null;
  supplier_outstanding_cents?: number | null;
  supplier_overdue_cents?: number | null;
  supplier_overdue_invoices?: number | null;
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

/** Render a metric; null/undefined (not permitted or zero denominator) shows "—". */
export function cell(row: SummaryRow, key: keyof SummaryRow, money?: boolean): string {
  const v = row[key];
  if (v === null || v === undefined) return '—';
  return money ? formatCents(Number(v)) : String(v);
}

type Column = { key: keyof SummaryRow; label: string; money?: boolean };

/** Dashboard tabs (ADR 0039): the same server summary, split by audience. */
export const SALES_COLUMNS: Column[] = [
  { key: 'completed_orders', label: 'Completed orders' },
  { key: 'gross_sales_cents', label: 'Gross sales', money: true },
  { key: 'discount_cents', label: 'Discounts', money: true },
  { key: 'refund_cents', label: 'Refunds', money: true },
  { key: 'net_sales_cents', label: 'Net sales', money: true },
  { key: 'tax_cents', label: 'Tax (separate)', money: true },
  { key: 'recorded_tenders_cents', label: 'Recorded payments', money: true },
  { key: 'recorded_refunds_cents', label: 'Recorded refunds paid out', money: true },
  { key: 'average_order_value_cents', label: 'Avg order value', money: true },
  { key: 'average_fulfillment_minutes', label: 'Avg fulfillment (min)' },
  { key: 'cancelled_orders', label: 'Cancelled orders' },
];

export const ACCOUNTING_COLUMNS: Column[] = [
  { key: 'net_sales_cents', label: 'Net sales', money: true },
  { key: 'cogs_cents', label: 'COGS', money: true },
  { key: 'gross_margin_cents', label: 'Gross margin', money: true },
  { key: 'cogs_reversed_cents', label: 'Retail COGS reversed', money: true },
  { key: 'waste_cost_cents', label: 'Waste cost (total)', money: true },
  { key: 'cancellation_waste_cents', label: '· post-start cancellations', money: true },
  { key: 'waste_reports_cents', label: '· posted waste reports', money: true },
  { key: 'transit_loss_cents', label: '· transit losses', money: true },
  { key: 'count_variance_cents', label: 'Count variance', money: true },
  { key: 'inventory_value_cents', label: 'Inventory value (now)', money: true },
  { key: 'in_transit_value_cents', label: 'In transit out (now)', money: true },
  { key: 'pending_preparation_cost_cents', label: 'Pending prep cost', money: true },
  { key: 'low_stock_items', label: 'Low-stock items' },
  { key: 'supplier_outstanding_cents', label: 'Supplier balance (now)', money: true },
  { key: 'supplier_overdue_cents', label: 'Supplier overdue (now)', money: true },
];

export const TABS = [
  { id: 'sales', label: 'Sales', columns: SALES_COLUMNS },
  { id: 'accounting', label: 'Accounting', columns: ACCOUNTING_COLUMNS },
] as const;
export type DashboardTab = (typeof TABS)[number]['id'];

/** Rows a tab shows: other locations' summary-only rows carry sales totals only (AC03). */
export function rowsForTab(rows: SummaryRow[], tab: DashboardTab): SummaryRow[] {
  return tab === 'sales' ? rows : rows.filter((r) => r.access === 'full');
}

/** CSV built from exactly the rows the server returned for this filter (same authorization). */
export function toCsv(summary: SalesSummary, tab: DashboardTab = 'sales'): string {
  const columns = TABS.find((t) => t.id === tab)!.columns;
  const rows = rowsForTab(summary.locations, tab);
  const header = [
    'location_id',
    'location_name',
    'access',
    ...columns.map((c) => c.key),
    'report',
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
  const lines = rows.map((r) =>
    [
      r.location_id,
      r.location_name,
      r.access,
      ...columns.map((c) => r[c.key]),
      tab,
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

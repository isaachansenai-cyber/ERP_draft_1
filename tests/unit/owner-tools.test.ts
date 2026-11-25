// Pure helpers behind the schema banner (ADR 0036), the Recipes nav entry
// (ADR 0037) and the Dashboard tabs (ADR 0039).
import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/lib/rpc';
import { navFor } from '../../src/lib/nav';
import { compareSchema, EXPECTED_SCHEMA_VERSION } from '../../src/lib/schemaVersion';
import {
  ACCOUNTING_COLUMNS,
  rowsForTab,
  SALES_COLUMNS,
  toCsv,
  type SalesSummary,
  type SummaryRow,
} from '../../src/lib/salesSummary';

describe('schema version check', () => {
  it('flags a database that is behind, missing the function, or ahead', () => {
    expect(compareSchema(EXPECTED_SCHEMA_VERSION)).toEqual({ state: 'ok', database: EXPECTED_SCHEMA_VERSION });
    expect(compareSchema(EXPECTED_SCHEMA_VERSION - 1).state).toBe('database_behind');
    expect(compareSchema(null).state).toBe('database_behind');
    expect(compareSchema(EXPECTED_SCHEMA_VERSION + 1).state).toBe('app_behind');
  });

  it('treats an unknown function as an out-of-date database, not a generic bad request', () => {
    const e = classifyError({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    expect(e.code).toBe('schema_out_of_date');
    expect(e.outcome).toBe('rejected');
    expect(classifyError({ code: 'PGRST100', message: 'bad filter' }, 400).code).toBe('request_invalid');
  });
});

describe('Recipes navigation', () => {
  it('managers and the owner see Recipes; employees do not', () => {
    expect(navFor('manager').map((n) => n.label)).toContain('Recipes');
    expect(navFor('owner').map((n) => n.label)).toContain('Recipes');
    expect(navFor('employee').map((n) => n.label)).not.toContain('Recipes');
  });
});

describe('dashboard tabs', () => {
  const row = (id: string, access: SummaryRow['access'], extra: Partial<SummaryRow> = {}): SummaryRow => ({
    location_id: id,
    location_name: id,
    access,
    completed_orders: 3,
    net_sales_cents: 4500,
    ...extra,
  });
  const summary: SalesSummary = {
    source: 'operational',
    data_label: 'demo operational',
    date_from: '2026-11-25',
    date_to: '2026-11-25',
    timezone: 'America/Denver',
    currency: 'USD',
    refreshed_at: '2026-11-25T08:00:00Z',
    payments_note: '',
    locations: [row('LOC-PRO', 'full', { cogs_cents: 1200 }), row('LOC-SFO', 'summary')],
  };

  it('splits the metrics with no overlap except net sales as context', () => {
    const sales = SALES_COLUMNS.map((c) => c.key);
    const accounting = ACCOUNTING_COLUMNS.map((c) => c.key);
    expect(sales.filter((k) => accounting.includes(k))).toEqual(['net_sales_cents']);
    expect(accounting).toContain('cogs_cents');
    expect(accounting).toContain('supplier_overdue_cents');
    expect(sales).toContain('recorded_tenders_cents');
    expect(sales).not.toContain('cogs_cents');
  });

  it('keeps summary-only rows off the Accounting tab', () => {
    expect(rowsForTab(summary.locations, 'sales').map((r) => r.location_id)).toEqual(['LOC-PRO', 'LOC-SFO']);
    expect(rowsForTab(summary.locations, 'accounting').map((r) => r.location_id)).toEqual(['LOC-PRO']);
  });

  it('exports the active tab only, labelled with the tab', () => {
    const [salesHeader, ...salesRows] = toCsv(summary, 'sales').split('\n');
    expect(salesHeader).toContain('net_sales_cents');
    expect(salesHeader).not.toContain('cogs_cents');
    expect(salesRows).toHaveLength(2);
    expect(salesRows[0]).toContain(',sales,');
    const [acctHeader, ...acctRows] = toCsv(summary, 'accounting').split('\n');
    expect(acctHeader).toContain('cogs_cents');
    expect(acctRows).toHaveLength(1);
    expect(acctRows[0]).toContain('1200');
  });
});

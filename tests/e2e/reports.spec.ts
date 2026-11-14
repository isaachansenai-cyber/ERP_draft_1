// AC33 (reporting part): CSV exports equal the filtered screen totals and keep
// the same role limits; reports show scope, source, dates, currency and refresh.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

function credentials(employeeId: string) {
  const text = readFileSync(process.env.E2E_CREDENTIALS_PATH!, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith(`| ${employeeId} |`));
  const m = line?.match(/\| (\S+@\S+) \| `([^`]+)` \|$/);
  if (!m) throw new Error(`no credentials for ${employeeId}`);
  return { email: m[1]!, password: m[2]! };
}

async function signIn(page: Page, employeeId: string) {
  const c = credentials(employeeId);
  await page.goto('./#/login');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

function parseCsv(text: string) {
  const [header, ...rows] = text.trim().split('\n');
  const cols = header!.split(',');
  return rows.map((r) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of r) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

const cents = (displayed: string) =>
  displayed === '—' ? '' : String(Math.round(Number(displayed.replace(/[$,]/g, '')) * 100));

async function exportAndCompare(page: Page) {
  const scope = page.getByTestId('report-scope');
  await expect(scope).toContainText('demo operational');
  await expect(scope).toContainText('America/Denver');
  await expect(scope).toContainText('USD');
  await expect(scope).toContainText(/Refreshed|refreshed/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = parseCsv(readFileSync((await download.path())!, 'utf8'));
  const headers = await page.locator('thead th').allTextContents();
  for (const row of csv) {
    const cells = await page.getByTestId(`summary-${row.location_id}`).locator('td').allTextContents();
    const at = (label: string) => cells[headers.indexOf(label)]!;
    expect(String(row.completed_orders)).toBe(at('Completed orders'));
    expect(row.net_sales_cents).toBe(cents(at('Net sales')));
    expect(row.data_source).toBe('demo operational');
  }
  return { csv, headers };
}

test('a manager’s CSV export equals the screen; other locations show only allowed summary fields', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/dashboard');
  const { csv } = await exportAndCompare(page);
  const own = csv.find((r) => r.location_id === 'LOC-PRO')!;
  expect(own.access).toBe('full');
  for (const other of csv.filter((r) => r.location_id !== 'LOC-PRO')) {
    expect(other.access).toBe('summary');
    expect(other.cogs_cents).toBe('');
    expect(other.gross_margin_cents).toBe('');
    expect(other.supplier_outstanding_cents).toBe('');
  }
});

test('employees get no export at all, and their screen withholds cost and margin', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-1');
  await page.goto('./#/dashboard');
  await expect(page.getByTestId('report-scope')).toContainText('demo operational');
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0); // exports are owner/manager only
  const headers = await page.locator('thead th').allTextContents();
  const cells = await page.getByTestId('summary-LOC-PRO').locator('td').allTextContents();
  for (const label of [
    'COGS',
    'Gross margin',
    'Waste cost (total)',
    'Inventory value (now)',
    'Supplier balance (now)',
  ]) {
    expect(cells[headers.indexOf(label)]).toBe('—');
  }
  await expect(page.locator('[data-testid^="summary-"]')).toHaveCount(1);
});

test('planning, hours and supplier reports show scope, source and refresh indicators', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/planning');
  await expect(page.getByTestId('forecast-scope')).toContainText(
    /demo operational · as of \d{4}-\d{2}-\d{2} .* America\/Denver · refreshed/,
  );
  await page.goto('./#/staff/time');
  await expect(
    page.getByText(
      /America\/Denver · elapsed time minus recorded unpaid breaks · refreshed|No recorded time in this range/,
    ),
  ).toBeVisible();
  await page.goto('./#/invoices');
  await expect(
    page.getByText(/Overdue is judged by the due date against today's date in America\/Denver/),
  ).toBeVisible();
});

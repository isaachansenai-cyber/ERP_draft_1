// Milestone 4 UI flows on the built app (demo database): labels and scanner
// test, clocking and breaks, schedules, planning, and What can we serve.
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { localStack } from '../integration/helpers/stack';

const stack = localStack();

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

async function newPage(browser: Browser, employeeId: string) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, employeeId);
  return page;
}

async function query<T = Record<string, string>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

test('all 47 items print as Code 128 labels; the scanner test reads the readable ID back', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-1');
  await page.goto('./#/labels');
  const sheet = page.getByTestId('label-sheet');
  await expect(sheet.locator('li')).toHaveCount(47);
  for (const id of ['ING-001', 'FG-001', 'RET-001']) {
    const label = page.getByTestId(`label-${id}`);
    await expect(label.locator(`svg[data-barcode="${id}"] rect`).first()).toBeAttached();
    await expect(label).toContainText(id);
  }
  await page.getByLabel('Category').selectOption({ index: 1 });
  expect(await sheet.locator('li').count()).toBeLessThan(47);
  await page.getByLabel('Category').selectOption('');

  const scan = page.getByLabel('Scanner test');
  await scan.fill('FG-003');
  await scan.press('Enter');
  await expect(page.getByTestId('scanner-result')).toContainText('FG-003: Korean Fried Chicken with Rice');
  await scan.fill('ing-001');
  await scan.press('Enter');
  await expect(page.getByTestId('scanner-result')).toContainText('ingredient — not sellable at the POS');
  await scan.fill('XYZ-1');
  await scan.press('Enter');
  await expect(page.getByTestId('scanner-result')).toContainText('no item has this code');

  // Print stylesheet: navigation, controls and the app header are hidden; labels stay.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('button', { name: /Print/ })).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('an employee clocks in, takes a break and clocks out on the server clock; a published shift appears for them', async ({
  page,
  browser,
}) => {
  const m = await newPage(browser, 'DEMO-LOC-SLC-MAN-1');
  await m.goto('./#/staff/schedule');
  await m.getByLabel('Staff member').selectOption('DEMO-LOC-SLC-EMP-1');
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await m.getByLabel('Start (Denver)').fill(`${tomorrow}T10:00`);
  await m.getByLabel('End (Denver)').fill(`${tomorrow}T16:00`);
  await m.getByRole('button', { name: 'Create draft shift' }).click();
  await expect(m.getByText('Draft shift created.', { exact: false })).toBeVisible();
  await m.getByLabel('Week starting').fill(tomorrow);
  await m.getByRole('button', { name: 'Publish' }).first().click();
  await expect(m.getByText('published', { exact: true }).first()).toBeVisible();

  await signIn(page, 'DEMO-LOC-SLC-EMP-1');
  await page.goto('./#/staff');
  await expect(page.getByRole('heading', { name: /My published shifts/ })).toBeVisible();
  await expect(page.locator('li', { hasText: 'LOC-SLC' }).first()).toBeVisible();
  await expect(page.getByTestId('clock-status')).toContainText('Not clocked in');
  await page.getByRole('button', { name: 'Clock in here' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('Clocked in');
  await page.getByRole('button', { name: 'Start unpaid break' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('on break');
  await page.getByRole('button', { name: 'End break' }).click();
  await expect(page.getByRole('button', { name: 'Start unpaid break' })).toBeVisible();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await expect(page.getByTestId('clock-status')).toContainText('Not clocked in');
  const [row] = await query(
    `select count(*)::text n, count(*) filter (where clock_out_at is null)::text open,
            (select count(*) from public.break_intervals b join public.time_entries t using (time_entry_id)
              where t.employee_id = 'DEMO-LOC-SLC-EMP-1')::text breaks
       from public.time_entries where employee_id = 'DEMO-LOC-SLC-EMP-1'`,
  );
  expect(row).toEqual({ n: '1', open: '0', breaks: '1' });
  await expect(page.getByTestId('hours-table')).toBeVisible();
});

test('planning shows forecast provenance and the labeled history source; EOQ settings preview with units', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/planning');
  await expect(page.getByTestId('forecast-scope')).toContainText('demo operational');
  await page.getByLabel('Demand source').selectOption('historical');
  await expect(page.getByTestId('forecast-scope')).toContainText('demo historical (synthetic)');
  await expect(page.getByTestId('forecast-table').locator('tbody tr')).toHaveCount(7); // 5 dishes + 2 retail sauces

  await page.getByRole('link', { name: 'ROP / EOQ settings' }).click();
  await page.getByLabel('Item').selectOption('ING-001');
  await page.getByLabel('Demand source').selectOption('historical');
  // The e2e demo database has no imported history (the integration demo suite covers it),
  // so the estimate is labeled insufficient and a manager demand input is required.
  await expect(page.getByTestId('eoq-inputs')).toContainText('demo historical (synthetic)');
  await expect(page.getByTestId('eoq-inputs')).toContainText('insufficient history (under 28 days)');
  await page.getByLabel('S: ordering cost (USD per order)').fill('20.00');
  await page.getByLabel('H: holding cost (USD per base unit per year)').fill('2');
  await page.getByLabel('Annual demand input (base units/year)').fill('10000');
  await page.getByRole('button', { name: 'Preview EOQ' }).click();
  await expect(page.getByText('Unconstrained EOQ 447.214')).toBeVisible();

  await page.getByRole('link', { name: 'Ingredient projection' }).click();
  await expect(page.getByText(/projected = previous \+ receipts on their expected date/)).toBeVisible();
});

test('What can we serve shows independent potentials; a manager mix aggregates shared chicken', async ({
  page,
  browser,
}) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-2');
  await page.goto('./#/serve');
  await expect(page.getByText('Independent potentials')).toBeVisible();
  for (const id of ['FG-001', 'FG-002', 'FG-003', 'FG-004', 'FG-005']) {
    await expect(page.getByTestId(`serve-${id}`)).toContainText('portions possible now');
  }
  await expect(page.getByRole('heading', { name: /Menu-mix simulator/ })).toHaveCount(0);

  const m = await newPage(browser, 'DEMO-LOC-PRO-MAN-1');
  await m.goto('./#/serve');
  await m.getByLabel(/Brazilian Chicken Strogonoff/).fill('3');
  await m.getByLabel(/Korean Fried Chicken with Rice/).fill('2');
  await m.getByRole('button', { name: 'Simulate' }).click();
  const chicken = m.getByTestId('mix-ING-001');
  await expect(chicken).toContainText('940 g');
  await expect(chicken).toContainText('shared');
  await expect(m.getByTestId('mix-ING-006')).toContainText('shared');
});

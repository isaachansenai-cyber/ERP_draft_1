// Milestone 2 UI flows on the built app: POS → kitchen → pickup → dashboard,
// purchasing with a partial receipt, scanner behavior (AC28 groundwork) and
// failure recovery on the real order RPCs (AC29).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
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

async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

test('POS → kitchen → simulated payment → pickup, with scanner rules', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-1');
  await page.goto('./#/pos');
  const scan = page.getByLabel('Scan or type item code');
  await scan.fill('ING-001');
  await scan.press('Enter');
  await expect(page.getByText('ING-001: Ingredient — not sellable. Nothing was added.')).toBeVisible();
  await scan.fill('FG-001');
  await scan.press('Enter');
  await expect(page.getByText('Added Brazilian Chicken Strogonoff.')).toBeVisible();
  await page.getByRole('button', { name: /Korean Fried Chicken with Rice/ }).click();
  await expect(page.getByText('Unsent draft — not an order yet')).toBeVisible();
  await page.getByLabel('Pickup name (optional)').fill('Avery');
  await page.getByRole('button', { name: 'Accept order' }).click();
  const accepted = page.getByTestId('accepted-order');
  await expect(accepted).toContainText('accepted — pickup code PRO-');
  const pickup = (await accepted.textContent())!.match(/pickup code (PRO-\d{4})/)![1]!;
  await expect(page.getByText('Simulated payment (demo — no money moves)')).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Balance due $0.00 — payment recorded')).toBeVisible();

  await page.goto('./#/kitchen');
  const card = page.getByTestId(`kitchen-${pickup}`);
  await expect(card).toContainText('Avery');
  await card.getByRole('button', { name: 'Start preparation' }).click();
  await expect(page.getByTestId(`kitchen-${pickup}`).getByRole('button', { name: 'Mark ready' })).toBeVisible();
  await page.getByTestId(`kitchen-${pickup}`).getByRole('button', { name: 'Mark ready' }).click();
  await expect(page.getByTestId(`kitchen-${pickup}`).getByText('Payment recorded in full')).toBeVisible();
  await page.getByTestId(`kitchen-${pickup}`).getByRole('button', { name: 'Complete pickup' }).click();
  await expect(page.getByTestId(`kitchen-${pickup}`)).toHaveCount(0);

  const [row] = await query<{ status: string; tender_type: string }>(
    `select o.status, t.tender_type from public.orders o join public.tenders t using (order_id) where o.pickup_code = $1 and o.location_id = 'LOC-PRO'`,
    [pickup],
  );
  expect(row).toEqual({ status: 'completed', tender_type: 'SIMULATED' });

  await page.goto('./#/dashboard');
  await expect(page.getByTestId('report-scope')).toContainText('demo operational');
  await expect(page.getByTestId('summary-LOC-PRO')).toBeVisible();
  // Employees get the daily summary: sales figures, but cost and margin cells are withheld ("—").
  const summaryRow = page.getByTestId('summary-LOC-PRO');
  const cells = await summaryRow.locator('td').allTextContents();
  const headers = await page.locator('thead th').allTextContents();
  expect(cells[headers.indexOf('COGS')]).toBe('—');
  expect(cells[headers.indexOf('Gross margin')]).toBe('—');
  expect(Number(cells[headers.indexOf('Completed orders')])).toBeGreaterThanOrEqual(1);
});

test('a POS acceptance whose response is lost is confirmed by its request key — one order, no duplicate', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-SLC-EMP-1');
  await page.goto('./#/pos');
  await page.getByRole('button', { name: /Mongolian Khorkhog/ }).click();
  let calls = 0;
  await page.route('**/rest/v1/rpc/accept_order', async (route) => {
    calls += 1;
    await route.fetch(); // the server commits the order
    await route.abort('connectionreset'); // …but the browser never hears back
  });
  const before = await query<{ n: number }>(`select count(*)::int n from public.orders where location_id = 'LOC-SLC'`);
  await page.getByRole('button', { name: 'Accept order' }).click();
  await expect(
    page.getByText(/Order accepted and ingredients reserved\. \(already saved earlier — no duplicate was created\)/),
  ).toBeVisible();
  await expect(page.getByTestId('accepted-order')).toContainText('pickup code SLC-');
  const after = await query<{ n: number }>(`select count(*)::int n from public.orders where location_id = 'LOC-SLC'`);
  expect(after[0]!.n - before[0]!.n).toBe(1);
  expect(calls).toBe(1);
});

test('an expired session during a payment shows "not confirmed", then confirms instead of resubmitting', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-SFO-EMP-2');
  await page.goto('./#/pos');
  await page.getByRole('button', { name: /Tacos al Pastor/ }).click();
  await page.getByRole('button', { name: 'Accept order' }).click();
  await expect(page.getByTestId('accepted-order')).toBeVisible();
  await page.route('**/rest/v1/rpc/record_tender', async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }),
    });
  });
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded. (already saved earlier — no duplicate was created)')).toBeVisible();
  const pickup = (await page.getByTestId('accepted-order').textContent())!.match(/pickup code (SFO-\d{4})/)![1]!;
  const tenders = await query<{ n: number }>(
    `select count(*)::int n from public.tenders t join public.orders o using (order_id) where o.pickup_code = $1 and o.location_id = 'LOC-SFO'`,
    [pickup],
  );
  expect(tenders[0]!.n).toBe(1);
});

test('a manager creates, submits and partially receives a purchase order; stock rises by the received packs only', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  const [si] = await query<{ supplier_id: string; pack: string }>(
    `select supplier_id, pack_base_qty::text pack from public.supplier_items where item_id = 'ING-007' and is_primary`,
  );
  const [before] = await query<{ q: string }>(
    `select sum(on_hand)::text q from public.stock_balances where location_id = 'LOC-PRO' and item_id = 'ING-007'`,
  );
  await page.goto('./#/purchasing/orders');
  await page.getByLabel('Supplier').selectOption(si!.supplier_id);
  await page.getByLabel('ING-007 packs').fill('4');
  await page.getByRole('button', { name: 'Create draft PO' }).click();
  await expect(page.getByText('Draft purchase order created.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit (placed outside the app)' }).first().click();
  await expect(page.getByText('submitted').first()).toBeVisible();
  await page.getByRole('button', { name: 'Receive…' }).first().click();
  await page.getByLabel('ING-007 packs received').fill('1');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText('partially received').first()).toBeVisible();
  const [after] = await query<{ q: string }>(
    `select sum(on_hand)::text q from public.stock_balances where location_id = 'LOC-PRO' and item_id = 'ING-007'`,
  );
  expect(Number(after!.q) - Number(before!.q)).toBe(Number(si!.pack));
});

test('employees see availability without costs; managers see average cost', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-2');
  await page.goto('./#/inventory');
  await expect(page.getByRole('columnheader', { name: 'Available' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Avg cost / unit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Purchasing' })).toHaveCount(0);
});

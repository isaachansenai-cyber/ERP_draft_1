// Regression for the Spanish Fork waste-report and stock-chart reports, the
// schema-version banner (ADR 0036), owner recipe editing (ADR 0037), supplier
// edits and change requests (ADR 0038), and the Overview "Today" card and
// Dashboard tabs (ADR 0039), on the built app (demo database).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { localStack, rpc, signIn as apiSignIn } from '../integration/helpers/stack';

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

async function query<T = Record<string, string>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

test('Spanish Fork employee 1 can report waste, and the Spanish Fork manager can open an item chart', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-SFO-EMP-1');
  await page.getByRole('link', { name: 'Waste reports' }).click();
  await page.getByLabel('Item 1').selectOption('ING-005');
  await page.getByLabel('Quantity (base unit)').fill('25');
  await page.getByLabel('Reason').selectOption({ label: 'Burnt during preparation' });
  await page.getByRole('button', { name: 'Submit waste report' }).click();
  await expect(page.getByText('Waste report submitted for manager review.')).toBeVisible();
  await expect(page.getByText(/WST-SFO-\d+/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'DEMO-LOC-SFO-MAN-1');
  await page.goto('./#/inventory');
  await page.getByRole('button', { name: 'Chart for Yellow onions' }).click();
  await expect(page.getByText(/demo operational · \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByText('On hand at end of day (g)')).toBeVisible();
});

test('a database older than the app shows an out-of-date banner instead of failing silently', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SFO-MAN-1');
  await expect(page.getByTestId('schema-banner')).toHaveCount(0);
  // A database from before migration 0024 has no get_schema_version.
  await page.route('**/rest/v1/rpc/get_schema_version', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function', details: null, hint: null }),
    }),
  );
  await page.reload();
  await expect(page.getByTestId('schema-banner')).toContainText('Database out of date');
});

test('the owner edits a recipe and activates it; managers only read recipes', async ({ page }) => {
  const original = await query<{ component_item_id: string; quantity_per_serving: string }>(
    `select c.component_item_id, c.quantity_per_serving::text from public.recipe_components c
       join public.recipe_versions v using (recipe_version_id)
      where v.parent_item_id = 'FG-004' and v.status = 'active' order by c.line_no`,
  );
  await signIn(page, 'DEMO-OWNER');
  await page.getByRole('link', { name: 'Recipes' }).click();
  const card = page.getByTestId('recipe-FG-004');
  await card.getByRole('button', { name: 'Edit recipe' }).click();
  await expect(card.getByText(/Draft version \d+/)).toBeVisible();
  await card.getByLabel('Per serving', { exact: false }).first().fill('999');
  await card.getByRole('button', { name: 'Add ingredient' }).click();
  const last = original.length;
  await card.locator(`#recipe-FG-004-item-${last}`).selectOption('ING-038');
  await card.locator(`#recipe-FG-004-qty-${last}`).fill('4');
  await card.getByRole('button', { name: 'Save draft' }).click();
  await expect(card.getByText('Draft saved.', { exact: false })).toBeVisible();
  await card.getByLabel('What changed (required)').fill('E2E: more of the first ingredient, add scallions');
  await card.getByRole('button', { name: /Activate version \d+/ }).click();
  await expect(card.getByText(/Version \d+ in use/)).toBeVisible();
  await expect(card.getByText('ING-038', { exact: false })).toBeVisible();
  const active = await query<{ n: string }>(
    `select count(*)::text n from public.recipe_components c join public.recipe_versions v using (recipe_version_id)
      where v.parent_item_id = 'FG-004' and v.status = 'active' and c.component_item_id = 'ING-038'`,
  );
  expect(active[0]!.n).toBe('1');

  // Put the original quantities back (a new version) so later suites see the seeded recipe.
  const owner = await apiSignIn(stack, credentials('DEMO-OWNER').email, credentials('DEMO-OWNER').password);
  const d = await rpc(owner, 'start_recipe_draft', { p_request_key: crypto.randomUUID(), p_dish_id: 'FG-004' });
  const lines = original.map((l) => ({ item_id: l.component_item_id, quantity_per_serving: l.quantity_per_serving }));
  const saved = await rpc(owner, 'save_recipe_draft', {
    p_request_key: crypto.randomUUID(),
    p_recipe_version_id: d.data.recipe_version_id,
    p_expected_revision: d.data.draft_revision,
    p_lines: lines,
  });
  const restored = await rpc(owner, 'activate_recipe_version', {
    p_request_key: crypto.randomUUID(),
    p_recipe_version_id: d.data.recipe_version_id,
    p_expected_revision: saved.data.draft_revision,
    p_change_note: 'E2E: restore seeded recipe',
  });
  expect(restored.code).toBeNull();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/catalog');
  await expect(page.getByText('Only the owner can change recipes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit recipe' })).toHaveCount(0);
});

test('a manager requests a supplier change; the owner approves it from the Overview page', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SFO-MAN-1');
  await page.goto('./#/purchasing/suppliers');
  await expect(page.getByRole('button', { name: 'Edit SUP-08 details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request change to SUP-08' }).click();
  const form = page.getByRole('form', { name: /Request a change to/ });
  await form.getByLabel('Phone').fill('435 555 0188');
  await form.getByLabel('Where did this come from? (required)').fill('Driver left a card with the new number');
  await form.getByRole('button', { name: 'Send request to owner' }).click();
  await expect(page.getByText('Request sent to the owner.')).toBeVisible();
  await expect(page.getByText('Waiting for owner').first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'DEMO-OWNER');
  const card = page.getByTestId('supplier-requests-card');
  await expect(card.getByText(/1 waiting for review/)).toBeVisible();
  await expect(card.getByText('435 555 0188')).toBeVisible();
  await card.getByRole('button', { name: 'Approve and apply' }).click();
  await expect(card.getByText('No supplier change requests are waiting.')).toBeVisible();
  const [s] = await query<{ phone: string }>(`select phone from public.suppliers where supplier_id = 'SUP-08'`);
  expect(s!.phone).toBe('435 555 0188');

  // The owner edits a lead time directly.
  await page.goto('./#/purchasing/suppliers');
  await page.getByRole('button', { name: 'Edit SUP-08 details' }).click();
  const edit = page.getByRole('form', { name: /Edit/ });
  const lead = edit.locator('input[id^="supplier-SUP-08-lead-"]').first();
  await lead.fill('9');
  await edit.getByRole('button', { name: 'Save supplier details' }).click();
  await expect(page.getByText(/Owner-entered/).first()).toBeVisible();
  const [l] = await query<{ n: string }>(
    `select count(*)::text n from public.supplier_items where supplier_id = 'SUP-08' and procurement_lead_days = 9 and lead_time_basis = 'Owner-entered'`,
  );
  expect(l!.n).toBe('1');
});

test('Overview shows today’s sales to managers and the owner; the Dashboard splits Sales and Accounting', async ({
  page,
}) => {
  await signIn(page, 'DEMO-OWNER');
  const today = page.getByTestId('today-summary');
  await expect(today.getByTestId('today-scope')).toContainText(
    /demo operational · \d{4}-\d{2}-\d{2} \(America\/Denver\) · USD/,
  );
  for (const loc of ['LOC-PRO', 'LOC-SFO', 'LOC-SLC']) await expect(today.getByTestId(`today-${loc}`)).toBeVisible();
  await expect(today.getByTestId('today-total')).toBeVisible();
  await today.getByRole('link', { name: 'Open full dashboard' }).click();
  await expect(page).toHaveURL(/#\/dashboard\/sales$/);
  await expect(page.locator('thead th', { hasText: 'Net sales' })).toHaveCount(1);
  await expect(page.locator('thead th', { hasText: 'COGS' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Accounting' }).click();
  await expect(page.locator('thead th', { hasText: 'COGS' })).toHaveCount(1);
  await expect(page.locator('thead th', { hasText: 'Recorded payments' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await expect(page.getByTestId('today-LOC-PRO')).toBeVisible();
  await expect(page.getByTestId('today-LOC-SFO')).toHaveCount(0);
  await expect(page.getByTestId('supplier-requests-card')).toHaveCount(0);
  await page.goto('./#/dashboard/accounting');
  // Other locations' summary rows carry sales totals only, so they are not on the Accounting tab.
  await expect(page.getByTestId('summary-LOC-PRO')).toBeVisible();
  await expect(page.getByTestId('summary-LOC-SFO')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'DEMO-LOC-PRO-EMP-1');
  await expect(page.getByTestId('today-summary')).toHaveCount(0);
});

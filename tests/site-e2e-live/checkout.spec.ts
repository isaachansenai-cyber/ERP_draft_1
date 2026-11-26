// W4: checkout and confirmation on the website against the live demo ERP.
// Uses Spanish Fork so the menu/cart tests' stock at the other locations is untouched.
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { localStack, withDb } from '../integration/helpers/stack';

const stack = localStack();
const sql = async <T>(text: string, params: unknown[] = []) =>
  (await withDb(stack.dbUrl, (db) => db.query(text, params))).rows as T[];
const webOrders = async () =>
  (
    await sql<{ n: number }>(
      `select count(*)::int n from public.orders where location_id = 'LOC-SFO' and channel = 'web'`,
    )
  )[0]!.n;

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

async function axeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Strogonoff × 2 and a barbecue sauce in the Spanish Fork cart, then open checkout. */
async function fillCart(page: Page) {
  await page.goto('#/menu');
  await page.getByRole('radio', { name: 'Spanish Fork' }).check();
  const dish = page.getByRole('article', { name: 'Brazilian Chicken Strogonoff' });
  await dish.getByRole('button', { name: 'More' }).click();
  await dish.getByRole('button', { name: 'Add to cart' }).click();
  await page
    .getByRole('article', { name: 'Demo bottled barbecue sauce 250 mL' })
    .getByRole('button', { name: 'Add to cart' })
    .click();
  await page.goto('#/cart');
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
}

/** Pick the first open day and its first open time; returns the chosen ISO time. */
async function chooseFirstSlot(page: Page): Promise<string> {
  const day = page.getByLabel('Day', { exact: true });
  await expect(day.locator('option')).not.toHaveCount(1);
  const dayValue = await day.locator('option:not([disabled]):not([value=""])').first().getAttribute('value');
  await day.selectOption(dayValue!);
  const time = page.getByLabel('Time', { exact: true });
  const timeValue = await time.locator('option:not([disabled]):not([value=""])').first().getAttribute('value');
  await time.selectOption(timeValue!);
  return timeValue!;
}

async function fillContact(page: Page, n: number) {
  await page.getByLabel('Name for pickup').fill(`Guest ${n}`);
  await page.getByLabel('Phone').fill(`385-555-${String(2000 + n)}`);
  await page.getByLabel('E-mail').fill(`checkout${n}@example.com`);
}

test('checkout shows the exact total, places the order and opens a receipt with the pickup code', async ({ page }) => {
  await fillCart(page);
  // 2 × $15.99 + $6.99 = $38.97; tax 7.25% per line: $2.32 + $0.51 = $2.83
  await expect(page.getByText('$38.97')).toBeVisible();
  await expect(page.getByText('Sales tax (7.25%)')).toBeVisible();
  await expect(page.getByTestId('checkout-total')).toHaveText('$41.80');
  await expect(page.getByText('Simulated payment (demo)')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const before = await webOrders();
  await chooseFirstSlot(page);
  await fillContact(page, 1);
  await page.getByLabel('Note for the kitchen (optional)').fill('Extra lime, please');
  await page.getByRole('button', { name: /^Place order/ }).click();

  await expect(page).toHaveURL(/#\/order\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('pickup-code')).toHaveText(/^SFO-\d{4}$/);
  await expect(page.getByTestId('order-total')).toHaveText('$41.80'); // the ERP's total matches the estimate
  await expect(page.getByTestId('order-balance')).toHaveText('$0.00');
  await expect(page.getByText('Simulated payment (demo, no card charged)')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('Received: the kitchen has your order');
  await expect(page.getByText('Your note: Extra lime, please')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  expect(await webOrders()).toBe(before + 1);

  // The receipt link keeps working, and follows the order's status.
  const [row] = await sql<{ order_id: string; total_cents: number }>(
    `select order_id, total_cents::int from public.orders where web_token = $1`,
    [page.url().split('/').pop()],
  );
  expect(row!.total_cents).toBe(4180);
  await page.reload();
  await expect(page.getByTestId('pickup-code')).toHaveText(/^SFO-\d{4}$/);
});

test('missing details are pointed out and nothing is placed', async ({ page }) => {
  await fillCart(page);
  const before = await webOrders();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByText('Please choose a pickup time.')).toBeVisible();
  await expect(page.getByText('Please enter your name.')).toBeVisible();
  await expect(page.getByText('Please enter a phone number we can call.')).toBeVisible();
  await expect(page.getByText('Please enter a valid e-mail address.')).toBeVisible();
  await expect(page.getByLabel('Name for pickup')).toHaveAttribute('aria-invalid', 'true');
  expect(await webOrders()).toBe(before);
});

test('a request that never reached the ERP is reported as not placed, and retrying places it once', async ({
  page,
}) => {
  await fillCart(page);
  await chooseFirstSlot(page);
  await fillContact(page, 2);
  const before = await webOrders();
  await page.route('**/rest/v1/rpc/web_place_order', (route) => route.abort());
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByText('so it was not placed. You can safely try again.')).toBeVisible();
  expect(await webOrders()).toBe(before);
  await page.unroute('**/rest/v1/rpc/web_place_order');
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByTestId('pickup-code')).toBeVisible();
  expect(await webOrders()).toBe(before + 1);
});

test('an order whose answer was lost after the ERP accepted it is found, not placed twice', async ({ page }) => {
  await fillCart(page);
  await chooseFirstSlot(page);
  await fillContact(page, 3);
  const before = await webOrders();
  // The ERP receives and commits the order, but the browser never sees the answer.
  await page.route('**/rest/v1/rpc/web_place_order', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByTestId('pickup-code')).toBeVisible();
  expect(await webOrders()).toBe(before + 1);
});

test('a time taken by someone else meanwhile is refused and must be chosen again', async ({ page }) => {
  await sql(`update public.web_ordering_settings set orders_per_slot = 1 where location_id = 'LOC-SFO'`);
  try {
    await fillCart(page);
    const slot = await chooseFirstSlot(page);
    await fillContact(page, 4);
    // Another visitor books the same time first.
    const other = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false } });
    const { error } = await other.rpc('web_place_order', {
      p_request_key: crypto.randomUUID(),
      p_location_id: 'LOC-SFO',
      p_lines: [{ item_id: 'RET-002', quantity: 1 }],
      p_contact: { name: 'Other', phone: '385-555-9000', email: 'other@example.com' },
      p_pickup_at: slot,
    });
    expect(error).toBeNull();
    const before = await webOrders();
    await page.getByRole('button', { name: /^Place order/ }).click();
    await expect(page.getByText('That pickup time was just taken or is no longer possible.')).toBeVisible();
    await expect(page.getByLabel('Time', { exact: true })).toHaveValue('');
    expect(await webOrders()).toBe(before);
  } finally {
    await sql(`update public.web_ordering_settings set orders_per_slot = 4 where location_id = 'LOC-SFO'`);
  }
});

test('the whole order can be placed with the keyboard alone', async ({ page }) => {
  await page.goto('#/menu');
  const press = async (locator: ReturnType<Page['getByRole']>, key: string) => {
    await locator.focus();
    await expect(locator).toBeFocused();
    await page.keyboard.press(key);
  };
  await press(page.getByRole('radio', { name: 'Provo' }), 'Space');
  await expect(page.getByRole('radio', { name: 'Provo' })).toBeChecked();
  await press(
    page.getByRole('article', { name: 'Korean Fried Chicken with Rice' }).getByRole('button', { name: 'Add to cart' }),
    'Enter',
  );
  await press(page.getByRole('link', { name: 'Cart, 1 item' }), 'Enter');
  await press(page.getByRole('link', { name: 'Continue to checkout' }), 'Enter');
  await press(page.getByLabel('Day', { exact: true }), 'ArrowDown');
  await expect(page.getByLabel('Day', { exact: true })).not.toHaveValue('');
  await press(page.getByLabel('Time', { exact: true }), 'ArrowDown');
  await expect(page.getByLabel('Time', { exact: true })).not.toHaveValue('');
  for (const [label, text] of [
    ['Name for pickup', 'Kai'],
    ['Phone', '801-555-3030'],
    ['E-mail', 'kai@example.com'],
  ] as const) {
    await page.getByLabel(label).focus();
    await page.keyboard.type(text);
  }
  await press(page.getByRole('button', { name: /^Place order/ }), 'Enter');
  await expect(page.getByTestId('pickup-code')).toHaveText(/^PRO-\d{4}$/);
});

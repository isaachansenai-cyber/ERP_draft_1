// W3: the website's menu and cart against the live demo ERP. Visitors never
// sign in. Availability changes are made in the database the way the ERP makes
// them, and the page must follow on its own refresh.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { localStack, withDb } from '../integration/helpers/stack';

const stack = localStack();
const sql = (text: string, params: unknown[] = []) => withDb(stack.dbUrl, (db) => db.query(text, params));

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

async function chooseLocation(page: Page, name: string) {
  await page.getByRole('radio', { name }).check();
}

const card = (page: Page, name: string) => page.getByRole('article', { name });

async function axeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('choosing a location shows live prices and availability, and the choice is remembered', async ({ page }) => {
  await page.goto('/menu');
  // The demo database says so on every page (the mode comes from the database).
  await expect(page.getByTestId('demo-banner')).toHaveText(/orders and payments are simulated/);
  await expect(page.getByText('Choose a pickup location to see prices')).toBeVisible();
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
  await expect(page.getByText('Open daily 12pm–8pm')).toHaveCount(3);

  await chooseLocation(page, 'Salt Lake City');
  const strogonoff = card(page, 'Brazilian Chicken Strogonoff');
  await expect(strogonoff.getByText('$15.99')).toBeVisible();
  await expect(strogonoff.getByText('Available', { exact: true })).toBeVisible();
  await expect(strogonoff.getByText('Ready in about 25 minutes.')).toBeVisible();
  await expect(card(page, 'Tacos al Pastor (3 tacos)').getByText('Prepared a day ahead')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Retail sauces' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(7);
  await expect(page.getByText('Allergen information: please ask staff.')).toHaveCount(7);
  expect(await axeViolations(page)).toEqual([]);

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Salt Lake City' })).toBeChecked();
  await expect(strogonoff.getByText('$15.99')).toBeVisible();
});

test('the cart keeps each location separate, survives a reload and is priced by the ERP', async ({ page }) => {
  await page.goto('/menu');
  await chooseLocation(page, 'Salt Lake City');
  const strogonoff = card(page, 'Brazilian Chicken Strogonoff');
  await strogonoff.getByRole('button', { name: 'More' }).click();
  await strogonoff.getByRole('button', { name: 'Add to cart' }).click();
  await expect(strogonoff.getByText('Added 2 to your cart.')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('2');

  await page.getByRole('link', { name: 'Cart, 2 items' }).click();
  await expect(page.getByText('Pickup at Salt Lake City.')).toBeVisible();
  await expect(page.getByTestId('cart-status')).toHaveText(/Not ordered yet/);
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$31.98');
  await expect(page.getByRole('link', { name: 'Continue to checkout' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$31.98');

  await page.goto('/menu');
  await chooseLocation(page, 'Provo');
  await expect(page.getByTestId('cart-count')).toHaveCount(0);
  await chooseLocation(page, 'Salt Lake City');
  await expect(page.getByTestId('cart-count')).toHaveText('2');
});

test('quantities are whole numbers capped at what the ERP allows (10 per line)', async ({ page }) => {
  await page.goto('/menu');
  await chooseLocation(page, 'Provo');
  const khorkhog = card(page, 'Mongolian Khorkhog');
  const qty = khorkhog.getByRole('spinbutton', { name: 'Quantity of Mongolian Khorkhog' });
  await qty.fill('50');
  await expect(qty).toHaveValue('10');
  await expect(khorkhog.getByRole('button', { name: 'More' })).toBeDisabled();
  await khorkhog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('10');
  await expect(khorkhog.getByText('Your cart already has the most we can make right now (10).')).toBeVisible();
});

test('sold out in the ERP shows on the website within one refresh, then comes back by itself', async ({ page }) => {
  await page.clock.install();
  await page.goto('/menu');
  await chooseLocation(page, 'Salt Lake City');
  const chicken = card(page, 'Korean Fried Chicken with Rice');
  await chicken.getByRole('button', { name: 'Add to cart' }).click();
  await expect(chicken.getByText('Available', { exact: true })).toBeVisible();

  await sql(
    `insert into public.location_item_availability (location_id, item_id, is_available, reason)
     values ('LOC-SLC', 'FG-003', false, 'Out of gochujang')
     on conflict (location_id, item_id) do update set is_available = false, reason = excluded.reason`,
  );
  try {
    await page.clock.runFor(31_000);
    await expect(chicken.getByText('Sold out — back soon')).toBeVisible();
    await expect(chicken.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
    await page.goto('/cart');
    await expect(page.getByRole('alert')).toHaveText('Sold out right now. Remove it to continue.');
    await expect(page.getByText('Some items need your attention')).toBeVisible();
  } finally {
    await sql(`update public.location_item_availability set is_available = true, reason = null
               where location_id = 'LOC-SLC' and item_id = 'FG-003'`);
  }
  await page.clock.runFor(31_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue to checkout' })).toBeVisible();
});

test('a location that is not taking orders says so and offers nothing to add', async ({ page }) => {
  await sql(`update public.web_ordering_settings set enabled = false where location_id = 'LOC-SFO'`);
  try {
    await page.goto('/menu');
    await expect(page.getByRole('radio', { name: 'Spanish Fork' }).locator('..').locator('..')).toContainText(
      'Online ordering is paused',
    );
    await chooseLocation(page, 'Spanish Fork');
    await expect(page.getByText('Not taking online orders')).toBeVisible();
    await expect(card(page, 'Brazilian Chicken Strogonoff').getByText('$15.99')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
  } finally {
    await sql(`update public.web_ordering_settings set enabled = true where location_id = 'LOC-SFO'`);
  }
});

test('when the ERP cannot be reached, the page says nothing was ordered and recovers on retry', async ({ page }) => {
  await page.route('**/rest/v1/rpc/web_get_menu', (route) => route.abort());
  await page.goto('/menu');
  await chooseLocation(page, 'Provo');
  await expect(page.getByText("We can't reach the restaurant right now")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nothing was ordered.')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/web_get_menu');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page, 'Brazilian Chicken Strogonoff').getByText('$15.99')).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the live menu and cart fit without sideways scrolling', async ({ page }) => {
    await page.goto('/menu');
    await chooseLocation(page, 'Provo');
    await card(page, 'Brazilian Chicken Strogonoff').getByRole('button', { name: 'Add to cart' }).click();
    for (const path of ['/menu', '/cart', '/']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

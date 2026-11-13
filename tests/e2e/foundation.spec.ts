// Milestone 1 UI flows: GitHub Pages base path + hash routing (AC30), sign-in and
// server-resolved roles (AC03 UI), offline/uncertain-network behavior (AC29, AC32).
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

test('unauthenticated deep links show only the sign-in page, with the server data-mode banner', async ({ page }) => {
  await page.goto('./#/settings/staff');
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByTestId('data-mode-banner')).toHaveText('DEMO — synthetic data');
  await expect(page.getByText('Demo Owner')).toHaveCount(0);
});

test('owner signs in; hash deep links survive a full reload under the base path', async ({ page }) => {
  await signIn(page, 'DEMO-OWNER');
  await expect(page.getByTestId('signed-in-as')).toContainText('Demo Owner');
  await expect(page.getByTestId('signed-in-as')).toContainText('owner');
  await page.goto('./#/settings/setup');
  await page.reload();
  await expect(page).toHaveURL(/\/ERP_draft_1\/#\/settings\/setup$/);
  await expect(page.getByText('Pilot setup gates')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen…' }).first()).toBeVisible();
});

test('an employee sees only their location and no owner controls', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SFO-EMP-1');
  const options = page.locator('#location-select option');
  await expect(options).toHaveText(['Spanish Fork']);
  await expect(page.getByTestId('signed-in-as')).toContainText('employee');
  await page.goto('./#/settings/setup');
  await expect(page.getByText('Only the owner can confirm or reopen gates.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm…|Reopen…/ })).toHaveCount(0);
  await page.goto('./#/settings/staff');
  await expect(page.getByText('Staff access is managed by the owner and location managers.')).toBeVisible();
});

test('offline: posting is disabled and the app says nothing was saved', async ({ page, context }) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/settings/account');
  await page.getByLabel('New PIN (6–12 digits)').fill('4829137');
  await page.getByLabel('Repeat PIN').fill('4829137');
  await context.setOffline(true);
  await expect(page.getByText('No connection — nothing was saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Set PIN|Change PIN/ })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /Set PIN|Change PIN/ })).toBeEnabled();
});

test('a write whose response is lost is confirmed by its request key, not retried blindly', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SLC-MAN-1');
  await page.goto('./#/settings/account');
  let sent = 0;
  // Let the request reach the server (it commits), then drop the response.
  await page.route('**/rest/v1/rpc/set_manager_pin', async (route) => {
    sent += 1;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.getByLabel('New PIN (6–12 digits)').fill('5829137');
  await page.getByLabel('Repeat PIN').fill('5829137');
  await page.getByRole('button', { name: /Set PIN|Change PIN/ }).click();
  await expect(page.getByText('PIN saved. (already saved earlier — no duplicate was created)')).toBeVisible();
  expect(sent).toBe(1);
});

test('a write that never reached the server is reported as not saved and can be retried safely', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SFO-MAN-1');
  await page.goto('./#/settings/account');
  await page.route('**/rest/v1/rpc/set_manager_pin', (route) => route.abort('connectionrefused'));
  await page.getByLabel('New PIN (6–12 digits)').fill('6829137');
  await page.getByLabel('Repeat PIN').fill('6829137');
  await page.getByRole('button', { name: /Set PIN|Change PIN/ }).click();
  await expect(page.getByText('The server confirmed nothing was saved. You can safely try again.')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/set_manager_pin');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(/^PIN saved\./)).toBeVisible();
});

test('primary controls are keyboard reachable with visible labels and ≥44px targets', async ({ page }) => {
  await page.goto('./#/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  const box = await page.getByRole('button', { name: 'Sign in' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

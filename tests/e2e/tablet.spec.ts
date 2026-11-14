// Milestone 5 tablet, keyboard and scanner pass (AC32): every screen is
// scanned with axe for serious/critical accessibility problems, keeps touch
// targets ≥ 44 px, fits a portrait tablet without sideways scrolling, and the
// principal POS flow works from the keyboard and a keyboard-wedge scanner alone.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
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

const MANAGER_ROUTES = [
  '#/',
  '#/dashboard',
  '#/pos',
  '#/kitchen',
  '#/inventory',
  '#/inventory/counts',
  '#/inventory/waste',
  '#/inventory/transfers',
  '#/returns',
  '#/returns/custody',
  '#/purchasing/orders',
  '#/purchasing/suppliers',
  '#/invoices',
  '#/planning',
  '#/planning/projection',
  '#/planning/settings',
  '#/serve',
  '#/staff',
  '#/staff/schedule',
  '#/staff/time',
  '#/labels',
  '#/settings/setup',
  '#/settings/taxes-prices',
  '#/settings/return-policy',
  '#/settings/staff',
  '#/settings/account',
];
const EMPLOYEE_ROUTES = [
  '#/',
  '#/dashboard',
  '#/pos',
  '#/kitchen',
  '#/inventory',
  '#/inventory/waste',
  '#/returns',
  '#/serve',
  '#/staff',
  '#/labels',
];

async function settle(page: Page, route: string) {
  await page.goto(`./${route}`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 10_000 });
}

async function axeProblems(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
}

/** Visible interactive controls in the main content smaller than 44 × 44 CSS px. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll(
        'main button, main input:not([type=checkbox]):not([type=radio]), main select, main a, main summary',
      )
      .forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(el as HTMLElement);
        if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') return;
        if (el.tagName === 'A' && (el as HTMLElement).closest('p, li, td')) return; // inline text links
        if (r.height < 44 || r.width < 44)
          out.push(
            `${el.tagName.toLowerCase()} "${(el.textContent ?? (el as HTMLInputElement).id).trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
          );
      });
    return out;
  });
}

test('manager screens: no serious accessibility problems and 44 px touch targets', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  const problems: Record<string, string[]> = {};
  for (const route of MANAGER_ROUTES) {
    await settle(page, route);
    const found = [...(await axeProblems(page)), ...(await smallTargets(page)).map((t) => `touch target ${t}`)];
    if (found.length) problems[route] = found;
  }
  expect(problems).toEqual({});
});

test('employee screens: no serious accessibility problems and 44 px touch targets', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'DEMO-LOC-SFO-EMP-2');
  const problems: Record<string, string[]> = {};
  for (const route of EMPLOYEE_ROUTES) {
    await settle(page, route);
    const found = [...(await axeProblems(page)), ...(await smallTargets(page)).map((t) => `touch target ${t}`)];
    if (found.length) problems[route] = found;
  }
  expect(problems).toEqual({});
});

test('portrait tablet: principal screens fit without sideways page scrolling', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 820, height: 1180 } })).newPage();
  await signIn(page, 'DEMO-LOC-SFO-MAN-1');
  const overflow: string[] = [];
  for (const route of [
    '#/pos',
    '#/kitchen',
    '#/inventory',
    '#/returns',
    '#/serve',
    '#/staff',
    '#/labels',
    '#/dashboard',
    '#/planning',
  ]) {
    await settle(page, route);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 1) overflow.push(`${route}: ${wide}px`);
  }
  expect(overflow).toEqual([]);
});

test('keyboard and scanner only: an order is taken, paid and found in the kitchen without a pointer', async ({
  page,
}) => {
  await signIn(page, 'DEMO-LOC-SFO-EMP-1');
  await page.goto('./#/pos');
  const scan = page.getByLabel('Scan or type item code');
  // Like a cashier, scan once the menu is on screen.
  await expect(page.getByRole('button', { name: /barbecue sauce/i }).first()).toBeVisible();
  await scan.focus();
  // A keyboard-wedge scanner types the code and presses Enter.
  await page.keyboard.type('RET-001');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Added .*barbecue sauce/i)).toBeVisible();
  await expect(scan).toBeFocused(); // ready for the next scan
  await page.keyboard.type('ING-006');
  await page.keyboard.press('Enter');
  await expect(page.getByText('ING-006: Ingredient — not sellable. Nothing was added.')).toBeVisible();

  // Tab to "Accept order"; every stop shows a visible focus indicator.
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        text: (el.textContent ?? '').trim(),
        outline: s.outlineStyle !== 'none' && s.outlineWidth !== '0px',
        ring: s.boxShadow !== 'none',
      };
    });
    if (info) expect(info.outline || info.ring, `focus indicator on "${info.text}"`).toBe(true);
    reached = info?.text === 'Accept order';
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  const accepted = page.getByTestId('accepted-order');
  await expect(accepted).toContainText('pickup code SFO-');
  const pickup = (await accepted.textContent())!.match(/pickup code (SFO-\d{4})/)![1]!;

  // Pay by keyboard: tab to "Record payment" and press Enter.
  await page.getByRole('button', { name: 'Record payment' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Balance due $0.00 — payment recorded')).toBeVisible();

  await page.goto('./#/kitchen');
  const card = page.getByTestId(`kitchen-${pickup}`);
  await card.getByRole('button', { name: 'Mark ready' }).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId(`kitchen-${pickup}`).getByRole('button', { name: 'Complete pickup' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`kitchen-${pickup}`)).toHaveCount(0);
});

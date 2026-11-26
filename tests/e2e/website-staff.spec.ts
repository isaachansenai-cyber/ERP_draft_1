// W4 staff side of the public website (BUILD_PLAN §5.3, §3) on the built app
// (demo database): web orders in the kitchen and Settings → Website.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
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

/** A website visitor: the public anon key, no sign-in. */
const visitor = () => createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false } });

async function placeWebOrder(locationId: string, itemId: string, name: string) {
  const v = visitor();
  const slots = await v.rpc('web_get_pickup_slots', {
    p_location_id: locationId,
    p_lines: [{ item_id: itemId, quantity: 1 }],
  });
  const slot = (slots.data.slots as Array<{ pickup_at: string; available: boolean }>).find((s) => s.available)!;
  const placed = await v.rpc('web_place_order', {
    p_request_key: crypto.randomUUID(),
    p_location_id: locationId,
    p_lines: [{ item_id: itemId, quantity: 1 }],
    p_contact: { name, phone: '801-555-4400', email: `${name.toLowerCase()}@example.com` },
    p_pickup_at: slot.pickup_at,
  });
  expect(placed.error).toBeNull();
  return placed.data as { pickup_code: string; requested_pickup_at: string };
}

test('a web order for tomorrow waits in the Scheduled lane with its pickup and start-by times', async ({ page }) => {
  // Tacos al Pastor marinate overnight: the earliest slot is 12:15 on a later day.
  const order = await placeWebOrder('LOC-SLC', 'FG-002', 'Rosa');
  await signIn(page, 'DEMO-LOC-SLC-EMP-1');
  await page.getByRole('link', { name: 'Kitchen' }).click();

  const lane = page.getByTestId('scheduled-lane');
  const card = lane.getByTestId(`kitchen-${order.pickup_code}`);
  await expect(card).toBeVisible();
  await expect(card.getByText('Web order')).toBeVisible();
  await expect(card.getByText('· Rosa')).toBeVisible();
  const schedule = card.getByTestId(`schedule-${order.pickup_code}`);
  await expect(schedule).toContainText(/Pickup \w{3}, \w{3} \d{1,2}, 12:15 PM/);
  await expect(schedule).toContainText(/start by \w{3}, \w{3} \d{1,2}, 12:00 PM/);
  await expect(schedule).toContainText('Needs prep the day before');
  // Today's columns stay clear of it.
  await expect(
    page.locator('h2', { hasText: 'Accepted (' }).locator('..').getByTestId(`kitchen-${order.pickup_code}`),
  ).toHaveCount(0);
  // Contact details are for managers: the employee's card shows only the pickup name.
  await expect(card).not.toContainText('rosa@example.com');
});

test('the owner edits website settings, hours, cook times and allergen notes; confirmations stay visible', async ({
  page,
}) => {
  await signIn(page, 'DEMO-OWNER');
  await page.goto('./#/settings/website');
  await expect(page.getByRole('heading', { name: 'Online ordering by location' })).toBeVisible();

  // Ordering limits per location.
  const sfo = page.getByRole('form', { name: 'Online ordering at Spanish Fork' });
  await expect(sfo.getByText('Taking orders')).toBeVisible();
  await sfo.getByLabel('Orders per 15-min slot').fill('5');
  await sfo.getByRole('button', { name: 'Save' }).click();
  await expect(sfo.getByText('Saved for Spanish Fork.')).toBeVisible();
  expect(await query(`select orders_per_slot from public.web_ordering_settings where location_id = 'LOC-SFO'`)).toEqual(
    [{ orders_per_slot: 5 }],
  );

  // Opening hours: close Provo on Sundays.
  const hours = page.getByRole('form', { name: 'Opening hours at Provo' });
  await hours.getByLabel('Open on Sunday').uncheck();
  await hours.getByRole('button', { name: 'Save hours' }).click();
  await expect(hours.getByText('Hours saved for Provo.')).toBeVisible();
  const locations = await visitor().rpc('web_get_locations');
  const provo = (locations.data as Array<{ location_id: string; hours: Array<{ weekday: number }> }>).find(
    (l) => l.location_id === 'LOC-PRO',
  )!;
  expect(provo.hours.map((h) => h.weekday)).toEqual([1, 2, 3, 4, 5, 6]);

  // Cook time for a dish.
  const cook = page.getByRole('form', { name: 'Cook time for Brazilian Chicken Strogonoff' });
  await cook.getByLabel('Cook minutes on pickup day').fill('30');
  await cook.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Cook time saved.')).toBeVisible();
  expect(await query(`select prep_minutes from public.items where item_id = 'FG-001'`)).toEqual([{ prep_minutes: 30 }]);

  // Publishing a reviewed allergen note; blank country is allowed for a sauce.
  const khorkhog = page.getByRole('form', { name: 'Website text for Mongolian Khorkhog' });
  await expect(khorkhog.getByText('Allergen note not reviewed')).toBeVisible();
  await khorkhog.getByRole('checkbox', { name: /I have checked this allergen note/ }).check();
  await khorkhog.getByRole('button', { name: 'Save' }).click();
  await expect(khorkhog.getByText('Website text saved.')).toBeVisible();
  const menu = await visitor().rpc('web_get_menu', { p_location_id: 'LOC-PRO' });
  const item = (menu.data.items as Array<{ item_id: string; allergen_note: string | null }>).find(
    (i) => i.item_id === 'FG-005',
  )!;
  expect(item.allergen_note).toMatch(/No dairy, wheat or nut ingredients/);
  const sauce = page.getByRole('form', { name: 'Website text for Demo bottled barbecue sauce 250 mL' });
  await sauce.getByRole('button', { name: 'Save' }).click();
  await expect(sauce.getByText('Website text saved.')).toBeVisible();

  // Put the demo values back for any later test.
  await query(`update public.web_ordering_settings set orders_per_slot = 4 where location_id = 'LOC-SFO'`);
  await query(`insert into public.location_opening_hours (location_id, weekday, opens_at, closes_at)
               values ('LOC-PRO', 7, '12:00', '20:00') on conflict do nothing`);
  await query(`update public.items set prep_minutes = 25 where item_id = 'FG-001'`);

  // The new gate is listed in Pilot setup.
  await page.goto('./#/settings/setup');
  await expect(page.getByText('Website ordering ready').first()).toBeVisible();
});

test('managers can see the Website tab but not change it', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/settings/website');
  await expect(page.getByText('Only the owner can change the website settings.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

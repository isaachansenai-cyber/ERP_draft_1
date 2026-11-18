// Inventory stock chart, the manager's "Needs reordering" card and session
// handling on shared logins (ADR 0033, 0034), on the built app (demo database).
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

/** Set a reorder point and return a function that restores the previous settings row. */
async function withReorderPoint(locationId: string, itemId: string, rop: string): Promise<() => Promise<void>> {
  const [prev] = await query<{ reorder_applicable: boolean; reorder_point_base: string | null }>(
    `select reorder_applicable, reorder_point_base::text from public.location_item_settings where location_id = $1 and item_id = $2`,
    [locationId, itemId],
  );
  await query(
    `insert into public.location_item_settings (location_id, item_id, reorder_applicable, reorder_point_base, provenance)
     values ($1, $2, true, $3, 'synthetic_demo')
     on conflict (location_id, item_id) do update set reorder_applicable = true, reorder_point_base = excluded.reorder_point_base`,
    [locationId, itemId, rop],
  );
  return async () => {
    if (prev)
      await query(
        `update public.location_item_settings set reorder_applicable = $3, reorder_point_base = $4 where location_id = $1 and item_id = $2`,
        [locationId, itemId, prev.reorder_applicable, prev.reorder_point_base],
      );
    else
      await query(`delete from public.location_item_settings where location_id = $1 and item_id = $2`, [
        locationId,
        itemId,
      ]);
  };
}

test('a manager opens an item chart from its stock row and switches between 7, 30 and 90 days', async ({ page }) => {
  const restore = await withReorderPoint('LOC-PRO', 'ING-001', '1234.5');
  try {
    await signIn(page, 'DEMO-LOC-PRO-MAN-1');
    await page.goto('./#/inventory');
    const [{ name }] = await query<{ name: string }>(`select name from public.items where item_id = 'ING-001'`);
    await page.getByRole('button', { name: `Chart for ${name}`, exact: true }).click();
    const panel = page.getByTestId('history-ING-001');
    await expect(panel.getByTestId('stock-history-svg')).toBeVisible();
    await expect(panel.getByTestId('reorder-line')).toBeAttached();
    await expect(panel.getByTestId('history-rop')).toContainText('1234.5 g');
    await expect(panel.getByTestId('history-scope')).toContainText('demo operational');
    await expect(panel.getByTestId('history-suggested')).not.toBeEmpty();
    await expect(panel.getByTestId('history-next-delivery')).not.toBeEmpty();
    await expect(page).toHaveURL(/chart=ING-001/);

    await panel.getByText('Show as table').click();
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(30);
    await panel.getByRole('button', { name: '7 days' }).click();
    await expect(rows).toHaveCount(7);
    await expect(panel.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: '90 days' }).click();
    await expect(rows).toHaveCount(90);

    await page.getByRole('button', { name: `Hide chart for ${name}`, exact: true }).click();
    await expect(panel).toHaveCount(0);
  } finally {
    await restore();
  }
});

test('the location manager sees "Needs reordering" when stock drops below the reorder point, and it clears after a delivery', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const [item] = await query<{ item_id: string; supplier_item_id: string; supplier_id: string; available: string }>(
    `select i.item_id, si.supplier_item_id, si.supplier_id, private.available_qty('LOC-SFO', i.item_id)::text available
       from public.items i join public.supplier_items si on si.item_id = i.item_id and si.is_primary and si.archived_at is null
      where i.is_purchasable and not i.requires_use_by and si.pack_base_qty > 1
      order by i.item_id limit 1`,
  );
  const restore = await withReorderPoint('LOC-SFO', item!.item_id, String(Number(item!.available) + 1));
  try {
    await signIn(page, 'DEMO-LOC-SFO-MAN-1');
    const card = page.getByTestId('reorder-alerts');
    await expect(card.getByTestId(`reorder-${item!.item_id}`)).toBeVisible();
    await expect(card).toContainText('below reorder point');

    // A delivery: one pack received through the normal purchasing functions.
    const c = credentials('DEMO-LOC-SFO-MAN-1');
    const api = await apiSignIn(stack, c.email, c.password);
    const po = (
      await rpc(api, 'create_purchase_order', {
        p_request_key: crypto.randomUUID(),
        p_location_id: 'LOC-SFO',
        p_supplier_id: item!.supplier_id,
        p_expected_date: null,
        p_lines: [{ supplier_item_id: item!.supplier_item_id, packs: 1 }],
      })
    ).data as { po_id: string; version: number };
    const sub = (
      await rpc(api, 'submit_purchase_order', {
        p_request_key: crypto.randomUUID(),
        p_po_id: po.po_id,
        p_expected_version: po.version,
      })
    ).data as { version: number };
    const [line] = await query<{ po_line_id: string }>(
      `select po_line_id from public.purchase_order_lines where po_id = $1`,
      [po.po_id],
    );
    const received = await rpc(api, 'receive_purchase_order', {
      p_request_key: crypto.randomUUID(),
      p_po_id: po.po_id,
      p_expected_version: sub.version,
      p_packing_slip_ref: null,
      p_lines: [{ po_line_id: line!.po_line_id, packs: 1 }],
    });
    expect(received.code).toBeNull();

    await page.reload();
    await expect(page.getByTestId('reorder-alerts')).toBeVisible();
    await expect(page.getByTestId(`reorder-${item!.item_id}`)).toHaveCount(0);
  } finally {
    await restore();
  }
});

test('the owner and employees get no reorder card', async ({ browser }) => {
  const restore = await withReorderPoint('LOC-PRO', 'ING-001', '999999999');
  try {
    for (const who of ['DEMO-OWNER', 'DEMO-LOC-PRO-EMP-1']) {
      const page = await (await browser.newContext()).newPage();
      await signIn(page, who);
      await page.locator('#location-select').selectOption('LOC-PRO');
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await expect(page.getByTestId('reorder-alerts')).toHaveCount(0);
      await page.context().close();
    }
    // The PRO manager does get it, for the same item.
    const page = await (await browser.newContext()).newPage();
    await signIn(page, 'DEMO-LOC-PRO-MAN-1');
    await expect(page.getByTestId('reorder-ING-001')).toBeVisible();
    await page.context().close();
  } finally {
    await restore();
  }
});

test('signing out on one device leaves the same account signed in on another', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, 'DEMO-LOC-SLC-EMP-2');
  await signIn(b, 'DEMO-LOC-SLC-EMP-2');
  await a.getByRole('button', { name: 'Sign out' }).click();
  await expect(a.getByLabel('Email')).toBeVisible();
  await b.goto('./#/pos');
  await expect(b.getByRole('heading', { name: /Staff POS/ })).toBeVisible();
  await expect(b.getByRole('button', { name: /barbecue sauce/i }).first()).toBeVisible();
  await a.context().close();
  await b.context().close();
});

test('a session ended on the server sends the user to sign in with an explanation', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-SLC-EMP-1');
  // End every session for this account on the server, then make this tab's
  // access token unusable so its next request is refused (as after expiry).
  const c = credentials('DEMO-LOC-SLC-EMP-1');
  const other = await apiSignIn(stack, c.email, c.password);
  await other.auth.signOut({ scope: 'global' });
  await page.evaluate(() => {
    const k = Object.keys(window.localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'))!;
    const s = JSON.parse(window.localStorage.getItem(k)!);
    s.access_token = 'invalid.token.value';
    s.expires_at = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByText('Your session ended')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByText(/do not have permission/)).toHaveCount(0);
});

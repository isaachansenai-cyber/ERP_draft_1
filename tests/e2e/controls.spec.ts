// Milestone 3 UI flows on the built app (demo database): waste reports, counts,
// transfers, retail return with restock, and supplier invoice matching and payment.
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
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

async function newPage(browser: Browser, employeeId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, employeeId);
  return page;
}

const api = (employeeId: string) => {
  const c = credentials(employeeId);
  return apiSignIn(stack, c.email, c.password);
};

async function query<T = Record<string, string>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

const onHand = async (loc: string, item: string) =>
  Number(
    (
      await query(
        `select coalesce(sum(on_hand),0)::text q from public.stock_balances where location_id = $1 and item_id = $2`,
        [loc, item],
      )
    )[0]!.q,
  );

test('an employee reports waste; the manager posts it and stock falls by exactly that amount', async ({
  page,
  browser,
}) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-1');
  await page.goto('./#/inventory/waste');
  await page.getByLabel('Item 1').selectOption('ING-039');
  await page.getByLabel('Quantity (base unit)').fill('12');
  await page.getByLabel('Reason').selectOption('SPOILAGE');
  const before = await onHand('LOC-PRO', 'ING-039');
  await page.getByRole('button', { name: 'Submit waste report' }).click();
  await expect(page.getByText('Waste report submitted for manager review.')).toBeVisible();
  await expect(page.getByText('submitted', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/cost \$/)).toHaveCount(0); // employees never see costs
  expect(await onHand('LOC-PRO', 'ING-039')).toBe(before);

  const m = await newPage(browser, 'DEMO-LOC-PRO-MAN-1');
  await m.goto('./#/inventory/waste');
  await m.getByRole('button', { name: 'Post waste (removes stock)' }).first().click();
  await expect(m.getByText(/WST-PRO-\d+ posted/).first()).toBeVisible();
  await expect(m.getByText(/cost \$/).first()).toBeVisible(); // managers see the posted cost
  expect(await onHand('LOC-PRO', 'ING-039')).toBe(before - 12);
});

test('a manager counts one item and posts a reason-coded adjustment', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  const before = await onHand('LOC-PRO', 'ING-040');
  await page.goto('./#/inventory/counts');
  await page.getByLabel('Items to count').fill('ING-040');
  await page.getByRole('button', { name: 'Start count (snapshot now)' }).click();
  await expect(page.getByText('Count started.')).toBeVisible();
  await page
    .getByLabel(/Counted ING-040/)
    .first()
    .fill(String(before - 7));
  await page.getByRole('button', { name: /Post count/ }).click();
  await expect(page.getByText(/posted: 1 line\(s\) adjusted/)).toBeVisible();
  expect(await onHand('LOC-PRO', 'ING-040')).toBe(before - 7);
  const [mv] = await query(
    `select reason_code, quantity::text q from public.inventory_movements where movement_type = 'count_adjustment' and item_id = 'ING-040' order by movement_no desc limit 1`,
  );
  expect(mv).toEqual({ reason_code: 'COUNT_VARIANCE', q: '-7.000000' });
});

test('a transfer is dispatched by the source manager and received with a reason-coded loss by the destination', async ({
  page,
  browser,
}) => {
  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  const srcBefore = await onHand('LOC-PRO', 'ING-037');
  const dstBefore = await onHand('LOC-SFO', 'ING-037');
  await page.goto('./#/inventory/transfers');
  await page.getByLabel('Destination').selectOption('LOC-SFO');
  await page.getByLabel('Item 1').selectOption('ING-037');
  await page.getByLabel('Quantity (base unit)').fill('500');
  await page.getByRole('button', { name: 'Create draft transfer' }).click();
  await expect(page.getByText('Draft transfer created.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Dispatch (stock leaves now)' }).first().click();
  await expect(page.getByText('dispatched', { exact: true }).first()).toBeVisible();
  expect(await onHand('LOC-PRO', 'ING-037')).toBe(srcBefore - 500);

  const s = await newPage(browser, 'DEMO-LOC-SFO-MAN-1');
  await s.goto('./#/inventory/transfers');
  await s.getByLabel('Received').first().fill('450');
  await s.getByLabel('Lost').first().fill('50');
  await s.getByLabel('Loss reason').first().selectOption('TRANSIT_LOSS');
  await s.getByRole('button', { name: 'Record receipt' }).first().click();
  await expect(s.getByText('received', { exact: true }).first()).toBeVisible();
  expect(await onHand('LOC-SFO', 'ING-037')).toBe(dstBefore + 450);
  const [line] = await query(
    `select l.received_qty::text r, l.lost_qty::text lost, l.in_transit_qty::text t from public.transfer_lines l
       join public.transfers t using (transfer_id) where l.item_id = 'ING-037' order by t.created_at desc limit 1`,
  );
  expect(line).toEqual({ r: '450.000000', lost: '50.000000', t: '0.000000' });
});

test('a retail bottle is returned with a simulated refund, then restocked once at its original cost', async ({
  page,
}) => {
  const mgr = await api('DEMO-LOC-PRO-MAN-1');
  const a = await rpc(mgr, 'accept_order', {
    p_request_key: crypto.randomUUID(),
    p_location_id: 'LOC-PRO',
    p_lines: [{ item_id: 'RET-002', quantity: 2 }],
  });
  const ready = await rpc(mgr, 'mark_order_ready', {
    p_request_key: crypto.randomUUID(),
    p_order_id: a.data.order_id,
    p_expected_version: a.data.version,
  });
  await rpc(mgr, 'record_tender', {
    p_request_key: crypto.randomUUID(),
    p_order_id: a.data.order_id,
    p_amount_cents: a.data.total_cents,
    p_method: 'cash',
  });
  const done = await rpc(mgr, 'complete_order_pickup', {
    p_request_key: crypto.randomUUID(),
    p_order_id: a.data.order_id,
    p_expected_version: ready.data.version,
  });
  expect(done.data.status).toBe('completed');

  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/returns');
  await page.getByLabel('Order number or pickup code').fill(a.data.pickup_code);
  await page.getByRole('button', { name: 'Find order' }).click();
  await expect(page.getByText(a.data.order_number)).toBeVisible();
  await page.getByRole('tab', { name: 'Retail return' }).click();
  await page.getByRole('textbox', { name: 'Units' }).fill('1');
  await page.getByLabel('Reason').selectOption('CUSTOMER_COMPLAINT');
  await page.getByRole('button', { name: 'Record return' }).click();
  await expect(page.getByText('Return recorded; goods are in custody.')).toBeVisible();
  const before = await onHand('LOC-PRO', 'RET-002');

  await page.getByRole('link', { name: 'Returned goods' }).click();
  await page.getByRole('button', { name: 'Restock at original cost' }).first().click();
  await expect(page.getByText('Decision recorded.')).toBeVisible();
  expect(await onHand('LOC-PRO', 'RET-002')).toBe(before + 1);
  const [rev] = await query(`select count(*)::text n from public.cogs_reversals where order_id = $1`, [
    a.data.order_id,
  ]);
  expect(rev!.n).toBe('1');
  const [f] = await query(`select refund_mode, amount_cents::text from public.refunds where order_id = $1`, [
    a.data.order_id,
  ]);
  expect(f!.refund_mode).toBe('SIMULATED');
});

test('a supplier invoice above the receipt price is flagged, accepted, partly paid; a duplicate number is refused', async ({
  page,
}) => {
  const mgr = await api('DEMO-LOC-PRO-MAN-1');
  const [si] = await query(
    `select supplier_item_id, supplier_id from public.supplier_items where item_id = 'ING-010' and is_primary`,
  );
  const po = await rpc(mgr, 'create_purchase_order', {
    p_request_key: crypto.randomUUID(),
    p_location_id: 'LOC-PRO',
    p_supplier_id: si!.supplier_id,
    p_expected_date: null,
    p_lines: [{ supplier_item_id: si!.supplier_item_id, packs: 1 }],
  });
  const sub = await rpc(mgr, 'submit_purchase_order', {
    p_request_key: crypto.randomUUID(),
    p_po_id: po.data.po_id,
    p_expected_version: po.data.version,
  });
  const [pol] = await query(`select po_line_id from public.purchase_order_lines where po_id = $1`, [po.data.po_id]);
  const rcv = await rpc(mgr, 'receive_purchase_order', {
    p_request_key: crypto.randomUUID(),
    p_po_id: po.data.po_id,
    p_expected_version: sub.data.version,
    p_packing_slip_ref: null,
    p_lines: [{ po_line_id: pol!.po_line_id, packs: 1 }],
  });
  expect(rcv.code).toBeNull();
  const [rl] = await query(
    `select receipt_number, unit_cost::text from public.receipt_lines l join public.receipts r using (receipt_id) where r.receipt_id = $1`,
    [rcv.data.receipt_id],
  );
  const movementsBefore = (await query(`select count(*)::text n from public.inventory_movements`))[0]!.n;

  await signIn(page, 'DEMO-LOC-PRO-MAN-1');
  await page.goto('./#/invoices');
  await page.getByRole('button', { name: 'Enter invoice' }).click();
  await page.getByLabel('Supplier', { exact: true }).selectOption(si!.supplier_id);
  await page.getByLabel('Invoice number').fill('E2E-INV-1');
  await page.getByLabel(new RegExp(`Invoiced quantity ${rl!.receipt_number} ING-010`)).fill('10000');
  await page
    .getByLabel(new RegExp(`Invoice unit price ${rl!.receipt_number} ING-010`))
    .fill((Number(rl!.unit_cost) * 1.1).toFixed(8));
  await page.getByRole('button', { name: /Save invoice/ }).click();
  await expect(page.getByText('Invoice saved. Stock and costs are unchanged.')).toBeVisible();
  expect((await query(`select count(*)::text n from public.inventory_movements`))[0]!.n).toBe(movementsBefore);

  const row = page.getByRole('row', { name: /E2E-INV-1/ });
  await expect(row.getByText('discrepancy')).toBeVisible();
  await row.getByRole('button', { name: 'Open' }).click();
  const detail = page.getByTestId('invoice-detail');
  await expect(detail.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  await detail.getByLabel('Why it is accepted').fill('Price rise confirmed with supplier');
  await detail.getByRole('button', { name: 'Accept discrepancy' }).click();
  await expect(detail.getByText('Discrepancy accepted: Price rise confirmed with supplier')).toBeVisible();
  await detail.getByLabel('Amount ($)').first().fill('10.00');
  await detail.getByRole('button', { name: 'Record payment' }).click();
  await expect(detail.getByText('Payment recorded.')).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E-INV-1/ }).getByText('partially paid')).toBeVisible();

  // The same number again (different case and spacing) is refused.
  await page.getByLabel('Invoice number').fill('  e2e-inv-1 ');
  await page.getByLabel(new RegExp(`Invoiced quantity ${rl!.receipt_number} ING-010`)).fill('1');
  await page.getByLabel(new RegExp(`Invoice unit price ${rl!.receipt_number} ING-010`)).fill(rl!.unit_cost!);
  await page.getByRole('button', { name: /Save invoice/ }).click();
  await expect(page.getByText(/already entered/)).toBeVisible();
});

test('employees do not see supplier invoices and cannot open them by URL', async ({ page }) => {
  await signIn(page, 'DEMO-LOC-PRO-EMP-2');
  await expect(page.getByRole('link', { name: 'Supplier invoices' })).toHaveCount(0);
  await page.goto('./#/invoices');
  await expect(page.getByText('Supplier invoices and payments are available to managers and the owner.')).toBeVisible();
});

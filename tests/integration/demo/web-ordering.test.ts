// Public pickup website (CLAUDE.md D12, ADR 0040) in the DEMO database, through
// the real API as anonymous website visitors: menu and live availability, pickup
// slots, placement through the shared acceptance core, the simulated tender,
// retries, slot capacity, rate limits, sold out and back again, a web-vs-POS race
// for the last unit, and what staff and visitors may (not) see.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { anonClient, localStack, rpc, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const creds = inject('demoCredentials');
const as = (id: string) => signIn(stack, creds[id]!.email, creds[id]!.password);

const SLC = 'LOC-SLC';
const SFO = 'LOC-SFO';

async function visitor(): Promise<SupabaseClient> {
  const client = anonClient(stack);
  const { error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  return client;
}

const sql = <T>(text: string, params: unknown[] = []) =>
  withDb(stack.dbUrl, async (db) => (await db.query(text, params)).rows as T[]);

interface MenuItem {
  item_id: string;
  item_type: string;
  price_cents: number | null;
  available: boolean;
  max_orderable: number;
  allergen_note: string | null;
  country: string | null;
}
interface Slot {
  pickup_at: string;
  available: boolean;
}
interface WebOrder {
  ok: true;
  order_number: string;
  pickup_code: string;
  web_token: string;
  status: string;
  requested_pickup_at: string;
  total_cents: number;
  paid_cents: number;
  balance_due_cents: number;
  payment: string;
  lines: Array<{ item_id: string; quantity: number }>;
  replayed?: boolean;
}

const contact = (n = 1) => ({
  name: `Guest ${n}`,
  phone: `801-555-${String(1000 + n)}`,
  email: `guest${n}@example.com`,
});
let contactNo = 0;
const nextContact = () => contact(++contactNo);

async function slots(v: SupabaseClient, location: string, items: string[]): Promise<Slot[]> {
  const r = await rpc(v, 'web_get_pickup_slots', {
    p_location_id: location,
    p_lines: items.map((item_id) => ({ item_id, quantity: 1 })),
  });
  expect(r.code).toBeNull();
  return r.data.slots as Slot[];
}

async function firstOpenSlot(v: SupabaseClient, location: string, items: string[]): Promise<string> {
  const s = (await slots(v, location, items)).find((x) => x.available);
  if (!s) throw new Error(`no open slot at ${location} for ${items.join(',')}`);
  return s.pickup_at;
}

async function place(
  v: SupabaseClient,
  location: string,
  lines: Array<{ item_id: string; quantity: number }>,
  extra: Record<string, unknown> = {},
) {
  const pickup =
    (extra.p_pickup_at as string | undefined) ??
    (await firstOpenSlot(
      v,
      location,
      lines.map((l) => l.item_id),
    ));
  return rpc(v, 'web_place_order', {
    p_request_key: randomUUID(),
    p_location_id: location,
    p_lines: lines,
    p_contact: nextContact(),
    p_pickup_at: pickup,
    ...extra,
  });
}

const available = async (location: string, item: string) =>
  Number((await sql<{ q: string }>('select private.available_qty($1, $2)::text q', [location, item]))[0]!.q);

// Every order a test creates is cancelled at the end so later suites see the
// demo stock as the seed left it.
const created: string[] = [];
afterAll(async () => {
  const managers: Record<string, string> = {
    'LOC-PRO': 'DEMO-LOC-PRO-MAN-1',
    'LOC-SFO': 'DEMO-LOC-SFO-MAN-1',
    'LOC-SLC': 'DEMO-LOC-SLC-MAN-1',
  };
  const open = await sql<{ order_id: string; location_id: string; version: number }>(
    `select order_id, location_id, version from public.orders where order_id = any($1::uuid[]) and status = 'accepted'`,
    [created],
  );
  for (const o of open) {
    const m = await as(managers[o.location_id]!);
    const r = await rpc(m, 'cancel_order', {
      p_request_key: randomUUID(),
      p_order_id: o.order_id,
      p_expected_version: o.version,
      p_reason_code: 'OTHER',
      p_note: 'test cleanup (no-show)',
      p_refund_method: 'card_external',
    });
    expect(r.code).toBeNull();
  }
});
describe('menu and locations for an anonymous visitor', () => {
  it('lists the three locations as open, 12:00–20:00 every day', async () => {
    const v = await visitor();
    const r = await rpc(v, 'web_get_locations');
    expect(r.code).toBeNull();
    expect(r.data).toHaveLength(3);
    for (const l of r.data as Array<{ ordering_open: boolean; hours: unknown[] }>) {
      expect(l.ordering_open).toBe(true);
      expect(l.hours).toHaveLength(7);
      expect(l.hours[0]).toEqual({ weekday: 1, opens_at: '12:00', closes_at: '20:00' });
    }
  });

  it('shows the 5 dishes and 2 sauces with prices and live availability, but no costs or exact stock', async () => {
    const v = await visitor();
    const r = await rpc(v, 'web_get_menu', { p_location_id: SLC });
    expect(r.code).toBeNull();
    expect(r.data).toMatchObject({ location_id: SLC, ordering_open: true, status_reason: null, max_per_line: 10 });
    const items = r.data.items as MenuItem[];
    expect(items.map((i) => i.item_id)).toEqual([
      'FG-001',
      'FG-002',
      'FG-003',
      'FG-004',
      'FG-005',
      'RET-001',
      'RET-002',
    ]);
    expect(items.find((i) => i.item_id === 'FG-001')).toMatchObject({
      price_cents: 1599,
      country: 'Brazil',
      available: true,
    });
    for (const i of items) {
      expect(i.max_orderable).toBeLessThanOrEqual(10);
      expect(i.allergen_note).toBeNull(); // drafts are not published until the owner reviews them
      expect(Object.keys(i).sort()).toEqual(
        [
          'allergen_note',
          'available',
          'country',
          'description',
          'image_path',
          'item_id',
          'item_type',
          'max_orderable',
          'name',
          'prep_lead_days',
          'prep_minutes',
          'price_cents',
        ].sort(),
      );
    }
  });

  it('reads no ERP tables directly and is refused by staff functions', async () => {
    const v = await visitor();
    for (const table of ['items', 'orders', 'customers', 'web_order_contacts', 'recipe_components', 'stock_balances']) {
      const { data, error } = await v.from(table).select('*').limit(5);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    expect((await rpc(v, 'list_stock_items', { p_location_id: SLC })).code).toBe('unauthorized');
    expect((await rpc(v, 'accept_order', { p_request_key: randomUUID(), p_location_id: SLC, p_lines: [] })).code).toBe(
      'unauthorized',
    );
    expect((await rpc(v, 'get_sales_summary', { p_from: '2026-01-01', p_to: '2026-12-31' })).code).toBe('unauthorized');
  });
});

describe('pickup slots', () => {
  it('an overnight dish (Tacos al Pastor) is first offered at 12:15 on a later day', async () => {
    const v = await visitor();
    const first = new Date((await slots(v, SLC, ['FG-002']))[0]!.pickup_at);
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(first);
    expect(local).toBe('12:15');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(first) > today).toBe(true);
  });
});

describe('placing an order', () => {
  it('accepts through the shared core: reserves ingredients, records the simulated payment, and the kitchen sees it', async () => {
    const v = await visitor();
    const chickenBefore = await available(SLC, 'ING-001');
    const r = await place(v, SLC, [
      { item_id: 'FG-001', quantity: 2 },
      { item_id: 'RET-001', quantity: 1 },
    ]);
    expect(r.code).toBeNull();
    const o = r.data as WebOrder;
    expect(o).toMatchObject({ ok: true, status: 'accepted', payment: 'simulated', balance_due_cents: 0 });
    expect(o.paid_cents).toBe(o.total_cents);
    expect(o.pickup_code).toMatch(/^SLC-\d{4}$/);
    expect(chickenBefore - (await available(SLC, 'ING-001'))).toBe(360); // 2 × 180 g reserved

    const [row] = await sql<{
      order_id: string;
      channel: string;
      accepted_by: string;
      tender_type: string;
      recorded_by: string;
      email: string;
    }>(
      `select o.order_id, o.channel, o.accepted_by, t.tender_type, t.recorded_by, c.email
         from public.orders o join public.tenders t using (order_id) join public.web_order_contacts c using (order_id)
        where o.web_token = $1`,
      [o.web_token],
    );
    created.push(row!.order_id);
    expect(row).toMatchObject({
      channel: 'web',
      accepted_by: 'EMP-WEB',
      tender_type: 'SIMULATED',
      recorded_by: 'EMP-WEB',
    });

    // Kitchen and staff at the location see the order; contact details are for managers only.
    const emp = await as('DEMO-LOC-SLC-EMP-1');
    const seen = await emp
      .from('orders')
      .select('order_id, channel, requested_pickup_at')
      .eq('order_id', row!.order_id);
    expect(seen.data).toEqual([{ order_id: row!.order_id, channel: 'web', requested_pickup_at: expect.any(String) }]);
    expect((await emp.from('web_order_contacts').select('*').eq('order_id', row!.order_id)).data).toEqual([]);
    const mgr = await as('DEMO-LOC-SLC-MAN-1');
    expect((await mgr.from('web_order_contacts').select('email').eq('order_id', row!.order_id)).data).toEqual([
      { email: row!.email },
    ]);
    const otherMgr = await as('DEMO-LOC-SFO-MAN-1');
    expect((await otherMgr.from('web_order_contacts').select('email').eq('order_id', row!.order_id)).data).toEqual([]);

    // The confirmation page reads the order back by its token only.
    const back = await rpc(await visitor(), 'web_get_order', { p_web_token: o.web_token });
    expect(back.data).toMatchObject({ order_number: o.order_number, status: 'accepted', total_cents: o.total_cents });
    expect(JSON.stringify(back.data)).not.toContain(row!.email);
    expect((await rpc(v, 'web_get_order', { p_web_token: randomUUID() })).code).toBe('not_found');
  });

  it('a retry with the same key returns the same order and writes nothing twice (AC07); a lost response can be checked (AC29)', async () => {
    const v = await visitor();
    const args = {
      p_request_key: randomUUID(),
      p_location_id: SLC,
      p_lines: [{ item_id: 'RET-002', quantity: 1 }],
      p_contact: nextContact(),
      p_pickup_at: await firstOpenSlot(v, SLC, ['RET-002']),
    };
    const count = async () =>
      (
        await sql<{ o: number; t: number; c: number }>(
          `select (select count(*) from public.orders)::int o, (select count(*) from public.tenders)::int t,
                  (select count(*) from public.web_order_contacts)::int c`,
        )
      )[0]!;
    const first = await rpc(v, 'web_place_order', args);
    expect(first.code).toBeNull();
    const after = await count();
    const second = await rpc(v, 'web_place_order', args);
    expect(second.data).toEqual({ ...first.data, replayed: true });
    expect(await count()).toEqual(after);
    const check = await rpc(v, 'web_get_request_result', { p_request_key: args.p_request_key });
    expect(check.data).toMatchObject({ status: 'committed', rpc_name: 'web_place_order' });
    // Another visitor cannot see this visitor's request.
    expect((await rpc(await visitor(), 'web_get_request_result', { p_request_key: args.p_request_key })).data).toEqual({
      status: 'not_found',
    });
    created.push(
      (
        await sql<{ order_id: string }>('select order_id from public.orders where web_token = $1', [
          first.data.web_token,
        ])
      )[0]!.order_id,
    );
  });

  it('rejects bad input with stable codes', async () => {
    const v = await visitor();
    const slot = await firstOpenSlot(v, SLC, ['RET-001']);
    const base = { p_location_id: SLC, p_lines: [{ item_id: 'RET-001', quantity: 1 }], p_pickup_at: slot };
    const tryWith = async (over: Record<string, unknown>) =>
      (await rpc(v, 'web_place_order', { p_request_key: randomUUID(), p_contact: contact(90), ...base, ...over })).code;
    expect(await tryWith({ p_contact: { ...contact(90), email: 'not-an-email' } })).toBe('validation:contact_email');
    expect(await tryWith({ p_contact: { ...contact(90), phone: '12' } })).toBe('validation:contact_phone');
    expect(await tryWith({ p_contact: { ...contact(90), name: '' } })).toBe('validation:contact_name');
    expect(await tryWith({ p_lines: [{ item_id: 'RET-001', quantity: 11 }] })).toBe('validation:quantity');
    expect(await tryWith({ p_lines: [{ item_id: 'RET-001', quantity: 1.5 }] })).toBe('validation:quantity');
    expect(await tryWith({ p_lines: [{ item_id: 'ING-001', quantity: 1 }] })).toBe('validation:item_not_offered');
    expect(await tryWith({ p_note: 'x'.repeat(301) })).toBe('validation:note');
    expect(await tryWith({ p_pickup_at: '2020-01-01T19:00:00Z' })).toBe('slot_unavailable');
    // An overnight dish cannot be booked into a same-day slot.
    const sameDay = (await slots(v, SLC, ['RET-001']))[0]!.pickup_at;
    const overnightFirst = (await slots(v, SLC, ['FG-002']))[0]!.pickup_at;
    if (sameDay < overnightFirst) {
      expect(await tryWith({ p_lines: [{ item_id: 'FG-002', quantity: 1 }], p_pickup_at: sameDay })).toBe(
        'slot_unavailable',
      );
    }
  });
});

describe('capacity and limits', () => {
  it('a full slot is shown as unavailable and refused', async () => {
    await sql(`update public.web_ordering_settings set orders_per_slot = 1 where location_id = $1`, [SFO]);
    try {
      const a = await visitor();
      const slot = await firstOpenSlot(a, SFO, ['RET-001']);
      const first = await place(a, SFO, [{ item_id: 'RET-001', quantity: 1 }], { p_pickup_at: slot });
      expect(first.code).toBeNull();
      created.push(
        (
          await sql<{ order_id: string }>('select order_id from public.orders where web_token = $1', [
            first.data.web_token,
          ])
        )[0]!.order_id,
      );
      const b = await visitor();
      expect((await slots(b, SFO, ['RET-001'])).find((s) => s.pickup_at === slot)).toEqual({
        pickup_at: slot,
        available: false,
      });
      const second = await place(b, SFO, [{ item_id: 'RET-001', quantity: 1 }], { p_pickup_at: slot });
      expect(second.code).toBe('slot_unavailable');
    } finally {
      await sql(`update public.web_ordering_settings set orders_per_slot = 4 where location_id = $1`, [SFO]);
    }
  });

  it('one visitor can hold at most 3 open orders', async () => {
    const v = await visitor();
    for (let i = 0; i < 3; i++) {
      const r = await place(v, SFO, [{ item_id: 'RET-002', quantity: 1 }]);
      expect(r.code).toBeNull();
      created.push(
        (
          await sql<{ order_id: string }>('select order_id from public.orders where web_token = $1', [r.data.web_token])
        )[0]!.order_id,
      );
    }
    expect((await place(v, SFO, [{ item_id: 'RET-002', quantity: 1 }])).code).toBe('rate_limited:open_orders');
  });
});

describe('sold out and back again', () => {
  it('a manager switching a dish off shows it sold out; switching it on makes it orderable again', async () => {
    const v = await visitor();
    const mgr = await as('DEMO-LOC-SLC-MAN-1');
    const setAvailability = async (on: boolean) =>
      expect(
        (
          await rpc(mgr, 'set_menu_availability', {
            p_request_key: randomUUID(),
            p_location_id: SLC,
            p_item_id: 'FG-003',
            p_available: on,
            p_reason: on ? null : 'Out of gochujang',
          })
        ).code,
      ).toBeNull();
    const fg003 = async () =>
      ((await rpc(v, 'web_get_menu', { p_location_id: SLC })).data.items as MenuItem[]).find(
        (i) => i.item_id === 'FG-003',
      )!;

    await setAvailability(false);
    expect(await fg003()).toMatchObject({ available: false, max_orderable: 0 });
    expect((await place(v, SLC, [{ item_id: 'FG-003', quantity: 1 }])).code).toBe('validation:item_unavailable');
    await setAvailability(true);
    expect(await fg003()).toMatchObject({ available: true });
  });

  it('web and POS race for the last bottle: exactly one wins; cancelling frees it and the menu shows it again', async () => {
    const pos = await as('DEMO-LOC-SLC-EMP-1');
    const left = await available(SLC, 'RET-002');
    expect(left).toBeGreaterThanOrEqual(2);
    const hold = await rpc(pos, 'accept_order', {
      p_request_key: randomUUID(),
      p_location_id: SLC,
      p_lines: [{ item_id: 'RET-002', quantity: left - 1 }],
    });
    expect(hold.code).toBeNull();
    created.push(hold.data.order_id);
    expect(await available(SLC, 'RET-002')).toBe(1);

    const v = await visitor();
    const slot = await firstOpenSlot(v, SLC, ['RET-002']);
    const [web, till] = await Promise.all([
      place(v, SLC, [{ item_id: 'RET-002', quantity: 1 }], { p_pickup_at: slot }),
      rpc(pos, 'accept_order', {
        p_request_key: randomUUID(),
        p_location_id: SLC,
        p_lines: [{ item_id: 'RET-002', quantity: 1 }],
      }),
    ]);
    const outcomes = [web.code, till.code].sort((a, b) => String(a).localeCompare(String(b)));
    expect(outcomes).toEqual(['insufficient_stock', null]);
    if (web.code === null) {
      created.push(
        (
          await sql<{ order_id: string }>('select order_id from public.orders where web_token = $1', [
            web.data.web_token,
          ])
        )[0]!.order_id,
      );
    } else {
      created.push(till.data.order_id);
    }
    expect(await available(SLC, 'RET-002')).toBe(0);
    const menu = async () =>
      ((await rpc(v, 'web_get_menu', { p_location_id: SLC })).data.items as MenuItem[]).find(
        (i) => i.item_id === 'RET-002',
      )!;
    expect(await menu()).toMatchObject({ available: false, max_orderable: 0 });
    expect(
      await sql<{ n: number }>(
        `select count(*)::int n from public.reservation_allocations a join public.orders o using (order_id)
          where o.location_id = $1 and a.item_id = 'RET-002' and a.status = 'active' and o.status = 'cancelled'`,
        [SLC],
      ),
    ).toEqual([{ n: 0 }]);

    // Back in stock: the hold is cancelled before kitchen start, and the website offers it again.
    const [h] = await sql<{ version: number }>('select version from public.orders where order_id = $1', [
      hold.data.order_id,
    ]);
    expect(
      (
        await rpc(pos, 'cancel_order', {
          p_request_key: randomUUID(),
          p_order_id: hold.data.order_id,
          p_expected_version: h!.version,
          p_reason_code: 'OTHER',
          p_note: 'customer changed their mind',
        })
      ).code,
    ).toBeNull(); // no payment recorded and not started: any staff member may cancel
    expect(await available(SLC, 'RET-002')).toBe(left - 1);
    expect(await menu()).toMatchObject({ available: true, max_orderable: Math.min(left - 1, 10) });
  });
});

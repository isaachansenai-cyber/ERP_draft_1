// Owner recipe editing (0025, ADR 0037), supplier edits and manager change
// requests (0026, ADR 0038) and the schema version check (0024, ADR 0036),
// through the real API as signed-in local users in a pilot database.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, code, key, ok, sql, stack, type OrderResult } from './helpers';

const PRO = 'LOC-PRO';
const SFO = 'LOC-SFO';
const DISH = 'FG-005';

interface Line {
  item_id: string;
  unit: string;
  quantity_per_serving: string;
  basis: string;
}
interface Draft {
  recipe_version_id: string;
  version_no: number;
  draft_revision: number;
  lines: Line[];
  replayed?: boolean;
}
interface Recipes {
  can_edit: boolean;
  dishes: Array<{
    dish_id: string;
    active: { recipe_version_id: string; version_no: number; lines: Line[] } | null;
    draft: Draft | null;
    history: Array<{ version_no: number; status: string }>;
  }>;
  ingredients: Array<{ item_id: string }>;
}

const toLines = (lines: Line[]) =>
  lines.map((l) => ({ item_id: l.item_id, quantity_per_serving: l.quantity_per_serving }));

describe('schema version (ADR 0036)', () => {
  it('reports the migration number to signed-in users only', async () => {
    const anon = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false } });
    expect((await anon.rpc('get_schema_version')).error).not.toBeNull();
    expect((await (await as('proEmployee')).rpc('get_schema_version')).data).toBe(26);
  });
});

describe('recipe editing (owner only)', () => {
  // Other suites sell DISH with exact expected quantities; put its recipe back
  // (as a new version) whatever order the files run in.
  let seeded: Array<{ item_id: string; quantity_per_serving: string }> = [];
  beforeAll(async () => {
    seeded = (
      await sql<{ item_id: string; quantity_per_serving: string }>(
        `select c.component_item_id item_id, c.quantity_per_serving::text quantity_per_serving
           from public.recipe_components c join public.recipe_versions v using (recipe_version_id)
          where v.parent_item_id = $1 and v.status = 'active' order by c.line_no`,
        [DISH],
      )
    ).map((r) => ({ item_id: r.item_id, quantity_per_serving: r.quantity_per_serving }));
  });
  afterAll(async () => {
    const owner = await as('owner');
    const d = await ok<Draft>(owner, 'start_recipe_draft', { p_request_key: key(), p_dish_id: DISH });
    const saved = await ok<Draft>(owner, 'save_recipe_draft', {
      p_request_key: key(),
      p_recipe_version_id: d.recipe_version_id,
      p_expected_revision: d.draft_revision,
      p_lines: seeded,
    });
    const r = await code(owner, 'activate_recipe_version', {
      p_request_key: key(),
      p_recipe_version_id: d.recipe_version_id,
      p_expected_revision: saved.draft_revision,
      p_change_note: 'Restore the seeded recipe after the test',
    });
    if (r === 'validation:recipe_unchanged')
      await ok(owner, 'discard_recipe_draft', {
        p_request_key: key(),
        p_recipe_version_id: d.recipe_version_id,
        p_expected_revision: saved.draft_revision,
      });
    else expect(r).toBeNull();
  });

  it('refuses employees and managers on every write, and employees on the read', async () => {
    for (const who of ['proEmployee', 'proManager'] as const) {
      const c = await as(who);
      expect(await code(c, 'start_recipe_draft', { p_request_key: key(), p_dish_id: DISH })).toBe('unauthorized');
      const fake = '00000000-0000-0000-0000-000000000000';
      expect(
        await code(c, 'save_recipe_draft', {
          p_request_key: key(),
          p_recipe_version_id: fake,
          p_expected_revision: 1,
          p_lines: [{ item_id: 'ING-001', quantity_per_serving: '1' }],
        }),
      ).toBe('unauthorized');
      expect(
        await code(c, 'activate_recipe_version', {
          p_request_key: key(),
          p_recipe_version_id: fake,
          p_expected_revision: 1,
          p_change_note: 'nope',
        }),
      ).toBe('unauthorized');
      expect(
        await code(c, 'discard_recipe_draft', {
          p_request_key: key(),
          p_recipe_version_id: fake,
          p_expected_revision: 1,
        }),
      ).toBe('unauthorized');
    }
    expect(await code(await as('proEmployee'), 'get_recipes', {})).toBe('unauthorized');
    const managerView = await ok<Recipes>(await as('proManager'), 'get_recipes', {});
    expect(managerView.can_edit).toBe(false);
    expect(managerView.dishes.length).toBe(5);
    expect(managerView.dishes.every((d) => d.draft === null && d.active !== null)).toBe(true);
  });

  it('validates draft lines and rejects a stale revision', async () => {
    const o = await as('owner');
    const d = await ok<Draft>(o, 'start_recipe_draft', { p_request_key: key(), p_dish_id: 'FG-004' });
    // Starting again resumes the same draft.
    const again = await ok<Draft>(o, 'start_recipe_draft', { p_request_key: key(), p_dish_id: 'FG-004' });
    expect(again.recipe_version_id).toBe(d.recipe_version_id);
    const save = (lines: unknown, revision = d.draft_revision) =>
      code(o, 'save_recipe_draft', {
        p_request_key: key(),
        p_recipe_version_id: d.recipe_version_id,
        p_expected_revision: revision,
        p_lines: lines,
      });
    expect(await save([])).toBe('validation:recipe_lines');
    expect(await save([{ item_id: 'FG-001', quantity_per_serving: '1' }])).toBe('validation:recipe_ingredient');
    expect(await save([{ item_id: 'RET-001', quantity_per_serving: '1' }])).toBe('validation:recipe_ingredient');
    expect(await save([{ item_id: 'ING-001', quantity_per_serving: '0' }])).toBe('validation:recipe_quantity');
    expect(await save([{ item_id: 'ING-001', quantity_per_serving: '1.1234567' }])).toBe('validation:recipe_quantity');
    expect(await save([{ item_id: 'ING-001', quantity_per_serving: 'abc' }])).toBe('validation:recipe_quantity');
    expect(
      await save([
        { item_id: 'ING-001', quantity_per_serving: '1' },
        { item_id: 'ING-001', quantity_per_serving: '2' },
      ]),
    ).toBe('validation:recipe_duplicate_ingredient');
    expect(await save(toLines(d.lines), d.draft_revision + 1)).toBe('conflict:stale_version');
    // Activating an unchanged copy is refused; discarding removes the draft.
    expect(
      await code(o, 'activate_recipe_version', {
        p_request_key: key(),
        p_recipe_version_id: d.recipe_version_id,
        p_expected_revision: d.draft_revision,
        p_change_note: 'No change',
      }),
    ).toBe('validation:recipe_unchanged');
    await ok(o, 'discard_recipe_draft', {
      p_request_key: key(),
      p_recipe_version_id: d.recipe_version_id,
      p_expected_revision: d.draft_revision,
    });
    const rows = await sql(`select 1 from public.recipe_versions where recipe_version_id = $1`, [d.recipe_version_id]);
    expect(rows).toHaveLength(0);
  });

  it('an activated edit applies to new orders only; an order accepted earlier is issued with its original recipe', async () => {
    const owner = await as('owner');
    const employee = await as('proEmployee');
    const before = (await ok<Recipes>(owner, 'get_recipes', {})).dishes.find((d) => d.dish_id === DISH)!;
    const oldLines = before.active!.lines;
    const first = oldLines[0]!;

    // 1. An order accepted under the current recipe.
    const early = await ok<OrderResult>(employee, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: DISH, quantity: 2 }],
    });

    // 2. The owner doubles the first ingredient and adds one the dish did not use.
    const added = (await ok<Recipes>(owner, 'get_recipes', {})).ingredients
      .map((i) => i.item_id)
      .find((id) => id !== 'ING-001' && !oldLines.some((l) => l.item_id === id))!;
    const d = await ok<Draft>(owner, 'start_recipe_draft', { p_request_key: key(), p_dish_id: DISH });
    const doubled = (Number(first.quantity_per_serving) * 2).toString();
    const newLines = [
      ...toLines(oldLines).map((l) => (l.item_id === first.item_id ? { ...l, quantity_per_serving: doubled } : l)),
      { item_id: added, quantity_per_serving: '3' },
    ];
    const saveArgs = {
      p_request_key: key(),
      p_recipe_version_id: d.recipe_version_id,
      p_expected_revision: d.draft_revision,
      p_lines: newLines,
    };
    const saved = await ok<Draft>(owner, 'save_recipe_draft', saveArgs);
    const savedAgain = await ok<Draft>(owner, 'save_recipe_draft', saveArgs);
    expect(savedAgain.replayed).toBe(true);
    expect(saved.draft_revision).toBe(d.draft_revision + 1);
    // Unchanged lines keep their source label; edited and new lines are owner-entered.
    expect(saved.lines.find((l) => l.item_id === first.item_id)!.basis).toBe('owner_entered');
    expect(saved.lines.find((l) => l.item_id === added)!.basis).toBe('owner_entered');
    const untouched = oldLines[1]!;
    expect(saved.lines.find((l) => l.item_id === untouched.item_id)!.basis).toBe(untouched.basis);
    expect(
      await code(owner, 'activate_recipe_version', {
        p_request_key: key(),
        p_recipe_version_id: d.recipe_version_id,
        p_expected_revision: saved.draft_revision,
        p_change_note: '',
      }),
    ).toBe('validation:change_note');
    const activateArgs = {
      p_request_key: key(),
      p_recipe_version_id: d.recipe_version_id,
      p_expected_revision: saved.draft_revision,
      p_change_note: 'Test: double the first ingredient',
    };
    const activated = await ok<{ version_no: number; superseded_version_no: number }>(
      owner,
      'activate_recipe_version',
      activateArgs,
    );
    const replay = await ok<{ replayed: boolean; version_no: number }>(owner, 'activate_recipe_version', activateArgs);
    expect(replay.replayed).toBe(true);
    expect(replay.version_no).toBe(activated.version_no);
    expect(activated.superseded_version_no).toBe(before.active!.version_no);

    const after = (await ok<Recipes>(owner, 'get_recipes', {})).dishes.find((x) => x.dish_id === DISH)!;
    expect(after.active!.version_no).toBe(activated.version_no);
    expect(after.history.find((h) => h.version_no === before.active!.version_no)!.status).toBe('superseded');
    expect(await sql(`select private.gate_confirmed('recipes_verified', $1) as ok`, [DISH])).toEqual([{ ok: true }]);
    const audit = await sql<{ n: number }>(
      `select count(*)::int n from public.audit_log where action = 'recipe.activate' and object_id = $1 and before_data is not null`,
      [d.recipe_version_id],
    );
    expect(audit[0]!.n).toBe(1);

    // 3. The early order still holds its original requirements and is issued with them, once.
    const reqs = await sql<{ component_item_id: string; required_qty: string }>(
      `select r.component_item_id, r.required_qty::text from public.order_line_requirements r
         join public.order_lines l on l.order_line_id = r.order_line_id
        where l.order_id = $1 order by 1`,
      [early.order_id],
    );
    expect(reqs.find((r) => r.component_item_id === first.item_id)!.required_qty).toBe(
      (Number(first.quantity_per_serving) * 2).toFixed(6),
    );
    expect(reqs.some((r) => r.component_item_id === added)).toBe(false);
    await ok(employee, 'start_order_preparation', {
      p_request_key: key(),
      p_order_id: early.order_id,
      p_expected_version: early.version,
    });
    const issued = await sql<{ item_id: string; qty: string }>(
      `select item_id, (-sum(quantity))::numeric(18,6)::text qty from public.inventory_movements
        where source_type = 'order' and source_id = $1 and movement_type = 'kitchen_issue' group by item_id`,
      [early.order_id],
    );
    expect(issued.find((m) => m.item_id === first.item_id)!.qty).toBe(
      (Number(first.quantity_per_serving) * 2).toFixed(6),
    );
    expect(issued.some((m) => m.item_id === added)).toBe(false);

    // 4. A new order uses the new recipe.
    const late = await ok<OrderResult>(employee, 'accept_order', {
      p_request_key: key(),
      p_location_id: PRO,
      p_lines: [{ item_id: DISH, quantity: 1 }],
    });
    const lateReqs = await sql<{ component_item_id: string; required_qty: string }>(
      `select r.component_item_id, r.required_qty::text from public.order_line_requirements r
         join public.order_lines l on l.order_line_id = r.order_line_id where l.order_id = $1`,
      [late.order_id],
    );
    expect(lateReqs.find((r) => r.component_item_id === first.item_id)!.required_qty).toBe(Number(doubled).toFixed(6));
    expect(lateReqs.find((r) => r.component_item_id === added)!.required_qty).toBe('3.000000');
    // Release the test order's reservations.
    await ok(employee, 'cancel_order', {
      p_request_key: key(),
      p_order_id: late.order_id,
      p_expected_version: late.version,
      p_reason_code: 'CUSTOMER_COMPLAINT',
    });
  });

  it('a superseded version can never be edited again', async () => {
    const [v] = await sql<{ recipe_version_id: string }>(
      `select recipe_version_id from public.recipe_versions where parent_item_id = $1 and status = 'superseded' limit 1`,
      [DISH],
    );
    await expect(
      sql(`update public.recipe_versions set change_note = 'x' where recipe_version_id = $1`, [v!.recipe_version_id]),
    ).rejects.toThrow(/immutable:recipe_version/);
    await expect(
      sql(`delete from public.recipe_components where recipe_version_id = $1`, [v!.recipe_version_id]),
    ).rejects.toThrow(/immutable:recipe_version/);
  });
});

interface SupplierRow {
  version: number;
  phone: string | null;
  contact_email: string | null;
  contact_provenance: string | null;
  supplier_items: Array<{
    supplier_item_id: string;
    procurement_lead_days: number | null;
    lead_time_basis: string | null;
  }>;
}
interface Requests {
  is_owner: boolean;
  requests: Array<{
    request_id: string;
    version: number;
    status: string;
    supplier_id: string;
    supplier_changed_since: boolean;
  }>;
}

async function supplier(id: string): Promise<SupplierRow> {
  const { data, error } = await (
    await as('owner')
  )
    .from('suppliers')
    .select(
      'version, phone, contact_email, contact_provenance, supplier_items(supplier_item_id, procurement_lead_days, lead_time_basis)',
    )
    .eq('supplier_id', id)
    .single();
  if (error) throw error;
  return data as SupplierRow;
}

describe('supplier edits (owner) and change requests (managers)', () => {
  const SUP = 'SUP-02';
  const SUP2 = 'SUP-06'; // no phone number in the source list
  // Planning suites read these lead times; restore them afterwards.
  const saved = new Map<
    string,
    { phone: string | null; contact_email: string | null; address: string | null; leads: Record<string, number> }
  >();
  beforeAll(async () => {
    for (const id of [SUP, SUP2]) {
      const [row] = await sql<{ phone: string | null; contact_email: string | null; address: string | null }>(
        `select phone, contact_email, address from public.suppliers where supplier_id = $1`,
        [id],
      );
      const leads = await sql<{ id: string; days: number | null }>(
        `select supplier_item_id::text id, procurement_lead_days days from public.supplier_items where supplier_id = $1`,
        [id],
      );
      saved.set(id, {
        ...row!,
        leads: Object.fromEntries(leads.filter((l) => l.days !== null).map((l) => [l.id, l.days!])),
      });
    }
  });
  afterAll(async () => {
    const owner = await as('owner');
    for (const [id, v] of saved) {
      const s = await supplier(id);
      const r = await code(owner, 'update_supplier_details', {
        p_request_key: key(),
        p_supplier_id: id,
        p_expected_version: s.version,
        p_changes: {
          phone: v.phone ?? '',
          contact_email: v.contact_email ?? '',
          address: v.address ?? '',
          lead_days: v.leads,
        },
      });
      expect([null, 'validation:no_changes']).toContain(r);
    }
  });

  it('only the owner edits directly; values are validated and labelled owner-entered', async () => {
    const s = await supplier(SUP);
    const si = s.supplier_items[0]!;
    const args = (changes: unknown, version = s.version) => ({
      p_request_key: key(),
      p_supplier_id: SUP,
      p_expected_version: version,
      p_changes: changes,
    });
    for (const who of ['proEmployee', 'proManager'] as const)
      expect(await code(await as(who), 'update_supplier_details', args({ phone: '801 555 0100' }))).toBe(
        'unauthorized',
      );
    const o = await as('owner');
    expect(await code(o, 'update_supplier_details', args({ phone: 'call us' }))).toBe('validation:phone');
    expect(await code(o, 'update_supplier_details', args({ phone: '12345' }))).toBe('validation:phone');
    expect(await code(o, 'update_supplier_details', args({ contact_email: 'not-an-email' }))).toBe(
      'validation:contact_email',
    );
    expect(await code(o, 'update_supplier_details', args({ lead_days: { [si.supplier_item_id]: 400 } }))).toBe(
      'validation:lead_days',
    );
    expect(await code(o, 'update_supplier_details', args({ lead_days: { [si.supplier_item_id]: 1.5 } }))).toBe(
      'validation:lead_days',
    );
    expect(await code(o, 'update_supplier_details', args({ website: 'x' }))).toBe('validation:changes');
    // Synthetic demo contacts are refused in a pilot database.
    expect(await code(o, 'update_supplier_details', args({ contact_email: 'a@demo.example.invalid' }))).toBe(
      'forbidden:synthetic_data_in_pilot',
    );
    expect(await code(o, 'update_supplier_details', args({ phone: s.phone ?? '' }))).toBe('validation:no_changes');

    const edit = args({
      phone: '(801) 555-0100',
      contact_email: 'Orders@Example.com',
      lead_days: { [si.supplier_item_id]: 4 },
    });
    const r = await ok<{ version: number }>(o, 'update_supplier_details', edit);
    expect(r.version).toBe(s.version + 1);
    expect((await ok<{ replayed: boolean }>(o, 'update_supplier_details', edit)).replayed).toBe(true);
    const after = await supplier(SUP);
    expect(after).toMatchObject({
      phone: '(801) 555-0100',
      contact_email: 'orders@example.com',
      contact_provenance: 'pilot_owner_entered',
    });
    expect(after.supplier_items.find((x) => x.supplier_item_id === si.supplier_item_id)).toMatchObject({
      procurement_lead_days: 4,
      lead_time_basis: 'Owner-entered',
    });
    expect(await code(o, 'update_supplier_details', args({ phone: '801 555 0199' }))).toBe('conflict:stale_version');
    // Clearing a value stores blank, never a placeholder.
    await ok(o, 'update_supplier_details', args({ contact_email: '' }, after.version));
    expect((await supplier(SUP)).contact_email).toBeNull();
    const audit = await sql<{ n: number }>(
      `select count(*)::int n from public.audit_log where action = 'supplier.update_details' and object_id = $1`,
      [SUP],
    );
    expect(audit[0]!.n).toBe(2);
  });

  it('a manager requests a change at their own location; the owner approves it and it applies once', async () => {
    const s = await supplier(SUP);
    const si = s.supplier_items[0]!;
    const changes = { phone: '801 555 0123', lead_days: { [si.supplier_item_id]: 6 } };
    const req = (who: 'proEmployee' | 'proManager' | 'sfoManager', loc: string, note = 'Rep phoned 11/24') =>
      as(who).then((c) =>
        code(c, 'submit_supplier_change_request', {
          p_request_key: key(),
          p_location_id: loc,
          p_supplier_id: SUP,
          p_changes: changes,
          p_note: note,
        }),
      );
    expect(await req('proEmployee', PRO)).toBe('unauthorized');
    expect(await req('sfoManager', PRO)).toBe('unauthorized');
    expect(await req('proManager', PRO, '')).toBe('validation:note');

    const manager = await as('proManager');
    const submitted = await ok<{ request_id: string; status: string }>(manager, 'submit_supplier_change_request', {
      p_request_key: key(),
      p_location_id: PRO,
      p_supplier_id: SUP,
      p_changes: changes,
      p_note: 'Rep phoned 11/24 with a new number',
    });
    expect(submitted.status).toBe('pending');
    expect((await supplier(SUP)).phone).toBe(s.phone); // nothing changes yet

    // Visibility: the requester and the owner; not another manager, not employees.
    const mine = await ok<Requests>(manager, 'list_supplier_change_requests', { p_status: 'pending' });
    expect(mine.requests.map((r) => r.request_id)).toContain(submitted.request_id);
    const other = await ok<Requests>(await as('sfoManager'), 'list_supplier_change_requests', {});
    expect(other.requests.map((r) => r.request_id)).not.toContain(submitted.request_id);
    const { data: direct } = await (await as('sfoManager')).from('supplier_change_requests').select('request_id');
    expect(direct).toEqual([]);
    expect(await code(await as('proEmployee'), 'list_supplier_change_requests', {})).toBe('unauthorized');
    const ownerView = await ok<Requests>(await as('owner'), 'list_supplier_change_requests', { p_status: 'pending' });
    const pending = ownerView.requests.find((r) => r.request_id === submitted.request_id)!;
    expect(ownerView.is_owner).toBe(true);
    expect(pending.supplier_changed_since).toBe(false);

    // Only the owner decides; a rejection needs a reason.
    const decide = (decision: string, note?: string, version = pending.version) => ({
      p_request_key: key(),
      p_request_id: submitted.request_id,
      p_expected_version: version,
      p_decision: decision,
      p_note: note,
    });
    expect(await code(manager, 'decide_supplier_change_request', decide('approve'))).toBe('unauthorized');
    const owner = await as('owner');
    expect(await code(owner, 'decide_supplier_change_request', decide('reject'))).toBe('validation:decision_note');
    expect(await code(owner, 'decide_supplier_change_request', decide('approve', undefined, pending.version + 1))).toBe(
      'conflict:stale_version',
    );
    const approveArgs = decide('approve', 'Confirmed with the rep');
    const approved = await ok<{ status: string }>(owner, 'decide_supplier_change_request', approveArgs);
    expect(approved.status).toBe('approved');
    expect((await ok<{ replayed: boolean }>(owner, 'decide_supplier_change_request', approveArgs)).replayed).toBe(true);
    expect(await code(owner, 'decide_supplier_change_request', decide('reject', 'too late', pending.version + 1))).toBe(
      'invalid_state:approved->reject',
    );
    const after = await supplier(SUP);
    expect(after.phone).toBe('801 555 0123');
    expect(after.supplier_items.find((x) => x.supplier_item_id === si.supplier_item_id)!.procurement_lead_days).toBe(6);
    expect(after.version).toBe(s.version + 1);
    // Decided requests are history.
    await expect(
      sql(`update public.supplier_change_requests set note = 'edited' where request_id = $1`, [submitted.request_id]),
    ).rejects.toThrow(/immutable:supplier_change_request/);
  });

  it('flags a request when the supplier was edited after it was made; a rejection changes nothing', async () => {
    const manager = await as('sfoManager');
    const r = await ok<{ request_id: string }>(manager, 'submit_supplier_change_request', {
      p_request_key: key(),
      p_location_id: SFO,
      p_supplier_id: SUP2,
      p_changes: { phone: '435 555 0142' },
      p_note: 'Printed on the latest invoice',
    });
    const s = await supplier(SUP2);
    expect(s.phone).toBeNull();
    const owner = await as('owner');
    await ok(owner, 'update_supplier_details', {
      p_request_key: key(),
      p_supplier_id: SUP2,
      p_expected_version: s.version,
      p_changes: { address: 'Spanish Fork, UT' },
    });
    const view = await ok<Requests>(owner, 'list_supplier_change_requests', { p_status: 'pending' });
    const pending = view.requests.find((x) => x.request_id === r.request_id)!;
    expect(pending.supplier_changed_since).toBe(true);
    await ok(owner, 'decide_supplier_change_request', {
      p_request_key: key(),
      p_request_id: r.request_id,
      p_expected_version: pending.version,
      p_decision: 'reject',
      p_note: 'Could not confirm the number',
    });
    expect((await supplier(SUP2)).phone).toBeNull();
    const decided = await ok<Requests>(manager, 'list_supplier_change_requests', { p_status: 'decided' });
    expect(decided.requests.find((x) => x.request_id === r.request_id)!.status).toBe('rejected');
  });
});

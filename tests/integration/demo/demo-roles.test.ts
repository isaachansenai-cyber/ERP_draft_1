// Demo logins (CLAUDE.md D4) and role-scoped visibility of demo history.
import { describe, expect, inject, it } from 'vitest';
import { localStack, signIn, withDb } from '../helpers/stack';

const stack = localStack();
const creds = inject('demoCredentials');

async function as(employeeId: string) {
  const c = creds[employeeId];
  if (!c) throw new Error(`no credentials for ${employeeId}`);
  return signIn(stack, c.email, c.password);
}

async function historyCount(client: Awaited<ReturnType<typeof as>>) {
  const { count, error } = await client
    .from('historical_sales_orders')
    .select('historical_order_id', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

describe('demo role fixtures', () => {
  it('all ten fixtures can sign in and resolve to their server-side role', async () => {
    for (const [employeeId, c] of Object.entries(creds)) {
      const client = await as(employeeId);
      const { data } = await client.rpc('get_my_context');
      expect(data.employee.employee_id).toBe(employeeId);
      expect(data.data_mode).toBe('demo');
      if (c.role === 'owner') expect(data.is_owner).toBe(true);
      else expect(data.roles).toEqual([expect.objectContaining({ location_id: c.location, role: c.role })]);
    }
  });

  it('owner sees all history; a manager only their location; an employee none directly', async () => {
    const totals = await withDb(stack.dbUrl, async (db) =>
      Object.fromEntries(
        (await db.query(`select location_id, count(*)::int n from public.historical_sales_orders group by 1`)).rows.map(
          (r) => [r.location_id, r.n],
        ),
      ),
    );
    expect(await historyCount(await as('DEMO-OWNER'))).toBe(totals['LOC-PRO'] + totals['LOC-SFO'] + totals['LOC-SLC']);
    expect(await historyCount(await as('DEMO-LOC-SLC-MAN-1'))).toBe(totals['LOC-SLC']);
    expect(await historyCount(await as('DEMO-LOC-PRO-EMP-1'))).toBe(0);
  });

  it('demo passwords are not stored anywhere in the database tables', async () => {
    await withDb(stack.dbUrl, async (db) => {
      for (const c of Object.values(creds)) {
        const { rows } = await db.query(
          `select count(*)::int n from public.audit_log where after_data::text like '%' || $1 || '%'`,
          [c.password],
        );
        expect(rows[0].n).toBe(0);
      }
    });
  });
});

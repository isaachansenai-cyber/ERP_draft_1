// AC31 (restore part): a full backup of the demo database restores into a
// disposable database with identical tables, identical ledger and document
// totals, and intact security controls. Local stack only.
import { describe, expect, it } from 'vitest';
import { runDrill } from '../../../scripts/ops/backup-restore-drill';
import { localStack } from '../helpers/stack';

describe('AC31 backup and restore', () => {
  it('restores into a disposable database with every table, total and control intact', async () => {
    const r = await runDrill(localStack().dbUrl);
    expect(r.tableMismatches).toEqual([]);
    expect(r.totalMismatches).toEqual([]);
    expect(r.tables_compared).toBeGreaterThan(60);
    expect(r.restored_integrity).toMatchObject({
      balances_not_matching_ledger: 0,
      invalid_balances: 0,
      public_tables_without_rls: 0,
      api_can_write_movements: false,
    });
    expect(String(r.restored_integrity.movement_update_guard)).toMatch(/^refused \(immutable:inventory_movements\)/);
    expect(r.restore_seconds).toBeLessThan(4 * 3600);
    expect(r.pass).toBe(true);
  }, 120_000);

  it('refuses drill mode against anything but the local stack', async () => {
    await expect(runDrill('postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres')).rejects.toThrow(
      /only against the local stack/,
    );
  });
});

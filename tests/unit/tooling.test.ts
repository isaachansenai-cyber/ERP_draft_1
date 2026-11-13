// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../../scripts/import/import-demo-history';
import { deriveRequiresUseBy, normalizeUnit, sameDecimal } from '../../scripts/import/import-source-master';
import {
  assertAllowlisted,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
  RefusalError,
} from '../../scripts/lib/target';

const REF = 'abcdefghijklmnopqrst';

describe('operator tooling target guards (CLAUDE.md §7)', () => {
  const saved = process.env.DEMO_PROJECT_REF_ALLOWLIST;
  afterEach(() => {
    process.env.DEMO_PROJECT_REF_ALLOWLIST = saved;
  });

  it('derives the project ref only from connection URLs', () => {
    expect(projectRefFromDatabaseUrl('postgresql://postgres:x@127.0.0.1:54322/postgres')).toBe('local');
    expect(projectRefFromDatabaseUrl(`postgresql://postgres:x@db.${REF}.supabase.co:5432/postgres`)).toBe(REF);
    expect(
      projectRefFromDatabaseUrl(`postgresql://postgres.${REF}:x@aws-0-us-west-1.pooler.supabase.com:6543/postgres`),
    ).toBe(REF);
    expect(() => projectRefFromDatabaseUrl('postgresql://u:x@db.example.com/postgres')).toThrow(RefusalError);
    expect(projectRefFromSupabaseUrl(`https://${REF}.supabase.co`)).toBe(REF);
    expect(projectRefFromSupabaseUrl('http://127.0.0.1:54321')).toBe('local');
  });

  it('refuses targets that are not allowlisted, or whose API and DB disagree', () => {
    process.env.DEMO_PROJECT_REF_ALLOWLIST = '';
    expect(() => assertAllowlisted('postgresql://p:x@127.0.0.1:54322/postgres')).toThrow(
      /not in DEMO_PROJECT_REF_ALLOWLIST/,
    );
    process.env.DEMO_PROJECT_REF_ALLOWLIST = 'local';
    expect(assertAllowlisted('postgresql://p:x@127.0.0.1:54322/postgres')).toBe('local');
    expect(() => assertAllowlisted('postgresql://p:x@127.0.0.1:54322/postgres', `https://${REF}.supabase.co`)).toThrow(
      /different projects/,
    );
  });
});

describe('import helpers', () => {
  it('normalizes unit spellings without touching values', () => {
    expect(['mL', 'ML', 'ml', 'g', 'each'].map(normalizeUnit)).toEqual(['ml', 'ml', 'ml', 'g', 'each']);
    expect(() => normalizeUnit('tbsp')).toThrow();
  });

  it('derives use-by requirements from the storage note (D8)', () => {
    expect(deriveRequiresUseBy({ item_type: 'ingredient', storage_note: 'Refrigerated / frozen storage' })).toEqual({
      value: true,
      basis: 'derived_from_storage_note',
    });
    expect(deriveRequiresUseBy({ item_type: 'ingredient', storage_note: 'Dry / ambient storage' }).value).toBe(false);
    expect(deriveRequiresUseBy({ item_type: 'finished_dish', storage_note: 'Kitchen' }).value).toBe(false);
  });

  it('compares decimals as strings', () => {
    expect(sameDecimal('180.000000', '180')).toBe(true);
    expect(sameDecimal('0.500000', '0.5')).toBe(true);
    expect(sameDecimal('0.5', '0.05')).toBe(false);
  });

  it('parses CSV with quotes, embedded commas and CRLF', () => {
    expect(parseCsv('a,b\r\n1,"x, ""y"""\r\n2,\n')).toEqual([
      { a: '1', b: 'x, "y"' },
      { a: '2', b: '' },
    ]);
    expect(() => parseCsv('a,b\n1\n')).toThrow();
  });
});

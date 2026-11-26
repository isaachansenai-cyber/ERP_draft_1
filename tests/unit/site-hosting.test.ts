// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { missingHostedConfig, sitePolicy } from '../../site/vite.config';

describe('hosted website build (ADR 0046)', () => {
  it('refuses a Vercel build that does not know which ERP to call', () => {
    expect(missingHostedConfig({ VERCEL: '1' })).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(
      missingHostedConfig({ VERCEL: '1', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: ' ' }),
    ).toEqual(['VITE_SUPABASE_ANON_KEY']);
  });

  it('accepts a connected Vercel build and leaves local and CI builds alone', () => {
    expect(
      missingHostedConfig({
        VERCEL: '1',
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_x',
      }),
    ).toEqual([]);
    expect(missingHostedConfig({})).toEqual([]);
  });

  it('lets a connected site call only its own ERP', () => {
    expect(sitePolicy('https://x.supabase.co')).toContain("connect-src 'self' https://x.supabase.co;");
    expect(sitePolicy(undefined)).toContain("connect-src 'self';");
  });
});

// @vitest-environment node
import { readFileSync } from 'node:fs';
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

  it('rewrites browser-only pages to the app shell by its clean address (ADR 0047)', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      cleanUrls: boolean;
      rewrites: { source: string; destination: string }[];
    };
    expect(config.cleanUrls).toBe(true);
    // With cleanUrls on, Vercel does not resolve a rewrite to "/app.html": it answers 404.
    expect(config.rewrites.map((r) => r.destination)).toEqual(['/app', '/app', '/app']);
    expect(config.rewrites.map((r) => r.source)).toEqual(['/cart', '/checkout', '/order/:token']);
  });
});

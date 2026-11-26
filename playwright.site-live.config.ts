import { defineConfig, devices } from '@playwright/test';

// Public website against a live local DEMO database (W3+). Needs the local
// Supabase stack; resets it. The static site tests (no database) are in
// playwright.site.config.ts.
export default defineConfig({
  testDir: 'tests/site-e2e-live',
  globalSetup: './tests/site-e2e-live/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4175/', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});

import { defineConfig, devices } from '@playwright/test';

// E2E runs against a local demo database and a production build served under the
// GitHub Pages base path (see tests/e2e/global-setup.ts).
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/ERP_draft_1/',
    trace: 'off',
    viewport: { width: 1180, height: 820 }, // landscape tablet
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } } }],
});

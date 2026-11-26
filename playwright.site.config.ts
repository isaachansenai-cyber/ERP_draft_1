import { defineConfig, devices } from '@playwright/test';

// Public website (site/) tests. No database: W1 is static. The site is built
// under its GitHub Pages base path and served with `vite preview`.
export const SITE_BASE_PATH = '/ERP_draft_1/site/';

export default defineConfig({
  testDir: 'tests/site-e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:4174${SITE_BASE_PATH}`, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'npm run site:build && npm run site:preview',
    url: `http://127.0.0.1:4174${SITE_BASE_PATH}`,
    env: { VITE_SITE_BASE_PATH: SITE_BASE_PATH },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

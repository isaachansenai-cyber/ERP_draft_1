import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share one local database: run files one at a time.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'integration-pilot',
          include: ['tests/integration/pilot/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/setup/pilot.global.ts'],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
      {
        test: {
          name: 'integration-ops',
          include: ['tests/integration/ops/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/setup/ops.global.ts'],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
      {
        test: {
          name: 'integration-demo',
          include: ['tests/integration/demo/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/setup/demo.global.ts'],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});

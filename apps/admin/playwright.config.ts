import { defineConfig, devices } from '@playwright/test';

/**
 * `testing_requirements`'s "E2E smoke tests for the critical operator
 * flows" — real browser, real running `services/api`, real Postgres/
 * Redis, real seeded fixture data (`packages/database/prisma/seed.ts` +
 * `services/api/scripts/e2e-set-admin-password.ts`). No mocked fetch, no
 * mocked backend — this project's own "no mocks for infrastructure
 * behavior" rule applied to the frontend for the first time (ADR-018
 * consequence).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This sandbox pre-installs one pinned Chromium revision at a
        // fixed path rather than letting Playwright download its own
        // (network-restricted) — @playwright/test's own resolved
        // version here expects a newer revision than what's on disk, so
        // point directly at the pre-installed binary instead of
        // `playwright install`ing a second copy.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @iecp/api dev',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @iecp/admin dev',
      url: 'http://localhost:3001/login',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});

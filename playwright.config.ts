import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Vocab Agent.
 *
 * Uses the locally installed Google Chrome browser (channel: 'chrome') so we
 * don't need to download the Playwright Chromium bundle. This works around
 * slow/blocked CDN downloads in this environment.
 *
 * The dev server is expected to be running on localhost:3088. Start it with:
 *   npm run dev -- --turbopack --port 3088
 *
 * Then run tests with:
 *   npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3088',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 15000,
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev -- --turbopack --port 3088',
    url: 'http://localhost:3088',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

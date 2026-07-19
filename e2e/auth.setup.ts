import { test as setup } from '@playwright/test';

/**
 * Global setup: ensure the dev server is reachable before running tests.
 * Playwright's webServer config also handles this, but an explicit health
 * check gives a clearer error message if something is wrong.
 */
setup('server is reachable', async ({ request }) => {
  const res = await request.get('/', { timeout: 10000 });
  setup.expect(res.status()).toBe(200);
});

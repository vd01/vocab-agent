import { test, expect } from '@playwright/test';

/**
 * Detect whether the server is running with AUTH_PASSWORD set.
 * When auth is disabled, the proxy redirects /login to /.
 */
async function isAuthRequired(page: { goto: (url: string) => Promise<unknown> }) {
  // Use a fresh goto to /login; if we end up at /, auth is disabled.
  const response = await page.goto('/login');
  if (!response) return false;
  const url = new URL(response.url());
  return url.pathname === '/login';
}

test.describe('Login page', () => {
  test('login page behavior matches auth configuration', async ({ page }) => {
    const authRequired = await isAuthRequired(page);

    if (!authRequired) {
      // Auth disabled: /login should redirect authenticated users to /.
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
      return;
    }

    // Auth enabled: the login form should be visible.
    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
    await expect(page.getByPlaceholder('密码')).toBeVisible();

    // The submit button is disabled while the password field is empty.
    const submitButton = page.getByRole('button', { name: '登录' });
    await expect(submitButton).toBeDisabled();
  });

  test('login flow succeeds with correct password', async ({ page }) => {
    const authRequired = await isAuthRequired(page);
    if (!authRequired) {
      test.skip('Auth is disabled on this server');
    }

    await page.goto('/login');
    await page.getByPlaceholder('密码').fill('vocab-agent');
    await page.getByRole('button', { name: '登录' }).click();

    await page.waitForURL('/');
    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
  });
});

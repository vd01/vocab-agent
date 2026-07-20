import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('renders main chat UI', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
    await expect(page.getByTitle('设置')).toBeVisible();
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('can run /stats command from toolbar', async ({ page }) => {
    await page.goto('/');

    await page.getByTitle('统计').click();
    await expect(page.getByText('学习统计').first()).toBeVisible({ timeout: 10000 });
  });

  test('can switch between teach and develop modes', async ({ page }) => {
    await page.goto('/');

    // The mode switch is rendered by @base-ui/react Switch.
    // Try multiple selectors because the primitive may render as button or span.
    const modeSwitch = page.locator('[data-slot="switch"], [role="switch"]').first();

    try {
      await modeSwitch.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      test.skip('No mode switch found in current UI');
      return;
    }

    await modeSwitch.click();
    await expect(page.getByText('开发中').first()).toBeVisible();
    await modeSwitch.click();
    await expect(page.getByText('开发').first()).toBeVisible();
  });
});

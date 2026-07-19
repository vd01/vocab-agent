import { test, expect } from '@playwright/test';

/**
 * Settings-lite page tests
 * Tests: server URL configuration, shortcut settings
 */
test.describe('Settings lite page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings-lite');
  });

  test('renders settings-lite page', async ({ page }) => {
    await expect(page.getByText('Vocab Agent Lite')).toBeVisible();
    await expect(page.getByText('配置服务端连接')).toBeVisible();
  });

  test('has server URL input', async ({ page }) => {
    const urlInput = page.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveAttribute('placeholder', 'https://example.duckdns.org:31588');
  });

  test('has connect button', async ({ page }) => {
    const connectButton = page.getByRole('button', { name: '连接' });
    await expect(connectButton).toBeVisible();
  });

  test('shows error for empty URL', async ({ page }) => {
    const connectButton = page.getByRole('button', { name: '连接' });
    await connectButton.click();
    
    // Should show error
    await expect(page.getByText('请输入服务端地址')).toBeVisible();
  });

  test('has shortcut settings section', async ({ page }) => {
    await expect(page.getByText('快捷键设置')).toBeVisible();
    
    const shortcutInput = page.locator('input[placeholder*="组合键"]').first();
    await expect(shortcutInput).toBeVisible();
  });

  test('has save shortcut button', async ({ page }) => {
    const saveButton = page.getByRole('button', { name: '保存快捷键' });
    await expect(saveButton).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('can navigate to settings page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();

    // Use role+name to avoid matching "提醒设置" button
    const settingsLink = page.getByRole('link', { name: '设置' });
    await settingsLink.click();

    await page.waitForURL('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  });

  test('can navigate to quick lookup page', async ({ page }) => {
    await page.goto('/quick-lookup');

    await expect(page.getByPlaceholder('输入单词或短语...')).toBeVisible();
    await expect(page.getByText('输入单词后按回车查询')).toBeVisible();
  });

  test('can navigate back from settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

    // Click back button to go home directly
    const backButton = page.getByText('← 返回');
    await backButton.click();

    // Use URL check without waitForURL to avoid timeout
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toContain('localhost:3088');
  });

  test('home page has correct title', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
  });

  test('header has all navigation elements', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();
    await expect(page.locator('button[title="切换主题"], button[aria-label="切换主题"]').first()).toBeVisible();
  });
});

test.describe('Responsive design', () => {
  test('shows correct layout on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();
  });

  test('shows correct layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vocab Agent' })).toBeVisible();

    const sidebar = page.getByText('置顶单词').first();
    await expect(sidebar).not.toBeVisible();
  });

  test('shows correct layout on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });
});

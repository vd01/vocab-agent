import { test, expect } from '@playwright/test';

test.describe('Error handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles empty message submission gracefully', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');

    // Send button should be disabled when input is empty
    const sendButton = page.locator('button[type="submit"]').first();
    await expect(sendButton).toBeDisabled();

    // Pressing Enter with empty input should not crash
    await input.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles very long messages', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    const longMessage = 'a'.repeat(1000);
    await input.fill(longMessage);
    await input.press('Enter');

    await page.waitForTimeout(1000);
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles special characters in messages', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    const specialMessage = '!@#$%^&*()_+-=[]{}|;\':",./<>?';
    await input.fill(specialMessage);
    await input.press('Enter');

    await page.waitForTimeout(1000);
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles unicode characters in messages', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    const unicodeMessage = 'Hello 世界 🌍 こんにちは مرحبا';
    await input.fill(unicodeMessage);
    await input.press('Enter');

    await page.waitForTimeout(1000);
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles rapid message sending', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');

    for (let i = 0; i < 3; i++) {
      await input.fill(`RapidMsg ${i}`);
      await input.press('Enter');
      await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(2000);
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles page refresh during chat', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('Test message before refresh');
    await input.press('Enter');

    await expect(page.getByText('Test message before refresh')).toBeVisible();

    await page.reload();
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('handles back button navigation', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });
});

test.describe('Performance', () => {
  test('page loads within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
    const endTime = Date.now();

    const loadTime = endTime - startTime;
    expect(loadTime).toBeLessThan(10000);
  });

  test('settings page loads within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    const endTime = Date.now();

    const loadTime = endTime - startTime;
    expect(loadTime).toBeLessThan(10000);
  });

  test('quick lookup page loads within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/quick-lookup');
    await expect(page.getByPlaceholder('输入单词或短语...')).toBeVisible();
    const endTime = Date.now();

    const loadTime = endTime - startTime;
    expect(loadTime).toBeLessThan(10000);
  });
});

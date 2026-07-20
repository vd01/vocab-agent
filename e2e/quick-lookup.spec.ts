import { test, expect } from '@playwright/test';

test.describe('Quick lookup page', () => {
  test('renders search input and empty state', async ({ page }) => {
    await page.goto('/quick-lookup');

    await expect(page.getByPlaceholder('输入单词或短语...')).toBeVisible();
    await expect(page.getByText('输入单词后按回车查询')).toBeVisible();
  });

  test('can search an English word', async ({ page }) => {
    await page.goto('/quick-lookup');

    await page.getByPlaceholder('输入单词或短语...').fill('hello');
    await page.getByPlaceholder('输入单词或短语...').press('Enter');

    // Wait for the lookup result to render (word header or error fallback).
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
  });
});

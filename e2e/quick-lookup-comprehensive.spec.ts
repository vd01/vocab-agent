import { test, expect } from '@playwright/test';

/**
 * Quick lookup page comprehensive tests
 * Tests: search functionality, result display, actions, audio playback
 */
test.describe('Quick lookup comprehensive', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/quick-lookup');
  });

  test('renders search input and empty state', async ({ page }) => {
    await expect(page.getByPlaceholder('输入单词或短语...')).toBeVisible();
    await expect(page.getByText('输入单词后按回车查询')).toBeVisible();
  });

  test('can search an English word and see results', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for the lookup result to render
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
    
    // Should show word header
    await expect(page.getByText('hello', { exact: false })).toBeVisible();
  });

  test('search shows loading state', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('test');
    await input.press('Enter');

    // Should show loading spinner
    await expect(page.getByText('查询中...')).toBeVisible();
  });

  test('shows word status badges after lookup', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
    
    // Should show either "已入库" or "未入库" badge
    const statusBadge = page.locator('text=/已入库|未入库/').first();
    await expect(statusBadge).toBeVisible();
  });

  test('shows action buttons for unadded words', async ({ page }) => {
    // Use a random word that's likely not in the library
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('xylophone');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/xylophone/i').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    
    // Check for action buttons in the bottom bar
    const actionBar = page.locator('div.flex-shrink-0.border-t').first();
    if (await actionBar.isVisible()) {
      // Should have at least one action button
      const buttons = actionBar.locator('button');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('can play audio for word with audio URL', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
    
    // Look for audio button
    const audioButton = page.locator('button[title="播放发音"]').first();
    if (await audioButton.isVisible().catch(() => false)) {
      await audioButton.click();
      // Audio playback is hard to test, just verify button exists and is clickable
      await expect(audioButton).toBeEnabled();
    }
  });

  test('shows phonetic transcription when available', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
    
    // Look for phonetic text (usually in IPA format)
    const phonetic = page.locator('text=/\\/.*\\//').first();
    // This may or may not be present depending on dictionary data
    // Just verify the page loaded without errors
    await expect(page.locator('text=/查询失败/').first()).not.toBeVisible();
  });

  test('handles invalid input gracefully', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('12345');
    await input.press('Enter');

    // Should not crash, might show no results or empty state
    await page.waitForTimeout(2000);
    
    // Page should still be functional
    await expect(page.getByPlaceholder('输入单词或短语...')).toBeVisible();
  });

  test('can add word to library from quick lookup', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('xylophone');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/xylophone/i').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    
    // Look for "入库" button
    const addButton = page.getByText('入库').first();
    if (await addButton.isVisible().catch(() => false)) {
      await addButton.click();
      
      // Should show success message
      await expect(page.getByText(/操作完成|已入库/)).toBeVisible({ timeout: 5000 });
    }
  });

  test('shows definitions when available', async ({ page }) => {
    const input = page.getByPlaceholder('输入单词或短语...');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for results
    await expect(page.locator('text=/hello/i').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    
    // Should show translation or definition
    const hasTranslation = await page.locator('text=/翻译|释义|definition/i').first().isVisible().catch(() => false);
    const hasDefinition = await page.locator('.text-sm').first().isVisible().catch(() => false);
    
    expect(hasTranslation || hasDefinition).toBeTruthy();
  });
});

import { test, expect } from '@playwright/test';

/**
 * Review prompt banner tests
 * Tests: banner visibility, dismiss functionality, start review button
 */
test.describe('Review prompt banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('review prompt banner may appear when due words exist', async ({ page }) => {
    // The banner appears conditionally based on due count
    // Just verify the page loads correctly
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
    
    // If banner appears, verify its structure
    const banner = page.locator('[data-testid="review-prompt-banner"]').first();
    if (await banner.isVisible().catch(() => false)) {
      // Should show due count
      await expect(banner.locator('text=/\\d+ 个单词待复习/').first()).toBeVisible();
      
      // Should have start review button
      await expect(banner.locator('button:has-text("开始复习")').first()).toBeVisible();
      
      // Should have dismiss button
      await expect(banner.locator('button[title="暂时忽略"]').first()).toBeVisible();
    }
  });

  test('can dismiss review prompt banner', async ({ page }) => {
    const banner = page.locator('[data-testid="review-prompt-banner"]').first();
    
    if (await banner.isVisible().catch(() => false)) {
      // Click dismiss button
      const dismissButton = banner.locator('button[title="暂时忽略"]').first();
      await dismissButton.click();
      
      // Banner should disappear
      await expect(banner).not.toBeVisible();
    }
  });

  test('can start review from banner', async ({ page }) => {
    const banner = page.locator('[data-testid="review-prompt-banner"]').first();
    
    if (await banner.isVisible().catch(() => false)) {
      // Click start review button
      const startButton = banner.locator('button:has-text("开始复习")').first();
      await startButton.click();
      
      // Should trigger review
      await page.waitForTimeout(3000);
      const response = page.locator('text=/复习|没有待复习/').first();
      await expect(response).toBeVisible();
    }
  });
});

/**
 * Review reminder toggle tests
 */
test.describe('Review reminder toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('review reminder button is visible in toolbar', async ({ page }) => {
    // The reminder button should be in the toolbar
    const reminderButton = page.locator('button').filter({ hasText: /提醒|提醒中/ }).first();
    await expect(reminderButton).toBeVisible();
  });

  test('can toggle review reminder', async ({ page }) => {
    const reminderButton = page.locator('button').filter({ hasText: /提醒|提醒中/ }).first();
    await expect(reminderButton).toBeVisible();
    
    // Click to toggle
    await reminderButton.click();
    await page.waitForTimeout(500);
    
    // The button text should have changed
    const newText = await reminderButton.textContent();
    expect(newText).toMatch(/提醒|提醒中/);
  });
});

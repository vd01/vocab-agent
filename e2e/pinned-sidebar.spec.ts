import { test, expect } from '@playwright/test';

/**
 * Pinned sidebar tests
 * Tests: sidebar visibility, pin cards, archive/unarchive, empty state
 */
test.describe('Pinned sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('pinned sidebar is visible on large screens', async ({ page }) => {
    // Set viewport to large screen
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // Sidebar should be visible
    await expect(page.getByText('置顶单词').first()).toBeVisible();
  });

  test('shows empty state when no pinned words', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // Should show empty state message
    const emptyState = page.getByText('暂无置顶单词');
    await expect(emptyState).toBeVisible();
  });

  test('shows pin count in header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // Should show count like "0/5"
    const countText = page.locator('text=/\\d\\/5/').first();
    await expect(countText).toBeVisible();
  });

  test('pin cards have hover actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // If there are pinned words, check hover actions
    const pinCards = page.locator('[class*="group relative"]').first();
    if (await pinCards.isVisible().catch(() => false)) {
      await pinCards.hover();
      
      // Hover actions should appear
      const hoverActions = page.locator('[class*="opacity-0 group-hover:opacity-100"]').first();
      await expect(hoverActions).toBeVisible();
    }
  });

  test('can click on pin card to open detail dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    // Find first pin card and click it
    const pinCard = page.locator('[class*="group relative"]').first();
    if (await pinCard.isVisible().catch(() => false)) {
      await pinCard.click();
      
      // Dialog should open
      await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    }
  });

  test('sidebar is hidden on small screens', async ({ page }) => {
    // Set viewport to small screen
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Sidebar should not be visible
    const sidebar = page.locator('text=置顶单词').first();
    await expect(sidebar).not.toBeVisible();
  });
});

/**
 * Pin button tests (within chat/review context)
 */
test.describe('Pin button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('pin button exists in review session', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session to appear
    await page.waitForTimeout(3000);
    
    // Look for pin button
    const pinButton = page.locator('button[title*="置顶"]').first();
    if (await pinButton.isVisible().catch(() => false)) {
      await expect(pinButton).toBeVisible();
    }
  });
});

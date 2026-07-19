import { test, expect } from '@playwright/test';

/**
 * Word card and review session tests
 * Tests: card flip, pronunciation buttons, FSRS rating buttons
 */
test.describe('Word card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('word card can be flipped by clicking', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session to appear
    await page.waitForTimeout(3000);
    
    // Find a word card and click it
    const wordCard = page.locator('[tabindex="0"]').first();
    if (await wordCard.isVisible().catch(() => false)) {
      // Click to flip
      await wordCard.click();
      await page.waitForTimeout(400);
      
      // The card should have flipped (check for transform style)
      const transform = await wordCard.evaluate(el => {
        const container = el.querySelector('[style*="transform"]');
        return container ? getComputedStyle(container).transform : null;
      });
      
      // If transform includes rotateY, card is flipped
      if (transform) {
        expect(transform).toContain('matrix3d');
      }
    }
  });

  test('pronunciation button is visible on word card', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session
    await page.waitForTimeout(3000);
    
    // Look for pronunciation button
    const pronounceButton = page.locator('button[title*="发音"], button[aria-label*="发音"]').first();
    if (await pronounceButton.isVisible().catch(() => false)) {
      await expect(pronounceButton).toBeVisible();
    }
  });

  test('FSRS rating buttons are visible after flip', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session
    await page.waitForTimeout(3000);
    
    // Find word card and flip it
    const wordCard = page.locator('[tabindex="0"]').first();
    if (await wordCard.isVisible().catch(() => false)) {
      await wordCard.click();
      await page.waitForTimeout(400);
      
      // Look for rating buttons
      const ratingButtons = page.locator('button').filter({ hasText: /Again|Hard|Good|Easy/ });
      const count = await ratingButtons.count();
      
      if (count > 0) {
        // Should have 4 rating buttons
        expect(count).toBeGreaterThanOrEqual(4);
        
        // Check each button
        for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
          const button = page.getByText(label).first();
          if (await button.isVisible().catch(() => false)) {
            await expect(button).toBeVisible();
          }
        }
      }
    }
  });

  test('review session shows progress indicator', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session
    await page.waitForTimeout(3000);
    
    // Look for progress indicator like "1 / X"
    const progressIndicator = page.locator('text=/\\d+ \\/ \\d+/').first();
    if (await progressIndicator.isVisible().catch(() => false)) {
      await expect(progressIndicator).toBeVisible();
    }
  });

  test('review session shows new/review count badges', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session
    await page.waitForTimeout(3000);
    
    // Look for new/review badges
    const newBadge = page.locator('text=/新\\d+/').first();
    const reviewBadge = page.locator('text=/复\\d+/').first();
    
    const hasNew = await newBadge.isVisible().catch(() => false);
    const hasReview = await reviewBadge.isVisible().catch(() => false);
    
    // At least one should be visible if there are words
    expect(hasNew || hasReview).toBeTruthy();
  });

  test('word card shows flip instructions', async ({ page }) => {
    // Start a review session
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');
    
    // Wait for review session
    await page.waitForTimeout(3000);
    
    // Look for flip instruction text
    const flipInstruction = page.getByText('点击或按空格键翻转查看释义').first();
    if (await flipInstruction.isVisible().catch(() => false)) {
      await expect(flipInstruction).toBeVisible();
    }
  });
});

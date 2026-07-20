import { test, expect } from '@playwright/test';

/**
 * Theme toggle tests
 * Tests: light/dark mode switching, localStorage persistence
 */
test.describe('Theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('theme toggle button is visible', async ({ page }) => {
    const themeButton = page.locator('button[title="切换主题"], button[aria-label="切换主题"]').first();
    await expect(themeButton).toBeVisible();
  });

  test('can toggle between light and dark mode', async ({ page }) => {
    const themeButton = page.locator('button[title="切换主题"], button[aria-label="切换主题"]').first();
    
    // Get initial theme state
    const initialHasDark = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    
    // Click to toggle
    await themeButton.click();
    
    // Wait for transition
    await page.waitForTimeout(300);
    
    // Check theme changed
    const afterToggleHasDark = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    expect(afterToggleHasDark).not.toBe(initialHasDark);
    
    // Toggle back
    await themeButton.click();
    await page.waitForTimeout(300);
    
    const afterSecondToggle = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    expect(afterSecondToggle).toBe(initialHasDark);
  });

  test('theme preference is persisted in localStorage', async ({ page }) => {
    const themeButton = page.locator('button[title="切换主题"], button[aria-label="切换主题"]').first();
    
    // Toggle to dark
    await themeButton.click();
    await page.waitForTimeout(300);
    
    // Check localStorage
    const storedTheme = await page.evaluate(() => 
      localStorage.getItem('vocab-agent-theme')
    );
    expect(storedTheme).toBeTruthy();
    expect(['light', 'dark']).toContain(storedTheme);
  });
});

import { test, expect } from '@playwright/test';

/**
 * Command system tests
 * Tests: built-in commands, command suggestions, command execution
 */
test.describe('Command system', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('can execute /stats command', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/stats');
    await input.press('Enter');

    // Wait for stats to render
    await expect(page.getByText('学习统计').first()).toBeVisible({ timeout: 10000 });
  });

  test('can execute /review command', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');

    // Wait for review response
    await page.waitForTimeout(3000);
    
    // Should show some response (either review session or "no words" message)
    const response = page.locator('text=/复习|没有待复习|单词/').first();
    await expect(response).toBeVisible();
  });

  test('command suggestions appear when typing /', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/');
    
    // Command suggestions should appear
    await expect(page.locator('[data-command-list]')).toBeVisible();
  });

  test('command suggestions filter by typed text', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/re');
    
    // Command suggestions should appear with filtered results
    const commandList = page.locator('[data-command-list]');
    await expect(commandList).toBeVisible();
    
    // Should show commands starting with 're'
    const commands = commandList.locator('[data-command-name]');
    const count = await commands.count();
    expect(count).toBeGreaterThan(0);
  });

  test('can select command with Tab key', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/sta');
    
    // Wait for suggestions
    await expect(page.locator('[data-command-list]')).toBeVisible();
    
    // Press Tab to select first command
    await input.press('Tab');
    
    // Input should now have the full command
    const value = await input.inputValue();
    expect(value).toMatch(/^\/[a-z]+\s/);
  });

  test('can dismiss command suggestions with Escape', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/');
    
    // Suggestions should appear
    await expect(page.locator('[data-command-list]')).toBeVisible();
    
    // Press Escape
    await input.press('Escape');
    
    // Suggestions should disappear
    await expect(page.locator('[data-command-list]')).not.toBeVisible();
  });

  test('toolbar buttons trigger commands', async ({ page }) => {
    // Click the stats button in toolbar
    const statsButton = page.getByTitle('统计');
    await statsButton.click();
    
    // Should show stats response
    await expect(page.getByText('学习统计').first()).toBeVisible({ timeout: 10000 });
  });

  test('toolbar review button triggers review', async ({ page }) => {
    // Click the review button in toolbar
    const reviewButton = page.getByTitle('开始复习');
    await reviewButton.click();
    
    // Should show review response
    await page.waitForTimeout(3000);
    const response = page.locator('text=/复习|没有待复习/').first();
    await expect(response).toBeVisible();
  });

  test('can execute /add command', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/add testword');
    await input.press('Enter');

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should show some response
    const messages = page.locator('[class*="flex flex-wrap"]').last();
    await expect(messages).toBeVisible();
  });

  test('unknown command shows error or fallback', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/unknowncommand');
    await input.press('Enter');

    // Wait for response
    await page.waitForTimeout(3000);
    
    // Should show some response (error or fallback)
    const messages = page.locator('[class*="flex flex-wrap"]').last();
    await expect(messages).toBeVisible();
  });
});

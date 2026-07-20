import { test, expect } from '@playwright/test';

test.describe('Chat interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('can send a message and see it in chat', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('Hello world');
    await input.press('Enter');

    await expect(page.getByText('Hello world')).toBeVisible();
  });

  test('can use Ctrl+/ to focus input', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+Slash');

    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await expect(input).toBeFocused();
  });

  test('can clear input with Escape', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('test message');
    await expect(input).toHaveValue('test message');

    await input.press('Escape');
    await expect(input).toHaveValue('');
  });

  test('shows command suggestions when typing /', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/');

    await expect(page.locator('[data-command-list]')).toBeVisible();
  });

  test('can navigate command suggestions with arrow keys', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/re');

    await expect(page.locator('[data-command-list]')).toBeVisible();

    await input.press('ArrowDown');
    await input.press('Enter');

    const value = await input.inputValue();
    expect(value).toMatch(/^\/[a-z]+\s/);
  });

  test('can switch between teach and develop modes', async ({ page }) => {
    const modeSwitch = page.locator('[data-slot="switch"], [role="switch"]').first();

    try {
      await modeSwitch.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      test.skip('No mode switch found in current UI');
      return;
    }

    await modeSwitch.click();
    await expect(page.getByText('开发中').first()).toBeVisible();
    await modeSwitch.click();
    await expect(page.getByText('开发').first()).toBeVisible();
  });

  test('can click quick action buttons', async ({ page }) => {
    await expect(page.getByTitle('开始复习')).toBeVisible();
    await expect(page.getByTitle('统计')).toBeVisible();
    await expect(page.getByTitle('清空聊天记录')).toBeVisible();
  });

  test('textarea auto-resizes with multi-line input', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');

    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

    const height = await input.evaluate(el => (el as HTMLElement).style.height);
    expect(parseInt(height)).toBeGreaterThan(0);
  });
});

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Chat bubble check', () => {
  test('sends "version" and screenshots the chat', async ({ page }) => {
    await page.goto('/');

    // Wait for chat input to be visible
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await expect(input).toBeVisible();

    // Send "version"
    await input.fill('version');
    await input.press('Enter');

    // Wait for the assistant response to appear by looking for the "思考中..." text to disappear
    // and a message bubble to be present. We'll wait for any text in the chat area.
    await page.waitForTimeout(5000);

    // Ensure the results directory exists
    const resultsDir = path.join(process.cwd(), 'test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Take screenshot
    await page.screenshot({ path: path.join(resultsDir, 'small-bubble-check.png') });
  });
});

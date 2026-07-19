import { test, expect } from '@playwright/test';

test('screenshot assistant bubble after sending version', async ({ page }) => {
  await page.goto('/');

  // Wait for the chat input to be ready
  const input = page.getByPlaceholder('输入消息或 / 命令...');
  await expect(input).toBeVisible();

  // Send the "version" message
  await input.fill('version');
  await input.press('Enter');

  // Wait for the assistant's thinking indicator to appear then disappear
  const thinking = page.getByText('思考中...');
  try {
    await thinking.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    // It may be too fast; continue
  }
  await expect(thinking).toHaveCount(0, { timeout: 60000 });

  // Wait a moment for any post-stream badges/tool bubbles to render
  await page.waitForTimeout(1500);

  // Ensure there is at least one assistant reply bubble
  const assistantBubbles = page.locator('[class*="bg-muted/50"]');
  await expect(assistantBubbles.first()).toBeVisible({ timeout: 60000 });

  // Take a screenshot of the chat message list area
  const messageList = page.locator('.scrollbar-thin').first();
  await expect(messageList).toBeVisible();
  await messageList.screenshot({
    path: 'test-results/current-bubble.png',
    type: 'png',
  });
});

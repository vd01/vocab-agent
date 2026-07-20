import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const resultsDir = path.join(process.cwd(), 'test-results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

test.describe('Command rendering visual check', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await expect(input).toBeVisible();
  });

  test('/stats renders with proper styling', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/stats');
    await input.press('Enter');

    await page.waitForSelector('text=学习统计', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const statsHtml = await page.evaluate(() => {
      // Find all assistant messages by looking for the message wrapper
      const allMessages = document.querySelectorAll('[class*="flex flex-wrap"]');
      let statsContainer: Element | null = null;
      allMessages.forEach(msg => {
        if (msg.textContent?.includes('学习统计')) {
          statsContainer = msg;
        }
      });

      if (!statsContainer) return { error: 'Stats container not found' };

      // Get the content area
      const contentArea = statsContainer.querySelector('[class*="max-w-[90%]"]') || 
                         statsContainer.querySelector('[class*="max-w-[85%]"]');

      // Check if there's a bubble wrapper
      const bubbleWrapper = contentArea?.querySelector('[class*="rounded-2xl"]');
      
      // Check all children of contentArea
      const children = contentArea ? Array.from(contentArea.children) : [];
      const childInfo = children.map(child => ({
        tag: child.tagName,
        className: child.className?.slice(0, 100),
        hasRounded2xl: child.className?.includes('rounded-2xl'),
        hasBgMuted: child.className?.includes('bg-muted'),
        hasBorder: child.className?.includes('border'),
      }));

      // Also check for the review session (due-words) rendering
      const reviewSession = statsContainer.querySelector('[class*="review"]');
      const hasReviewSession = !!reviewSession;

      return {
        bubbleWrapperExists: !!bubbleWrapper,
        bubbleWrapperClass: bubbleWrapper?.className?.slice(0, 200),
        childCount: children.length,
        children: childInfo,
        hasReviewSession,
      };
    });

    console.log('STATS STRUCTURE:', JSON.stringify(statsHtml, null, 2));

    await page.screenshot({
      path: path.join(resultsDir, 'stats-rendering.png'),
      fullPage: true,
    });
  });

  test('/review renders with proper styling', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.fill('/review');
    await input.press('Enter');

    await page.waitForTimeout(3000);

    const reviewHtml = await page.evaluate(() => {
      const allMessages = document.querySelectorAll('[class*="flex flex-wrap"]');
      let reviewContainer: Element | null = null;
      allMessages.forEach(msg => {
        const text = msg.textContent || '';
        if (text.includes('复习') || text.includes('没有待复习') || text.includes('单词')) {
          reviewContainer = msg;
        }
      });

      if (!reviewContainer) return { error: 'Review container not found' };

      const contentArea = reviewContainer.querySelector('[class*="max-w-[90%]"]') || 
                         reviewContainer.querySelector('[class*="max-w-[85%]"]');

      const bubbleWrapper = contentArea?.querySelector('[class*="rounded-2xl"]');
      
      const children = contentArea ? Array.from(contentArea.children) : [];
      const childInfo = children.map(child => ({
        tag: child.tagName,
        className: child.className?.slice(0, 100),
        hasRounded2xl: child.className?.includes('rounded-2xl'),
        hasBgMuted: child.className?.includes('bg-muted'),
        hasBorder: child.className?.includes('border'),
      }));

      // Check for review session
      const reviewSession = reviewContainer.querySelector('[class*="review"]');
      const hasReviewSession = !!reviewSession;

      return {
        bubbleWrapperExists: !!bubbleWrapper,
        bubbleWrapperClass: bubbleWrapper?.className?.slice(0, 200),
        childCount: children.length,
        children: childInfo,
        hasReviewSession,
      };
    });

    console.log('REVIEW STRUCTURE:', JSON.stringify(reviewHtml, null, 2));

    await page.screenshot({
      path: path.join(resultsDir, 'review-rendering.png'),
      fullPage: true,
    });
  });
});

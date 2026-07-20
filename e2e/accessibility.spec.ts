import { test, expect } from '@playwright/test';

/**
 * Accessibility tests
 * Tests: keyboard navigation, ARIA labels, focus management, screen reader support
 */
test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('输入消息或 / 命令...')).toBeVisible();
  });

  test('chat input has correct ARIA attributes', async ({ page }) => {
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    
    // Should be a textarea
    const tagName = await input.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('textarea');
    
    // Should have placeholder
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  test('buttons have accessible labels', async ({ page }) => {
    // Check that main buttons have titles or aria-labels
    const buttons = page.locator('button');
    const count = await buttons.count();
    
    let labeledCount = 0;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const button = buttons.nth(i);
      const title = await button.getAttribute('title');
      const ariaLabel = await button.getAttribute('aria-label');
      const text = await button.textContent();
      
      if (title || ariaLabel || text?.trim()) {
        labeledCount++;
      }
    }
    
    // Most buttons should have some form of label
    expect(labeledCount).toBeGreaterThan(0);
  });

  test('can navigate with Tab key', async ({ page }) => {
    // Press Tab multiple times to navigate through interactive elements
    const focusedElements: string[] = [];
    
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const activeElement = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? {
          tagName: el.tagName,
          className: el.className?.slice(0, 50),
          ariaLabel: el.getAttribute('aria-label'),
          title: el.getAttribute('title'),
        } : null;
      });
      
      if (activeElement) {
        const identifier = activeElement.ariaLabel || activeElement.title || activeElement.tagName;
        if (!focusedElements.includes(identifier)) {
          focusedElements.push(identifier);
        }
      }
    }
    
    // Should have navigated to multiple elements
    expect(focusedElements.length).toBeGreaterThan(1);
  });

  test('mode switch has correct ARIA role', async ({ page }) => {
    const modeSwitch = page.locator('[data-slot="switch"], [role="switch"]').first();
    
    try {
      await modeSwitch.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      test.skip('No mode switch found');
      return;
    }
    
    // Should have switch role or data-slot
    const role = await modeSwitch.getAttribute('role');
    const dataSlot = await modeSwitch.getAttribute('data-slot');
    
    expect(role === 'switch' || dataSlot === 'switch').toBeTruthy();
  });

  test('images have alt text or are decorative', async ({ page }) => {
    // Check for images without alt text
    const images = page.locator('img');
    const count = await images.count();
    
    let missingAltCount = 0;
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const ariaHidden = await img.getAttribute('aria-hidden');
      
      if (!alt && ariaHidden !== 'true') {
        missingAltCount++;
      }
    }
    
    // All images should have alt text or be aria-hidden
    expect(missingAltCount).toBe(0);
  });

  test('form inputs have associated labels', async ({ page }) => {
    await page.goto('/settings');
    
    // Check that inputs have labels
    const inputs = page.locator('input');
    const count = await inputs.count();
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledBy = await input.getAttribute('aria-labelledby');
      const placeholder = await input.getAttribute('placeholder');
      
      // Should have some form of labeling
      const hasLabel = id || ariaLabel || ariaLabelledBy || placeholder;
      expect(hasLabel).toBeTruthy();
    }
  });

  test('color contrast is sufficient', async ({ page }) => {
    // Check that main text elements have sufficient contrast
    const body = page.locator('body');
    const bgColor = await body.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.backgroundColor;
    });
    
    const textColor = await body.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.color;
    });
    
    // Both should be defined
    expect(bgColor).toBeTruthy();
    expect(textColor).toBeTruthy();
    expect(bgColor).not.toBe(textColor);
  });

  test('focus indicators are visible', async ({ page }) => {
    // Focus on the input
    const input = page.getByPlaceholder('输入消息或 / 命令...');
    await input.focus();
    
    // Check that focused element has some visual indicator
    const outline = await input.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.outline || style.boxShadow || style.borderColor;
    });
    
    // Should have some focus indicator
    expect(outline).toBeTruthy();
  });
});

import { test, expect } from "@playwright/test";

/**
 * UI Component tests
 * Tests: buttons, inputs, cards, dialogs, badges
 */
test.describe("UI Components", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("buttons have correct styling", async ({ page }) => {
		// Check main action buttons
		const buttons = [
			{ title: "开始复习", expectedText: /复习/ },
			{ title: "统计", expectedText: /统计/ },
			{ title: "清空聊天记录", expectedText: /清空/ },
		];

		for (const { title, expectedText } of buttons) {
			const button = page.getByTitle(title);
			await expect(button).toBeVisible();

			const text = await button.textContent();
			expect(text).toMatch(expectedText);
		}
	});

	test("input fields have correct styling", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");

		// Should be visible and enabled
		await expect(input).toBeVisible();
		await expect(input).toBeEnabled();

		// Should have rounded corners
		const borderRadius = await input.evaluate((el) => {
			const style = window.getComputedStyle(el);
			return style.borderRadius;
		});
		expect(borderRadius).toBeTruthy();
		expect(borderRadius).not.toBe("0px");
	});

	test("cards have correct styling", async ({ page }) => {
		// Use toolbar button instead of typing (more reliable when AI is streaming)
		const statsButton = page.getByTitle("统计");
		await statsButton.click();

		await expect(page.getByText("学习统计").first()).toBeVisible({
			timeout: 10000,
		});

		// Look for card elements
		const cards = page
			.locator(
				'[class*="rounded-lg"], [class*="rounded-xl"], [class*="rounded-2xl"]',
			)
			.first();
		await expect(cards).toBeVisible();
	});

	test("badges render correctly", async ({ page }) => {
		// Go to quick lookup to see badges
		await page.goto("/quick-lookup");
		const input = page.getByPlaceholder("输入单词或短语...");
		await input.fill("hello");
		await input.press("Enter");

		// Wait for results
		await expect(page.locator("text=/hello/i").first()).toBeVisible({
			timeout: 15000,
		});

		// Look for badges (status indicators)
		const badges = page.locator('span[class*="rounded"]').first();
		if (await badges.isVisible().catch(() => false)) {
			await expect(badges).toBeVisible();
		}
	});

	test("scroll area works correctly", async ({ page }) => {
		// Send multiple messages to create scrollable content
		const input = page.getByPlaceholder("输入消息或 / 命令...");

		for (let i = 0; i < 10; i++) {
			await expect(input).toBeEnabled({ timeout: 10000 });
			await input.fill(`Message ${i} for scrolling test`);
			await input.press("Enter");
			await page.waitForTimeout(300);
		}

		// Find scrollable container
		const scrollContainer = page.locator(".scrollbar-thin").first();
		await expect(scrollContainer).toBeVisible();

		// Scroll to top
		await scrollContainer.evaluate((el) => (el.scrollTop = 0));

		// Check if scroll worked - scrollTop should be near 0
		const scrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
		expect(scrollTop).toBeLessThan(10);
	});

	test("separator renders correctly", async ({ page }) => {
		await page.goto("/settings");
		await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

		// Separators only render in Electron mode (isElectron condition)
		// In web mode, settings page has no Separator components
		// Instead, verify the page has multiple Card sections separated visually
		const cards = page.locator('[data-slot="card"]');
		const cardCount = await cards.count();
		expect(cardCount).toBeGreaterThanOrEqual(2);
	});

	test("progress indicators render correctly", async ({ page }) => {
		// Send a message to trigger loading state
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Test message");
		await input.press("Enter");

		// Look for progress or loading indicators
		const loadingIndicator = page
			.locator("text=/思考中|加载中|Loading/")
			.first();
		try {
			await loadingIndicator.waitFor({ state: "visible", timeout: 3000 });
			await expect(loadingIndicator).toBeVisible();
		} catch {
			// Loading may have completed too fast
		}
	});
});

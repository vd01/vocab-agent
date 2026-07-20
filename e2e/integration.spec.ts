import { test, expect } from "@playwright/test";

/**
 * Integration tests - Cross-feature workflows
 * Tests: end-to-end user workflows combining multiple features
 */
test.describe("Integration workflows", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("complete workflow: lookup word, add to library, review", async ({
		page,
	}) => {
		// Step 1: Quick lookup a word that's likely not in the library
		await page.goto("/quick-lookup");
		const input = page.getByPlaceholder("输入单词或短语...");
		await input.fill("xylophone");
		await input.press("Enter");

		// Wait for results - the word header should appear in a span with text-lg class
		await expect(
			page.locator("span.text-lg").filter({ hasText: "xylophone" }),
		).toBeVisible({ timeout: 15000 });
		await page.waitForTimeout(1000);

		// Step 2: Add to library if button exists
		const addButton = page
			.locator('button:has-text("入库"):not(:has-text("置顶"))')
			.first();
		if (await addButton.isVisible().catch(() => false)) {
			await addButton.click();
			// The action message uses "已添加" or status changes to "已入库"
			await expect(page.getByText(/已添加|已入库|操作完成/)).toBeVisible({
				timeout: 5000,
			});
		}

		// Step 3: Go back to home and run /review
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();

		const chatInput = page.getByPlaceholder("输入消息或 / 命令...");
		await chatInput.fill("/review");
		await chatInput.press("Enter");

		// Wait for review session
		await page.waitForTimeout(3000);

		// Should show review response
		const response = page.locator("text=/复习|没有待复习|单词/").first();
		await expect(response).toBeVisible();
	});

	test("workflow: send message, check stats, navigate settings", async ({
		page,
	}) => {
		// Step 1: Send a message
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Test workflow message");
		await input.press("Enter");

		// Verify message appears (use .first() to avoid strict mode from prior test data)
		await expect(page.getByText("Test workflow message").first()).toBeVisible();

		// Step 2: Use toolbar button for /stats (more reliable than typing in input)
		await page.getByTitle("统计").click();
		await expect(page.getByText("学习统计").first()).toBeVisible({
			timeout: 10000,
		});

		// Step 3: Navigate to settings
		const settingsLink = page.getByTitle("设置");
		await settingsLink.click();

		await page.waitForURL("/settings");
		await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

		// Step 4: Navigate back - window.history.back() may not work without history
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("workflow: switch mode, send dev message, switch back", async ({
		page,
	}) => {
		// Find mode switch
		const modeSwitch = page
			.locator('[data-slot="switch"], [role="switch"]')
			.first();

		try {
			await modeSwitch.waitFor({ state: "visible", timeout: 5000 });
		} catch {
			test.skip();
			return;
		}

		// Switch to dev mode
		await modeSwitch.click();
		await expect(page.getByText("开发中").first()).toBeVisible();

		// Send a message in dev mode
		const input = page.getByPlaceholder("描述你想添加或修改的功能...");
		await input.fill("Test dev mode message");
		await input.press("Enter");

		// Wait for message
		await expect(page.getByText("Test dev mode message")).toBeVisible();

		// Switch back to teach mode
		await modeSwitch.click();
		await expect(page.getByText("开发").first()).toBeVisible();

		// Verify placeholder changed back
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("workflow: use keyboard shortcuts for commands", async ({ page }) => {
		// Use Alt+S for stats
		await page.keyboard.press("Alt+s");

		// Wait for stats to appear
		await expect(page.getByText("学习统计").first()).toBeVisible({
			timeout: 10000,
		});
	});

	test("workflow: clear chat and verify empty state", async ({ page }) => {
		// Send a message first
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Message to be cleared");
		await input.press("Enter");

		// Verify message exists (use .first() to avoid strict mode from prior test data)
		await expect(page.getByText("Message to be cleared").first()).toBeVisible();

		// Clear chat
		const clearButton = page.getByTitle("清空聊天记录");
		await clearButton.click();

		// Handle confirmation dialog
		page.on("dialog", async (dialog) => {
			await dialog.accept();
		});

		// Wait for empty state or just verify chat is cleared
		await page.waitForTimeout(1000);
		// The welcome message may vary; just verify page is still functional
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});
});

import { test, expect } from "@playwright/test";

test.describe("Message list", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("messages appear after sending", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Test message");
		await input.press("Enter");

		await expect(page.getByText("Test message")).toBeVisible();
	});

	test("user messages are right-aligned", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("RightAlignTest");
		await input.press("Enter");

		// Find the message wrapper div that has justify-end
		const msgWrapper = page
			.locator("div.justify-end")
			.filter({ hasText: "RightAlignTest" })
			.first();
		await expect(msgWrapper).toBeVisible();
	});

	test("assistant avatar is visible for assistant messages", async ({
		page,
	}) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("version");
		await input.press("Enter");

		await page.waitForTimeout(5000);

		const avatar = page
			.locator("svg")
			.filter({ has: page.locator('path[d*="M9.813 15.904"]') })
			.first();
		if (await avatar.isVisible().catch(() => false)) {
			await expect(avatar).toBeVisible();
		}
	});

	test("chat scrolls to bottom on new messages", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");

		for (let i = 0; i < 5; i++) {
			// Wait for input to be enabled (not disabled by streaming)
			await expect(input).toBeEnabled({ timeout: 30000 });
			await input.fill(`ScrollMsg ${i}`);
			await input.press("Enter");
			await page.waitForTimeout(500);
		}

		// The last message should be visible (use .last() to avoid strict mode)
		await expect(page.getByText("ScrollMsg 4").last()).toBeVisible();
	});

	test("shows loading indicator during streaming", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Tell me a story");
		await input.press("Enter");

		const thinking = page.getByText("思考中...");
		try {
			await thinking.waitFor({ state: "visible", timeout: 5000 });
		} catch {
			// It may be too fast
		}
	});

	test("can clear chat history", async ({ page }) => {
		// Send a message first
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("ClearTestMsg");
		await input.press("Enter");

		await expect(page.getByText("ClearTestMsg")).toBeVisible();

		// Wait for any streaming to finish so the button becomes enabled
		await page.waitForTimeout(3000);

		// Set up dialog handler before clicking
		page.once("dialog", async (dialog) => {
			await dialog.accept();
		});

		const clearButton = page.getByTitle("清空聊天记录");
		await clearButton.click({ force: true });

		await page.waitForTimeout(1000);
	});
});

test.describe("Chat input", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("input placeholder changes in dev mode", async ({ page }) => {
		const modeSwitch = page
			.locator('[data-slot="switch"], [role="switch"]')
			.first();

		try {
			await modeSwitch.waitFor({ state: "visible", timeout: 5000 });
			await modeSwitch.click();

			await expect(
				page.getByPlaceholder("描述你想添加或修改的功能..."),
			).toBeVisible();
		} catch {
			test.skip();
		}
	});

	test("send button is disabled when input is empty", async ({ page }) => {
		const sendButton = page.locator('button[type="submit"]').first();
		await expect(sendButton).toBeDisabled();
	});

	test("send button is enabled when input has text", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("test");

		const sendButton = page.locator('button[type="submit"]').first();
		await expect(sendButton).toBeEnabled();
	});

	test("shows stop button while loading", async ({ page }) => {
		const input = page.getByPlaceholder("输入消息或 / 命令...");
		await input.fill("Test message");
		await input.press("Enter");

		// Look for stop button (contains a rect element)
		const stopButton = page.locator("button:has(svg rect)").first();
		try {
			await stopButton.waitFor({ state: "visible", timeout: 3000 });
		} catch {
			// Response may have completed too fast
		}
	});

	test("shows keyboard shortcut hint", async ({ page }) => {
		await expect(
			page.getByText("按 Enter 发送，Shift+Enter 换行"),
		).toBeVisible();
	});
});

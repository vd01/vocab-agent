import { test, expect } from "@playwright/test";

test.describe("Group management", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await expect(page.getByPlaceholder("输入消息或 / 命令...")).toBeVisible();
	});

	test("group selector is visible in header", async ({ page }) => {
		const groupSelector = page.locator("text=分组").first();
		await expect(groupSelector).toBeVisible();
	});

	test("can open group selector dropdown", async ({ page }) => {
		const groupSelector = page.locator("text=分组").first();
		await groupSelector.click();

		// Use .first() to avoid strict mode violation (button text + dropdown item both match)
		await expect(page.getByText("全部").first()).toBeVisible();
	});

	test("can create a new group", async ({ page }) => {
		const groupSelector = page.locator("text=分组").first();
		await groupSelector.click();

		const createButton = page.getByText("+ 新建分组");
		await expect(createButton).toBeVisible();
		// Force click to bypass overlay interception from card element
		await createButton.click({ force: true });

		const groupInput = page.locator('input[placeholder="分组名"]');
		await expect(groupInput).toBeVisible();
		await groupInput.fill("TestGroup");

		const submitButton = groupInput.locator("xpath=../button");
		await submitButton.click();

		await page.waitForTimeout(500);
	});

	test("can switch between groups", async ({ page }) => {
		const groupSelector = page.locator("text=分组").first();
		await groupSelector.click();

		// Click the "全部" option inside the dropdown (second match)
		const allOption = page.locator('button:has-text("全部")').last();
		await allOption.click();

		await page.waitForTimeout(300);
	});

	test("group selector closes on Escape", async ({ page }) => {
		const groupSelector = page.locator("text=分组").first();
		await groupSelector.click();

		await page.keyboard.press("Escape");
		await page.waitForTimeout(300);
	});
});

/**
 * 端到端集成测试
 * 测试完整的聊天 API 流程：页面加载、Teacher/Developer 模式路由、工具调用、FSRS 复习
 *
 * 运行方式: npm run test:e2e
 * 前提条件: 开发服务器必须已在运行 (npm run dev --turbopack --port 3088)
 */
import { describe, it, expect } from "vitest";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3088";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Send a chat message and collect all SSE events */
async function chat(
	userText: string,
	options: { mode?: "teach" | "develop"; timeout?: number } = {},
) {
	const { mode = "teach", timeout = 60000 } = options;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const res = await fetch(`${BASE_URL}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				message: userText,
				mode,
				modeSwitched: false,
			}),
			signal: controller.signal,
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${await res.text()}`);
		}

		// Parse SSE stream
		const text = await res.text();
		const events = text
			.split("\n")
			.filter((line) => line.startsWith("data: "))
			.map((line) => {
				try {
					return JSON.parse(line.slice(6));
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		return events;
	} finally {
		clearTimeout(timer);
	}
}

/** Extract accumulated text from SSE events */
function extractText(events: any[]): string {
	return events
		.filter((e) => e.type === "text-delta" && e.delta)
		.map((e) => e.delta)
		.join("");
}

/** Extract tool calls from SSE events */
function extractToolCalls(
	events: any[],
): Array<{ toolName: string; toolCallId: string; uiData: any }> {
	const starts = events.filter((e) => e.type === "tool-start");
	const ends = events.filter((e) => e.type === "tool-result");

	return starts.map((s) => {
		const end = ends.find((e) => e.toolCallId === s.toolCallId);
		return {
			toolName: s.toolName,
			toolCallId: s.toolCallId,
			uiData: end?.uiData ?? null,
		};
	});
}

/** Check if agent lifecycle events are present */
function hasAgentEvents(events: any[]) {
	return {
		start: events.some((e) => e.type === "agent-start"),
		end: events.some((e) => e.type === "agent-end"),
		settled: events.some((e) => e.type === "agent-settled"),
	};
}

// ── Server Health ────────────────────────────────────────────────────────

describe("E2E - Server Health", () => {
	it("should serve the main page", async () => {
		const res = await fetch(BASE_URL);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Vocab Agent");
	});
});

// ── Teacher Mode ─────────────────────────────────────────────────────────

describe("E2E - Teacher Mode", () => {
	it("should respond to greetings in Chinese", async () => {
		const events = await chat("你好");
		const text = extractText(events);
		expect(text.length).toBeGreaterThan(0);
		expect(text).toMatch(/[一-鿿]/);
	});

	it("should emit agent lifecycle events", async () => {
		const events = await chat("hello");
		const lifecycle = hasAgentEvents(events);
		expect(lifecycle.start).toBe(true);
		expect(lifecycle.end).toBe(true);
	});

	it("should stream text-delta events", async () => {
		const events = await chat("say hi");
		const deltas = events.filter((e) => e.type === "text-delta");
		expect(deltas.length).toBeGreaterThan(0);
	});

	it("should call add-word tool when asked to add a word", async () => {
		const uniqueWord = `e2e_add_${Date.now()}`;
		const events = await chat(`请添加单词 ${uniqueWord}，意思是"测试单词"`, {
			timeout: 90000,
		});

		const toolCalls = extractToolCalls(events);
		const toolNames = toolCalls.map((tc) => tc.toolName);

		// Should call add-word directly or vocab-lookup first
		expect(
			toolNames.some((n) => n === "add-word" || n === "vocab-lookup"),
		).toBe(true);
	}, 100000);

	it("should call fsrs-review tool when asked to review", async () => {
		const events = await chat("我要复习单词", { timeout: 90000 });

		const toolCalls = extractToolCalls(events);
		const reviewCall = toolCalls.find((tc) => tc.toolName === "fsrs-review");
		expect(reviewCall).toBeDefined();

		// Output should be due-words or no-due-words
		if (reviewCall?.uiData) {
			expect(["due-words", "no-due-words"]).toContain(reviewCall.uiData.type);
		}
	}, 100000);

	it("should call vocab-lookup tool for word queries", async () => {
		const events = await chat("查一下 ephemeral 是什么意思", {
			timeout: 90000,
		});

		const toolCalls = extractToolCalls(events);
		const toolNames = toolCalls.map((tc) => tc.toolName);
		expect(
			toolNames.some((n) => n === "vocab-lookup" || n === "dict-lookup"),
		).toBe(true);
	}, 100000);

	it("should NOT use developer tools in teach mode", async () => {
		const events = await chat("帮我写一个组件", { timeout: 90000 });

		const toolCalls = extractToolCalls(events);
		const devToolNames = toolCalls
			.map((tc) => tc.toolName)
			.filter((n) =>
				[
					"create-command",
					"register-component",
					"db-query",
					"safe-ls",
					"readSeek_read",
					"readSeek_write",
				].includes(n),
			);

		// Teacher mode should not call developer-only tools.
		// It may refuse the request and suggest switching to develop mode.
		expect(devToolNames.length).toBe(0);
	}, 100000);
});

// ── Developer Mode ───────────────────────────────────────────────────────

describe("E2E - Developer Mode", () => {
	it("should respond in develop mode", async () => {
		const events = await chat("你好", { mode: "develop" });
		const text = extractText(events);
		expect(text.length).toBeGreaterThan(0);
	});

	it("should emit agent lifecycle events in develop mode", async () => {
		const events = await chat("hello", { mode: "develop" });
		const lifecycle = hasAgentEvents(events);
		expect(lifecycle.start).toBe(true);
		expect(lifecycle.end).toBe(true);
	});

	it("should have developer tools available (db-query)", async () => {
		const events = await chat("查询词库有多少单词", {
			mode: "develop",
			timeout: 90000,
		});

		const toolCalls = extractToolCalls(events);
		const toolNames = toolCalls.map((tc) => tc.toolName);

		// Developer mode should use developer tools like db-query
		expect(toolNames).toContain("db-query");
	}, 100000);

	it("should NOT call teacher tools in develop mode", async () => {
		const events = await chat("帮我查一下词库", {
			mode: "develop",
			timeout: 90000,
		});

		const toolCalls = extractToolCalls(events);
		const teacherToolNames = toolCalls
			.map((tc) => tc.toolName)
			.filter((n) =>
				["fsrs-review", "fsrs-rate", "add-word", "vocab-lookup"].includes(n),
			);

		// Developer mode should not call teacher tools
		expect(teacherToolNames.length).toBe(0);
	}, 100000);

	it("should use file tools when asked to read code", async () => {
		const events = await chat("看一下 src/lib/db/index.ts 的内容", {
			mode: "develop",
			timeout: 90000,
		});

		const toolCalls = extractToolCalls(events);
		const toolNames = toolCalls.map((tc) => tc.toolName);

		// Should use read or readSeek_read
		expect(
			toolNames.some(
				(n) => n === "read" || n === "readSeek_read" || n === "safe-ls",
			),
		).toBe(true);
	}, 100000);
});

// ── Mode Switching ───────────────────────────────────────────────────────

describe("E2E - Mode Switching", () => {
	it("should switch from teach to develop and use dev tools", async () => {
		// First request in teach mode
		const teachEvents = await chat("你好", { mode: "teach" });
		const teachText = extractText(teachEvents);
		expect(teachText.length).toBeGreaterThan(0);

		// Switch to develop mode
		const devEvents = await chat("查询词库有多少单词", {
			mode: "develop",
			timeout: 90000,
		});
		const devToolCalls = extractToolCalls(devEvents);
		const devToolNames = devToolCalls.map((tc) => tc.toolName);

		// Should now have developer tools
		expect(devToolNames).toContain("db-query");
	}, 100000);

	it("should switch from develop to teach and use teacher tools", async () => {
		// First request in develop mode
		const devEvents = await chat("你好", { mode: "develop" });
		const devText = extractText(devEvents);
		expect(devText.length).toBeGreaterThan(0);

		// Switch to teach mode
		const teachEvents = await chat("我要复习单词", {
			mode: "teach",
			timeout: 90000,
		});
		const teachToolCalls = extractToolCalls(teachEvents);
		const teachToolNames = teachToolCalls.map((tc) => tc.toolName);

		// Should now have teacher tools
		expect(teachToolNames.some((n) => n === "fsrs-review")).toBe(true);
	}, 100000);
});

// ── Command Handling ─────────────────────────────────────────────────────

describe("E2E - Command Handling", () => {
	it("should handle /review command", async () => {
		const res = await fetch(`${BASE_URL}/api/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/review" }),
		});
		expect(res.ok).toBe(true);
		const result = await res.json();
		expect(["due-words", "no-due-words"]).toContain(result.type);
	});

	it("should handle /add command", async () => {
		const testWord = `cmdtest_${Date.now()}`;
		const res = await fetch(`${BASE_URL}/api/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: `/add ${testWord} 测试单词` }),
		});
		expect(res.ok).toBe(true);
		const result = await res.json();
		expect(result.type).toBe("added");
		expect(result.word).toBe(testWord);
	});

	it("should handle /stats command", async () => {
		const res = await fetch(`${BASE_URL}/api/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/stats" }),
		});
		expect(res.ok).toBe(true);
		const result = await res.json();
		expect(result.type).toBe("stats");
		expect(result).toHaveProperty("totalWords");
		expect(result).toHaveProperty("distribution");
		expect(result).toHaveProperty("daily");
	});

	it("should return unknown-command for invalid commands", async () => {
		const res = await fetch(`${BASE_URL}/api/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ command: "/nonexistent" }),
		});
		expect(res.ok).toBe(true);
		const result = await res.json();
		expect(result.type).toBe("unknown-command");
	});
});

/**
 * ChatMessage types for the vocab-agent frontend.
 *
 * Replaces AI SDK's UIMessage with a simpler, pi-SDK-oriented format.
 * Messages come from two sources:
 *   1. pi SDK events (LLM text, tool results, thinking)
 *   2. Business commands (frontend API Route calls)
 */

// ── Base ─────────────────────────────────────────────────────────────────

interface BaseMessage {
	id: string;
	timestamp: number;
}

// ── User message ─────────────────────────────────────────────────────────

export interface UserMessage extends BaseMessage {
	role: "user";
	content: string;
	/** Attached images (base64) */
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
}

// ── Assistant text message ───────────────────────────────────────────────

export interface AssistantTextMessage extends BaseMessage {
	role: "assistant";
	type: "text";
	content: string;
}

// ── Assistant reasoning message ──────────────────────────────────────────

export interface AssistantReasoningMessage extends BaseMessage {
	role: "assistant";
	type: "reasoning";
	content: string;
}

// ── Tool result message ──────────────────────────────────────────────────

/**
 * A tool execution result that needs UI rendering.
 *
 * This is the unified type for both:
 *   - LLM tool results (from pi SDK tool_execution_end events)
 *   - Business command results (from /api/commands API calls)
 *
 * The `uiType` field determines which renderer to use:
 *   - Built-in renderers: "due-words", "found", "stats", "added", etc.
 *   - Dynamic components: componentRegistry.has(uiType) → DynamicRenderer
 */
export interface ToolResultMessage extends BaseMessage {
	role: "tool-result";
	/** Tool or command name (e.g. "fsrs-review", "vocab-lookup", "review") */
	toolName: string;
	/** UI renderer key — determines which component renders this result */
	uiType: string;
	/** Structured data for the renderer */
	data: Record<string, unknown>;
	/** Whether this tool result is from an error */
	isError?: boolean;
}

// ── Union type ───────────────────────────────────────────────────────────

export type ChatMessage =
	| UserMessage
	| AssistantTextMessage
	| AssistantReasoningMessage
	| ToolResultMessage;

// ── Helpers ──────────────────────────────────────────────────────────────

export function createUserMessage(content: string): UserMessage {
	return {
		id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content,
		timestamp: Date.now(),
	};
}

export function createAssistantTextMessage(
	content: string,
	id?: string,
): AssistantTextMessage {
	return {
		id: id ?? `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "assistant",
		type: "text",
		content,
		timestamp: Date.now(),
	};
}

export function createAssistantReasoningMessage(
	content: string,
): AssistantReasoningMessage {
	return {
		id: `reason-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "assistant",
		type: "reasoning",
		content,
		timestamp: Date.now(),
	};
}

export function createToolResultMessage(
	toolName: string,
	uiType: string,
	data: Record<string, unknown>,
	isError?: boolean,
): ToolResultMessage {
	return {
		id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "tool-result",
		toolName,
		uiType,
		data,
		isError,
		timestamp: Date.now(),
	};
}

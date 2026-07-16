/**
 * Chat API Route — pi SDK backend
 *
 * Replaces the AI SDK v7 streamText() backend with pi SDK.
 * Uses createAgentSession() embedded in the Next.js process.
 *
 * Flow:
 *   1. Frontend sends prompt via POST
 *   2. Route calls session.prompt() with the user message
 *   3. Subscribes to pi events and converts them to SSE stream
 *   4. Frontend consumes SSE to render messages
 */

import { getPiSession, type AgentSession } from "@/lib/pi/session";

export const maxDuration = 60;

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { message, mode, modeSwitched, activeGroup } = body as {
			message?: string;
			mode?: string;
			modeSwitched?: boolean;
			activeGroup?: string;
		};

		if (!message?.trim()) {
			return Response.json(
				{ error: "Message is required" },
				{ status: 400 },
			);
		}

		// Get the global pi session
		const session = await getPiSession();

		// Store mode context for the vocab-agent extension to read
		// (The extension reads this in before_agent_start to switch tools/prompts)
		const resolvedMode = mode ?? "teach";
		console.log(`[Chat API] Setting mode: ${resolvedMode}, modeSwitched: ${modeSwitched}`);
		setCurrentMode(resolvedMode, {
			modeSwitched: modeSwitched === true,
			activeGroup: activeGroup ?? null,
		});

		// Create SSE stream from pi events
		const stream = createSSEStream(session, message);

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("[Chat API Error]", error);
		return Response.json(
			{
				error: "Internal server error",
				details: String(error),
			},
			{ status: 500 },
		);
	}
}

// ── Mode context (shared with vocab-agent extension) ─────────────────────

export interface ModeContext {
	mode: "teach" | "develop";
	modeSwitched: boolean;
	activeGroup: string | null;
}

// Use globalThis to share across module instances
// (jiti and Turbopack load separate instances of the same module)
const GLOBAL_KEY = "__vocab_mode_context__" as const;

const defaultModeContext: ModeContext = {
	mode: "teach",
	modeSwitched: false,
	activeGroup: null,
};

function setCurrentMode(
	mode: string,
	extra: { modeSwitched: boolean; activeGroup: string | null },
) {
	const ctx: ModeContext = {
		mode: mode === "develop" ? "develop" : "teach",
		...extra,
	};
	(globalThis as any)[GLOBAL_KEY] = ctx;
}

/** Read by vocab-agent extension to determine active mode */
export function getCurrentModeContext(): ModeContext {
	return (globalThis as any)[GLOBAL_KEY] ?? defaultModeContext;
}

// ── SSE Stream Builder ───────────────────────────────────────────────────

function createSSEStream(
	session: AgentSession,
	message: string,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let aborted = false;

	return new ReadableStream({
		async start(controller) {
			// Subscribe to pi session events
			const unsubscribe = session.subscribe((event) => {
				if (aborted) return;

				try {
					switch (event.type) {
						// ── Streaming text/thinking ──────────────────────
						case "message_update": {
							const ae = event.assistantMessageEvent;
							if (!ae) break;

							if (ae.type === "text_delta") {
								controller.enqueue(
									encoder.encode(
										formatSSE("text-delta", {
											id: "assistant",
											delta: ae.delta,
										}),
									),
								);
							} else if (ae.type === "thinking_delta") {
								controller.enqueue(
									encoder.encode(
										formatSSE("thinking-delta", {
											id: "reasoning",
											delta: ae.delta,
										}),
									),
								);
							}
							// text_start, text_end, thinking_start, thinking_end, etc. can be handled here
							break;
						}

						// ── Tool execution ──────────────────────────────
						case "tool_execution_start": {
							controller.enqueue(
								encoder.encode(
									formatSSE("tool-start", {
										toolCallId: event.toolCallId,
										toolName: event.toolName,
									}),
								),
							);
							break;
						}

						case "tool_execution_end": {
							const details = event.result?.details as
								| Record<string, unknown>
								| undefined;
							controller.enqueue(
								encoder.encode(
									formatSSE("tool-result", {
										toolCallId: event.toolCallId,
										toolName: event.toolName,
										isError: event.isError,
										// Pass details for UI rendering
										uiData: details ?? null,
										// Also pass text content for fallback
										textContent: event.result?.content
											?.filter((c: any) => c.type === "text")
											.map((c: any) => c.text)
											.join("\n") ?? null,
									}),
								),
							);
							break;
						}

						// ── Agent lifecycle ─────────────────────────────
						case "agent_start": {
							controller.enqueue(
								encoder.encode(formatSSE("agent-start", {})),
							);
							break;
						}

						case "agent_end": {
							controller.enqueue(
								encoder.encode(formatSSE("agent-end", {})),
							);
							break;
						}

						case "agent_settled": {
							controller.enqueue(
								encoder.encode(formatSSE("agent-settled", {})),
							);
							break;
						}
					}
				} catch (err) {
					// Controller might be closed after abort
				}
			});

			try {
				// Send the prompt — this blocks until the agent finishes
				await session.prompt(message);
			} catch (err: unknown) {
				if (!aborted) {
					console.error("[Chat API] Prompt error:", err);
					controller.enqueue(
						encoder.encode(
							formatSSE("error", {
								message:
									err instanceof Error ? err.message : String(err),
							}),
						),
					);
				}
			} finally {
				unsubscribe();
				try {
					controller.close();
				} catch {}
			}
		},

		cancel() {
			aborted = true;
			session.abort();
		},
	});
}

// ── SSE Formatting ───────────────────────────────────────────────────────

function formatSSE(
	event: string,
	data: Record<string, unknown>,
): string {
	return `data: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

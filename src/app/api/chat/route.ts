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

import {
	getPiSession,
	queuePrompt,
	abortAndClearQueue,
	type AgentSession,
} from "@/lib/pi/session";
import { runWithModeContext, setCurrentMode } from "@/lib/pi/mode-context";

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
			return Response.json({ error: "Message is required" }, { status: 400 });
		}

		// Get the global pi session
		const session = await getPiSession();

		// Build mode context for the vocab-agent extension to read
		// (The extension reads this in before_agent_start to switch tools/prompts)
		const resolvedMode = mode ?? "teach";
		console.log(
			`[Chat API] Setting mode: ${resolvedMode}, modeSwitched: ${modeSwitched}`,
		);
		const modeCtx = setCurrentMode(resolvedMode, {
			modeSwitched: modeSwitched === true,
			activeGroup: activeGroup ?? null,
		});

		// Run the entire SSE stream within AsyncLocalStorage scope
		// so the extension can read the correct mode per-request
		const stream = runWithModeContext(modeCtx, () =>
			createSSEStream(session, message),
		);

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

// Mode context is now managed via AsyncLocalStorage in @/lib/pi/mode-context
// See that module for setCurrentMode / getCurrentModeContext

// ── SSE Stream Builder ───────────────────────────────────────────────────

function createSSEStream(
	session: AgentSession,
	message: string,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let aborted = false;
	let eventCount = 0;

	return new ReadableStream({
		async start(controller) {
			// Subscribe to pi session events
			const unsubscribe = session.subscribe((event) => {
				if (aborted) return;
				eventCount++;

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
							break;
						}

						// ── Tool execution ──────────────────────────────
						case "tool_execution_start": {
							console.log(
								`[Chat SSE] tool-start: ${event.toolName} (${event.toolCallId})`,
							);
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
							const textContent =
								event.result?.content
									?.filter((c: any) => c.type === "text")
									.map((c: any) => c.text)
									.join("\n") ?? null;
							console.log(
								`[Chat SSE] tool-result: ${event.toolName} (${event.toolCallId}), isError=${event.isError}, hasDetails=${!!details}, textLen=${textContent?.length ?? 0}`,
							);
							controller.enqueue(
								encoder.encode(
									formatSSE("tool-result", {
										toolCallId: event.toolCallId,
										toolName: event.toolName,
										isError: event.isError,
										// Pass details for UI rendering
										uiData: details ?? null,
										// Also pass text content for fallback
										textContent,
									}),
								),
							);
							break;
						}

						// ── Agent lifecycle ─────────────────────────────
						case "agent_start": {
							console.log(`[Chat SSE] agent-start`);
							controller.enqueue(encoder.encode(formatSSE("agent-start", {})));
							break;
						}

						case "agent_end": {
							console.log(`[Chat SSE] agent-end`);
							controller.enqueue(encoder.encode(formatSSE("agent-end", {})));
							break;
						}

						case "agent_settled": {
							console.log(
								`[Chat SSE] agent-settled (total events: ${eventCount})`,
							);
							controller.enqueue(
								encoder.encode(formatSSE("agent-settled", {})),
							);
							break;
						}
					}
				} catch (err) {
					console.error(`[Chat SSE] Error sending event #${eventCount}:`, err);
				}
			});

			try {
				// Send the prompt via queue (serializes concurrent requests)
				console.log(`[Chat SSE] Calling queuePrompt()...`);
				await queuePrompt(session, message);
				console.log(
					`[Chat SSE] queuePrompt() completed successfully (${eventCount} events sent)`,
				);
			} catch (err: unknown) {
				if (!aborted) {
					console.error(`[Chat SSE] session.prompt() FAILED:`, err);
					controller.enqueue(
						encoder.encode(
							formatSSE("error", {
								message: err instanceof Error ? err.message : String(err),
							}),
						),
					);
				}
			} finally {
				unsubscribe();
				try {
					controller.close();
				} catch (closeErr) {
					// Controller may already be closed if the client disconnected
					console.debug(
						"[Chat SSE] Controller close error (expected on disconnect):",
						closeErr,
					);
				}
			}
		},

		cancel() {
			aborted = true;
			abortAndClearQueue(session);
		},
	});
}

// ── SSE Formatting ───────────────────────────────────────────────────────

function formatSSE(event: string, data: Record<string, unknown>): string {
	return `data: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

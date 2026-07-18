/**
 * Mode Context — Request-scoped mode state via AsyncLocalStorage.
 *
 * Replaces the previous globalThis-based approach which was unsafe under
 * concurrent requests (one request's mode could overwrite another's).
 *
 * AsyncLocalStorage guarantees each HTTP request has its own isolated store,
 * so the vocab-agent extension reads the correct mode even when multiple
 * requests are in flight simultaneously.
 *
 * Usage:
 *   - In API route: `runWithModeContext(ctx, () => { ... })`
 *   - In extension: `getCurrentModeContext()` reads from the current ALS store
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ── Types ────────────────────────────────────────────────────────────────

export interface ModeContext {
	mode: "teach" | "develop";
	modeSwitched: boolean;
	activeGroup: string | null;
}

const defaultModeContext: ModeContext = {
	mode: "teach",
	modeSwitched: false,
	activeGroup: null,
};

// ── AsyncLocalStorage ────────────────────────────────────────────────────

export const modeContextStore = new AsyncLocalStorage<ModeContext>();

// ── API ──────────────────────────────────────────────────────────────────

/**
 * Set the current mode context and run `fn` within that scope.
 * All calls to `getCurrentModeContext()` inside `fn` (including in
 * pi extension hooks triggered during the same async call chain)
 * will see this context.
 */
export function runWithModeContext<T>(ctx: ModeContext, fn: () => T): T {
	return modeContextStore.run(ctx, fn);
}

/**
 * Set the current mode context (convenience for route.ts).
 * Returns the constructed ModeContext.
 */
export function setCurrentMode(
	mode: string,
	extra: { modeSwitched: boolean; activeGroup: string | null },
): ModeContext {
	const ctx: ModeContext = {
		mode: mode === "develop" ? "develop" : "teach",
		...extra,
	};
	return ctx;
}

/**
 * Read the current mode context.
 *
 * In API route scope: reads from AsyncLocalStorage (request-isolated).
 * Fallback: returns default (teach mode) if called outside any ALS scope.
 */
export function getCurrentModeContext(): ModeContext {
	return modeContextStore.getStore() ?? defaultModeContext;
}

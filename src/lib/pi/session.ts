/**
 * Pi SDK Integration — Global singleton for vocab-agent's pi AgentSession.
 *
 * Embeds pi inside the Next.js process using an isolated agentDir (.pi-vocab/).
 * This module is only imported server-side (API Routes).
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	AuthStorage,
	ModelRegistry,
	type AgentSession,
	type CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// ── Isolated agentDir for vocab-agent ────────────────────────────────────

const VOCAB_AGENT_DIR = join(process.cwd(), ".pi-vocab");

function ensureAgentDir() {
	if (!existsSync(VOCAB_AGENT_DIR)) {
		mkdirSync(VOCAB_AGENT_DIR, { recursive: true });
	}
	for (const sub of ["extensions", "skills", "sessions"]) {
		const dir = join(VOCAB_AGENT_DIR, sub);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
}

// ── Singleton ────────────────────────────────────────────────────────────

let sessionResult: CreateAgentSessionResult | null = null;
let sessionInitPromise: Promise<CreateAgentSessionResult> | null = null;

/**
 * Get or initialize the global pi AgentSession.
 *
 * The session is lazily created on first call and reused thereafter.
 * It uses the isolated .pi-vocab/ agentDir, so vocab extensions,
 * packages, and sessions are completely separate from the user's
 * everyday pi environment (~/.pi/agent/).
 */
export async function getPiSession(): Promise<AgentSession> {
	if (sessionResult) return sessionResult.session;
	if (sessionInitPromise) {
		const result = await sessionInitPromise;
		return result.session;
	}

	sessionInitPromise = initSession();
	sessionResult = await sessionInitPromise;
	return sessionResult.session;
}

/**
 * Get the full CreateAgentSessionResult (includes extensionsResult, etc.)
 */
export async function getPiSessionResult(): Promise<CreateAgentSessionResult> {
	if (sessionResult) return sessionResult;
	if (sessionInitPromise) return await sessionInitPromise;

	sessionInitPromise = initSession();
	sessionResult = await sessionInitPromise;
	return sessionResult;
}

// ── Initialization ───────────────────────────────────────────────────────

async function initSession(): Promise<CreateAgentSessionResult> {
	ensureAgentDir();
	// jiti @/ aliases are patched via scripts/postinstall-patch-jiti.js

	const cwd = process.cwd();

	// Write models.json with env vars at runtime (not committed to git)
	const apiKey = process.env.OPENAI_API_KEY ?? "";
	const baseUrl = process.env.OPENAI_BASE_URL ?? "";
	const teacherModelId = process.env.TEACHER_MODEL ?? "gpt-4o-mini";
	const developerModelId = process.env.DEVELOPER_MODEL ?? teacherModelId;

	const modelsConfig = {
		providers: {
			"openai-compatible": {
				name: "OpenAI Compatible",
				baseUrl,
				apiKey,
				api: "openai-completions",
				models: [
					{
						id: teacherModelId,
						name: `Teacher (${teacherModelId})`,
						reasoning: false,
						contextWindow: 128000,
						maxTokens: 4096,
					},
					{
						id: developerModelId,
						name: `Developer (${developerModelId})`,
						reasoning: true,
						contextWindow: 128000,
						maxTokens: 16384,
					},
				],
			},
		},
	};
	writeFileSync(join(VOCAB_AGENT_DIR, "models.json"), JSON.stringify(modelsConfig, null, 2));

	const authStorage = AuthStorage.create(join(VOCAB_AGENT_DIR, "auth.json"));
	const modelRegistry = ModelRegistry.create(
		authStorage,
		join(VOCAB_AGENT_DIR, "models.json"),
	);

	// Settings: read from .pi-vocab/settings.json
	const settingsManager = SettingsManager.create(cwd, VOCAB_AGENT_DIR);

	// ResourceLoader: discovers extensions, skills, packages from .pi-vocab/
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: VOCAB_AGENT_DIR,
		settingsManager,
	});
	await loader.reload();

	// Find the teacher model in the registry
	const available = await modelRegistry.getAvailable();
	let model = available.find(
		(m) => m.id === teacherModelId || m.name === teacherModelId,
	);

	// If no exact match, use the first available from our provider
	if (!model && available.length > 0) {
		model = available[0];
		console.log(
			`[Pi SDK] Model "${teacherModelId}" not found, using "${model.name}"`,
		);
	}

	const result = await createAgentSession({
		resourceLoader: loader,
		authStorage,
		modelRegistry,
		settingsManager,
		sessionManager: SessionManager.inMemory(),
		model: model ?? undefined,
		// In-memory sessions — we persist messages ourselves via /api/messages
	});

	console.log(
		`[Pi SDK] Session initialized (agentDir: ${VOCAB_AGENT_DIR})`,
	);
	console.log(
		`[Pi SDK] Extensions loaded: ${result.extensionsResult.extensions.length}`,
	);
	if (result.extensionsResult.errors.length > 0) {
		for (const err of result.extensionsResult.errors) {
			console.error(`[Pi SDK] Extension error: ${err.path}: ${err.error}`);
		}
	}

	return result;
}

// ── Helper: dispose session (for graceful shutdown) ──────────────────────

export function disposePiSession() {
	if (sessionResult) {
		sessionResult.session.dispose();
		sessionResult = null;
		sessionInitPromise = null;
	}
}

/**
 * Reset the pi session's in-memory conversation history.
 *
 * This clears the SessionManager's fileEntries (message history) so the
 * LLM starts fresh on the next prompt. Without this, even after deleting
 * chat_messages from the DB, the pi agent still "remembers" previous
 * conversations because they live in the in-memory SessionManager.
 *
 * Call this when the user wants to clear/purge all chat history.
 */
export async function resetPiSession(): Promise<void> {
	const result = sessionResult;
	if (!result) return;

	// Clear the in-memory session history
	result.session.sessionManager.newSession();

	// Also clear the agent's internal message state so the next prompt
	// doesn't carry over stale context
	result.session.agent.state.messages = [];

	console.log('[Pi SDK] Session history reset — conversation context cleared');
}

// ── Exports for external use ─────────────────────────────────────────────

export { VOCAB_AGENT_DIR };
export type { AgentSession };

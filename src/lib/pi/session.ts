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
import { existsSync, mkdirSync } from "node:fs";

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

	const cwd = process.cwd();

	// Auth: read from .pi-vocab/auth.json; fall back to env vars
	const authStorage = AuthStorage.create(join(VOCAB_AGENT_DIR, "auth.json"));

	// If OPENAI_API_KEY is set in env but not in auth.json, inject it at runtime
	const apiKey = process.env.OPENAI_API_KEY;
	if (apiKey) {
		authStorage.setRuntimeApiKey("openai-compatible", apiKey);
	}

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

	// Resolve model from env vars
	const teacherModelId = process.env.TEACHER_MODEL ?? "gpt-4o-mini";
	const developerModelId = process.env.DEVELOPER_MODEL ?? teacherModelId;

	// Try to find models in the registry
	const available = await modelRegistry.getAvailable();
	let model = available.find(
		(m) =>
			m.id === teacherModelId ||
			m.name === teacherModelId ||
			m.id.includes(teacherModelId),
	);

	// If no model found, use the first available
	if (!model && available.length > 0) {
		model = available[0];
		console.log(
			`[Pi SDK] Teacher model "${teacherModelId}" not found, using "${model.name}"`,
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

// ── Exports for external use ─────────────────────────────────────────────

export { VOCAB_AGENT_DIR };
export type { AgentSession };

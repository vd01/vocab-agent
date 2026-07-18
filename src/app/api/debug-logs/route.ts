import { apiHandlerV2 } from "@/lib/api/handler";
import { getDebugLogs } from "@/lib/ai/debug-store";

const DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_PANEL === "true";

/**
 * GET /api/debug-logs?id=<debugId>
 * Returns the LLM interaction logs for a given debug session.
 * Only available when NEXT_PUBLIC_DEBUG_PANEL=true is set.
 */
export const GET = apiHandlerV2(async (req) => {
	if (!DEBUG_ENABLED) {
		return Response.json(
			{ error: "Debug panel is not enabled" },
			{ status: 404 },
		);
	}

	const url = new URL(req.url);
	const id = url.searchParams.get("id");

	if (!id) {
		return Response.json({ error: "Missing id parameter" }, { status: 400 });
	}

	const entry = getDebugLogs(id);
	if (!entry) {
		return Response.json(
			{ error: "Debug logs not found or expired" },
			{ status: 404 },
		);
	}

	return Response.json(entry);
});

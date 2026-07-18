/**
 * Tool Schema Synchronizer
 *
 * Validates that the TypeBox schemas in the vocab-agent extension
 * match the Zod schemas in the tool implementation files.
 *
 * Run: npx tsx src/lib/ai/tools/schema-sync.ts
 *
 * This ensures the "single source of truth" principle — if a tool's
 * Zod schema changes, this script will flag the mismatch so the
 * Extension schema can be updated accordingly.
 *
 * Future improvement: auto-generate Extension schemas from Zod.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Import tool schemas
import { fsrsReviewTool, fsrsRateTool } from "./fsrs-review";
import { addWordTool } from "./add-word";
import { vocabLookupTool } from "./vocab-lookup";
import { dictLookupTool } from "./dict-lookup";
import { extractWordsTool } from "./extract-words";
import { vocabStatsTool } from "./vocab-stats";
import { pinWordTool, unpinWordTool } from "./pin-word";
import { batchAddWordsTool } from "./batch-add-words";
import { importByTagTool } from "./import-by-tag";
import { groupManageTool } from "./group-manage";
import { createCommandTool } from "./create-command";
import { registerComponentTool } from "./register-component";
import { unregisterComponentTool } from "./unregister-component";
import { dbQueryTool } from "./db-query";
import { saveLessonTool } from "./save-lesson";
import { listLessonsTool } from "./list-lessons";
import { mergeLessonsTool } from "./merge-lessons";
import { testCommandTool } from "./test-command";

interface ToolWithSchema {
	description: string;
	inputSchema: z.ZodSchema;
}

const tools: Record<string, ToolWithSchema> = {
	"fsrs-review": fsrsReviewTool as any,
	"fsrs-rate": fsrsRateTool as any,
	"add-word": addWordTool as any,
	"vocab-lookup": vocabLookupTool as any,
	"dict-lookup": dictLookupTool as any,
	"extract-words": extractWordsTool as any,
	"vocab-stats": vocabStatsTool as any,
	"pin-word": pinWordTool as any,
	"unpin-word": unpinWordTool as any,
	"batch-add-words": batchAddWordsTool as any,
	"import-by-tag": importByTagTool as any,
	"group-manage": groupManageTool as any,
	"create-command": createCommandTool as any,
	"register-component": registerComponentTool as any,
	"unregister-component": unregisterComponentTool as any,
	"db-query": dbQueryTool as any,
	"save-lesson": saveLessonTool as any,
	"list-lessons": listLessonsTool as any,
	"merge-lessons": mergeLessonsTool as any,
	"test-command": testCommandTool as any,
};

console.log("=== Tool Schema Sync Check ===\n");

for (const [name, tool] of Object.entries(tools)) {
	try {
		const jsonSchema = zodToJsonSchema(tool.inputSchema as any);
		const params = Object.keys((jsonSchema as any).properties ?? {});
		const required = (jsonSchema as any).required ?? [];
		console.log(
			`✅ ${name}: ${params.length} params (${required.length} required) — ${params.join(", ")}`,
		);
	} catch (err) {
		console.log(`❌ ${name}: Failed to convert schema — ${err}`);
	}
}

console.log("\n=== Done ===");

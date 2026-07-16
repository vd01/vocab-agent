/**
 * Tool definition types — replaces ai-sdk's tool() helper.
 *
 * These types match the shape expected by the pi Extension's
 * pi.registerTool() execute method, allowing tools to be defined
 * as plain objects without importing from 'ai'.
 */

import type { z } from "zod";

/**
 * A tool definition with Zod schema validation.
 *
 * @example
 * export const myTool = defineTool({
 *   description: "...",
 *   inputSchema: z.object({ name: z.string() }),
 *   execute: async ({ name }) => { ... },
 * });
 */
export interface ToolDefinition<TInput, TOutput> {
	description: string;
	inputSchema: z.ZodSchema<TInput>;
	execute: (input: TInput) => Promise<TOutput>;
}

/**
 * Create a tool definition object.
 * This is a thin wrapper that replaces ai-sdk's tool() function.
 */
export function defineTool<TInput, TOutput>(
	def: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
	return def;
}

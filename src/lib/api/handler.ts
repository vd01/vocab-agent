/**
 * API Route Helpers — standardized error handling for Next.js API routes
 *
 * Usage:
 *   import { apiHandler } from "@/lib/api/handler";
 *
 *   export const GET = apiHandler(async (req) => {
 *     const data = await fetchData();
 *     return Response.json(data);
 *   });
 *
 *   // With params:
 *   export const GET = apiHandler(async (req, { params }) => {
 *     const { id } = await params;
 *     return Response.json({ id });
 *   });
 */

import { NextRequest } from "next/server";

type ApiContext = {
	params: Promise<Record<string, string>>;
};

type ApiHandler = (
	req: NextRequest | Request,
	ctx?: ApiContext,
) => Promise<Response>;

/**
 * Wraps an API handler with standardized error handling.
 * Catches unhandled errors and returns a consistent JSON error response.
 */
export function apiHandler(handler: ApiHandler): ApiHandler {
	return async (req, ctx) => {
		try {
			return await handler(req, ctx);
		} catch (error) {
			console.error("[API Error]", error);
			const message = error instanceof Error ? error.message : String(error);
			return Response.json({ error: message }, { status: 500 });
		}
	};
}

/**
 * Parse JSON body with validation.
 * Returns parsed body or throws with a 400 response.
 */
export async function parseBody<T = Record<string, unknown>>(
	req: Request,
	validate?: (body: T) => string | null,
): Promise<T> {
	let body: T;
	try {
		body = await req.json();
	} catch {
		throw new ApiError(400, "Invalid JSON body");
	}

	if (validate) {
		const error = validate(body);
		if (error) throw new ApiError(400, error);
	}

	return body;
}

/**
 * Custom error class that carries an HTTP status code.
 * apiHandler will use this to return the correct status.
 */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * Enhanced apiHandler that understands ApiError status codes.
 */
export function apiHandlerV2(handler: ApiHandler): ApiHandler {
	return async (req, ctx) => {
		try {
			return await handler(req, ctx);
		} catch (error) {
			if (error instanceof ApiError) {
				return Response.json(
					{ error: error.message },
					{ status: error.status },
				);
			}
			console.error("[API Error]", error);
			const message = error instanceof Error ? error.message : String(error);
			return Response.json({ error: message }, { status: 500 });
		}
	};
}

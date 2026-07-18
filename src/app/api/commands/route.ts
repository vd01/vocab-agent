import { executeCommand } from "@/lib/commands/executor";
import { apiHandlerV2 } from "@/lib/api/handler";

export const POST = apiHandlerV2(async (req) => {
	const body = await req.json();
	const { command } = body;

	if (typeof command !== "string" || !command.trim()) {
		return Response.json(
			{ type: "invalid-args", message: "请提供命令" },
			{ status: 400 },
		);
	}

	const result = await executeCommand(command);
	return Response.json(result);
});

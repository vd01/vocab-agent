import { apiHandlerV2 } from "@/lib/api/handler";

export const GET = apiHandlerV2(async () => {
	return Response.json({ status: "ok" });
});

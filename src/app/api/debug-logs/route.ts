import { debugStore } from '@/app/api/chat/route';

/**
 * GET /api/debug-logs?id=<debugId>
 * Returns the LLM interaction logs for a given debug session.
 * Entries auto-expire after 5 minutes (see chat/route.ts).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  const entry = debugStore.get(id);
  if (!entry) {
    return Response.json({ error: 'Debug logs not found or expired' }, { status: 404 });
  }

  return Response.json({
    id,
    createdAt: entry.createdAt,
    logs: entry.logs,
  });
}

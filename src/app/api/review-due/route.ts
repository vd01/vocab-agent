import { client } from '@/lib/db';

export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000);

  const result = await client.execute({
    sql: `
      SELECT COUNT(*) as cnt
      FROM reviews r
      INNER JOIN (
        SELECT word_id, max(reviewed_at) as max_reviewed_at
        FROM reviews
        GROUP BY word_id
      ) latest ON r.word_id = latest.word_id AND r.reviewed_at = latest.max_reviewed_at
      WHERE r.due <= ?
    `,
    args: [nowSec],
  });

  const due = Number((result.rows[0] as Record<string, unknown>)?.cnt ?? 0);
  return Response.json({ due });
}

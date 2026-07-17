import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chatMessages } from '@/lib/db/schema';
import { desc, lt, inArray, sql, eq } from 'drizzle-orm';

const PAGE_SIZE = 20;

/**
 * GET /api/messages — 分页加载历史消息
 * Query params:
 *   cursor: createdAt timestamp (ms), load messages older than this
 *   limit:  page size (default 20)
 *
 * Reads `parts` column (JSON string of AI SDK v7 UIMessagePart[]) and
 * returns UIMessage[] directly.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cursorStr = searchParams.get('cursor');
    const limitStr = searchParams.get('limit');
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10), 1), 50);

    // Query: newest first, before cursor if provided
    const cursorSeq = cursorStr ? parseInt(cursorStr, 10) : null;
    const cursorValid = cursorSeq !== null && !isNaN(cursorSeq);

    const rows = await db
      .select()
      .from(chatMessages)
      .where(cursorValid ? lt(chatMessages.seq, cursorSeq!) : undefined)
      .orderBy(desc(chatMessages.seq))
      .limit(limit + 1); // +1 to detect hasMore
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Convert DB rows → AI SDK v7 UIMessage format
    const messages = data.map(row => {
      let parts: any[] = [];

      if (row.parts) {
        try {
          parts = JSON.parse(row.parts);
          if (!Array.isArray(parts)) parts = [];
        } catch {
          parts = [];
        }
      }

      // Fallback: if no parts, add empty text
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' });
      }

      return {
        id: row.id,
        role: row.role as 'user' | 'assistant',
        parts,
        createdAt: row.createdAt,
      };
    });

    // nextCursor = oldest message's seq
    const nextCursor = data.length > 0
      ? data[data.length - 1].seq
      : null;

    return NextResponse.json({ messages, hasMore, nextCursor });
  } catch (error) {
    console.error('[GET /api/messages] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load messages' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/messages — 保存消息到数据库
 * Body: { messages: UIMessage[] }
 *
 * Only saves messages that don't already exist (by id).
 * Serializes each message's `parts` array to JSON string for the `parts` column.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming: any[] = body.messages || [];
    const agentType: string | null = body.agentType || null;

    if (incoming.length === 0) {
      return NextResponse.json({ saved: 0 });
    }

    // Check which ids already exist
    const ids = incoming.map(m => m.id).filter(Boolean);
    const existing = ids.length > 0
      ? await db.select({ id: chatMessages.id })
          .from(chatMessages)
          .where(inArray(chatMessages.id, ids))
      : [];
    const existingIds = new Set(existing.map(r => r.id));

    // Filter to only new messages
    const newMessages = incoming.filter(m => !existingIds.has(m.id));

    // Messages that already exist — update their parts (content may have changed during streaming)
    const updatedMessages = incoming.filter(m => existingIds.has(m.id));

    // Update existing messages (parts may have been incomplete when first saved)
    for (const msg of updatedMessages) {
      if (msg.parts && Array.isArray(msg.parts)) {
        await db
          .update(chatMessages)
          .set({ parts: JSON.stringify(msg.parts) })
          .where(eq(chatMessages.id, msg.id));
      }
    }

    if (newMessages.length === 0) {
      return NextResponse.json({ saved: 0, skipped: ids.length });
    }

    // Get current max seq
    const maxSeqRow = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${chatMessages.seq}), 0)` })
      .from(chatMessages);
    let nextSeq = (maxSeqRow[0]?.maxSeq ?? 0) + 1;

    // Convert UIMessage → DB row
    const rows = newMessages.map(msg => {
      // Serialize parts array to JSON string
      let parts: string | null = null;
      if (msg.parts && Array.isArray(msg.parts)) {
        parts = JSON.stringify(msg.parts);
      }

      return {
        id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: msg.role,
        parts,
        agentType,
        seq: nextSeq++,
        createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
      };
    });

    // Insert in batch
    for (const row of rows) {
      await db.insert(chatMessages).values(row).onConflictDoNothing();
    }

    return NextResponse.json({ saved: rows.length, updated: updatedMessages.length, skipped: existingIds.size - updatedMessages.length });
  } catch (error) {
    console.error('[POST /api/messages] Error:', error);
    return NextResponse.json(
      { error: 'Failed to save messages' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/messages — 清空所有聊天消息
 *
 * Deletes all chat_messages from the DB AND resets the pi agent's
 * in-memory conversation history. Without resetting the pi session,
 * the LLM would still "remember" previous conversations even after
 * the DB is cleared, because SessionManager.inMemory() keeps all
 * messages in its fileEntries array.
 *
 * Auth: handled by middleware (cookie or X-Auth-Password header).
 */
export async function DELETE() {
  try {
    // ── 1. Clear DB messages ────────────────────────────────────────────
    await db.delete(chatMessages);

    // ── 2. Reset pi session's in-memory conversation history ────────────
    try {
      const { resetPiSession } = await import('@/lib/pi/session');
      await resetPiSession();
    } catch (err) {
      console.error('[DELETE /api/messages] Failed to reset pi session:', err);
      // Still report success for DB cleanup, but note the session reset issue
    }

    return NextResponse.json({ deleted: true, message: '所有聊天记录已清空，对话上下文已重置' });
  } catch (error) {
    console.error('[DELETE /api/messages] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete messages' },
      { status: 500 }
    );
  }
}

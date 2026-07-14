/**
 * 清空聊天消息记录
 * - DB 表: chat_messages DELETE 所有行
 */
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vocab.db');
const client = createClient({ url: `file:${dbPath}` });

async function cleanMessages() {
  console.log('🧹 Cleaning chat messages...\n');

  try {
    const result = await client.execute('DELETE FROM chat_messages');
    console.log(`  chat_messages: ${result.rowsAffected} rows deleted`);
  } catch (err) {
    console.error('  ⚠ chat_messages:', (err as Error).message);
  }

  console.log('\n✅ Clean complete!');
}

cleanMessages().catch((err) => {
  console.error('Clean failed:', err);
  process.exit(1);
});

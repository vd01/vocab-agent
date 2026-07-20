/**
 * 从 ECDICT 数据库中批量导入单词到词库 (data/vocab.db)
 *
 * 用法:
 *   npx tsx scripts/seed-words-from-ecdict.ts [数量] [模式]
 *   npm run seed-words -- [数量] [模式]
 *
 * 参数:
 *   数量  — 导入单词数（默认 500）
 *   模式  — "freq" 高频优先（默认）| "random" 随机选取
 *
 * 选取策略:
 *   freq:   按 BNC 词频排名升序 + Collins 星级降序，优先选常用词。
 *           为保证首字母分布均匀，按字母分桶后从每个桶中按比例抽取。
 *   random: 从有 Collins 星级或 BNC 排名的词中随机选取，同样按字母分桶均匀抽取。
 *
 * 前提条件: ECDICT 数据库已导入 (npx tsx src/lib/dictionary/import-ecdict.ts)
 */

import { createClient } from '@libsql/client';
import path from 'path';
import crypto from 'crypto';

const ECDICT_DB = path.join(process.cwd(), 'data', 'ecdict.db');
const VOCAB_DB = path.join(process.cwd(), 'data', 'vocab.db');

// ── 参数解析 ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const TARGET_COUNT = parseInt(args[0], 10) || 500;
const MODE = (args[1] || 'freq').toLowerCase() === 'random' ? 'random' : 'freq';

if (!['freq', 'random'].includes(MODE)) {
  console.error('❌ 模式必须是 "freq" 或 "random"');
  process.exit(1);
}

// ── 主流程 ───────────────────────────────────────────────────────────────

async function seedWords() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ECDICT → 词库 批量导入');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  模式: ${MODE === 'freq' ? '高频优先' : '随机选取'}`);
  console.log(`  目标: ${TARGET_COUNT} 个单词`);
  console.log('═══════════════════════════════════════════════════\n');

  // 检查 ECDICT 数据库
  const ecdictClient = createClient({ url: `file:${ECDICT_DB}` });
  try {
    const check = await ecdictClient.execute('SELECT COUNT(*) as cnt FROM ecdict LIMIT 1');
    const count = Number(check.rows[0].cnt);
    if (count === 0) {
      console.error('❌ ECDICT 数据库为空！请先运行: npx tsx src/lib/dictionary/import-ecdict.ts');
      process.exit(1);
    }
    console.log(`✅ ECDICT 数据库: ${count.toLocaleString()} 条记录`);
  } catch {
    console.error('❌ ECDICT 数据库不存在！请先运行: npx tsx src/lib/dictionary/import-ecdict.ts');
    process.exit(1);
  }

  // 连接词库
  const vocabClient = createClient({ url: `file:${VOCAB_DB}` });

  // 检查现有单词数
  const existingResult = await vocabClient.execute('SELECT COUNT(*) as cnt FROM words');
  const existingCount = Number(existingResult.rows[0].cnt);
  console.log(`📊 当前词库: ${existingCount} 个单词`);

  // 获取已有单词列表（用于去重）
  const existingWords = new Set<string>();
  const existingRows = await vocabClient.execute('SELECT word FROM words');
  for (const row of existingRows.rows) {
    existingWords.add((row.word as string).toLowerCase());
  }

  const needCount = TARGET_COUNT - existingCount;
  if (needCount <= 0) {
    console.log(`✅ 词库已有 ${existingCount} 个单词，无需添加`);
    process.exit(0);
  }
  console.log(`🎯 需要添加 ${needCount} 个单词\n`);

  // ── 按首字母分桶选取 ──────────────────────────────────────────────────

  // 先统计 ECDICT 中每个首字母有多少候选词
  console.log('📖 统计 ECDICT 各首字母候选词数量...');
  const letterStats = await ecdictClient.execute(`
    SELECT UPPER(SUBSTR(word, 1, 1)) AS letter, COUNT(*) AS cnt
    FROM ecdict
    WHERE (collins >= 3 OR bnc > 0)
      AND LENGTH(word) >= 2
      AND LENGTH(word) <= 20
      AND word NOT LIKE '% %'
      AND word GLOB '[a-z]*'
    GROUP BY letter
    ORDER BY letter
  `);

  const letterBuckets: Map<string, number> = new Map();
  let totalCandidates = 0;
  for (const row of letterStats.rows) {
    const letter = row.letter as string;
    const cnt = Number(row.cnt);
    letterBuckets.set(letter, cnt);
    totalCandidates += cnt;
  }
  console.log(`   共 ${totalCandidates.toLocaleString()} 个候选词，覆盖 ${letterBuckets.size} 个首字母`);

  // 按比例分配每个字母的选取数量
  const letterQuotas: Map<string, number> = new Map();
  let allocated = 0;
  const letters = [...letterBuckets.keys()].sort();

  for (const letter of letters) {
    const bucketSize = letterBuckets.get(letter)!;
    // 按比例分配，但每个字母至少 1 个（如果需要量够大）
    const quota = Math.max(1, Math.round(needCount * bucketSize / totalCandidates));
    letterQuotas.set(letter, quota);
    allocated += quota;
  }

  // 调整配额使总和等于 needCount
  while (allocated > needCount) {
    // 从配额最多的字母减 1
    let maxLetter = letters[0];
    for (const l of letters) {
      if ((letterQuotas.get(l) || 0) > (letterQuotas.get(maxLetter) || 0)) maxLetter = l;
    }
    letterQuotas.set(maxLetter, (letterQuotas.get(maxLetter) || 0) - 1);
    allocated--;
  }
  while (allocated < needCount) {
    // 给配额最少的字母加 1
    let minLetter = letters[0];
    for (const l of letters) {
      if ((letterQuotas.get(l) || 0) < (letterQuotas.get(minLetter) || 0)) minLetter = l;
    }
    letterQuotas.set(minLetter, (letterQuotas.get(minLetter) || 0) + 1);
    allocated++;
  }

  console.log(`\n📋 各字母配额分配:`);
  const quotaDisplay = letters.map(l => `${l}:${letterQuotas.get(l)}`).join(' ');
  console.log(`   ${quotaDisplay}\n`);

  // ── 从每个字母桶中选取单词 ────────────────────────────────────────────

  const selectedWords: Array<{
    word: string;
    phonetic: string | null;
    definition: string | null;
    translation: string | null;
    tag: string | null;
    collins: number | null;
    bnc: number | null;
    frq: number | null;
    exchange: string | null;
  }> = [];

  for (const letter of letters) {
    const quota = letterQuotas.get(letter) || 0;
    if (quota <= 0) continue;

    const orderBy = MODE === 'freq'
      ? 'CASE WHEN bnc > 0 THEN bnc ELSE 999999 END ASC, CASE WHEN collins > 0 THEN -collins ELSE 0 END DESC, frq ASC'
      : 'RANDOM()';

    const query = `
      SELECT word, phonetic, definition, translation, tag, collins, bnc, frq, exchange
      FROM ecdict
      WHERE UPPER(SUBSTR(word, 1, 1)) = ?
        AND (collins >= 3 OR bnc > 0)
        AND LENGTH(word) >= 2
        AND LENGTH(word) <= 20
        AND word NOT LIKE '% %'
        AND word GLOB '[a-z]*'
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    const result = await ecdictClient.execute({ sql: query, args: [letter, quota + 50] });

    let picked = 0;
    for (const row of result.rows) {
      const word = (row.word as string).toLowerCase();
      if (existingWords.has(word)) continue;
      if (picked >= quota) break;

      selectedWords.push({
        word: row.word as string,
        phonetic: (row.phonetic as string) || null,
        definition: (row.definition as string) || null,
        translation: (row.translation as string) || null,
        tag: (row.tag as string) || null,
        collins: row.collins != null ? Number(row.collins) : null,
        bnc: row.bnc != null ? Number(row.bnc) : null,
        frq: row.frq != null ? Number(row.frq) : null,
        exchange: (row.exchange as string) || null,
      });

      existingWords.add(word);
      picked++;
    }

    process.stdout.write(`\r  已选取 ${selectedWords.length}/${needCount} 个单词`);
  }

  console.log(`\n✅ 选取完成: ${selectedWords.length} 个单词\n`);

  // ── 批量插入 ──────────────────────────────────────────────────────────

  const BATCH_SIZE = 100;
  let inserted = 0;
  const now = Date.now();

  for (let i = 0; i < selectedWords.length; i += BATCH_SIZE) {
    const batch = selectedWords.slice(i, i + BATCH_SIZE);

    await vocabClient.execute('BEGIN TRANSACTION');
    try {
      for (const row of batch) {
        const id = crypto.randomUUID();
        // 优先使用中文翻译，英文释义作为补充
        // ECDICT: translation = 中文, definition = 英文
        let definition: string;
        const trans = (row.translation || '').trim();
        const def = (row.definition || '').trim();
        if (trans && def) {
          definition = trans + '\n' + def;
        } else {
          definition = trans || def || 'no definition';
        }
        // 将 ECDICT 中的字面 \n / \r\n 替换为真正的换行符
        definition = definition.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
        const examples = row.exchange ? JSON.stringify([row.exchange]) : null;

        try {
          await vocabClient.execute({
            sql: `INSERT OR IGNORE INTO words (id, word, phonetic, definition, examples, source, tag, collins, bnc, frq, exchange, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              id,
              row.word,
              row.phonetic,
              definition,
              examples,
              'ecdict',
              row.tag,
              row.collins,
              row.bnc,
              row.frq,
              row.exchange,
              now,
            ],
          });
          inserted++;
        } catch {
          // 跳过重复或无效行
        }
      }
      await vocabClient.execute('COMMIT');
    } catch {
      await vocabClient.execute('ROLLBACK');
    }

    process.stdout.write(`\r  已插入 ${inserted}/${selectedWords.length} 个单词`);
  }

  console.log(`\n✅ 完成！已添加 ${inserted} 个单词到词库\n`);

  // ── 初始化 FSRS review 记录 ──────────────────────────────────────────
  // Words without review records are invisible to the review system.
  // Create initial review cards (rating=0, queued) for all new words.
  const QUEUE_DUE_SEC = Math.floor(new Date('2099-12-31T23:59:59').getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);

  const orphans = await vocabClient.execute(`
    SELECT w.id FROM words w
    LEFT JOIN reviews r ON r.word_id = w.id
    WHERE r.id IS NULL
  `);

  if (orphans.rows.length > 0) {
    // Check daily new limit: if unlimited (0), release immediately; otherwise queue
    const settingResult = await vocabClient.execute(
      "SELECT value FROM user_settings WHERE key = 'review.dailyNewLimit'"
    );
    const dailyNewLimit = parseInt((settingResult.rows[0] as any)?.value || '10', 10);
    const dueSec = dailyNewLimit > 0 ? QUEUE_DUE_SEC : nowSec;

    let reviewInserted = 0;
    await vocabClient.execute('BEGIN TRANSACTION');
    try {
      for (const row of orphans.rows) {
        const wordId = row.id as string;
        const id = crypto.randomUUID();
        await vocabClient.execute({
          sql: `INSERT INTO reviews (id, word_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, reviewed_at)
                VALUES (?, ?, 0, 0, ?, 0, 0, 0, 0, 0, 0, ?, ?)`,
          args: [id, wordId, dueSec, nowSec, nowSec],
        });
        reviewInserted++;
      }
      await vocabClient.execute('COMMIT');
    } catch {
      await vocabClient.execute('ROLLBACK');
    }
    console.log(`✅ Created ${reviewInserted} FSRS review records`);

    // Release first batch if daily limit is set
    if (dailyNewLimit > 0) {
      const releaseResult = await vocabClient.execute({
        sql: `UPDATE reviews SET due = ?
              WHERE rowid IN (
                SELECT r.rowid FROM reviews r
                WHERE r.rating = 0 AND r.due >= ?
                ORDER BY r.reviewed_at ASC
                LIMIT ?
              )`,
        args: [nowSec, QUEUE_DUE_SEC - 86400, dailyNewLimit],
      });
      console.log(`✅ Released ${releaseResult.rowsAffected} words for today's review (dailyNewLimit=${dailyNewLimit})`);
    }
  } else {
    console.log('✅ All words already have review records');
  }

  // ── 确保默认分组存在 & 所有词分配到默认分组 ──────────────────────────────
  // This is critical: /review with a group filter uses INNER JOIN on word_group_members.
  // Without membership records, group-scoped reviews return 0 words.
  {
    const nowSec2 = Math.floor(Date.now() / 1000);
    // Ensure default group exists (use existing if name conflict)
    await vocabClient.execute({
      sql: `INSERT OR IGNORE INTO word_groups (id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: ['default-daily', '日常', '默认分组', 1, nowSec2],
    });
    // Look up actual group id (may differ if group already existed with a different id)
    const groupRow = await vocabClient.execute(
      "SELECT id FROM word_groups WHERE name = '日常' LIMIT 1"
    );
    const groupId = groupRow.rows[0]?.id as string;
    if (!groupId) {
      console.error('❌ Failed to find/create default group');
    } else {
      const assignResult = await vocabClient.execute({
        sql: `INSERT OR IGNORE INTO word_group_members (id, group_id, word_id, added_at)
             SELECT 'wgm-' || w.id, ?, w.id, ?
             FROM words w`,
        args: [groupId, nowSec2],
      });
      if (assignResult.rowsAffected > 0) {
        console.log(`✅ Assigned ${assignResult.rowsAffected} words to default group "日常"`);
      }
    }
  }

  // ── 验证统计 ──────────────────────────────────────────────────────────

  const finalResult = await vocabClient.execute('SELECT COUNT(*) as cnt FROM words');
  const finalCount = Number(finalResult.rows[0].cnt);

  const letterDist = await vocabClient.execute(
    "SELECT UPPER(SUBSTR(word, 1, 1)) AS letter, COUNT(*) AS cnt FROM words GROUP BY letter ORDER BY letter"
  );

  console.log(`📊 词库统计: ${finalCount} 个单词`);
  console.log('首字母分布:');

  let distLine1 = '';
  let distLine2 = '';
  for (const row of letterDist.rows) {
    const letter = row.letter as string;
    const cnt = String(row.cnt);
    distLine1 += letter.padStart(4);
    distLine2 += cnt.padStart(4);
  }
  console.log(distLine1);
  console.log(distLine2);

  process.exit(0);
}

seedWords().catch(err => {
  console.error('❌ 导入失败:', err);
  process.exit(1);
});

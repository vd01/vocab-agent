import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pinnedWords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { teacherModel } from '@/lib/ai/models';
import { lookupWord } from '@/lib/dictionary/lookup';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pinId } = await params;

    const pin = await db
      .select()
      .from(pinnedWords)
      .where(eq(pinnedWords.id, pinId))
      .limit(1);

    if (pin.length === 0) {
      return NextResponse.json({ error: 'Pin not found' }, { status: 404 });
    }

    const p = pin[0];

    if (p.richContent) {
      try {
        const content = JSON.parse(p.richContent);
        return NextResponse.json({ richContent: content, cached: true });
      } catch {
        // fall through to regenerate
      }
    }

    const dictData = await lookupWord(p.word);

    const dictInfo = dictData
      ? `词典信息: 音标=${dictData.phonetic || 'N/A'}, 中文释义=${dictData.translation || 'N/A'}, Collins=${dictData.collins || 'N/A'}, 考试标签=${dictData.tag || 'N/A'}${dictData.definitions ? `, 英文释义=${JSON.stringify(dictData.definitions.slice(0, 3))}` : ''}${dictData.synonyms?.length ? `, 同义词=${dictData.synonyms.slice(0, 5).join(', ')}` : ''}${dictData.antonyms?.length ? `, 反义词=${dictData.antonyms.slice(0, 5).join(', ')}` : ''}`
      : '';

    const prompt = `你是一个专业的英语词汇教学助手。请为单词 "${p.word}" 生成一份丰富的详解卡片内容，帮助用户深度理解和记忆这个单词。

${dictInfo}

请以 JSON 格式输出，包含以下字段：
{
  "mnemonic": "助记法 — 用谐音、词根词缀、联想等方式帮助记忆，要有趣、好记",
  "wordFamily": "词族 — 列出词根相同的词（名词/动词/形容词/副词等变形），格式如：act → action(n) active(adj) actively(adv)",
  "collocations": "常用搭配 — 3-5个最常用的搭配，格式如：make progress, progress steadily",
  "contextSentences": ["语境例句1 — 每个例句要展示不同用法，附中文翻译", "语境例句2", "语境例句3"],
  "confusables": "易混淆词辨析 — 列出1-3个容易混淆的词，简要说明区别，格式如：affect(动词，影响) vs effect(名词，效果)",
  "cultureNote": "文化小贴士 — 这个词在英语文化中的有趣用法、常见场景或词源故事，1-2句话",
  "memoryTip": "一句话记忆诀窍 — 用最精炼的方式总结这个单词的核心含义和记忆要点"
}

要求：
- mnemonic 和 memoryTip 是重点，要真正能帮助记忆，不要敷衍
- 所有中文内容要简洁精炼，不要啰嗦
- confusables 如果没有明显易混淆词，可以填空字符串
- contextSentences 的例句要地道、实用，不要太长
- 只输出 JSON，不要有其他文字`;

    const { text: resultText } = await generateText({
      model: teacherModel,
      prompt,
      maxOutputTokens: 1000,
    });

    let richContent;
    try {
      const cleaned = resultText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      richContent = JSON.parse(cleaned);
    } catch {
      richContent = {
        mnemonic: resultText,
        raw: true,
      };
    }

    await db
      .update(pinnedWords)
      .set({ richContent: JSON.stringify(richContent) })
      .where(eq(pinnedWords.id, pinId));

    return NextResponse.json({ richContent, cached: false });
  } catch (err) {
    console.error('[Pin Detail API] Error:', err);
    return NextResponse.json({ error: 'Failed to generate detail' }, { status: 500 });
  }
}

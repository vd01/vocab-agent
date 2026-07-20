import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pinnedWords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { lookupWordFast } from '@/lib/dictionary/lookup';

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

    // Phase 1: ECDICT data immediately (~10ms)
    // Phase 2: race background enrichment with 2.5s timeout
    //   - If cached word or fast network: full data (MDX, WordNet, FreeDict, etc.)
    //   - If timeout: ECDICT + whatever offline sources finished
    const [fastEntry, backgroundPromise] = await lookupWordFast(p.word);

    let dictData = fastEntry;
    try {
      const enriched = await Promise.race([
        backgroundPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (enriched) dictData = enriched;
    } catch {
      // background failed, use fast entry
    }

    // Build rich context for LLM from all available sources
    const dictInfo = buildLLMContext(p.word, dictData);

    const prompt = `你是一个专业的英语词汇教学助手。请为单词 "${p.word}" 生成一份丰富的详解卡片内容，帮助用户深度理解和记忆这个单词。

${dictInfo}

请以 JSON 格式输出，包含以下字段：
{
  "mnemonic": "助记法 - 用谐音、词根词缀、联想等方式帮助记忆，要有趣、好记",
  "wordFamily": "词族 - 列出词根相同的词（名词/动词/形容词/副词等变形），格式如：act -> action(n) active(adj) actively(adv)",
  "collocations": "常用搭配 - 3-5个最常用的搭配，格式如：make progress, progress steadily",
  "contextSentences": ["语境例句1 - 每个例句要展示不同用法，附中文翻译", "语境例句2", "语境例句3"],
  "confusables": "易混淆词辨析 - 列出1-3个容易混淆的词，简要说明区别，格式如：affect(动词，影响) vs effect(名词，效果)",
  "cultureNote": "文化小贴士 - 这个词在英语文化中的有趣用法、常见场景或词源故事，1-2句话",
  "memoryTip": "一句话记忆诀窍 - 用最精炼的方式总结这个单词的核心含义和记忆要点"
}

要求：
- mnemonic 和 memoryTip 是重点，要真正能帮助记忆，不要敷衍
- 参考提供的词典信息生成内容，特别是权威词典的释义和例句
- 所有中文内容要简洁精炼，不要啰嗦
- confusables 如果没有明显易混淆词，可以填空字符串
- contextSentences 的例句要地道、实用，不要太长
- 重要：JSON字符串值内不要使用双引号，需要强调时用单引号或「」
- 只输出纯JSON，不要用反引号包裹，不要有其他文字`;

    // Direct API call (replaces AI SDK generateText)
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL;
    const model = process.env.TEACHER_MODEL || 'gpt-4o-mini';

    if (!apiKey || !baseUrl) {
      return NextResponse.json({ error: 'LLM not configured' }, { status: 500 });
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a JSON generator. Always output valid JSON only, no markdown, no code blocks.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Pin Detail API] LLM error:', res.status, errText.slice(0, 200));
      return NextResponse.json({ error: 'LLM call failed' }, { status: 502 });
    }

    const data = await res.json() as any;
    const resultText = data.choices?.[0]?.message?.content || '';

    let richContent;
    try {
      // Strip markdown code fences and whitespace
      const cleaned = resultText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      richContent = JSON.parse(cleaned);
    } catch {
      // Fallback: try to extract JSON object from the text
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          richContent = JSON.parse(jsonMatch[0]);
        } catch {
          richContent = { mnemonic: resultText, raw: true };
        }
      } else {
        richContent = { mnemonic: resultText, raw: true };
      }
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

/**
 * Build a concise but rich context string for the LLM from all available
 * dictionary sources. Each section is truncated to keep the prompt short.
 */
function buildLLMContext(word: string, d: any): string {
  if (!d) return '词典信息: 暂无';

  const parts: string[] = [];

  // Basic info from ECDICT
  parts.push(`音标=${d.phonetic || 'N/A'}`);
  parts.push(`中文释义=${d.translation || 'N/A'}`);
  if (d.collins) parts.push(`Collins=${d.collins}`);
  if (d.tag) parts.push(`考试标签=${d.tag}`);

  // English definitions (FreeDict)
  if (d.definitions?.length > 0) {
    const defs = d.definitions
      .slice(0, 3)
      .map((g: any) => `${g.partOfSpeech}: ${g.definitions.slice(0, 2).map((x: any) => x.definition).join('; ')}`)
      .join(' | ');
    parts.push(`英文释义=${defs}`);
  }

  // Synonyms
  if (d.synonyms?.length > 0) {
    parts.push(`同义词=${d.synonyms.slice(0, 8).join(', ')}`);
  }

  // MDX content (OALD9 etc.) - truncate to keep prompt manageable
  if (d.mdxEntries?.length > 0) {
    const mdxText = d.mdxEntries
      .map((e: any) => `[${e.dict}] ${e.text.slice(0, 800)}`)
      .join('\n');
    parts.push(`权威词典=\n${mdxText}`);
  }

  // WordNet synsets - useful for word family and semantic understanding
  if (d.synsets?.length > 0) {
    const synsetText = d.synsets
      .slice(0, 5)
      .map((s: any) => `${s.pos}: ${s.definition}${s.lemmas?.length ? ` (同义词集: ${s.lemmas.slice(0, 5).join(', ')})` : ''}`)
      .join(' | ');
    parts.push(`语义网络=${synsetText}`);
  }

  // Etymology from Wiktionary - great for culture note and mnemonic
  if (d.etymology) {
    parts.push(`词源=${d.etymology.slice(0, 300)}`);
  }

  return `词典信息: ${parts.join(', ')}`;
}

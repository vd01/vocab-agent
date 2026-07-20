import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pinnedWords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { lookupWordFast } from '@/lib/dictionary/lookup';
import { wordDebugger } from '@/lib/debug/word-debug';

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
        // Debug: record cached result
        wordDebugger.startWord(p.word);
        wordDebugger.recordSource(p.word, 'richContent-cache', content, 0);
        wordDebugger.recordLLMOutput(p.word, JSON.stringify(content, null, 2));
        wordDebugger.flushWord(p.word);
        return NextResponse.json({ richContent: content, cached: true });
      } catch {
        // fall through to regenerate
      }
    }

    // Phase 1: ECDICT data immediately (~10ms)
    // Phase 2: race background enrichment with 2.5s timeout
    //   - If cached word or fast network: full data (MDX, WordNet, FreeDict, etc.)
    //   - If timeout: ECDICT + whatever offline sources finished

    // Debug: start tracking this word
    wordDebugger.startWord(p.word);

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

    const prompt = `你是一个专业的英语词汇教学助手。请为单词 "${p.word}" 生成一份详解卡片。

${dictInfo}

输出纯JSON（不要反引号、不要多余文字），字段如下：
{
  "mnemonic": "助记法，1-2句话，用谐音/词根/联想",
  "wordFamily": "词族，格式: act->action(n) active(adj)",
  "collocations": "3个常用搭配，逗号分隔",
  "contextSentences": ["例句1(附中文)", "例句2(附中文)"],
  "confusables": "1-2个易混淆词辨析，无则填空串",
  "cultureNote": "文化小贴士，1句话",
  "memoryTip": "一句话记忆诀窍"
}
要求：简洁精炼，每字段不超过120字（contextSentences每条不超过80字），JSON值内用单引号或「」代替双引号`;

    // Debug: record LLM input
    wordDebugger.recordLLMInput(p.word, 'pin-detail', prompt);

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
        max_tokens: 3000,
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

    // Debug: record LLM output
    wordDebugger.recordLLMOutput(p.word, resultText);

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

    // Debug: flush to disk (wait for background sources to finish recording)
    try {
      await Promise.race([backgroundPromise, new Promise(resolve => setTimeout(resolve, 1000))]);
    } catch {}
    wordDebugger.flushWord(p.word);

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
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLLMContext(word: string, d: any): string {
  if (!d) return '词典信息: 暂无';

  const sections: string[] = [];

  // ── 基础信息 (ECDICT) ──────────────────────────────────────
  const basics: string[] = [];
  if (d.phonetic) basics.push(`音标: ${d.phonetic}`);
  if (d.translation) basics.push(`中文释义: ${d.translation}`);
  if (d.collins) basics.push(`Collins星级: ${'★'.repeat(d.collins)}`);
  if (d.tag) basics.push(`考试标签: ${d.tag}`);
  if (d.bnc) basics.push(`BNC词频排名: ${d.bnc}`);
  if (d.frq) basics.push(`当代词频排名: ${d.frq}`);
  if (d.exchange) basics.push(`变形: ${d.exchange}`);
  if (basics.length > 0) sections.push(`【基础信息】\n${basics.join('\n')}`);

  // ── 英文释义 + 例句 (FreeDict + ECDICT) ──────────────────
  if (d.definitions?.length > 0) {
    const defLines: string[] = [];
    for (const g of d.definitions.slice(0, 4)) {
      const pos = g.partOfSpeech || '释义';
      for (const def of g.definitions.slice(0, 3)) {
        let line = `  ${pos} ${stripHtml(def.definition)}`;
        if (def.example) line += ` — 例: ${stripHtml(def.example)}`;
        defLines.push(line);
      }
    }
    sections.push(`【英文释义与例句】\n${defLines.join('\n')}`);
  }

  // ── 同义词/反义词 ────────────────────────────────────────
  const synAnt: string[] = [];
  if (d.synonyms?.length > 0) synAnt.push(`同义词: ${d.synonyms.slice(0, 10).join(', ')}`);
  if (d.antonyms?.length > 0) synAnt.push(`反义词: ${d.antonyms.slice(0, 10).join(', ')}`);
  if (synAnt.length > 0) sections.push(synAnt.join('\n'));

  // ── 权威词典 (MDX: OALD/LDOCE) ──────────────────────────
  if (d.mdxSenses?.length > 0) {
    const senseLines: string[] = [];
    for (const sense of d.mdxSenses) {
      const pos = sense.pos ? `${sense.pos} ` : '';
      const grammar = sense.grammar ? `${sense.grammar} ` : '';
      const register = sense.register ? `(${sense.register}) ` : '';
      const geo = sense.geo ? `[${sense.geo}] ` : '';
      senseLines.push(`${pos}${grammar}${register}${geo}`.trim());
      for (const s of sense.senses?.slice(0, 4) ?? []) {
        let line = `  ${s.number ? s.number + '. ' : ''}${s.en}`;
        if (s.cn) line += ` 【${s.cn}】`;
        if (s.examples?.length) line += ` — 例: ${s.examples[0]}`;
        if (s.synonym) line += ` (SYN: ${s.synonym})`;
        senseLines.push(line);
      }
      if (sense.idioms?.length) {
        senseLines.push('  习语:');
        for (const idiom of sense.idioms.slice(0, 3)) {
          senseLines.push(`    ${idiom.phrase} — ${idiom.en} 【${idiom.cn}】`);
        }
      }
      if (sense.phrasalVerbs?.length) {
        senseLines.push('  短语动词:');
        for (const pv of sense.phrasalVerbs.slice(0, 3)) {
          const pvSenses = pv.senses.map(s => s.en).join('; ');
          senseLines.push(`    ${pv.phrase} — ${pvSenses}`);
        }
      }
      if (sense.derivedForms?.length) {
        senseLines.push(`  派生词: ${sense.derivedForms.map(f => `${f.word}${f.pos ? `(${f.pos})` : ''}`).join(', ')}`);
      }
    }
    sections.push(`【权威词典 (OALD)】\n${senseLines.join('\n')}`);
  } else if (d.mdxEntries?.length > 0) {
    // Fallback: raw text if no structured senses
    const mdxText = d.mdxEntries
      .map((e: any) => `[${e.dict}] ${e.text.slice(0, 1200)}`)
      .join('\n');
    sections.push(`【权威词典】\n${mdxText}`);
  }

  // ── 语义网络 (WordNet) ───────────────────────────────────
  if (d.synsets?.length > 0) {
    const wnLines: string[] = [];
    for (const s of d.synsets.slice(0, 4)) {
      const posLabel: Record<string, string> = { n: '名词', v: '动词', a: '形容词', r: '副词' };
      wnLines.push(`  ${posLabel[s.pos] || s.pos}: ${s.definition}`);
      if (s.lemmas?.length) wnLines.push(`    同义词集: ${s.lemmas.join(', ')}`);
      if (s.examples?.length) wnLines.push(`    例: ${s.examples.join('; ')}`);
    }
    if (d.semanticRelations) {
      if (d.semanticRelations.hypernyms?.length)
        wnLines.push(`  上位词(更广义): ${d.semanticRelations.hypernyms.join(', ')}`);
      if (d.semanticRelations.hyponyms?.length)
        wnLines.push(`  下位词(更具体): ${d.semanticRelations.hyponyms.join(', ')}`);
    }
    sections.push(`【语义网络 (WordNet)】\n${wnLines.join('\n')}`);
  }

  // ── 词源 (Wiktionary) ────────────────────────────────────
  if (d.etymology) {
    sections.push(`【词源 (Wiktionary)】\n${d.etymology.slice(0, 500)}`);
  }

  // ── 词形变化 (Wiktionary) ────────────────────────────────
  if (d.forms?.length > 0) {
    const formText = d.forms
      .slice(0, 8)
      .map((f: any) => `${f.form}(${f.tags?.join(',') || ''})`)
      .join(', ');
    sections.push(`【词形变化】${formText}`);
  }

  // ── 多地区发音 (Wiktionary) ──────────────────────────────
  if (d.ipa?.length > 0) {
    const ipaText = d.ipa
      .map((i: any) => `${i.tag || ''}${i.ipa}`.trim())
      .join(' / ');
    sections.push(`【IPA发音】${ipaText}`);
  }

  return sections.join('\n\n');
}

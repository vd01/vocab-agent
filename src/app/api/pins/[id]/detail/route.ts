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
        let content = JSON.parse(p.richContent);
        // Fix legacy raw:true entries where mnemonic contains the full JSON string
        if (content?.raw && typeof content.mnemonic === 'string') {
          try {
            const inner = JSON.parse(content.mnemonic);
            if (typeof inner === 'object' && inner.mnemonic) {
              content = inner;
              // Update DB with fixed content
              db.update(pinnedWords)
                .set({ richContent: JSON.stringify(content) })
                .where(eq(pinnedWords.id, pinId))
                .catch(() => {});
            }
          } catch {
            try {
              const fixed = content.mnemonic
                .replace(/[\u201c\u201d]/g, '"')
                .replace(/[\u2018\u2019]/g, "'");
              const inner = JSON.parse(fixed);
              if (typeof inner === 'object' && inner.mnemonic) {
                content = inner;
                db.update(pinnedWords)
                  .set({ richContent: JSON.stringify(content) })
                  .where(eq(pinnedWords.id, pinId))
                  .catch(() => {});
              }
            } catch {}
          }
        }
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
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
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
要求：
1. 必须输出合法JSON，所有key和value必须用双引号""，不能用单引号或「」
2. contextSentences中每条例句格式：英文句子（中文翻译），必须包含中文
3. 简洁精炼，每字段不超过120字（contextSentences每条不超过80字）`;

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
      let cleaned = resultText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      richContent = JSON.parse(cleaned);
    } catch {
      // Fallback: try progressive JSON repair
      // Since we use response_format:json_object, the LLM should output valid JSON.
      // If it fails, it's usually because of CJK quotes inside string values.
      // Strategy: extract the outermost { }, then try targeted fixes.
      const raw = resultText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        // Try 1: Replace 「」 with "" (these are never valid JSON syntax)
        try {
          richContent = JSON.parse(jsonStr.replace(/[「」]/g, '"'));
        } catch {}

        // Try 2: Replace CJK quotes \u201c\u201d with escaped quotes inside strings
        // The key insight: \u201c/\u201d inside JSON string values need to become
        // escaped \" not raw ", because raw " would break the JSON structure.
        if (!richContent) {
          try {
            // Replace CJK quotes with escaped double quotes
            const fixed = jsonStr
              .replace(/\u201c/g, '\\"')
              .replace(/\u201d/g, '\\"');
            richContent = JSON.parse(fixed);
          } catch {}
        }

        // Try 3: Replace CJK quotes with single quotes (less destructive)
        if (!richContent) {
          try {
            const fixed = jsonStr
              .replace(/\u201c/g, "'")
              .replace(/\u201d/g, "'");
            richContent = JSON.parse(fixed);
          } catch {}
        }

        // Try 4: Single-quote keys/values (some LLMs use 'key': 'value')
        if (!richContent) {
          try {
            const fixed = jsonStr
              .replace(/'([^']*)'\s*:/g, '"$1":')
              .replace(/:\s*'([^']*)'/g, ': "$1"')
              .replace(/\[\s*'([^']*)'\s*\]/g, '["$1"]');
            richContent = JSON.parse(fixed);
          } catch {}
        }

        // Try 5: Combined — CJK quotes to single quotes + single-quote fix
        if (!richContent) {
          try {
            const fixed = jsonStr
              .replace(/\u201c/g, "'")
              .replace(/\u201d/g, "'")
              .replace(/'([^']*)'\s*:/g, '"$1":')
              .replace(/:\s*'([^']*)'/g, ': "$1"')
              .replace(/\[\s*'([^']*)'\s*\]/g, '["$1"]');
            richContent = JSON.parse(fixed);
          } catch {}
        }
      }

      // Final fallback: store as raw text
      if (!richContent) {
        richContent = { mnemonic: resultText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim(), raw: true };
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
      // Sort senses: prefer those with examples
      const sortedSenses = [...(sense.senses || [])].sort((a, b) => {
        const aHasEx = (a.examples?.length || 0) > 0 ? 0 : 1;
        const bHasEx = (b.examples?.length || 0) > 0 ? 0 : 1;
        return aHasEx - bHasEx;
      });
      for (const s of sortedSenses.slice(0, 6) ?? []) {
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
          const pvSenses = pv.senses.map((s: any) => s.en).join('; ');
          senseLines.push(`    ${pv.phrase} — ${pvSenses}`);
        }
      }
      if (sense.derivedForms?.length) {
        senseLines.push(`  派生词: ${sense.derivedForms.map((f: any) => `${f.word}${f.pos ? `(${f.pos})` : ''}`).join(', ')}`);
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
      // Truncate WordNet definitions that contain quoted examples inline
      // e.g. "open to two or more interpretations; or ..."an equivocal statement";..."
      let def = s.definition || '';
      // If definition contains semicolons and quoted text, truncate at first semicolon
      if (def.length > 100 && def.includes(';')) {
        def = def.split(';')[0] + '; ...';
      }
      // Cap definition length
      if (def.length > 150) def = def.slice(0, 147) + '...';
      wnLines.push(`  ${posLabel[s.pos] || s.pos}: ${def}`);
      if (s.lemmas?.length) wnLines.push(`    同义词集: ${s.lemmas.join(', ')}`);
      if (s.examples?.length) {
        // Truncate WordNet examples that are concatenated with semicolons
        const exText = s.examples.join('; ');
        wnLines.push(`    例: ${exText.length > 120 ? exText.slice(0, 117) + '...' : exText}`);
      }
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
    sections.push(`【词源 (Wiktionary)】\n${d.etymology.replace(/<[^>]+>/g, '').slice(0, 500)}`);
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

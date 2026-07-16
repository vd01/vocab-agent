import { defineTool } from './types';
import { z } from 'zod';
import { db } from '@/lib/db';
import { words } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { ecdictBatchLookup } from '@/lib/dictionary/ecdict';

// ── Stop words ──────────────────────────────────────────────────────────
// Common English words that are almost never worth extracting as "new vocabulary"
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
  'it', 'its', 'he', 'she', 'they', 'them', 'their', 'we', 'us', 'our',
  'you', 'your', 'i', 'me', 'my', 'this', 'that', 'these', 'those',
  'which', 'who', 'whom', 'what', 'where', 'when', 'how', 'why',
  'not', 'no', 'nor', 'if', 'then', 'than', 'too', 'very', 'so',
  'just', 'about', 'also', 'more', 'most', 'some', 'any', 'each',
  'every', 'all', 'both', 'few', 'many', 'much', 'other', 'another',
  'such', 'only', 'own', 'same', 'up', 'out', 'into', 'over', 'after',
  'before', 'between', 'under', 'again', 'there', 'here', 'once',
  'while', 'during', 'until', 'since', 'because', 'although', 'though',
  'even', 'still', 'already', 'yet', 'now', 'well', 'back', 'down',
  'off', 'away', 'far', 'near', 'much', 'little', 'big', 'small',
  'good', 'bad', 'new', 'old', 'long', 'short', 'high', 'low',
  'great', 'first', 'last', 'next', 'one', 'two', 'three', 'four',
  'five', 'ten', 'hundred', 'thousand', 'million',
  'say', 'said', 'get', 'got', 'go', 'went', 'gone', 'come', 'came',
  'make', 'made', 'take', 'took', 'taken', 'give', 'gave', 'given',
  'know', 'knew', 'known', 'see', 'saw', 'seen', 'think', 'thought',
  'tell', 'told', 'ask', 'asked', 'seem', 'seemed', 'feel', 'felt',
  'try', 'tried', 'leave', 'left', 'call', 'called', 'keep', 'kept',
  'let', 'begin', 'began', 'show', 'showed', 'hear', 'heard', 'play',
  'run', 'move', 'live', 'believe', 'hold', 'bring', 'happen',
  'write', 'written', 'sit', 'sat', 'stand', 'stood', 'lose', 'lost',
  'pay', 'paid', 'meet', 'met', 'include', 'continue', 'set',
  'learn', 'change', 'lead', 'led', 'understand', 'understood',
  'watch', 'follow', 'stop', 'create', 'speak', 'spoke', 'read',
  'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer',
  'remember', 'love', 'consider', 'appear', 'buy', 'bought', 'wait',
  'serve', 'die', 'died', 'send', 'sent', 'expect', 'build', 'built',
  'stay', 'fall', 'fell', 'cut', 'reach', 'kill', 'raise', 'pass',
  'sell', 'sold', 'require', 'report', 'decide', 'pull', 'develop',
  'am', 'being', 'having', 'doing', 'going', 'looking', 'using',
  'thing', 'things', 'man', 'men', 'woman', 'women', 'child', 'children',
  'people', 'world', 'year', 'years', 'day', 'days', 'time', 'times',
  'way', 'ways', 'life', 'hand', 'hands', 'part', 'parts', 'place',
  'places', 'case', 'cases', 'week', 'company', 'system', 'program',
  'question', 'work', 'number', 'night', 'point', 'home', 'water',
  'room', 'mother', 'area', 'money', 'story', 'fact', 'month',
  'lot', 'right', 'book', 'eye', 'job', 'word', 'business', 'issue',
  'side', 'kind', 'head', 'house', 'service', 'friend', 'father',
  'power', 'hour', 'game', 'line', 'end', 'member', 'law', 'car', 'city',
  'community', 'name', 'president', 'team', 'minute', 'idea',
  'body', 'information', 'back', 'parent', 'face', 'others', 'level',
  'office', 'door', 'health', 'person', 'art', 'war', 'history',
  'party', 'result', 'change', 'morning', 'reason', 'research',
  'girl', 'guy', 'moment', 'air', 'teacher', 'force', 'education',
]);

/**
 * Extract English words from text, tokenize, and identify words
 * that are NOT in the user's vocab library.
 * Returns each unknown word with its dictionary info.
 */
export const extractWordsTool = defineTool({
  description: '从英文文本中提取用户词库中不存在的生词，返回每个词的释义、音标、考试标签、Collins星级。用于阅读辅助场景。',
  inputSchema: z.object({
    text: z.string().describe('要分析的英文文本'),
    maxWords: z.number().optional().describe('最多返回的生词数，默认 15'),
    group: z.string().optional().describe('如果用户后续添加这些词，归入的分组名，如"四级"'),
  }),
  execute: async ({ text, maxWords = 15, group }) => {
    // 1. Tokenize: extract English words, lowercase, deduplicate
    const matches = text.toLowerCase().match(/[a-z']+/g);
    const rawWords: string[] = matches
      ? matches.filter((w: string) => w.length > 1 && !STOP_WORDS.has(w) && !/^['']+$/.test(w))
      : [];

    // Deduplicate
    const uniqueWords = [...new Set(rawWords)];

    if (uniqueWords.length === 0) {
      return { type: 'no-words', message: '文本中未找到可提取的英文单词' };
    }

    // 2. Check which words are already in user's vocab library
    // Process in chunks to avoid SQL variable limit
    const CHUNK = 200;
    const knownSet = new Set<string>();
    for (let i = 0; i < uniqueWords.length; i += CHUNK) {
      const chunk = uniqueWords.slice(i, i + CHUNK);
      const existing = await db
        .select({ word: words.word })
        .from(words)
        .where(inArray(words.word, chunk));
      for (const row of existing) {
        knownSet.add(row.word);
      }
    }

    const unknownWords = uniqueWords.filter(w => !knownSet.has(w));
    const knownCount = uniqueWords.length - unknownWords.length;

    if (unknownWords.length === 0) {
      return {
        type: 'all-known',
        knownCount,
        message: `文本中的 ${uniqueWords.length} 个词你都已学过，没有生词`,
      };
    }

    // 3. Batch lookup unknown words in ECDICT
    const ecdictResults = await ecdictBatchLookup(unknownWords);

    // 4. Build result — filter out words not in ECDICT (names, abbreviations, etc.)
    const extractedWords: Array<{
      word: string;
      phonetic: string | null;
      translation: string | null;
      tag: string | null;
      collins: number | null;
    }> = [];

    for (const w of unknownWords) {
      const entry = ecdictResults.get(w);
      if (!entry) continue;

      // Skip very short words without Collins rating (likely noise)
      if (w.length <= 3 && !entry.collins) continue;

      extractedWords.push({
        word: w,
        phonetic: entry.phonetic,
        translation: entry.translation?.split('\n')[0] ?? null,
        tag: entry.tag,
        collins: entry.collins,
      });
    }

    // Sort: Collins 5★ first, then by tag (GRE > CET6 > CET4), then alphabetical
    const tagPriority = (tag: string | null): number => {
      if (!tag) return 99;
      if (tag.includes('gre')) return 1;
      if (tag.includes('toefl')) return 2;
      if (tag.includes('ielts')) return 3;
      if (tag.includes('cet6')) return 4;
      if (tag.includes('cet4')) return 5;
      return 10;
    };

    extractedWords.sort((a, b) => {
      const collinsDiff = (b.collins ?? 0) - (a.collins ?? 0);
      if (collinsDiff !== 0) return collinsDiff;
      return tagPriority(a.tag) - tagPriority(b.tag);
    });

    // Limit to maxWords
    const limited = extractedWords.slice(0, maxWords);

    return {
      type: 'extracted-words',
      total: limited.length,
      words: limited,
      knownCount,
      group: group?.trim() || null,
      message: `从文本中提取了 ${limited.length} 个生词（你已认识 ${knownCount} 个词）${group ? `，建议添加到"${group}"分组` : ''}`,
    };
  },
});

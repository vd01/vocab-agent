import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';

// ── Provider instances ───────────────────────────────────────────────────

// OpenAI-compatible provider — configure via .env.local
// V7: use .chat() to hit /chat/completions (not /responses which most compatible APIs don't support)
const openaiCompatible = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// Native DeepSeek provider — for reasoning models
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  baseURL: process.env.DEEPSEEK_BASE_URL ?? process.env.OPENAI_BASE_URL,
});

// ── Model instances ──────────────────────────────────────────────────────
// Direct model references — single source of truth for model configuration.
// Change models here in one place.

// Teacher Agent: fast model for daily teaching interaction
export const teacherModel = openaiCompatible.chat(
  process.env.TEACHER_MODEL ?? 'gpt-4o-mini',
);

// Developer Agent: reasoning model for code generation
export const developerModel = openaiCompatible.chat(
  process.env.DEVELOPER_MODEL ?? 'deepseek-reasoner',
);

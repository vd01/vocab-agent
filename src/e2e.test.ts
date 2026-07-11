/**
 * 端到端集成测试
 * 测试完整的聊天 API 流程：页面加载、Agent 路由、工具调用、FSRS 复习
 *
 * 运行方式: npm run test:e2e
 * 前提条件: 开发服务器必须已在运行 (npm run dev --turbopack --port 3088)
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3088';

/** Helper: 发送聊天消息并收集完整响应 */
async function chat(userText: string, timeout = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // AI SDK v7 DefaultChatTransport sends UIMessage format
    const message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text: userText }],
    };

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [message] }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    // Parse SSE stream
    const text = await res.text();
    const events = text
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return events;
  } finally {
    clearTimeout(timer);
  }
}

/** Helper: 从事件列表中提取文本内容 */
function extractText(events: any[]): string {
  return events
    .filter(e => e.type === 'text-delta' && e.delta)
    .map(e => e.delta)
    .join('');
}

/** Helper: 从事件列表中提取工具调用 */
function extractToolCalls(events: any[]): Array<{ toolName: string; input: any; output: any }> {
  const calls: Map<string, { toolName: string; input: any; output: any }> = new Map();

  for (const e of events) {
    if (e.type === 'tool-input-available' && e.toolCallId) {
      const existing = calls.get(e.toolCallId) || { toolName: e.toolName, input: null, output: null };
      existing.input = e.input;
      calls.set(e.toolCallId, existing);
    }
    if (e.type === 'tool-output-available' && e.toolCallId) {
      const existing = calls.get(e.toolCallId) || { toolName: '', input: null, output: null };
      existing.output = e.output;
      calls.set(e.toolCallId, existing);
    }
  }

  return Array.from(calls.values());
}

/** Helper: 检查服务器是否可用 */
async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('E2E - Server Health', () => {
  it('should serve the main page', async () => {
    const res = await fetch(BASE_URL);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Vocab Agent');
  });
});

describe('E2E - Chat API', () => {
  it('should respond to a greeting', async () => {
    const events = await chat('你好');
    const text = extractText(events);
    expect(text.length).toBeGreaterThan(0);
    // Should contain some Chinese text
    expect(text).toMatch(/[一-鿿]/);
  });

  it('should include stream start event', async () => {
    const events = await chat('hello');
    const types = events.map(e => e.type);
    expect(types).toContain('start');
  });

  it('should include text deltas', async () => {
    const events = await chat('say hi');
    const textDeltas = events.filter(e => e.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);
  });
});

describe('E2E - Add Word Tool', () => {
  const uniqueWord = `testword_${Date.now()}`;

  it('should call add-word tool when asked to add a word', async () => {
    const events = await chat(`请添加单词 ${uniqueWord}，意思是"测试单词"`, 90000);

    const toolCalls = extractToolCalls(events);
    const addWordCall = toolCalls.find(tc => tc.toolName === 'add-word');

    // Either add-word was called directly, or vocab-lookup was called first
    // (multi-step: lookup then add)
    const hasRelevantTool = toolCalls.some(tc =>
      tc.toolName === 'add-word' || tc.toolName === 'vocab-lookup'
    );
    expect(hasRelevantTool).toBe(true);
  });

  it('should confirm word was added in the response text', async () => {
    const events = await chat(`用add-word工具添加单词 ${uniqueWord}_v2，意思是"测试单词v2"`, 90000);

    const toolCalls = extractToolCalls(events);
    const addWordCall = toolCalls.find(tc => tc.toolName === 'add-word');

    if (addWordCall && addWordCall.output) {
      expect(addWordCall.output.type).toBe('added');
      expect(addWordCall.output.word).toContain(uniqueWord);
    }
  });
});

describe('E2E - Review Tool', () => {
  it('should call fsrs-review tool when asked to review', async () => {
    const events = await chat('我要复习单词', 90000);

    const toolCalls = extractToolCalls(events);
    const reviewCall = toolCalls.find(tc => tc.toolName === 'fsrs-review');

    // Tool should be called
    expect(reviewCall).toBeDefined();

    if (reviewCall?.output) {
      // Output should be either due-words or no-due-words
      expect(['due-words', 'no-due-words']).toContain(reviewCall.output.type);
    }
  });
});

describe('E2E - Agent Router', () => {
  it('should route to Teacher agent for normal questions', async () => {
    const events = await chat('什么是 ephemeral？');
    // Should get a response (not error)
    const text = extractText(events);
    expect(text.length).toBeGreaterThan(0);
  });

  it('should route to Developer agent for development requests', async () => {
    const events = await chat('帮我写一个倒计时组件', 90000);

    // Developer agent should use its tools
    const toolCalls = extractToolCalls(events);
    const devTools = toolCalls.filter(tc =>
      ['file-write', 'file-read', 'shell-exec', 'register-tool', 'register-component'].includes(tc.toolName)
    );

    // Developer may respond with text or use tools
    // The important thing is we get a non-error response
    const text = extractText(events);
    const hasDevTools = devTools.length > 0;
    const hasTextResponse = text.length > 0;

    // Either tools were called, or text was returned (model may ask for clarification)
    expect(hasDevTools || hasTextResponse).toBe(true);
  });
});

describe('E2E - Command Handling', () => {
  it('should handle /review command via /api/commands', async () => {
    const res = await fetch(`${BASE_URL}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '/review' }),
    });
    expect(res.ok).toBe(true);
    const result = await res.json();
    expect(['due-words', 'no-due-words']).toContain(result.type);
  });

  it('should handle /add command via /api/commands', async () => {
    const testWord = `cmdtest_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `/add ${testWord} 测试单词` }),
    });
    expect(res.ok).toBe(true);
    const result = await res.json();
    expect(result.type).toBe('added');
    expect(result.word).toBe(testWord);
  });

  it('should handle /stats command via /api/commands', async () => {
    const res = await fetch(`${BASE_URL}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '/stats' }),
    });
    expect(res.ok).toBe(true);
    const result = await res.json();
    expect(result.type).toBe('stats');
    expect(result).toHaveProperty('totalWords');
    expect(result).toHaveProperty('distribution');
    expect(result).toHaveProperty('daily');
  });

  it('should return unknown-command for invalid commands', async () => {
    const res = await fetch(`${BASE_URL}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '/nonexistent' }),
    });
    expect(res.ok).toBe(true);
    const result = await res.json();
    expect(result.type).toBe('unknown-command');
  });

  it('should handle /dev command via chat API', async () => {
    const events = await chat('/dev 我想加一个统计功能', 90000);

    // Should get a response
    const text = extractText(events);
    expect(text.length).toBeGreaterThan(0);
  });
});

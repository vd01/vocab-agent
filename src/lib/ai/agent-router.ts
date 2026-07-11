/**
 * Route user message to the appropriate agent.
 * / commands (except /dev / /d) are now handled by the command executor,
 * so this router only deals with /dev, /d and natural language intent.
 */

// ── Development intent patterns ──────────────────────────────────────────
// Broad coverage: Chinese imperatives, questions, suggestions;
// English imperatives, feature requests, code-related terms.

const devPatterns: RegExp[] = [
  // Chinese: 帮我/给我/让我/能不能/可不可以 + 开发动词
  /(帮我|给我|让我|能不能|可不可以|请).*(加|写|创建|修改|开发|实现|设计|重构|生成|做|搞|弄|配置|设置|部署)/,
  // Chinese: 需要/想要/希望 + 功能/组件/命令/特性
  /(需要|想要|希望|得|该).*(功能|组件|命令|特性|页面|模块|接口|工具|统计|分析|面板)/,
  // Chinese: 添加/新增/开发 + 功能/命令/组件
  /(添加|新增|开发|实现|创建|写个|做个).*(功能|命令|组件|特性|页面|模块|工具|统计|分析)/,
  // Chinese: 没有动词的功能请求 ("一个xxx功能", "词库统计")
  /一个.{0,6}(功能|命令|组件|特性|页面|模块|工具|面板)/,
  // Chinese: "xxx不够/不好/太慢" + 暗示改进
  /(不够|不好|太慢|太弱|缺失|缺少|缺少|缺).*(功能|特性|能力|支持)/,
  // English: imperative verbs
  /\b(add|create|build|make|develop|write|implement|generate|configure|deploy|refactor|fix)\b.{0,20}\b(feature|command|component|tool|page|module|function|panel|widget|endpoint)\b/i,
  // English: "I want/need a ..."
  /\b(I|we)\b.{0,5}\b(want|need|would like|should|have to)\b.{0,15}\b(feature|command|component|tool|page|module|panel)\b/i,
  // English: "can you / could you add/build/..."
  /\b(can|could|would)\b.{0,5}\byou\b.{0,10}\b(add|build|create|make|write|implement|develop)\b/i,
];

// ── False positive filters ───────────────────────────────────────────────
// These patterns look like dev intent but are actually learning questions.

const teacherPatterns: RegExp[] = [
  // "什么是/怎么用/如何理解" + English word → learning question
  /(什么是|怎么用|如何理解|怎么读|什么意思|怎么发音|如何发音).{0,10}[a-zA-Z]/,
  // "帮我复习/帮我记忆/帮我学" → learning
  /帮我(复习|记忆|学习|背|练|读|翻译|查)/,
  // "add word" as in vocabulary, not feature
  /\badd\s+(word|vocab|term|entry)\b/i,
  // Short questions (< 15 chars) are usually learning questions
  /^.{1,14}[?？]$/,
];

export function routeAgent(message: string): 'teacher' | 'developer' {
  const trimmed = message.trim();

  // /dev or /d prefix → Developer (force trigger)
  if (trimmed.startsWith('/dev ') || trimmed === '/dev' ||
      trimmed.startsWith('/d ') || trimmed === '/d') {
    return 'developer';
  }

  // Check false positives first — if it looks like a learning question, go to Teacher
  if (teacherPatterns.some(p => p.test(trimmed))) {
    return 'teacher';
  }

  // Check development intent patterns
  if (devPatterns.some(p => p.test(trimmed))) {
    return 'developer';
  }

  // Default → Teacher
  return 'teacher';
}

/**
 * Developer Agent 测试用例数据
 * 从 docs/developer-agent-test-cases.md 提取的结构化数据
 */

export interface TestCase {
  id: string;
  title: string;
  category: string;
  complexity: 'simple' | 'medium' | 'complex';
  prompt: string;
  expectation: string;
  coveragePoint: string;
  group: string;       // 测试分组，同组内顺序执行，组间清理
  dependsOn?: string[]; // 依赖的测试用例 ID
  timeoutMs: number;    // 超时时间
}

export const TEST_CASES: TestCase[] = [
  // ── Group A: 能力边界 + 基础查询（无副作用）────────────────────────
  {
    id: 'TC-01',
    title: '越界请求 — 复习单词',
    category: '能力边界拒绝',
    complexity: 'simple',
    prompt: '帮我复习今天的单词',
    expectation: 'Developer Agent 应拒绝执行，回复"这是学习功能，请关闭「开发」开关后再试。"不应调用 fsrs-review、vocab-lookup 等教学工具。',
    coveragePoint: '能力边界 — 教学操作拒绝',
    group: 'A',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-02',
    title: '越界请求 — 查询单词含义',
    category: '能力边界拒绝',
    complexity: 'simple',
    prompt: 'ephemeral 这个单词是什么意思？',
    expectation: '同样拒绝，告知用户关闭开发模式。不能调用 dict-lookup 或假装查了词典。',
    coveragePoint: '能力边界 — 查词拒绝',
    group: 'A',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-03',
    title: 'db-query — 词库统计',
    category: '单工具调用',
    complexity: 'simple',
    prompt: '帮我看看词库里有多少单词',
    expectation: '调用 db-query 工具，queryType="word-count"，返回词库总数。直接用自然语言回复用户，不注册命令。',
    coveragePoint: 'db-query 工具（word-count），不需要注册命令的场景判断',
    group: 'A',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-04',
    title: 'db-query — 搜索单词',
    category: '单工具调用',
    complexity: 'simple',
    prompt: '词库里有 ephemeral 这个词吗？',
    expectation: '调用 db-query，queryType="word-search"，word="ephemeral"。返回搜索结果。',
    coveragePoint: 'db-query 工具（word-search），带参数查询',
    group: 'A',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-05',
    title: 'db-query — 自定义 SQL 查询',
    category: '单工具调用',
    complexity: 'simple',
    prompt: '统计一下每个首字母开头的单词各有多少个',
    expectation: '调用 db-query，queryType="custom"，传入 SQL 如 SELECT SUBSTR(word,1,1) AS letter, COUNT(*) AS cnt FROM words GROUP BY letter ORDER BY letter。以表格或列表形式返回统计结果。',
    coveragePoint: 'db-query 工具（custom SQL），聚合查询',
    group: 'A',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-06',
    title: 'file-list — 浏览项目结构',
    category: '单工具调用',
    complexity: 'simple',
    prompt: '看看 generated 目录下都有什么文件',
    expectation: '调用 file-list，path="generated"，可能 recursive=true。返回目录结构。',
    coveragePoint: 'file-list 工具，项目文件浏览',
    group: 'A',
    timeoutMs: 60_000,
  },

  // ── Group B: 标记块文件操作链（TC-07→08→09 有依赖）──────────────────
  {
    id: 'TC-07',
    title: 'file-write 标记块 — 创建简单脚本',
    category: '标记块文件操作',
    complexity: 'simple',
    prompt: '在 generated/tools/ 下创建一个 hello.js，内容是一个 async 函数，返回 { type: \'message\', message: \'Hello from developer!\' }',
    expectation: '使用 <<<file-write:generated/tools/hello.js>>> 标记块写入文件，不调用任何"file-write工具"（因为没有这个工具）。',
    coveragePoint: '标记块 <<<file-write>>> 写入，确认 Agent 理解标记块而非工具调用',
    group: 'B',
    timeoutMs: 60_000,
  },
  {
    id: 'TC-08',
    title: 'file-edit 标记块 — 修改已有文件',
    category: '标记块文件操作',
    complexity: 'medium',
    prompt: '把 generated/tools/hello.js 里的消息改成 "Hello, World!"，另外加一行 console.log',
    expectation: '必须先调用 file-read 读取文件，等待结果返回确认行号后，再输出 <<<file-edit:generated/tools/hello.js:replace:N-M>>> 标记块替换对应行。不允许在同一轮回复中同时调用 file-read 和输出标记块。',
    coveragePoint: 'file-read + <<<file-edit:replace>>> 标记块，编辑前先读取的规范',
    group: 'B',
    dependsOn: ['TC-07'],
    timeoutMs: 120_000,
  },
  {
    id: 'TC-09',
    title: 'file-edit 标记块 — 插入代码',
    category: '标记块文件操作',
    complexity: 'medium',
    prompt: '在 generated/tools/hello.js 的第 2 行前面插入一行注释 // This is a generated tool',
    expectation: '先用 file-read 读取文件确认行号，然后用 <<<file-edit:generated/tools/hello.js:insert:2>>> 插入注释。',
    coveragePoint: '<<<file-edit:insert>>> 标记块，行号定位',
    group: 'B',
    dependsOn: ['TC-08'],
    timeoutMs: 120_000,
  },

  // ── Group C: 命令注册链（TC-10→15, TC-11→14 有依赖）─────────────────
  {
    id: 'TC-10',
    title: '创建简单命令（message 类型，无组件）',
    category: 'create-command',
    complexity: 'medium',
    prompt: '帮我创建一个 /word-count 命令，输入后显示词库单词总数和待复习数',
    expectation: '1. 用 <<<file-write>>> 标记块将 toolCode 写入 generated/tools/word-count.js\n2. 调用 create-command 工具，传入 name="word-count"、description、toolCodePath\n3. 不提供 componentCodePath（因为返回 type: \'message\'）\n4. 调用 test-command 验证命令可用',
    coveragePoint: 'create-command 工具 + test-command 工具，message 类型返回值，完整命令注册流程',
    group: 'C',
    timeoutMs: 120_000,
  },
  {
    id: 'TC-11',
    title: '创建带自定义 UI 的命令',
    category: 'create-command',
    complexity: 'medium',
    prompt: '做一个 /word-stats 命令，用柱状图展示各首字母开头的单词数量分布，要有漂亮的 UI',
    expectation: '1. 用 <<<file-write>>> 写入 toolCode 到 generated/tools/word-stats.js（查询数据库，按首字母聚合）\n2. 用 <<<file-write>>> 写入组件代码到 generated/components/word-stats-panel.tsx（含 \'use client\'、export default、Tailwind 样式）\n3. 调用 create-command，同时传入 toolCodePath 和 componentCodePath\n4. 调用 test-command 验证',
    coveragePoint: 'create-command 工具（含组件），组件代码规范，type 匹配规则',
    group: 'C',
    timeoutMs: 360_000,
  },
  {
    id: 'TC-12',
    title: '命令名冲突处理',
    category: 'create-command',
    complexity: 'medium',
    prompt: '创建一个 /stats 命令，显示我的学习统计信息',
    expectation: 'Agent 应正确处理 /stats 与内置命令的冲突。合法路径：(1) 直接用 /stats 调用 create-command，收到冲突错误后用建议名重新注册；(2) 识别到 /stats 是内置命令，主动选择替代名注册。无论哪种路径，最终都应告知用户新命令名及原因。整个冲突处理应在 2-3 步内完成。',
    coveragePoint: '命令名冲突检测，自动恢复策略',
    group: 'C',
    timeoutMs: 240_000,
  },
  {
    id: 'TC-13',
    title: '语法错误自动修复',
    category: 'create-command',
    complexity: 'medium',
    prompt: '创建一个 /recent-words 命令，显示最近添加的 10 个单词。我之前试过但总是报语法错误，请确保代码正确',
    expectation: 'Agent 编写 toolCode 时如果 create-command 返回 syntax-error，应根据错误信息定位并修复，不需要重写标记块——只需覆盖原文件后重新调用 create-command。',
    coveragePoint: 'create-command 的语法检查反馈，错误恢复流程',
    group: 'C',
    timeoutMs: 180_000,
  },
  {
    id: 'TC-14',
    title: 'unregister-component — 删除组件',
    category: '组件管理',
    complexity: 'medium',
    prompt: '把 /word-stats 的 UI 组件删掉，只保留纯文本返回',
    expectation: '1. 调用 unregister-component，name="word-stats"（组件名与命令名一致）\n2. 不直接删除文件（因为会导致注册表不同步）\n3. 可能需要更新 toolCode 的返回值为 type: \'message\'',
    coveragePoint: 'unregister-component 工具，注册表同步机制',
    group: 'C',
    dependsOn: ['TC-11'],
    timeoutMs: 240_000,
  },
  {
    id: 'TC-15',
    title: 'register-component — 单独注册组件',
    category: '组件管理',
    complexity: 'medium',
    prompt: '我想给 /word-count 命令加一个好看的卡片式 UI 组件，显示数字大一点。请使用 register-component 工具来单独注册这个组件，不要用 create-command。',
    expectation: '1. 用 <<<file-write>>> 写组件代码到 generated/components/ 目录\n2. 调用 register-component 工具（而非 create-command），name="word-count"，codePath 指向组件文件\n3. 可能需要同步更新 toolCode 的返回值 type',
    coveragePoint: 'register-component 工具，单独组件注册（非 create-command 路径）',
    group: 'C',
    dependsOn: ['TC-10'],
    timeoutMs: 240_000,
  },

  // ── Group D: 经验教训 + 复合场景 ─────────────────────────────────────
  {
    id: 'TC-16',
    title: 'save-lesson — 保存经验',
    category: '经验教训管理',
    complexity: 'complex',
    prompt: '我刚发现 component-registry.ts 是自动维护的，手动改会被覆盖。把这个经验记下来',
    expectation: '调用 save-lesson，category="pitfall"，title 如"不要手动修改 component-registry.ts"，content 描述具体原因和正确做法。',
    coveragePoint: 'save-lesson 工具，经验教训保存',
    group: 'D',
    timeoutMs: 120_000,
  },
  {
    id: 'TC-17',
    title: 'list-lessons + merge-lessons — 合并冗余经验',
    category: '经验教训管理',
    complexity: 'complex',
    prompt: '检查一下知识库，如果有重复的经验就合并一下',
    expectation: '1. 调用 list-lessons 查看所有经验\n2. 识别语义重复或高度相关的条目\n3. 调用 merge-lessons 合并，传入 keepId、mergeIds、合并后的标题和内容',
    coveragePoint: 'list-lessons + merge-lessons 工具，知识库维护',
    group: 'D',
    timeoutMs: 120_000,
  },
  {
    id: 'TC-18',
    title: 'save-lesson — 重复标题自动更新',
    category: '经验教训管理',
    complexity: 'complex',
    prompt: '我之前保存过一条经验"component-registry.ts 是自动维护的"，现在我想更新它的内容为：component-registry.ts 由 register-component 和 unregister-component 工具自动维护，不要手动编辑，否则改动会被覆盖。请用 save-lesson 工具保存，标题保持和之前一样。',
    expectation: '调用 save-lesson，标题与 TC-16 保存的标题相同（或非常接近），因此应返回 type: \'updated\'（更新而非重复创建），知识库中不会出现重复条目。',
    coveragePoint: 'save-lesson 去重机制（标题唯一），重复标题自动更新',
    group: 'D',
    timeoutMs: 120_000,
  },
  {
    id: 'TC-19',
    title: '完整开发流程 — 交互式单词匹配游戏',
    category: '复合场景',
    complexity: 'complex',
    prompt: '帮我做一个 /word-match 命令，随机出 5 个单词和 5 个释义，用户可以点击配对，做成一个交互式的小游戏',
    expectation: '核心流程：1. <<<file-write>>> 写入 toolCode（查询数据库，随机出 5 个单词和 5 个释义）2. <<<file-write>>> 写入交互式组件代码（点击配对游戏 UI）3. create-command 注册 4. test-command 测试 5. 如果测试失败，根据 _errorDetail 修复。可选步骤：file-list 了解目录（如不确定时）、file-read 查阅文档（如不确定 API 时）、save-lesson（如有价值发现）。',
    coveragePoint: '多工具协作，完整开发流程，交互式组件，test-command 错误处理，经验教训自动积累',
    group: 'D',
    timeoutMs: 420_000,
  },
  {
    id: 'TC-20',
    title: '一次性数据操作 — 不注册命令',
    category: '复合场景',
    complexity: 'complex',
    prompt: '帮我把词库里所有 source 为 "test" 的单词清理掉。如果没有这样的单词，先添加几个测试用的（source 设为 "test"），然后再删除它们，让我看到完整的清理流程。',
    expectation: '1. 先用 db-query（custom SQL: SELECT）确认有多少 source="test" 的单词\n2. 如果没有，通过临时 toolCode 添加测试数据\n3. 因为 db-query 的 custom 模式只支持 SELECT，写操作需要通过临时注册的命令执行（用 register-tool 或 create-command 注册 + test-command 执行）\n4. 执行完清理后明确告知用户这是一次性操作已完成，不要推荐用户将此命令作为长期工具使用',
    coveragePoint: 'db-query 只读限制，写操作需通过沙盒 toolCode，不默认注册命令的判断，完整写操作流程',
    group: 'D',
    timeoutMs: 300_000,
  },
];

/** 测试分组定义：组间执行顺序和组间清理策略 */
export const TEST_GROUPS = [
  { name: 'A', label: '能力边界 + 基础查询', needsCleanup: false },
  { name: 'B', label: '标记块文件操作链', needsCleanup: true },
  { name: 'C', label: '命令注册 + 组件管理', needsCleanup: true },
  { name: 'D', label: '经验教训 + 复合场景', needsCleanup: true },
] as const;

/** 获取指定组的测试用例 */
export function getTestCasesByGroup(group: string): TestCase[] {
  return TEST_CASES.filter(tc => tc.group === group);
}

/** 获取指定 ID 的测试用例 */
export function getTestCaseById(id: string): TestCase | undefined {
  return TEST_CASES.find(tc => tc.id === id);
}

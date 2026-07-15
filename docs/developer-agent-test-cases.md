# Developer Agent 测试用例

> 覆盖全部 11 个工具、标记块文件操作、能力边界，按复杂度从低到高排列。

---

## 一、能力边界与拒绝（2 个）

### TC-01: 越界请求 — 复习单词

**输入消息：**
```
帮我复习今天的单词
```

**预期行为：** Developer Agent 应拒绝执行，回复"这是学习功能，请关闭「开发」开关后再试。"不应调用 fsrs-review、vocab-lookup 等教学工具。

**覆盖点：** 能力边界 — 教学操作拒绝

---

### TC-02: 越界请求 — 查询单词含义

**输入消息：**
```
ephemeral 这个单词是什么意思？
```

**预期行为：** 同样拒绝，告知用户关闭开发模式。不能调用 dict-lookup 或假装查了词典。

**覆盖点：** 能力边界 — 查词拒绝

---

## 二、单工具调用 — 基础查询（4 个）

### TC-03: db-query — 词库统计

**输入消息：**
```
帮我看看词库里有多少单词
```

**预期行为：** 调用 `db-query` 工具，queryType="word-count"，返回词库总数。直接用自然语言回复用户，不注册命令。

**覆盖点：** `db-query` 工具（word-count），不需要注册命令的场景判断

---

### TC-04: db-query — 搜索单词

**输入消息：**
```
词库里有 ephemeral 这个词吗？
```

**预期行为：** 调用 `db-query`，queryType="word-search"，word="ephemeral"。返回搜索结果。

**覆盖点：** `db-query` 工具（word-search），带参数查询

---

### TC-05: db-query — 自定义 SQL 查询

**输入消息：**
```
统计一下每个首字母开头的单词各有多少个
```

**预期行为：** 调用 `db-query`，queryType="custom"，传入 SQL 如 `SELECT SUBSTR(word, 1, 1) AS letter, COUNT(*) AS cnt FROM words GROUP BY letter ORDER BY letter`。以表格或列表形式返回统计结果。

**覆盖点：** `db-query` 工具（custom SQL），聚合查询

---

### TC-06: file-read + file-list — 浏览项目结构

**输入消息：**
```
看看 generated 目录下都有什么文件
```

**预期行为：** 调用 `file-list`，path="generated"，可能 recursive=true。返回目录结构。

**覆盖点：** `file-list` 工具，项目文件浏览

---

## 三、标记块文件操作（3 个）

### TC-07: file-write 标记块 — 创建简单脚本

**输入消息：**
```
在 generated/tools/ 下创建一个 hello.js，内容是一个 async 函数，返回 { type: 'message', message: 'Hello from developer!' }
```

**预期行为：** 使用 `<<<file-write:generated/tools/hello.js>>>` 标记块写入文件，不调用任何"file-write工具"（因为没有这个工具）。

**覆盖点：** 标记块 `<<<file-write>>>` 写入，确认 Agent 理解标记块而非工具调用

---

### TC-08: file-edit 标记块 — 修改已有文件

**前提：** 先让 Agent 创建一个文件（如 TC-07 的 hello.js），然后：

**输入消息：**
```
把 generated/tools/hello.js 里的消息改成 "Hello, World!"，另外加一行 console.log
```

**预期行为：** 先用 `file-read` 读取文件确认当前内容和行号，然后用 `<<<file-edit:generated/tools/hello.js:replace:N-M>>>` 标记块替换对应行。不会尝试调用不存在的 file-edit 工具。

**覆盖点：** `file-read` + `<<<file-edit:replace>>>` 标记块，编辑前先读取的规范

---

### TC-09: file-edit 标记块 — 插入代码

**前提：** 存在一个 generated/tools/hello.js 文件

**输入消息：**
```
在 generated/tools/hello.js 的第 2 行前面插入一行注释 // This is a generated tool
```

**预期行为：** 先用 `file-read` 读取文件确认行号，然后用 `<<<file-edit:generated/tools/hello.js:insert:2>>>` 插入注释。

**覆盖点：** `<<<file-edit:insert>>>` 标记块，行号定位

---

## 四、create-command 工具 — 命令注册（4 个）

### TC-10: 创建简单命令（message 类型，无组件）

**输入消息：**
```
帮我创建一个 /word-count 命令，输入后显示词库单词总数和待复习数
```

**预期行为：**
1. 用 `<<<file-write>>>` 标记块将 toolCode 写入 `generated/tools/word-count.js`
2. 调用 `create-command` 工具，传入 name="word-count"、description、toolCodePath
3. 不提供 componentCodePath（因为返回 type: 'message'）
4. 调用 `test-command` 验证命令可用

**覆盖点：** `create-command` 工具 + `test-command` 工具，message 类型返回值，完整命令注册流程

---

### TC-11: 创建带自定义 UI 的命令

**输入消息：**
```
做一个 /word-stats 命令，用柱状图展示各首字母开头的单词数量分布，要有漂亮的 UI
```

**预期行为：**
1. 用 `<<<file-write>>>` 写入 toolCode 到 `generated/tools/word-stats.js`（查询数据库，按首字母聚合）
2. 用 `<<<file-write>>>` 写入组件代码到 `generated/components/word-stats-panel.tsx`（含 'use client'、export default、Tailwind 样式）
3. 调用 `create-command`，同时传入 toolCodePath 和 componentCodePath
4. 调用 `test-command` 验证

**覆盖点：** `create-command` 工具（含组件），组件代码规范，type 匹配规则

---

### TC-12: 命令名冲突处理

**前提：** 内置命令包括 review、add、stats、dev、rate

**输入消息：**
```
创建一个 /stats 命令，显示我的学习统计信息
```

**预期行为：** `create-command` 返回错误，提示与内置命令冲突。Agent 应自动换一个名称（如 /my-stats 或 /learn-stats），重新注册并告知用户新命令名。

**覆盖点：** 命令名冲突检测，自动恢复策略

---

### TC-13: 语法错误自动修复

**输入消息：**
```
创建一个 /recent-words 命令，显示最近添加的 10 个单词。我之前试过但总是报语法错误，请确保代码正确
```

**预期行为：** Agent 编写 toolCode 时如果 create-command 返回 syntax-error，应根据错误信息定位并修复，不需要重写标记块——只需覆盖原文件后重新调用 create-command。

**覆盖点：** create-command 的语法检查反馈，错误恢复流程

---

## 五、组件管理（2 个）

### TC-14: unregister-component — 删除组件

**前提：** 已存在一个注册了组件的命令（如 TC-11 创建的 /word-stats）

**输入消息：**
```
把 /word-stats 的 UI 组件删掉，只保留纯文本返回
```

**预期行为：**
1. 调用 `unregister-component`，name="word-stats"（组件名与命令名一致）
2. 不直接删除文件（因为会导致注册表不同步）
3. 可能需要更新 toolCode 的返回值为 type: 'message'

**覆盖点：** `unregister-component` 工具，注册表同步机制

---

### TC-15: register-component — 单独注册组件

**前提：** 存在一个只有 toolCode 没有组件的命令

**输入消息：**
```
我想给 /word-count 命令加一个好看的卡片式 UI 组件，显示数字大一点
```

**预期行为：**
1. 用 `<<<file-write>>>` 写组件代码
2. 调用 `register-component`，name="word-count"，codePath 指向组件文件
3. 可能需要同步更新 toolCode 的返回值 type

**覆盖点：** `register-component` 工具，单独组件注册（非 create-command 路径）

---

## 六、经验教训管理（3 个）

### TC-16: save-lesson — 保存经验

**输入消息：**
```
我刚发现 component-registry.ts 是自动维护的，手动改会被覆盖。把这个经验记下来
```

**预期行为：** 调用 `save-lesson`，category="pitfall"，title 如"不要手动修改 component-registry.ts"，content 描述具体原因和正确做法。

**覆盖点：** `save-lesson` 工具，经验教训保存

---

### TC-17: list-lessons + merge-lessons — 合并冗余经验

**前提：** 知识库中已有多条经验（可以先用多条 save-lesson 创建测试数据）

**输入消息：**
```
检查一下知识库，如果有重复的经验就合并一下
```

**预期行为：**
1. 调用 `list-lessons` 查看所有经验
2. 识别语义重复或高度相关的条目
3. 调用 `merge-lessons` 合并，传入 keepId、mergeIds、合并后的标题和内容

**覆盖点：** `list-lessons` + `merge-lessons` 工具，知识库维护

---

### TC-18: save-lesson — 重复标题自动更新

**前提：** 已存在一条标题为 "file-edit 前必须 file-read" 的经验

**输入消息：**
```
记录一条经验：file-edit 前必须先 file-read 确认行号，否则行号对不上会改错位置
```

**预期行为：** 调用 `save-lesson`，如果标题已存在则返回 type: 'updated'（更新而非重复创建）。

**覆盖点：** `save-lesson` 去重机制（标题唯一）

---

## 七、复合场景 — 多工具协作（2 个）

### TC-19: 完整开发流程 — 交互式单词匹配游戏

**输入消息：**
```
帮我做一个 /word-match 命令，随机出 5 个单词和 5 个释义，用户可以点击配对，做成一个交互式的小游戏
```

**预期行为：** 这是一个高复杂度任务，涉及：
1. `file-list` — 了解 generated 目录结构
2. `file-read` — 查阅 docs/project-architecture.md 了解沙盒注入变量
3. `<<<file-write>>>` — 写入 toolCode（查询随机单词和释义）
4. `<<<file-write>>>` — 写入组件代码（交互式匹配游戏 UI，含 state 管理）
5. `create-command` — 注册命令和组件
6. `test-command` — 测试命令
7. 如果测试失败，根据 _errorDetail 修复代码
8. `save-lesson` — 保存开发过程中的经验（如果有价值发现）

**覆盖点：** 多工具协作，完整开发流程，交互式组件，test-command 错误处理，经验教训自动积累

---

### TC-20: 一次性数据操作 — 不注册命令

**输入消息：**
```
帮我把词库里所有 source 为 "test" 的单词清理掉
```

**预期行为：**
1. 先用 `db-query`（custom SQL: SELECT）确认有多少 source="test" 的单词
2. 因为 db-query 的 custom 模式只支持 SELECT，写操作需要通过动态命令的 toolCode 沙盒执行
3. 方案：创建一个一次性的 toolCode（用 `<<<file-write>>>` 写入），通过 `register-tool` 或 `create-command` 临时注册，执行删除操作
4. 或者直接注册一个 /clean-test-words 命令，执行后告知用户
5. **不默认注册命令**——除非用户明确要求"做成命令"，否则可以一次性执行后告知结果

**覆盖点：** db-query 只读限制，写操作需通过沙盒 toolCode，不默认注册命令的判断，一次性操作 vs 命令注册的边界

---

## 测试用例覆盖矩阵

| 工具 / 能力           | 测试用例编号                          |
|-----------------------|--------------------------------------|
| 能力边界拒绝          | TC-01, TC-02                         |
| `db-query` (word-count) | TC-03                             |
| `db-query` (word-search) | TC-04                            |
| `db-query` (custom SQL) | TC-05                              |
| `file-list`           | TC-06                                |
| `<<<file-write>>>`    | TC-07, TC-10, TC-11, TC-19           |
| `<<<file-edit:replace>>>` | TC-08                           |
| `<<<file-edit:insert>>>`  | TC-09                           |
| `file-read`           | TC-06, TC-08, TC-09, TC-19           |
| `create-command`      | TC-10, TC-11, TC-12, TC-13, TC-19    |
| `test-command`        | TC-10, TC-11, TC-13, TC-19           |
| `unregister-component` | TC-14                              |
| `register-component`  | TC-15                                |
| `register-tool`       | TC-20 (可能)                          |
| `save-lesson`         | TC-16, TC-18, TC-19 (可能)            |
| `list-lessons`        | TC-17                                |
| `merge-lessons`       | TC-17                                |
| 标记块 vs 工具调用区分 | TC-07, TC-08, TC-09                  |
| 命令名冲突            | TC-12                                |
| 语法错误修复          | TC-13                                |
| 不默认注册命令        | TC-03, TC-04, TC-05, TC-20           |
| 多工具协作            | TC-19, TC-20                         |

## 复杂度分级

| 级别 | 测试用例 | 说明 |
|------|---------|------|
| 🟢 简单 | TC-01 ~ TC-07 | 单一操作，低认知负荷 |
| 🟡 中等 | TC-08 ~ TC-15 | 涉及多步骤或条件判断 |
| 🔴 复杂 | TC-16 ~ TC-20 | 多工具协作、错误恢复、边界决策 |

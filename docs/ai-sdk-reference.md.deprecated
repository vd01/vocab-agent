# AI SDK v7 速查手册

> 本项目使用 AI SDK v7（`ai` npm 包）。以下是 Developer Agent 需要了解的关键 API。

## 1. tool() — 定义工具

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: '工具描述，LLM 根据此描述决定是否调用',
  parameters: z.object({
    param1: z.string().describe('参数描述'),
    param2: z.number().optional(),
  }),
  execute: async ({ param1, param2 }) => {
    // 执行逻辑
    return { type: 'success', data: '...' };
  },
});
```

**要点**:
- `parameters` 必须用 zod schema 定义，LLM 根据这个 schema 生成参数
- `description` 非常重要，LLM 靠它理解工具用途
- `execute` 是异步函数，返回值会作为 tool result 传回 LLM
- 参数中的 `describe()` 帮助 LLM 理解每个参数的含义

## 2. streamText() — 流式文本生成

```typescript
import { streamText, convertToModelMessages, isStepCount } from 'ai';

const result = streamText({
  model: myModel,
  system: '系统提示',
  messages: modelMessages,  // 必须是 ModelMessage[]，不是 UIMessage[]
  tools: { 'my-tool': myTool },
  stopWhen: isStepCount(25),  // 最多 25 步工具调用
  onStepFinish: async () => { /* 每步完成回调 */ },
});

// 转为 UI 消息流
const response = result.toUIMessageStreamResponse();
```

**要点**:
- `messages` 参数必须是 `ModelMessage[]` 格式，**不能直接传 UIMessage[]**
- 使用 `convertToModelMessages()` 将 UIMessage[] 转为 ModelMessage[]
- `stopWhen: isStepCount(N)` 限制最大工具调用步数
- `toUIMessageStreamResponse()` 生成 SSE 流响应给前端

## 3. convertToModelMessages() — 消息格式转换

```typescript
import { convertToModelMessages } from 'ai';

// UIMessage[] → ModelMessage[]
const modelMessages = await convertToModelMessages(uiMessages, {
  tools: myToolSet,
  ignoreIncompleteToolCalls: true,  // 忽略流式传输中不完整的 tool call
});
```

**为什么需要这个函数**:
- 前端 `useChat` 发送的是 UIMessage 格式（parts 数组）
- `streamText` 接收的是 ModelMessage 格式（content 字段）
- 两者结构完全不同，不能直接传递
- **不要手写转换函数**，用官方的 `convertToModelMessages`

## 4. UIMessage 格式（v7）

前端 `useChat` 使用的消息格式：

```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];
  createdAt?: Date;
}
```

### UIMessagePart 类型

```typescript
// 文本部分
{ type: 'text', text: 'Hello' }

// 推理部分（DeepSeek reasoner）
{ type: 'reasoning', text: '思考过程...' }

// 工具调用部分 — type 是 'tool-<工具名>'
{ type: 'tool-db-query', toolCallId: 'call_xxx', state: 'input-streaming', input?: {...} }
{ type: 'tool-db-query', toolCallId: 'call_xxx', state: 'input-available', input: {...} }
{ type: 'tool-db-query', toolCallId: 'call_xxx', state: 'output-available', input: {...}, output: {...} }
{ type: 'tool-db-query', toolCallId: 'call_xxx', state: 'output-error', input: {...}, errorText: '...' }

// 步骤开始标记
{ type: 'step-start' }
```

**重要变化（v6→v7）**:
- ❌ 旧: `type: 'tool-invocation'`, `state: 'call' | 'result'`
- ✅ 新: `type: 'tool-<name>'`, `state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'`
- ❌ 旧: `result` 字段
- ✅ 新: `output` 字段
- ❌ 旧: `args` 字段
- ✅ 新: `input` 字段

## 5. useChat() — 前端聊天 Hook

```typescript
'use client';
import { useChat } from '@ai-sdk/react';

const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
  api: '/api/chat',
  // messages prop 是初始值，只在 Chat 创建时使用一次
  // 后续消息变化不会重新创建 Chat
});
```

**要点**:
- `messages` prop 是初始值（initial value），不是受控值
- Chat 实例在首次渲染时创建，后续 prop 变化不会重建
- 如果需要从 DB 加载历史消息，必须先加载完再渲染 useChat
- `onFinish` 回调在流式响应完成时触发

## 6. ModelMessage 格式

`streamText` 接收的消息格式：

```typescript
type ModelMessage =
  | SystemModelMessage   // { role: 'system', content: string }
  | UserModelMessage     // { role: 'user', content: UserContent }
  | AssistantModelMessage // { role: 'assistant', content: AssistantContent }
  | ToolModelMessage;    // { role: 'tool', content: ToolContent }

// AssistantContent 可以包含 tool calls:
type AssistantContent = string | Array<TextPart | ToolCallPart | ReasoningPart | FilePart>;

// ToolCallPart:
{ type: 'tool-call', toolCallId: 'call_xxx', toolName: 'db-query', args: {...} }

// ToolModelMessage 包含 tool results:
{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_xxx', toolName: 'db-query', result: {...} }] }
```

## 7. 本项目的 Chat API 流程

```
前端 useChat → POST /api/chat (body: { messages: UIMessage[] })
  → routeAgent() 判断用 Teacher 还是 Developer
  → convertToModelMessages(uiMessages, { tools }) 转换消息格式
  → streamText({ model, system, messages: modelMessages, tools })
  → toUIMessageStreamResponse() 生成 SSE 流
  → 前端 useChat 解析 SSE 更新 messages
```

## 8. 常见陷阱

1. **不要手写 UIMessage → ModelMessage 转换** — 用 `convertToModelMessages`
2. **UIMessage.parts 中的 tool type 是 `tool-<name>`** — 不是 `tool-invocation`
3. **tool result 在 v7 中是 `output`** — 不是 `result`
4. **tool input 在 v7 中是 `input`** — 不是 `args`
5. **useChat 的 messages prop 是初始值** — 不是受控值，变化不会重建 Chat
6. **streamText 的 messages 必须是 ModelMessage[]** — 传 UIMessage[] 会报 schema 校验错误

# 前端框架速查

> Developer Agent 编写 React 组件时需要的快速参考。

## 1. Next.js 15 App Router

### 路由约定
```
src/app/page.tsx          → /
src/app/api/chat/route.ts → POST /api/chat
src/app/api/xxx/route.ts  → GET/POST /api/xxx
```

### Server vs Client Component
```tsx
// 默认是 Server Component（不能有 useState/useEffect 等）
// 需要 'use client' 指令才能用 hooks
'use client';
import { useState } from 'react';
```

### API Route
```typescript
// src/app/api/xxx/route.ts
export async function GET(req: Request) { ... }
export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ data: '...' });
}
```

## 2. React Hooks 速查

### useState
```tsx
const [value, setValue] = useState(initialValue);
// 函数式更新（避免 stale closure）
setValue(prev => prev + 1);
```

### useEffect
```tsx
useEffect(() => {
  // 副作用
  return () => { /* 清理 */ };
}, [dep1, dep2]); // 依赖数组 — 空数组 = 只执行一次
```

### useRef
```tsx
const ref = useRef(initialValue);
ref.current = newValue; // 直接修改，不触发重渲染
// 用途: 存储不参与渲染的值、DOM 引用、稳定回调
```

### useCallback
```tsx
const fn = useCallback((arg) => {
  // 使用 ref 访问最新 state，避免 stale closure
}, []); // 空依赖 = 永远稳定
```

### 常见模式: Ref 同步 State
```tsx
const [state, setState] = useState(initial);
const stateRef = useRef(state);
stateRef.current = state; // 每次渲染同步

// 在事件处理器中同步更新 ref（setState 是异步的）
const handleClick = () => {
  const newValue = !stateRef.current;
  stateRef.current = newValue; // 立即同步
  setState(newValue);
};
```

## 3. Tailwind CSS 常用类

### 布局
```
flex, grid, block, inline-flex
flex-col, flex-row, flex-wrap
items-center, justify-center, justify-between
gap-1, gap-2, gap-3, gap-4
w-full, w-fit, min-w-0, max-w-3xl
h-full, h-screen
overflow-y-auto, overflow-hidden
```

### 间距
```
p-1..p-6, px-4, py-2, pt-4, pb-5
m-1..m-6, mx-auto, my-2, mt-2, mb-4
space-y-2, space-x-2 (子元素间距)
```

### 文字
```
text-xs, text-sm, text-base, text-lg, text-xl, text-2xl
font-normal, font-medium, font-semibold, font-bold
text-center, text-left, text-right
text-foreground, text-muted-foreground, text-primary
leading-relaxed, leading-snug
whitespace-pre-wrap, break-words
```

### 颜色
```
bg-background, bg-muted, bg-primary, bg-card
text-foreground, text-muted-foreground, text-primary
border-border, border-input
bg-green-50, text-green-700, border-green-400
bg-red-50, text-red-500, border-red-400
bg-blue-50, text-blue-700, border-blue-400
bg-amber-50, text-amber-700, border-amber-400
```

### 边框/圆角
```
border, border-2, border-t, border-b
rounded, rounded-lg, rounded-xl, rounded-2xl, rounded-full
ring-1, ring-2, ring-blue-400
```

### 交互
```
hover:bg-muted, hover:border-slate-300
cursor-pointer, cursor-default
transition-all, transition-colors, duration-200, duration-300
disabled:opacity-50, disabled:cursor-not-allowed
```

### 响应式
```
sm:text-sm, md:grid-cols-2, lg:max-w-4xl
hidden sm:block, sm:hidden
```

### 暗色模式
```
dark:bg-input/30, dark:text-blue-300
```

## 4. shadcn/ui 组件

### 导入方式
```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
```

### Button
```tsx
<Button variant="default">主要按钮</Button>
<Button variant="outline">边框按钮</Button>
<Button variant="ghost">幽灵按钮</Button>
<Button variant="destructive">危险按钮</Button>
<Button size="sm">小按钮</Button>
<Button size="icon">图标按钮</Button>
<Button disabled>禁用</Button>
```

### Card
```tsx
<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
  </CardHeader>
  <CardContent>
    内容
  </CardContent>
</Card>
```

### Badge
```tsx
<Badge>默认</Badge>
<Badge variant="secondary">次要</Badge>
<Badge variant="destructive">危险</Badge>
<Badge variant="outline">边框</Badge>
```

### Input
```tsx
<Input type="text" placeholder="输入..." value={value} onChange={handleChange} />
```

## 5. CSS 3D 翻转动画（本项目使用）

```tsx
<div style={{ perspective: '600px' }}>
  <div className="grid transition-transform duration-300"
    style={{
      transformStyle: 'preserve-3d',
      transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
    }}>
    {/* 正面 */}
    <Card className="row-start-1 col-start-1"
      style={{ backfaceVisibility: 'hidden' }}>
      ...
    </Card>
    {/* 反面 */}
    <Card className="row-start-1 col-start-1 overflow-hidden"
      style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
      ...
    </Card>
  </div>
</div>
```

要点:
- Grid stacking: `row-start-1 col-start-1` 让两面叠在同一格
- 容器高度 = max(正面高度, 反面高度)，翻转时不变
- `backfaceVisibility: hidden` 隐藏背面
- 反面初始 `rotateY(180deg)`，翻转时容器 `rotateY(180deg)` 让反面朝前

## 6. 自定义滚动条（本项目使用）

```css
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.3) transparent;
}
.scrollbar-thin::-webkit-scrollbar { width: 6px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.3);
  border-radius: 3px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.5); }
```

## 7. 动态组件 Props 类型

动态组件接收的 props 就是 toolCode 返回的整个对象：

```tsx
// toolCode 返回:
return { type: 'word-stats-panel', total: 50, distribution: {...} };

// 组件接收:
interface WordStatsPanelProps {
  type: string;        // 总是包含 type 字段
  total: number;
  distribution: { ... };
}

export default function WordStatsPanel(props: WordStatsPanelProps) {
  // 使用 props.total, props.distribution 等
}
```

**注意**: props 中总是包含 `type` 字段，组件可以选择忽略它。

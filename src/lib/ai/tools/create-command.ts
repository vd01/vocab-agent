import { tool } from 'ai';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';

const GENERATED_SRC_DIR = path.join(process.cwd(), 'src', 'components', 'generated');
const REGISTRY_PATH = path.join(process.cwd(), 'src', 'components', 'generative', 'component-registry.ts');

export const createCommandTool = tool({
  description: `创建或更新一个 / 命令，一步完成命令注册和 UI 组件注册。

**重要：代码必须先写入文件，然后通过路径引用。这是避免 JSON 转义问题的唯一可靠方式。**

工作流程:
1. 先用 file-write 把 toolCode 写到 generated/ 下的 .js 文件
2. 如果需要 UI 组件，先用 file-write 把组件代码写到 generated/ 下的 .tsx 文件
3. 然后调用本工具，传入文件路径

toolCode 沙盒注入的变量（无需 import）:
- db: Drizzle ORM 实例
- tables: { words, reviews, chatMessages, dynamicCommands, dynamicExtractors }
- fsrs: { getDueWords, processReview, initializeCard, getProficiencyDistribution, getDailyStats, Rating }
- args: string[] 命令参数
- console: { log, error, warn }

toolCode 返回值规则:
- 简单文本结果: return { type: 'message', message: '...' }
- 自定义 UI: return { type: '<name>', ...data }，同时提供 componentCodePath

组件代码规范:
- 必须包含默认导出
- 使用 Tailwind CSS 样式
- 可从 @/components/ui 导入 shadcn/ui 组件
- props 就是 toolCode 返回的整个对象`,
  inputSchema: z.object({
    name: z.string().describe('命令名称（不含 / 前缀），如 "word-match"'),
    description: z.string().describe('命令描述'),
    toolCodePath: z.string().describe('toolCode 文件路径（相对于项目根目录），如 "generated/tools/word-match.js"'),
    componentCodePath: z.string().optional().describe('组件代码文件路径（可选，需要自定义 UI 时提供），如 "generated/components/word-match-panel.tsx"'),
  }),
  execute: async ({ name, description, toolCodePath, componentCodePath }) => {
    const now = new Date();

    // 1. Block built-in command names
    const builtinNames = ['review', 'add', 'stats', 'dev', 'rate'];
    if (builtinNames.includes(name)) {
      return { type: 'error', message: `命令 /${name} 与内置命令冲突，请换一个名称` };
    }

    // 2. Read toolCode from file
    const toolCodeFullPath = path.join(process.cwd(), toolCodePath);
    const toolCodeNormalized = path.normalize(toolCodeFullPath);
    if (!toolCodeNormalized.startsWith(path.normalize(process.cwd()))) {
      return { type: 'error', message: '安全限制：toolCodePath 必须在项目目录内' };
    }

    let toolCode: string;
    try {
      toolCode = await fs.readFile(toolCodeNormalized, 'utf-8');
    } catch {
      return { type: 'error', message: `toolCode 文件不存在: ${toolCodePath}。请先用 file-write 写入代码文件。` };
    }

    // 3. Read componentCode from file (if provided)
    let componentCode: string | undefined;
    if (componentCodePath) {
      const componentFullPath = path.join(process.cwd(), componentCodePath);
      const componentNormalized = path.normalize(componentFullPath);
      if (!componentNormalized.startsWith(path.normalize(process.cwd()))) {
        return { type: 'error', message: '安全限制：componentCodePath 必须在项目目录内' };
      }

      try {
        componentCode = await fs.readFile(componentNormalized, 'utf-8');
      } catch {
        return { type: 'error', message: `组件代码文件不存在: ${componentCodePath}。请先用 file-write 写入代码文件。` };
      }
    }

    try {
      // 4. Upsert dynamic_commands
      const existing = await db.select().from(dynamicCommands)
        .where(eq(dynamicCommands.name, name)).limit(1);

      if (existing.length > 0) {
        await db.update(dynamicCommands).set({
          description,
          toolCode,
          componentCode: componentCode ?? null,
          updatedAt: now,
        }).where(eq(dynamicCommands.name, name));
      } else {
        await db.insert(dynamicCommands).values({
          id: uuid(),
          name,
          description,
          toolCode,
          componentCode: componentCode ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 5. If componentCode provided, write component file + update registry
      if (componentCode) {
        // Write to src/components/generated/<name>.tsx
        await fs.mkdir(GENERATED_SRC_DIR, { recursive: true });
        const componentPath = path.join(GENERATED_SRC_DIR, `${name}.tsx`);
        await fs.writeFile(componentPath, componentCode, 'utf-8');

        // Update component-registry.ts
        await updateRegistryFile();
      }

      return {
        type: 'registered',
        name,
        hasComponent: !!componentCode,
        message: `命令 /${name} 已注册${componentCode ? '，组件已写入并更新注册表' : ''}。Turbopack HMR 会自动热更新，稍等片刻即可使用。`,
      };
    } catch (error) {
      return { type: 'error', message: `注册失败: ${String(error)}` };
    }
  },
});

/**
 * Scan src/components/generated/ and rewrite component-registry.ts
 * with static imports for all components. Turbopack HMR will pick up
 * the change automatically.
 */
async function updateRegistryFile() {
  let files: string[];
  try {
    files = (await fs.readdir(GENERATED_SRC_DIR))
      .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
  } catch {
    files = [];
  }

  // Filter out empty files
  const validFiles: string[] = [];
  for (const f of files) {
    const stat = await fs.stat(path.join(GENERATED_SRC_DIR, f));
    if (stat.size > 10) {
      validFiles.push(f);
    }
  }

  if (validFiles.length === 0) return;

  const imports = validFiles.map(f => {
    const name = f.replace(/\.(tsx|ts)$/, '');
    // PascalCase the import name to avoid hyphen issues
    const importName = name
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    return `import ${importName} from '@/components/generated/${name}';`;
  }).join('\n');

  const registrations = validFiles.map(f => {
    const name = f.replace(/\.(tsx|ts)$/, '');
    const importName = name
      .split('-')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    return `  componentRegistry.register('${name}', ${importName} as unknown as React.ComponentType<Record<string, unknown>>);`;
  }).join('\n');

  const code = `'use client';

import React from 'react';

type ComponentMap = Map<string, React.ComponentType<Record<string, unknown>>>;

class ComponentRegistryClass {
  private components: ComponentMap = new Map();

  register(name: string, component: React.ComponentType<Record<string, unknown>>): void {
    this.components.set(name, component);
  }

  get(name: string): React.ComponentType<Record<string, unknown>> | undefined {
    return this.components.get(name);
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  getAll(): Map<string, React.ComponentType<Record<string, unknown>>> {
    return new Map(this.components);
  }

  unregister(name: string): void {
    this.components.delete(name);
  }
}

// Singleton instance
export const componentRegistry = new ComponentRegistryClass();

/**
 * Load all generated components using static imports.
 * This file is auto-updated by the register-component tool
 * whenever a new component is registered. Turbopack HMR
 * will hot-reload this module automatically.
 *
 * DO NOT EDIT MANUALLY — changes will be overwritten.
 */

${imports}

export function loadGeneratedComponents() {
${registrations}
}
`;

  await fs.writeFile(REGISTRY_PATH, code, 'utf-8');
}

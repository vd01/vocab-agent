import { promises as fs } from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(
  process.cwd(), 'src', 'components', 'generative', 'component-registry.ts'
);
const GENERATED_SRC_DIR = path.join(
  process.cwd(), 'src', 'components', 'generated'
);
const GENERATED_TOOLS_DIR = path.join(
  process.cwd(), 'generated', 'tools'
);

// ── Shared template fragments ────────────────────────────────────────────

const CLASS_CODE = `class ComponentRegistryClass {
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
}`;

const SINGLETON_CODE = `// Singleton instance — use globalThis to survive HMR module replacement
const GLOBAL_KEY = '__vocab_component_registry__' as const;

if (!(globalThis as any)[GLOBAL_KEY]) {
  (globalThis as any)[GLOBAL_KEY] = new ComponentRegistryClass();
}

export const componentRegistry: ComponentRegistryClass = (globalThis as any)[GLOBAL_KEY];`;

const HEADER = `'use client';

import React from 'react';

type ComponentMap = Map<string, React.ComponentType<Record<string, unknown>>>;

${CLASS_CODE}

${SINGLETON_CODE}

/**
 * Load all generated components using dynamic imports.
 * This file is auto-updated by the register-component / unregister-component tools
 * whenever a component is added or removed. The file change triggers Turbopack HMR,
 * which compiles the new components and hot-reloads this module.
 *
 * Uses dynamic import() instead of static imports so that:
 * - Build succeeds when generated/ is empty (git clone, clean:dynamic)
 * - No hardcoded static imports that would break on missing files
 *
 * DO NOT EDIT MANUALLY — changes will be overwritten.
 */`;

/**
 * Scan src/components/generated/ and rewrite component-registry.ts
 * with dynamic import() calls for all components.
 */
export async function updateRegistryFile() {
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

  if (validFiles.length === 0) {
    const code = `${HEADER}

export async function loadGeneratedComponents(): Promise<void> {
  // No components registered yet
}
`;
    await fs.writeFile(REGISTRY_PATH, code, 'utf-8');
    return;
  }

  const registrations = validFiles.map(f => {
    const name = f.replace(/\.(tsx|ts)$/, '');
    return `  if (!componentRegistry.has('${name}')) {
    promises.push(
      import('@/components/generated/${name}').then(mod => {
        componentRegistry.register('${name}', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
      }).catch(err => {
        console.warn('[component-registry] Failed to load component "${name}":', err);
      })
    );
  }`;
  }).join('\n');

  const code = `${HEADER}

export async function loadGeneratedComponents(): Promise<void> {
  const promises: Promise<void>[] = [];

${registrations}

  await Promise.all(promises);
}
`;

  await fs.writeFile(REGISTRY_PATH, code, 'utf-8');
}

export { GENERATED_SRC_DIR, GENERATED_TOOLS_DIR, REGISTRY_PATH };

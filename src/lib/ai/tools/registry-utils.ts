import { promises as fs } from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(
  process.cwd(), 'src', 'components', 'generative', 'component-registry.ts'
);
const GENERATED_SRC_DIR = path.join(
  process.cwd(), 'src', 'components', 'generated'
);

/**
 * Scan src/components/generated/ and rewrite component-registry.ts
 * with dynamic import() calls for all components.
 *
 * Uses dynamic import() instead of static imports so that:
 * - Build succeeds when generated/ is empty (git clone, clean:dynamic)
 * - No Module not found errors for missing component files
 *
 * The file change triggers Turbopack HMR, which compiles the new
 * components and hot-reloads the module — making them immediately
 * available without a server restart.
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
 */

export function loadGeneratedComponents() {
  // No components registered yet
}
`;
    await fs.writeFile(REGISTRY_PATH, code, 'utf-8');
    return;
  }

  const registrations = validFiles.map(f => {
    const name = f.replace(/\.(tsx|ts)$/, '');
    return `  import('@/components/generated/${name}.tsx').then(mod => {
    componentRegistry.register('${name}', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
  }).catch(err => {
    console.warn('[component-registry] Failed to load component "${name}:', err);
  });`;
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
 */

export function loadGeneratedComponents() {
${registrations}
}
`;

  await fs.writeFile(REGISTRY_PATH, code, 'utf-8');
}

export { GENERATED_SRC_DIR, REGISTRY_PATH };

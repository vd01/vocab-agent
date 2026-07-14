/**
 * 确保 component-registry.ts 存在（空模板）
 * 该文件被 gitignore，新 clone 后需要生成
 */
import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(
  process.cwd(), 'src', 'components', 'generative', 'component-registry.ts'
);

const EMPTY_REGISTRY = `'use client';

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

if (!fs.existsSync(REGISTRY_PATH)) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, EMPTY_REGISTRY, 'utf-8');
  console.log('✅ Created component-registry.ts (empty template)');
} else {
  console.log('✅ component-registry.ts exists');
}

// Also ensure src/components/generated/ directory exists
const GENERATED_DIR = path.join(process.cwd(), 'src', 'components', 'generated');
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  console.log('✅ Created src/components/generated/ directory');
}

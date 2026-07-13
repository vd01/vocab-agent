'use client';

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
  import('@/components/generated/greet').then(mod => {
    componentRegistry.register('greet', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
  }).catch(err => {
    console.warn('[component-registry] Failed to load component "greet:', err);
  });
  import('@/components/generated/helloworld').then(mod => {
    componentRegistry.register('helloworld', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
  }).catch(err => {
    console.warn('[component-registry] Failed to load component "helloworld:', err);
  });
  import('@/components/generated/hi').then(mod => {
    componentRegistry.register('hi', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
  }).catch(err => {
    console.warn('[component-registry] Failed to load component "hi:', err);
  });
  import('@/components/generated/word-match').then(mod => {
    componentRegistry.register('word-match', (mod.default ?? mod) as unknown as React.ComponentType<Record<string, unknown>>);
  }).catch(err => {
    console.warn('[component-registry] Failed to load component "word-match:', err);
  });
}

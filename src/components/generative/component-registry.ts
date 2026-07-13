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
 * Dynamically load all generated components at runtime.
 * Fetches the component manifest from the API, then uses
 * dynamic import() to load each component and register it.
 *
 * This approach keeps component-registry.ts static (no hardcoded
 * component names or imports), so generated/ can be gitignored
 * and clean:dynamic works without breaking the build.
 *
 * Called on mount and after each Agent conversation ends.
 */
export async function loadGeneratedComponents(): Promise<void> {
  try {
    const res = await fetch('/api/component-manifest');
    if (!res.ok) return;
    const names: string[] = await res.json();

    for (const name of names) {
      if (componentRegistry.has(name)) continue;
      try {
        const mod = await import(`@/components/generated/${name}.tsx`);
        const Component = mod.default ?? mod;
        componentRegistry.register(name, Component as unknown as React.ComponentType<Record<string, unknown>>);
      } catch (err) {
        console.warn(`[component-registry] Failed to load component "${name}":`, err);
      }
    }
  } catch (err) {
    console.warn('[component-registry] Failed to fetch component manifest:', err);
  }
}

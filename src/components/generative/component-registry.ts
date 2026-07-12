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
 * Load all generated components using static imports.
 * This file is auto-updated by the register-component / unregister-component tools
 * whenever a component is added or removed. Turbopack HMR
 * will hot-reload this module automatically.
 *
 * DO NOT EDIT MANUALLY — changes will be overwritten.
 */

import RandomLetter from '@/components/generated/random-letter';
import RandomWords from '@/components/generated/random-words';

export function loadGeneratedComponents() {
  componentRegistry.register('random-letter', RandomLetter as unknown as React.ComponentType<Record<string, unknown>>);
  componentRegistry.register('random-words', RandomWords as unknown as React.ComponentType<Record<string, unknown>>);
}

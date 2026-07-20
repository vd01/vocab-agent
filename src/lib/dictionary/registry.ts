/**
 * Dictionary source registry — registration order = priority order.
 *
 * Sources registered earlier have higher priority in the merge.
 * Sources can be registered at startup; availability is checked lazily.
 */

import type { DictSource, DictEntry } from './types';

class DictRegistry {
	private sources: DictSource[] = [];

	/**
	 * Register a source. Earlier registrations have higher merge priority.
	 * Duplicate registrations (by name) are silently ignored.
	 */
	register(source: DictSource): void {
		if (this.sources.some((s) => s.name === source.name)) return;
		this.sources.push(source);
	}

	/**
	 * Insert a source at a specific index. Higher index = lower priority.
	 * Duplicate registrations (by name) are silently ignored.
	 */
	insert(index: number, source: DictSource): void {
		if (this.sources.some((s) => s.name === source.name)) return;
		this.sources.splice(Math.min(index, this.sources.length), 0, source);
	}

	/**
	 * Remove a source by name. No-op if not found.
	 */
	unregister(name: string): void {
		this.sources = this.sources.filter((s) => s.name !== name);
	}

	/** Return all registered sources (ordered). */
	getSources(): DictSource[] {
		return [...this.sources];
	}

	/** Return only sources that are currently available. */
	async getAvailableSources(): Promise<DictSource[]> {
		const results = await Promise.all(
			this.sources.map(async (s) => {
				try {
					return (await s.available()) ? s : null;
				} catch {
					return null;
				}
			}),
		);
		return results.filter((s): s is DictSource => s !== null);
	}

	/**
	 * Look up a word across all sources in parallel.
	 * Returns an array of Partial<DictEntry> | null in registration order.
	 *
	 * Skips the available() check — sources handle their own availability
	 * inside lookup() (returning null if unavailable). This avoids an extra
	 * async round-trip per source that added significant latency.
	 */
	async lookupAll(
		word: string,
	): Promise<(Partial<DictEntry> | null)[]> {
		const sources = this.sources;
		const results = await Promise.all(
			sources.map(async (s) => {
				try {
					return await s.lookup(word);
				} catch {
					return null;
				}
			}),
		);
		return results;
	}
}

export const registry = new DictRegistry();

/**
 * Request deduplication + in-memory cache.
 *
 * - dedupedFetch: coalesces concurrent identical GET requests into one
 * - cachedFetch: dedupedFetch + TTL-based in-memory cache
 *
 * Key insight: we cache the *parsed data*, not the Response object,
 * because Response.body is a one-time stream.
 */

const pendingRequests = new Map<string, Promise<unknown>>();
const dataCache = new Map<string, { data: unknown; ts: number }>();
const DEFAULT_TTL = 60_000; // 1 minute

/**
 * Deduplicated fetch — if the same URL is already being fetched,
 * return the same promise instead of firing a new request.
 * Caches the parsed JSON result, not the Response.
 */
export function dedupedFetch<T = unknown>(url: string): Promise<T> {
  const cached = dataCache.get(url);
  if (cached && Date.now() - cached.ts < DEFAULT_TTL) {
    return Promise.resolve(cached.data as T);
  }

  const existing = pendingRequests.get(url);
  if (existing) return existing as Promise<T>;

  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      dataCache.set(url, { data, ts: Date.now() });
      pendingRequests.delete(url);
      return data as T;
    })
    .catch((err) => {
      pendingRequests.delete(url);
      throw err;
    });

  pendingRequests.set(url, promise);
  return promise;
}

/** Backward-compatible alias */
export async function cachedFetch<T = unknown>(
  url: string,
  options?: { ttl?: number }
): Promise<T> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const cached = dataCache.get(url);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.data as T;
  }

  // Use dedupedFetch but respect custom TTL by updating cache timestamp
  const data = await dedupedFetch<T>(url);
  // dedupedFetch already cached with default TTL; update if custom TTL
  if (options?.ttl !== undefined) {
    dataCache.set(url, { data, ts: Date.now() });
  }
  return data;
}

/** Invalidate cached data (e.g. after a mutation) */
export function invalidateCache(url?: string) {
  if (url) {
    dataCache.delete(url);
    // Also cancel any pending request so next call re-fetches
    pendingRequests.delete(url);
  } else {
    dataCache.clear();
    pendingRequests.clear();
  }
}

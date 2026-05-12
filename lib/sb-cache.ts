// ────────────────────────────────────────────────────────────────────────────
// Server-only in-memory cache for Supabase REST reads.
//
// Why: hot APIs (/api/discover/feed, /api/flash/near, /api/social/feed) were
// shipping `Cache-Control: no-store` AND firing 5–9 full-table Supabase fetches
// per request. Under any real traffic that scales linearly with QPS and turns
// every page open into ~400ms of waterfall. Reading a 30 s stale copy of
// hotels/rooms/bids is *identical* to what users see on a refresh anyway, so
// caching is correct, not a tradeoff.
//
// How: each Vercel Lambda instance holds a module-level Map of key → {at,data}.
// While the instance is warm (typically minutes between cold starts) every
// subsequent caller of `sbCached(key, fetcher, ttlMs)` skips Supabase entirely
// for the first `ttlMs`. On a cold instance the first request still pays the
// fetch, then warms the cache for every other request that lands on it.
//
// What it ISN'T: a write-through cache, a request-deduper, or a CDN. Personal
// per-user transformations still run per-request — only the shared dataset
// (catalog, popularity counts, etc.) is reused. That keeps personalization
// correct while still cutting P50 latency from ~400 ms to ~30 ms.
// ────────────────────────────────────────────────────────────────────────────

type Entry<T> = { at: number; data: T };

// Globally shared so HMR doesn't blow away the cache between hot reloads.
const g = globalThis as any;
if (!g.__sbCacheMap) g.__sbCacheMap = new Map<string, Entry<any>>();
const cache: Map<string, Entry<any>> = g.__sbCacheMap;

// In-flight de-duplication: if 50 concurrent requests all need `hotels`, we
// only fire ONE Supabase fetch and the rest await the same promise.
if (!g.__sbCacheInflight) g.__sbCacheInflight = new Map<string, Promise<any>>();
const inflight: Map<string, Promise<any>> = g.__sbCacheInflight;

export async function sbCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.data as T;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    try {
      const data = await fetcher();
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function sbCacheInvalidate(keyPrefix: string) {
  Array.from(cache.keys()).forEach((k) => {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  });
}

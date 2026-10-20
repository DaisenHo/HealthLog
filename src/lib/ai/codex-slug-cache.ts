/**
 * Process-local positive cache for working Codex model slugs.
 *
 * (v1.4.15) — slug-drift defence per
 * `docs/codex-protocol-spec.md` §7b. The ChatGPT-Codex backend rotates
 * its allow-list silently; pinning a single `CODEX_MODEL` slug bricks
 * the integration the moment upstream flips it. Instead of pinning,
 * `CodexClient` walks an ordered fallback chain on every fresh
 * request series and caches the first slug that returns 200 +
 * `response.completed` for `CACHE_TTL_MS` so subsequent requests skip
 * the chain walk.
 *
 * Lives in its own module so:
 *   - Tests can `clearCodexSlugCache()` between cases.
 *   - The shared Map state stays out of `CodexClient` itself (so
 *     instance creation in `resolveProvider` doesn't reset the cache).
 *   - Future telemetry (cache hit-rate emission) hooks here cleanly.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour per spec §7b

interface CachedEntry {
  slug: string;
  cachedAtMs: number;
}

/**
 * Cache key — currently a single global slot ("codex"). Kept in a Map
 * so future per-account / per-model-family scoping is a one-line
 * change.
 */
const CACHE_KEY = "codex";

const cache = new Map<string, CachedEntry>();

export function getCachedCodexSlug(now: number = Date.now()): string | null {
  const entry = cache.get(CACHE_KEY);
  if (!entry) return null;
  if (now - entry.cachedAtMs > CACHE_TTL_MS) {
    cache.delete(CACHE_KEY);
    return null;
  }
  return entry.slug;
}

export function setCachedCodexSlug(
  slug: string,
  now: number = Date.now(),
): void {
  cache.set(CACHE_KEY, { slug, cachedAtMs: now });
}

export function invalidateCachedCodexSlug(): void {
  cache.delete(CACHE_KEY);
}

/** Test-only: reset the cache between cases. */
export function clearCodexSlugCache(): void {
  cache.clear();
}

export const CODEX_SLUG_CACHE_TTL_MS = CACHE_TTL_MS;

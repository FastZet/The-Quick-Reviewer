// cache.js — in-memory cache replacement for HuggingFace deployment
// This replaces the original filesystem-based cache to avoid write issues on HF Spaces.

const CACHE_EXPIRY_DAYS = 7;
const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 86400000; // 7 days in ms

// Store reviews in a Map keyed by `${date}:${id}`
// Each entry: { review: string, ts: number }
const cache = new Map();

function getCacheKey(date, id) {
  return `${date}:${id}`;
}

function isExpired(ts) {
  return (Date.now() - ts) > CACHE_EXPIRY_MS;
}

function readReview(date, id) {
  const key = getCacheKey(date, id);
  const entry = cache.get(key);
  if (!entry) return null;
  if (isExpired(entry.ts)) {
    cache.delete(key);
    return null;
  }
  return entry.review;
}

function saveReview(date, id, review) {
  const key = getCacheKey(date, id);
  cache.set(key, { review, ts: Date.now() });
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (isExpired(entry.ts)) cache.delete(key);
  }
}

module.exports = {
  readReview,
  saveReview,
  cleanupCache
};

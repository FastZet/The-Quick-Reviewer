// cache.js — in-memory cache with enhanced functionality for viewing all entries.

const CACHE_EXPIRY_DAYS = 30;
const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 86400000;

// Store reviews in a Map keyed by `id`
// Each entry: { review: string, ts: number, type: string }
const cache = new Map();

function getCacheKey(id) {
  return id;
}

function isExpired(ts) {
  return (Date.now() - ts) > CACHE_EXPIRY_MS;
}

function readReview(id) {
  const key = getCacheKey(id);
  const entry = cache.get(key);
  if (!entry) return null;
  if (isExpired(entry.ts)) {
    cache.delete(key);
    return null;
  }
  return entry.review;
}

// saveReview now accepts and stores the 'type' of the content.
function saveReview(id, review, type) {
  const key = getCacheKey(id);
  cache.set(key, { review, ts: Date.now(), type });
}

function cleanupCache() {
  for (const [key, entry] of cache.entries()) {
    if (isExpired(entry.ts)) cache.delete(key);
  }
}

// New function to get all valid cache entries.
function getAllCachedReviews() {
  cleanupCache(); // First, remove any expired entries.
  const allReviews = [];
  for (const [key, entry] of cache.entries()) {
    allReviews.push({
      id: key,
      ts: entry.ts,
      type: entry.type
    });
  }
  return allReviews;
}

module.exports = {
  readReview,
  saveReview,
  cleanupCache,
  getAllCachedReviews
};

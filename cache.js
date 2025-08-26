// cache.js — in-memory cache with enhanced functionality for viewing all entries.

const CACHE_EXPIRY_DAYS = 30;
const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 86400000; // 7 days in ms

// Store reviews in a Map keyed by `${date}:${id}`
// Each entry: { review: string, ts: number, type: string }
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

// THE FIX: saveReview now accepts and stores the 'type' of the content.
function saveReview(date, id, review, type) {
  const key = getCacheKey(date, id);
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
      key: key,
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

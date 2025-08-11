// server.js — HuggingFace-ready Stremio addon server (fixed)
// - Reads API keys from environment variables
// - Uses in-memory cache (no filesystem writes)
// - Serves manifest.json and public files
// - Returns a single "stream" result which opens the AI review page

const express = require('express');
const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');

// Load manifest (keep a separate manifest.json file in the project root)
const manifest = require('./manifest.json');

// Environment-backed configuration
const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null; // optional override
const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

// Basic checks (will not crash; logs warnings)
if (!TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Search metadata may fail.');
if (!OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set.');

// In-memory cache for generated review URLs (keyed by "type:id")
// Entry: { url: string, ts: number }
const cache = new Map();
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getCacheKey(type, id) {
  return `${type}:${id}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_EXPIRY_MS) {
    cache.delete(key);
    return null;
  }
  return entry.url;
}

function saveCache(key, url) {
  cache.set(key, { url, ts: Date.now() });
}

// Build the Stremio addon
const builder = new addonBuilder(manifest);

// Stream handler: returns a single stream that points to the AI review page
builder.defineStreamHandler(async (args) => {
  // args example: { id: 'tt0137523', type: 'movie' }
  const { id, type } = args;
  const key = getCacheKey(type, id);
  let reviewUrl = getCached(key);

  if (!reviewUrl) {
    // Create a URL that points to the hosted review page.
    // We prefer an explicit BASE_URL env var. If not present, build from request (handled below in express route).
    // Here we'll store a path; the final absolute URL will be constructed at request-time if needed.
    reviewUrl = `/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    saveCache(key, reviewUrl);
  }

  // Stremio expects stream objects with at least "id" and "title"/"url" + optional "isRemote"/"subtitle".
  return Promise.resolve([
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      url: reviewUrl,
      // mark as remote so Stremio clients understand this is an external stream
      isRemote: true,
      // additional meta to make it appear as a simple stream
      poster: manifest.icon || undefined,
      // NOTE: some clients require 'format'/'language' fields, but they are optional
    },
  ]);
});

const addonInterface = builder.getInterface();

// Express app
const app = express();

// Serve static public files (configure.html, review.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Serve manifest at the root path /manifest.json (Stremio expects a public json at this path)
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// If BASE_URL is not provided via env, we will compute absolute URLs based on request
function makeAbsoluteUrl(req, relativePath) {
  if (BASE_URL) {
    // ensure no trailing slash conflict
    return `${BASE_URL.replace(/\/+$/, '')}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
  }
  // Build from request
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${relativePath}`;
}

// A simple route that Stremio clients may call to get stream info in an absolute form.
// This is useful because in-memory cache stores relative paths for portability.
app.get('/stream-info', (req, res) => {
  // query: ?type=movie&id=tt123
  const { type, id } = req.query;
  if (!type || !id) return res.status(400).json({ error: 'Missing type or id' });
  const key = getCacheKey(type, id);
  const relative = getCached(key);
  if (!relative) return res.status(404).json({ error: 'No review cached for this item' });
  const absolute = makeAbsoluteUrl(req, relative);
  return res.json({ url: absolute });
});

// Review page route helper: returns absolute review URL for cached items (used by clients, optional)
app.get('/review', (req, res, next) => {
  // If the file exists in public/review.html express.static will serve it.
  // Otherwise, we can render a minimal placeholder explaining how to call the generator.
  // Let express.static handle actual file; if not found, fall through to this handler.
  next();
});

// Mount the Stremio addon interface at / (builder router will handle addon routes such as /stream, /manifest, /catalog)
app.use('/', addonInterface);

// Health check
app.get('/health', (req, res) => res.send('OK'));

// Basic CORS header for routes that might be called from clients (Stremio usually doesn't require complex CORS for addons)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
});

// Export app for testing (optional)
module.exports = app;

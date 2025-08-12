// server.js — HuggingFace-ready Stremio addon server
// - Uses in-memory cache (no filesystem writes)
// - Serves manifest.json and public files
// - Returns a single "stream" result which opens the AI review page

const express = require('express');
const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest.json');

// Environment config
const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

// Warn if API keys missing
if (!TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Search metadata may fail.');
if (!OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set.');

// In-memory cache for generated review URLs (keyed by "type:id")
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
  const { id, type } = args;
  const key = getCacheKey(type, id);
  let reviewUrl = getCached(key);

  if (!reviewUrl) {
    // Create a URL that points to the hosted review page.
    // Use BASE_URL if present, otherwise build at request time.
    reviewUrl = `/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    saveCache(key, reviewUrl);
  }

  return Promise.resolve([
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      url: reviewUrl,
      isRemote: true,
      poster: manifest.icon || undefined,
    },
  ]);
});

const addonInterface = builder.getInterface();

const app = express();

// Serve static public files (configure.html, review.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Serve manifest at /manifest.json (Stremio expects this)
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Review HTML helper (let express.static serve the file; fallthrough to next if not found)
app.get('/review', (req, res, next) => {
  next();
});

// Mount the Stremio addon interface at root (handles /stream, /manifest, /catalog, etc)
app.use('/', addonInterface);

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

// Basic CORS for clients
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

module.exports = app;

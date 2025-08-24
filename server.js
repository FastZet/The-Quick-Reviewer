// server.js — HuggingFace-ready Stremio addon server (Express-only version)
// - No stremio-addon-sdk to avoid middleware type errors
// - Provides /manifest.json and /stream/:type/:id.json (Stremio spec)
// - Serves static files and /review (HTML)
// - Mounts /api/review from routes.js
// - Builds absolute review URLs using BASE_URL or request host

const express = require('express');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// Environment config
const PORT = process.env.PORT || 7860;
const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

// Warn if API keys missing
if (!TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Metadata may fail.');
if (!OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set. Reviews will not be generated.');

// Trust proxy for correct proto/host in HF Spaces
app.set('trust proxy', true);

// Basic CORS for clients (placed BEFORE routes)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static public files (configure.html, review.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Manifest endpoint (Stremio expects this)
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Stream endpoint (Stremio spec): returns a single "Quick AI Review" stream
// Example: /stream/movie/550.json or /stream/series/1399.json
app.get('/stream/:type/:id.json', (req, res) => {
  const { type, id } = req.params;

  // Build absolute base URL
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');

  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const streams = [
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      url: reviewUrl,
      // Hint Stremio this is not a playable media stream
      isRemote: true,
      isExternal: true,
      poster: manifest.icon || undefined
    }
  ];

  res.json({ streams });
});

// Serve the review page explicitly
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// Mount API routes (for /api/review)
const apiRouter = require('./routes');
app.use(apiRouter);

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

// Start server
app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
});

module.exports = app;

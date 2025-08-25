// server.js — HuggingFace-ready Stremio addon server (Express-only version)
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

// --- MANIFEST AND STREAM ENDPOINTS WITH PASSWORD LOGIC ---

const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log(`Addon is SECURED. All endpoints are prefixed with: ${secretPath}`);

  // Secured manifest endpoint
  app.get(`${secretPath}/manifest.json`, (req, res) => {
    res.json(manifest);
  });

  // Secured stream endpoint
  app.get(`${secretPath}/stream/:type/:id.json`, (req, res) => {
    handleStreamRequest(req, res);
  });

} else {
  console.log('Addon is UNSECURED.');

  // Unsecured manifest endpoint
  app.get('/manifest.json', (req, res) => {
    res.json(manifest);
  });

  // Unsecured stream endpoint
  app.get('/stream/:type/:id.json', (req, res) => {
    handleStreamRequest(req, res);
  });
}

// We move the stream logic into a reusable function to avoid code duplication.
function handleStreamRequest(req, res) {
  const { type, id } = req.params;

  // Build absolute base URL
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');

  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const streams = [{
    id: `quick-reviewer-${type}-${id}`,
    title: '⚡ Quick AI Review',
    externalUrl: reviewUrl, 
    poster: manifest.icon || undefined,
    behaviorHints: {
      "notWebReady": true
    }
  }];

  res.json({ streams });
}

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

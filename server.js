// server.js — HuggingFace-ready Stremio addon server (Express-only version)
const express = require('express');
const path = require('path');
const manifest = require('./manifest.json');
const fs = require('fs');

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

// The dynamic route for the landing page now comes BEFORE the static middleware.
// This ensures it runs first for the root URL.
app.get('/', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) {
      console.error("Could not read index.html file:", err);
      return res.status(500).send("Could not load landing page.");
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = BASE_URL || (host ? `${proto}://${host}` : '');
    const manifestUrl = `${base}/${ADDON_PASSWORD ? ADDON_PASSWORD + '/' : ''}manifest.json`;
    let renderedHtml = html.replace('{{MANIFEST_URL}}', manifestUrl.replace(/^https?:\/\//, 'stremio://'));
    let cacheButtonHtml = '';
    if (ADDON_PASSWORD) {
      const cacheUrl = `${base}/${ADDON_PASSWORD}/cached-reviews`;
      cacheButtonHtml = `<a href="${cacheUrl}" class="btn cache">View Cached Reviews</a>`;
    }
    renderedHtml = renderedHtml.replace('{{CACHE_BUTTON_HTML}}', cacheButtonHtml);
    res.send(renderedHtml);
  });
});

// Serve static public files (review.html, cached-reviews.html, etc.)
// For any request not handled by a specific route above, Express will look for a file in the 'public' folder.
app.use(express.static(path.join(__dirname, 'public')));

// --- MANIFEST AND STREAM ENDPOINTS WITH PASSWORD LOGIC ---
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All endpoints are password-protected.');
  app.get(`${secretPath}/manifest.json`, (req, res) => { res.json(manifest); });
  app.get(`${secretPath}/cached-reviews`, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'cached-reviews.html')); });
  app.get(`${secretPath}/stream/:type/:id.json`, (req, res) => { handleStreamRequest(req, res); });
} else {
  console.log('Addon is UNSECURED.');
  app.get('/manifest.json', (req, res) => { res.json(manifest); });
  app.get('/stream/:type/:id.json', (req, res) => { handleStreamRequest(req, res); });
}

function handleStreamRequest(req, res) {
  const { type, id } = req.params;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  const streams = [{
    id: `quick-reviewer-${type}-${id}`,
    title: '⚡ Quick AI Review',
    externalUrl: reviewUrl, 
    poster: manifest.icon || undefined,
    behaviorHints: { "notWebReady": true }
  }];
  res.json({ streams });
}

app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

const apiRouter = require('./routes');
app.use(apiRouter);

app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
});

module.exports = app;

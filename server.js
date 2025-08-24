// server.js — HuggingFace-ready Stremio addon server (Express-only version)
// - Provides / (landing), /manifest.json, /stream/:type/:id.json
// - Serves /review (HTML) and mounts /api/review
// - CORS applied early
// - Absolute review URL built using BASE_URL or request host

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

// Serve static public files
app.use(express.static(path.join(__dirname, 'public')));

// Simple landing page at "/"
app.get('/', (req, res) => {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const sampleMovieId = '550'; // Example TMDB movie id

  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>The Quick Reviewer</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}
a{color:#0b5ed7;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f5f5f5;padding:2px 6px;border-radius:4px}</style>
</head><body>
<h1>⚡ The Quick Reviewer — Addon</h1>
<p>This Space is running. Useful endpoints:</p>
<ul>
  <li>Manifest: <a href="${base}/manifest.json">${base}/manifest.json</a></li>
  <li>Sample Review UI (movie 550): <a href="${base}/review?type=movie&id=${sampleMovieId}">${base}/review?type=movie&id=${sampleMovieId}</a></li>
  <li>Sample API: <a href="${base}/api/review?type=movie&id=${sampleMovieId}">${base}/api/review?type=movie&id=${sampleMovieId}</a></li>
  <li>Health: <a href="${base}/health">${base}/health</a></li>
</ul>
<p>Install in Stremio by using the manifest URL above.</p>
</body></html>`);
});

// Manifest endpoint
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Stream endpoint per Stremio spec
app.get('/stream/:type/:id.json', (req, res) => {
  const { type, id } = req.params;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');

  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const streams = [
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      url: reviewUrl,
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

// server.js — Express server for Stremio-style endpoints with externalUrl and verbose logging

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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

// Warn if API keys missing
if (!TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set — metadata may fail.');
if (!OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set — reviews will not be generated.');
console.log(`Gemini model in use: ${GEMINI_MODEL}`);

// Trust proxy for correct proto/host in HF Spaces
app.set('trust proxy', true);

// Basic CORS early
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  const id = Math.random().toString(36).slice(2, 8);
  console.log(`[${new Date().toISOString()}] [req:${id}] ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(
      `[${new Date().toISOString()}] [req:${id}] ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - start}ms`
    );
  });
  next();
});

// Static public files
app.use(express.static(path.join(__dirname, 'public')));

// Landing page
app.get('/', (req, res) => {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>The Quick Reviewer</title>
  <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}
  a{color:#0b5ed7;text-decoration:none}a:hover{text-decoration:underline}
  code{background:#f5f5f5;padding:2px 6px;border-radius:4px}</style></head><body>
  <h1>⚡ The Quick Reviewer — Addon</h1>
  <ul>
    <li>Manifest: <a href="${base}/manifest.json">${base}/manifest.json</a></li>
    <li>Sample Review UI: <a href="${base}/review?type=movie&id=550">${base}/review?type=movie&id=550</a></li>
    <li>Sample API: <a href="${base}/api/review?type=movie&id=550">${base}/api/review?type=movie&id=550</a></li>
    <li>Health: <a href="${base}/health">${base}/health</a></li>
  </ul>
  <p>Environment: TMDB=${!!TMDB_API_KEY}, GEMINI=${!!GEMINI_API_KEY}, MODEL=${GEMINI_MODEL}</p>
  </body></html>`);
});

// Manifest
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Stream endpoint — return externalUrl so Stremio opens system browser
app.get('/stream/:type/:id.json', (req, res) => {
  const { type, id } = req.params;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');

  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  console.log(`Stream requested for ${type}:${id} -> externalUrl ${reviewUrl}`);

  const streams = [
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      externalUrl: reviewUrl, // critical: open in browser
      poster: manifest.icon || undefined
    }
  ];

  res.json({ streams });
});

// Serve review page
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// Mount API routes
const apiRouter = require('./routes');
app.use(apiRouter);

// Health
app.get('/health', (req, res) => res.send('OK'));

// Start
app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
  console.log(`Logging enabled. Model=${GEMINI_MODEL}`);
});

module.exports = app;

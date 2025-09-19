// server.js
// The main entry point for the Stremio addon server.

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const { version } = require('./package.json');
const addonRouter = require('./src/routes/addonRouter.js');
const getReview = require('./src/api.js'); // Used by regeneration worker

// Unified storage (DB or in‑memory fallback)
const {
  initStorage,
  isDbEnabled,
  closeStorage,
  getExpiredReviewIds,
  deleteReview
} = require('./src/core/storage.js');

const app = express();

// --- Environment Config ---
const PORT = process.env.PORT || 7860;
const ADDON_PASSWORD = process.env.ADDONPASSWORD || null;
const BASE_URL = process.env.BASEURL || process.env.HFSPACEURL || null;

// Startup warnings and info
if (!process.env.TMDBAPIKEY) {
  console.warn('[Warning] TMDBAPIKEY not set. TMDB metadata may fail; relying on TVDB/OMDb fallbacks.'); // optional
}
if (!process.env.OMDBAPIKEY) {
  console.warn('[Warning] OMDBAPIKEY not set. OMDb fallback will be unavailable.'); // optional
}
const HAS_GEMINI_KEY = process.env.GEMINIAPIKEY || process.env.GOOGLEAPIKEY;
if (!HAS_GEMINI_KEY) {
  console.warn('[Warning] GEMINIAPIKEY/GOOGLEAPIKEY not set. AI reviews will not be generated unless another provider is configured.'); // optional
}
// TVDB is optional; warn as informational only
if (!process.env.TVDBAPIKEY) {
  console.warn('[Info] TVDBAPIKEY not set. TVDB secondary provider will be skipped (TMDB -> OMDb fallback remains).'); // optional
}
const AI_PROVIDER = (process.env.AIPROVIDER || process.env.AI_PROVIDER || 'perplexity').toLowerCase().trim();
const AI_MODEL = (process.env.AIMODEL || process.env.AI_MODEL || 'auto').trim();
console.log(`[Startup] AI provider: ${AI_PROVIDER}, model: ${AI_MODEL}`);

// --- Global Middleware ---
app.set('trust proxy', true);
app.use(express.json());

// Basic CORS for all routes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Dynamic Homepage Route ---
app.get('/', async (req, res) => {
  try {
    let html = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');

    let dynamicContent = '';
    let pageScript = '';

    if (ADDON_PASSWORD) {
      // Password‑protected homepage
      dynamicContent = `
<form id="password-form" class="password-form">
  <input type="password" id="addon-password" placeholder="Enter Addon Password" required />
  <button type="submit" class="btn submit">Unlock</button>
</form>
<div id="status-message" class="status-message"></div>
      `;
      pageScript = `
<script>
document.getElementById('password-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const password = document.getElementById('addon-password').value;
  const statusEl = document.getElementById('status-message');
  const submitBtn = this.querySelector('button');
  submitBtn.disabled = true;
  statusEl.textContent = 'Verifying...';
  statusEl.className = 'status-message';
  try {
    const response = await fetch('/api/validate-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) {
      statusEl.className = 'status-message error';
      statusEl.textContent = data.error || 'An unknown error occurred.';
      submitBtn.disabled = false;
      return;
    }
    statusEl.className = 'status-message success';
    statusEl.textContent = 'Success! Addon unlocked.';
    const buttonHtml = \`
      <a href="\${data.manifestStremioUrl}" class="btn install">Install Addon</a>
      <a href="\${data.cacheUrl}" class="btn cache">View Cached Reviews</a>
    \`;
    document.getElementById('dynamic-content-area').innerHTML = buttonHtml;
  } catch (err) {
    statusEl.className = 'status-message error';
    statusEl.textContent = 'Failed to connect to the server. Please try again.';
    submitBtn.disabled = false;
  }
});
</script>
      `;
    } else {
      // Public homepage
      const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
      const host = req.get('x-forwarded-host') || req.get('host');
      const base = BASE_URL || (host ? `${proto}://${host}` : '');
      const manifestUrl = `${base}/manifest.json`;
      dynamicContent = `
<a href="${manifestUrl.replace(/^https?:\/\//, 'stremio://')}" class="btn install">Install Addon</a>
      `;
    }

    // VERSION injection and dynamic blocks
    let renderedHtml = html.replace(/VERSION/g, `v${version}`);
    renderedHtml = renderedHtml.replace('DYNAMIC_CONTENT', dynamicContent);
    renderedHtml = renderedHtml.replace('PAGE_SCRIPT', pageScript);

    res.send(renderedHtml);
  } catch (err) {
    console.error('Could not read or process index.html file:', err);
    res.status(500).send('Could not load landing page.');
  }
});

// Serve static public files
app.use(express.static(path.join(__dirname, 'public')));

// Mounting Main Router
app.use('/', addonRouter);

// --- Health Check ---
app.get('/health', (_req, res) => res.send('OK'));

// --- Bootstrap, Scheduler & Graceful Shutdown ---

let server;

// Background regeneration
const regenerationQueue = [];
const REGEN_PER_HOUR = 20;               // ~20 per hour
const REGEN_INTERVAL_MS = Math.floor((60 * 60 * 1000) / REGEN_PER_HOUR); // about every 3 minutes

// Timers must be accessible for shutdown
let workerTimer = null;
let populatorTimer = null;

async function processQueue() {
  if (regenerationQueue.length === 0) return;
  const { id, type } = regenerationQueue.shift();
  console.log('[Regen Worker] Processing expired review for', id, `(Queue size: ${regenerationQueue.length})`);
  try {
    // Force regeneration; storage layer will update the entry
    await getReview(id, type, true);
    console.log('[Regen Worker] Successfully regenerated review for', id);
  } catch (err) {
    console.error('[Regen Worker] Failed to regenerate review for', id, '-', err?.message || err);
    // Avoid loops on repeatedly failing IDs
    try {
      await deleteReview(id);
    } catch (delErr) {
      console.error('[Regen Worker] Failed to delete review', id, 'after error:', delErr?.message || delErr);
    }
  }
}

async function populateQueue() {
  console.log('[Regen Scheduler] Checking for expired reviews to regenerate...');
  try {
    const expiredItems = await getExpiredReviewIds();
    if (expiredItems.length > 0) {
      expiredItems.forEach((item) => {
        if (!regenerationQueue.some((q) => q.id === item.id)) {
          regenerationQueue.push(item);
        }
      });
      console.log('[Regen Scheduler] Found', expiredItems.length, 'expired reviews. Queue size is now', regenerationQueue.length, '.');
    } else {
      console.log('[Regen Scheduler] No expired reviews found.');
    }
  } catch (err) {
    console.error('[Regen Scheduler] Error populating regeneration queue:', err?.message || err);
  }
}

async function start() {
  try {
    await initStorage();
    console.log('[Storage] Initialized. Using', isDbEnabled() ? 'database-backed' : 'in-memory', 'storage mode.');
  } catch (e) {
    console.error('[Storage] Initialization failed. Falling back to in-memory cache:', e?.message || e);
  }

  // Start background scheduler
  workerTimer = setInterval(processQueue, REGEN_INTERVAL_MS);
  populatorTimer = setInterval(populateQueue, 6 * 60 * 60 * 1000); // every 6 hours

  // Allow process to exit without waiting for timers
  if (workerTimer.unref) workerTimer.unref();
  if (populatorTimer.unref) populatorTimer.unref();

  // Prime queue once on start
  populateQueue();

  server = app.listen(PORT, () => {
    console.log(`Quick Reviewer Addon v${version} running on port ${PORT}`);
    if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
  });
}

async function shutdown(kind) {
  console.log(`[Server] Received ${kind}. Shutting down gracefully...`);
  try {
    if (workerTimer) clearInterval(workerTimer);
    if (populatorTimer) clearInterval(populatorTimer);
    if (typeof closeStorage === 'function') {
      try {
        await closeStorage();
      } catch (e) {
        console.warn('[Storage] closeStorage warning:', e?.message || e);
      }
    }
  } finally {
    if (server) {
      server.close(() => {
        console.log('[Server] HTTP server closed.');
        process.exit(0);
      });
      // Fallback hard-exit if close hangs
      setTimeout(() => process.exit(1), 5000).unref();
    } else {
      process.exit(0);
    }
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Process] Unhandled Rejection at:', p, 'reason:', reason);
  // Not forcing shutdown; continue running but logged
});

start();

module.exports = app;

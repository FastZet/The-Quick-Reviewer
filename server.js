// server.js — The main entry point for the Stremio addon server.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { version } = require('./package.json');
const addonRouter = require('./src/routes/addonRouter.js');
const { getReview } = require('./src/api.js'); // Import getReview for regeneration

// Unified storage (DB or in-memory fallback)
const {
  initStorage,
  isDbEnabled,
  closeStorage,
  getExpiredReviewIds, // Import new functions for regeneration
  deleteReview,
} = require('./src/core/storage.js');

const app = express();

// --- Environment Config ---
const PORT = process.env.PORT || 7860;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// Warn if essential API keys are missing
if (!process.env.TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Metadata may fail.');
if (!process.env.OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
const HAS_GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!HAS_GEMINI_KEY) console.warn('Warning: GEMINI_API_KEY/GOOGLE_API_KEY not set. Reviews will not be generated.');

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
      // Logic for password-protected homepage
      dynamicContent = `
        <form id="password-form">
          <input type="password" id="addon-password" placeholder="Enter Addon Password" required />
          <button type="submit" class="btn submit">Unlock</button>
        </form>
        <div id="status-message"></div>
      `;
      pageScript = `<script>
          document.getElementById('password-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const password = document.getElementById('addon-password').value;
            const statusEl = document.getElementById('status-message');
            const submitBtn = this.querySelector('button');
            submitBtn.disabled = true;
            statusEl.textContent = 'Verifying...';
            statusEl.className = '';
            try {
              const response = await fetch('/api/validate-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
              });
              const data = await response.json();
              if (!response.ok) {
                statusEl.className = 'error';
                statusEl.textContent = data.error || 'An unknown error occurred.';
                submitBtn.disabled = false;
                return;
              }
              statusEl.className = 'success';
              statusEl.textContent = 'Success! Addon unlocked.';
              const buttonHtml = \`<a href="\${data.manifestStremioUrl}" class="btn install">Install Addon</a><a href="\${data.cacheUrl}" class="btn cache">View Cached Reviews</a>\`;
              document.getElementById('dynamic-content-area').innerHTML = buttonHtml;
            } catch (err) {
              statusEl.className = 'error';
              statusEl.textContent = 'Failed to connect to the server. Please try again.';
              submitBtn.disabled = false;
            }
          });
        </script>`;
    } else {
      // Logic for public homepage
      const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
      const host = req.get('x-forwarded-host') || req.get('host');
      const base = process.env.BASE_URL || (host ? `${proto}://${host}` : '');
      const manifestUrl = `${base}/manifest.json`;
      dynamicContent = `<a href="${manifestUrl.replace(/^https?:\/\//, 'stremio://')}" class="btn install">Install Addon</a>`;
    }

    // --- VERSION INJECTION ---
    let renderedHtml = html.replace('{{VERSION}}', `v${version}`);
    renderedHtml = renderedHtml.replace('{{DYNAMIC_CONTENT}}', dynamicContent);
    renderedHtml = renderedHtml.replace('{{PAGE_SCRIPT}}', pageScript);
    res.send(renderedHtml);
  } catch (err) {
    console.error("Could not read or process index.html file:", err);
    res.status(500).send("Could not load landing page.");
  }
});

// Serve static public files
app.use(express.static(path.join(__dirname, 'public')));

// Mounting Main Router
app.use('/', addonRouter);

// --- Health Check ---
app.get('/health', (req, res) => res.send('OK'));

// --- Bootstrap, Scheduler & Graceful Shutdown ---
let server;
const regenerationQueue = [];
const REGEN_PER_HOUR = 20;
const REGEN_INTERVAL_MS = (60 * 60 * 1000) / REGEN_PER_HOUR; // Approx. every 3 minutes

// Timers need to be accessible for shutdown
let workerTimer = null;
let populatorTimer = null;

async function start() {
  try {
    await initStorage();
    console.log(`[Storage] Initialized. Using ${isDbEnabled() ? 'database-backed' : 'in-memory'} storage mode.`);
  } catch (e) {
    console.error('[Storage] Initialization failed. Falling back to in-memory cache:', e);
  }

  // --- Background Regeneration Scheduler ---

  // 1. Worker: Processes one review from the queue at a set interval
  const processQueue = async () => {
    if (regenerationQueue.length === 0) return;

    const { id, type } = regenerationQueue.shift();
    console.log(`[Regen Worker] Processing expired review for ${id}. Queue size: ${regenerationQueue.length}`);
    try {
      // Regenerate the review. This will automatically update it in storage.
      await getReview(id, type, true);
      console.log(`[Regen Worker] Successfully regenerated review for ${id}.`);
    } catch (err) {
      console.error(`[Regen Worker] Failed to regenerate review for ${id}:`, err.message);
      // Delete the failed review so it doesn't get stuck in a loop
      await deleteReview(id).catch(delErr => console.error(`[Regen Worker] Failed to delete review ${id} after error:`, delErr));
    }
  };

  // 2. Populator: Periodically finds expired reviews and adds them to the queue
  const populateQueue = async () => {
    console.log('[Regen Scheduler] Checking for expired reviews to regenerate...');
    try {
        const expiredItems = await getExpiredReviewIds();
        if (expiredItems.length > 0) {
            expiredItems.forEach(item => {
                if (!regenerationQueue.some(q => q.id === item.id)) {
                    regenerationQueue.push(item);
                }
            });
            console.log(`[Regen Scheduler] Found ${expiredItems.length} expired reviews. Queue size is now ${regenerationQueue.length}.`);
        } else {
            console.log('[Regen Scheduler] No expired reviews found.');
        }
    } catch (err) {
        console.error('[Regen Scheduler] Error populating regeneration queue:', err);
    }
  };

  // Set intervals and store their IDs
  workerTimer = setInterval(processQueue, REGEN_INTERVAL_MS);
  populatorTimer = setInterval(populateQueue, 6 * 60 * 60 * 1000); // Every 6 hours
  
  // Unref timers to allow graceful shutdown without waiting for them
  if (workerTimer.unref) workerTimer.unref();
  if (populatorTimer.unref) populatorTimer.unref();
  
  populateQueue(); // Initial run on start

  server = app.listen(PORT, () => {
    console.log(`Quick Reviewer Addon v${version} running on port ${PORT}`);
    if (process.env.BASE_URL) console.log(`Base URL (env): ${process.env.BASE_URL}`);
  });
}

async function shutdown(kind = 'shutdown') {
  try {
    console.log(`[Server] Received ${kind}. Shutting down gracefully...`);
    if (workerTimer) clearInterval(workerTimer);
    if (populatorTimer) clearInterval(populatorTimer);

    if (typeof closeStorage === 'function') {
      await closeStorage().catch((e) => console.warn('[Storage] close failed:', e));
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
  console.error('[Process] Unhandled Rejection at Promise:', p, 'reason:', reason);
  // Not forcing shutdown here; continue running but logged
});

start();

module.exports = app;

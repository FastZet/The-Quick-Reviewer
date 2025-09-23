// server.js — The main entry point for the Stremio addon server.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { version } = require('./package.json');
const addonRouter = require('./src/routes/addonRouter.js');

// Unified storage (DB or in-memory fallback)
const {
  initStorage,
  cleanupExpired,
  isDbEnabled,
  closeStorage
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

// --- Password Validation Endpoint ---
// This logic is placed here to ensure the /api/validate-password route is always available
// for the landing page, avoiding conflicts with the addonRouter.
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

app.post('/api/validate-password', (req, res) => {
  if (!ADDON_PASSWORD) {
    return res.status(403).json({ error: 'Password protection is not enabled.' });
  }

  const ip = req.ip;
  const { password } = req.body;
  const now = Date.now();
  let attempts = loginAttempts.get(ip) || { count: 0, firstAttemptTime: now, lockoutUntil: null };

  if (attempts.lockoutUntil && now < attempts.lockoutUntil) {
    const remainingLockout = Math.ceil((attempts.lockoutUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Please try again in ${remainingLockout} minutes.` });
  }

  if (password === ADDON_PASSWORD) {
    loginAttempts.delete(ip);
    const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = BASE_URL || (host ? `${proto}://${host}` : '');

    const manifestStremioUrl = `stremio://${base.replace(/^https?:\/\//, '')}/${ADDON_PASSWORD}/manifest.json`;
    const cacheUrl = `/${ADDON_PASSWORD}/cached-reviews`;

    return res.json({ manifestStremioUrl, cacheUrl });
  }

  // Incorrect password logic
  if (now - attempts.firstAttemptTime > ATTEMPT_WINDOW_MS) {
    attempts = { count: 1, firstAttemptTime: now, lockoutUntil: null };
  } else {
    attempts.count++;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    attempts.lockoutUntil = now + LOCKOUT_MS;
    loginAttempts.set(ip, attempts);
    return res.status(429).json({ error: 'Too many failed attempts. You are locked out for 10 minutes.' });
  } else {
    loginAttempts.set(ip, attempts);
    const remaining = MAX_ATTEMPTS - attempts.count;
    return res.status(401).json({ error: `Incorrect password. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` });
  }
});


// Mounting Main Router
app.use('/', addonRouter);

// --- Health Check ---
app.get('/health', (req, res) => res.send('OK'));

// --- Bootstrap, Scheduler & Graceful Shutdown ---
let server;
let cleanupTimer;

async function start() {
  try {
    await initStorage();
    console.log(`[Storage] Initialized. Using ${isDbEnabled() ? 'database-backed' : 'in-memory'} storage mode.`);
  } catch (e) {
    console.error('[Storage] Initialization failed. Falling back to in-memory cache:', e);
  }

  // Periodic TTL cleanup (DB or memory)
  cleanupTimer = setInterval(() => {
    cleanupExpired().catch(() => {});
  }, 6 * 60 * 60 * 1000); // every 6 hours
  if (cleanupTimer.unref) cleanupTimer.unref();

  server = app.listen(PORT, () => {
    console.log(`Quick Reviewer Addon v${version} running on port ${PORT}`);
    if (process.env.BASE_URL) console.log(`Base URL (env): ${process.env.BASE_URL}`);
  });
}

async function shutdown(kind = 'shutdown') {
  try {
    console.log(`[Server] Received ${kind}. Shutting down gracefully...`);
    if (cleanupTimer) clearInterval(cleanupTimer);
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
  console.error('Error in /api/review route:', reason);
  // Not forcing shutdown here; continue running but logged
});

start();

module.exports = app;

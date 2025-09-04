// server.js — The main entry point for the Stremio addon server.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { version } = require('../package.json');
const addonRouter = require('./src/routes/addonRouter.js');

const app = express();

// --- Environment Config ---
const PORT = process.env.PORT || 7860;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// Warn if essential API keys are missing
if (!process.env.TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Metadata may fail.');
if (!process.env.OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!process.env.GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set. Reviews will not be generated.');

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

// --- Health Check and Server Start ---
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon v${version} running on port ${PORT}`);
  if (process.env.BASE_URL) console.log(`Base URL (env): ${process.env.BASE_URL}`);
});

module.exports = app;

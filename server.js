// server.js — The main entry point for the Stremio addon server.

const express = require('express');
const path = require('path');
const fs = require('fs');
const addonRouter = require('./src/routes/addonRouter');
const apiRouter = require('./src/routes/apiRouter');

const app = express();

// --- Environment Config ---
const PORT = process.env.PORT || 7860;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// Warn if essential API keys are missing
if (!process.env.TMDB_API_KEY) console.warn('Warning: TMDB_API_KEY not set. Metadata may fail.');
if (!process.env.OMDB_API_KEY) console.warn('Warning: OMDB_API_KEY not set.');
if (!process.env.GEMINI_API_KEY) console.warn('Warning: GEMINI_API_KEY not set. Reviews will not be generated.');

// --- Global Middleware ---
app.set('trust proxy', true); // Trust proxy for correct IP address and protocol
app.use(express.json());      // Parse JSON bodies

// Basic CORS for all routes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static public files (style.css, review.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// --- Dynamic Homepage Route ---
// This remains here as it's part of the server's core presentation logic.
app.get('/', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) {
      console.error("Could not read index.html file:", err);
      return res.status(500).send("Could not load landing page.");
    }
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
              const buttonHtml = \`
                <a href="\${data.manifestStremioUrl}" class="btn install">Install Addon</a>
                <a href="\${data.cacheUrl}" class="btn cache">View Cached Reviews</a>
              \`;
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

    let renderedHtml = html.replace('{{DYNAMIC_CONTENT}}', dynamicContent);
    renderedHtml = renderedHtml.replace('{{PAGE_SCRIPT}}', pageScript);
    res.send(renderedHtml);
  });
});

// --- Route to serve the review page ---
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// --- Mounting Routers ---
app.use('/api', apiRouter);   // Internal APIs for the frontend
app.use('/', addonRouter);  // Stremio-facing addon routes

// --- Health Check and Server Start ---
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (process.env.BASE_URL) console.log(`Base URL (env): ${process.env.BASE_URL}`);
});

module.exports = app;

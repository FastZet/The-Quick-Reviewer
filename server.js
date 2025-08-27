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
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

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

// --- Homepage route is now fully dynamic and password-aware ---
app.get('/', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) {
      console.error("Could not read index.html file:", err);
      return res.status(500).send("Could not load landing page.");
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = BASE_URL || (host ? `${proto}://${host}` : '');
    
    let dynamicContent = '';
    let pageScript = '';
    
    if (ADDON_PASSWORD) {
      // SECURED: Render the password form and the client-side script to handle it.
      dynamicContent = `
        <form id="password-form">
          <input type="password" id="addon-password" placeholder="Enter Addon Password" required />
          <button type="submit" class="btn submit">Unlock</button>
        </form>
      `;
      pageScript = `
        <script>
          document.getElementById('password-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const password = document.getElementById('addon-password').value.trim();
            if (!password) {
              alert('Please enter a password.');
              return;
            }

            // Dynamically build the protected URLs on the client-side
            const manifestStremioUrl = \`stremio://${base.replace(/^https?:\/\//, '')}/\${encodeURIComponent(password)}/manifest.json\`;
            const cacheUrl = \`/\${encodeURIComponent(password)}/cached-reviews\`;

            const buttonHtml = \`
              <a href="\${manifestStremioUrl}" class="btn install">Install Addon</a>
              <a href="\${cacheUrl}" class="btn cache">View Cached Reviews</a>
            \`;

            // Replace the form with the generated buttons
            document.getElementById('dynamic-content-area').innerHTML = buttonHtml;
          });
        </script>
      `;
    } else {
      // UNSECURED: Render the installation button directly.
      const manifestUrl = `${base}/manifest.json`;
      dynamicContent = `<a href="${manifestUrl.replace(/^https?:\/\//, 'stremio://')}" class="btn install">Install Addon</a>`;
      pageScript = ''; // No script needed for the unsecured version.
    }
    
    // Replace placeholders and send the final rendered HTML to the user.
    let renderedHtml = html.replace('{{DYNAMIC_CONTENT}}', dynamicContent);
    renderedHtml = renderedHtml.replace('{{PAGE_SCRIPT}}', pageScript);
    res.send(renderedHtml);
  });
});

// Serve static public files (review.html etc.)
app.use(express.static(path.join(__dirname, 'public')));

// --- MANIFEST AND STREAM ENDPOINTS WITH PASSWORD LOGIC ---

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
  if (ADDON_PASSWORD) console.log(`Password protection is ENABLED.`);
});

module.exports = app;

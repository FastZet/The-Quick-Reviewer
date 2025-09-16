// src/routes/addonRouter.js — Handles ALL Stremio and internal API routes.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const manifest = require('../../manifest.json');
const { buildStreamResponse } = require('../core/stremioStreamer.js');
const { getReview } = require('../api');
const { getAllCachedReviews } = require('../core/storage');
const { buildReviewContent } = require('../core/formatEnforcerV2'); // Import the new V2 enforcer

const router = express.Router();
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// Constant for favicon links to keep HTML templates clean
const FAVICON_LINKS = `
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">
  <link rel="manifest" href="/assets/site.webmanifest">
`;

const handleReviewApiRequest = async (req, res) => {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';
    if (!type || !id) return res.status(400).json({ error: 'Missing type or id parameter.' });
    if (type !== 'movie' && type !== 'series') return res.status(400).json({ error: 'Invalid type.' });
    const review = await getReview(String(id).trim(), type, forceRefresh);
    res.json(review);
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const handleCachedReviewsApiRequest = async (req, res) => {
  try {
    const cachedItems = await getAllCachedReviews();
    res.json(cachedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const handleQuickReviewPage = async (req, res) => {
    try {
        const { type, id } = req.query;
        const forceRefresh = req.query.force === 'true';
        if (!type || !id) return res.status(400).send('Missing "type" or "id" in URL query.');

        const reviewData = await getReview(String(id).trim(), type, forceRefresh);
        if (!reviewData || !reviewData.raw) {
            return res.status(500).send('Failed to generate or retrieve review content.');
        }

        const content = buildReviewContent(reviewData.raw);
        const templatePath = path.join(__dirname, '..', '..', 'public', 'review-quick.html');
        let html = await fs.readFile(templatePath, 'utf-8');

        // Build the full review URL for toggle
        const fullReviewUrl = req.originalUrl.replace('/review-quick', '/review-full');
        
        // Build the force refresh URL
        const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
        currentUrl.searchParams.set('force', 'true');
        const forceRefreshUrl = currentUrl.pathname + currentUrl.search;
        
        html = html.replace('{{FAVICON_LINKS}}', FAVICON_LINKS)
                   .replace('{{POSTER_CONTENT}}', content.posterContent)
                   .replace('{{HERO_CONTENT}}', content.heroContent
                       .replace('{{TOGGLE_URL}}', fullReviewUrl)
                       .replace('{{TOGGLE_TEXT}}', 'Click for Full Review'))
                   .replace('{{SIDEBAR_CONTENT}}', content.sidebarContent)
                   .replace('{{PLOT_SUMMARY}}', content.plotSummary)
                   .replace('{{OVERALL_VERDICT}}', content.overallVerdict)
                   .replace('{{TIMESTAMP}}', reviewData.ts)
                   .replace('{{FORCE_REFRESH_URL}}', forceRefreshUrl);
        
        // Add force refresh JavaScript functionality
        const forceRefreshScript = `
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const forceBtn = document.getElementById('force-refresh');
                if (forceBtn) {
                    forceBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        forceBtn.disabled = true;
                        forceBtn.innerHTML = '⏳ Generating...';
                        window.location.href = '${forceRefreshUrl}';
                    });
                }
            });
        </script>`;
        
        html = html.replace('</body>', forceRefreshScript + '</body>');
        res.send(html);
    } catch (error) {
        console.error('SSR Error for quick review page:', error);
        res.status(500).send('Error generating quick review page.');
    }
};

const handleFullReviewPage = async (req, res) => {
    try {
        const { type, id } = req.query;
        const forceRefresh = req.query.force === 'true';
        if (!type || !id) return res.status(400).send('Missing "type" or "id" in URL query.');

        const reviewData = await getReview(String(id).trim(), type, forceRefresh);
        if (!reviewData || !reviewData.raw) {
            return res.status(500).send('Failed to generate or retrieve review content.');
        }

        const content = buildReviewContent(reviewData.raw);
        const templatePath = path.join(__dirname, '..', '..', 'public', 'review-full.html');
        let html = await fs.readFile(templatePath, 'utf-8');

        // Build the quick review URL for toggle
        const quickReviewUrl = req.originalUrl.replace('/review-full', '/review-quick');
        
        // Build the force refresh URL
        const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
        currentUrl.searchParams.set('force', 'true');
        const forceRefreshUrl = currentUrl.pathname + currentUrl.search;

        html = html.replace('{{FAVICON_LINKS}}', FAVICON_LINKS)
                   .replace('{{POSTER_CONTENT}}', content.posterContent)
                   .replace('{{HERO_CONTENT}}', content.heroContent
                       .replace('{{TOGGLE_URL}}', quickReviewUrl)
                       .replace('{{TOGGLE_TEXT}}', 'Click for Quick View'))
                   .replace('{{SIDEBAR_CONTENT}}', content.sidebarContent)
                   .replace('{{MAIN_REVIEW_CARDS}}', content.mainReviewCards)
                   .replace('{{TIMESTAMP}}', reviewData.ts)
                   .replace('{{FORCE_REFRESH_URL}}', forceRefreshUrl);
        
        // Add force refresh JavaScript functionality
        const forceRefreshScript = `
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const forceBtn = document.getElementById('force-refresh');
                if (forceBtn) {
                    forceBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        forceBtn.disabled = true;
                        forceBtn.innerHTML = '⏳ Generating...';
                        window.location.href = '${forceRefreshUrl}';
                    });
                }
            });
        </script>`;
        
        html = html.replace('</body>', forceRefreshScript + '</body>');
        res.send(html);
    } catch (error) {
        console.error('SSR Error for full review page:', error);
        res.status(500).send('Error generating full review page.');
    }
};

const handleCachedReviewsPageRequest = (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'cached-reviews.html'));
};

const loginAttempts = new Map();
router.post('/api/validate-password', (req, res) => {
  const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;
  if (!ADDON_PASSWORD) return res.status(403).json({ error: 'Password protection is not enabled.' });
  const ip = req.ip;
  const { password } = req.body;
  const now = Date.now();
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 10 * 60 * 1000;
  let attempts = loginAttempts.get(ip) || { count: 0, lockoutUntil: null };
  if (attempts.lockoutUntil && now < attempts.lockoutUntil) {
    const remainingLockout = Math.ceil((attempts.lockoutUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Please try again in ${remainingLockout} minutes.` });
  }
  if (password === ADDON_PASSWORD) {
    loginAttempts.delete(ip);
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = process.env.BASE_URL || (host ? `${proto}://${host}` : '');
    const manifestStremioUrl = `stremio://${base.replace(/^https?:\/\//, '')}/${ADDON_PASSWORD}/manifest.json`;
    const cacheUrl = `/${ADDON_PASSWORD}/cached-reviews`;
    return res.json({ manifestStremioUrl, cacheUrl });
  }
  attempts.count++;
  if (attempts.count >= MAX_ATTEMPTS) attempts.lockoutUntil = now + LOCKOUT_MS;
  loginAttempts.set(ip, attempts);
  const remaining = MAX_ATTEMPTS - attempts.count;
  return res.status(401).json({ error: `Incorrect password. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` });
});

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All functional routes are password-protected.');
  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));
  router.get(`${secretPath}/stream/:type/:id.json`, (req, res) => buildStreamResponse(req).then(data => res.json(data)));
  
  // New review page routes
  router.get(`${secretPath}/review`, (req, res) => res.redirect(301, req.originalUrl.replace('/review', '/review-quick')));
  router.get(`${secretPath}/review-quick`, handleQuickReviewPage);
  router.get(`${secretPath}/review-full`, handleFullReviewPage);
  
  router.get(`${secretPath}/cached-reviews`, handleCachedReviewsPageRequest);
  router.get(`${secretPath}/api/review`, handleReviewApiRequest);
  router.get(`${secretPath}/api/cached-reviews`, handleCachedReviewsApiRequest);
  
  const forbiddenHandler = (req, res) => res.status(403).send('You are not authorized. Contact the administrator.');
  router.get('/manifest.json', forbiddenHandler);
  router.get('/stream/:type/:id.json', forbiddenHandler);
  router.get('/review', forbiddenHandler);
  router.get('/review-quick', forbiddenHandler);
  router.get('/review-full', forbiddenHandler);
  router.get('/cached-reviews', forbiddenHandler);
  router.get('/api/review', forbiddenHandler);
  router.get('/api/cached-reviews', forbiddenHandler);
} else {
  console.log('Addon is UNSECURED.');
  router.get('/manifest.json', (req, res) => res.json(manifest));
  router.get('/stream/:type/:id.json', (req, res) => buildStreamResponse(req).then(data => res.json(data)));
  
  // New review page routes
  router.get('/review', (req, res) => res.redirect(301, req.originalUrl.replace('/review', '/review-quick')));
  router.get('/review-quick', handleQuickReviewPage);
  router.get('/review-full', handleFullReviewPage);

  router.get('/cached-reviews', handleCachedReviewsPageRequest);
  router.get('/api/review', handleReviewApiRequest);
  router.get('/api/cached-reviews', handleCachedReviewsApiRequest);
}

module.exports = router;

// src/routes/addonRouter.js — Handles ALL Stremio and internal API routes.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const manifest = require('../../manifest.json');
const { buildStreamResponse } = require('../core/stremioStreamer.js');
const { getReview } = require('../api');
const { getAllCachedReviews } = require('../core/cache');

const router = express.Router();
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// --- API Logic Handlers ---
const handleReviewApiRequest = async (req, res) => {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) return res.status(400).json({ error: 'Missing type or id parameter.' });
    if (type !== 'movie' && type !== 'series') return res.status(400).json({ error: 'Invalid type.' });

    const review = await getReview(String(id).trim(), type, forceRefresh);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const handleCachedReviewsApiRequest = (req, res) => {
  try {
    const cachedItems = getAllCachedReviews();
    res.json(cachedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- Page Handlers ---
// SSR Handler for the Review Page
const handleReviewPageRequest = async (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) {
      return res.status(400).send('Missing "type" or "id" in URL query.');
    }

    const reviewHtml = await getReview(String(id).trim(), type, false);
    const templatePath = path.join(__dirname, '..', '..', 'public', 'review.html');
    let htmlTemplate = await fs.readFile(templatePath, 'utf-8');

    htmlTemplate = htmlTemplate
      .replace('{{LOADING_STATE}}', 'style="display: none;"')
      .replace('{{REVIEW_CONTENT}}', reviewHtml || '<p>Review could not be loaded.</p>');

    res.send(htmlTemplate);
  } catch (error) {
    console.error('SSR Error for review page:', error);
    res.status(500).send('Error generating review page.');
  }
};

const handleCachedReviewsPageRequest = (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'cached-reviews.html'));
};

// --- Password Validation ---
const loginAttempts = new Map();
router.post('/api/validate-password', (req, res) => {
    if (!ADDON_PASSWORD) {
        return res.status(403).json({ error: 'Password protection is not enabled.' });
    }
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
    if (attempts.count >= MAX_ATTEMPTS) {
        attempts.lockoutUntil = now + LOCKOUT_MS;
    }
    loginAttempts.set(ip, attempts);
    const remaining = MAX_ATTEMPTS - attempts.count;
    return res.status(401).json({ error: `Incorrect password. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` });
});


// --- Conditional Routing ---

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All functional routes are password-protected.');

  // Stremio Routes
  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));
  router.get(`${secretPath}/stream/:type/:id.json`, (req, res) => buildStreamResponse(req).then(data => res.json(data)));

  // User-facing Pages
  router.get(`${secretPath}/review`, handleReviewPageRequest);
  router.get(`${secretPath}/cached-reviews`, handleCachedReviewsPageRequest);
  
  // Internal APIs for those pages
  router.get(`${secretPath}/api/review`, handleReviewApiRequest);
  router.get(`${secretPath}/api/cached-reviews`, handleCachedReviewsApiRequest);

  // Forbidden Routes
  const forbiddenHandler = (req, res) => {
    res.status(403).send('You are not authorized. Contact the administrator.');
  };
  router.get('/manifest.json', forbiddenHandler);
  router.get('/stream/:type/:id.json', forbiddenHandler);
  router.get('/review', forbiddenHandler);
  router.get('/cached-reviews', forbiddenHandler);
  router.get('/api/review', forbiddenHandler);
  router.get('/api/cached-reviews', forbiddenHandler);

} else {
  console.log('Addon is UNSECURED.');

  // Stremio Routes
  router.get('/manifest.json', (req, res) => res.json(manifest));
  router.get('/stream/:type/:id.json', (req, res) => buildStreamResponse(req).then(data => res.json(data)));
  
  // User-facing Pages & APIs (now unprotected)
  router.get('/review', handleReviewPageRequest);
  router.get('/cached-reviews', handleCachedReviewsPageRequest);
  router.get('/api/review', handleReviewApiRequest);
  router.get('/api/cached-reviews', handleCachedReviewsApiRequest);
}

module.exports = router;

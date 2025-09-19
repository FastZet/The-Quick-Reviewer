// src/routes/addonRouter.js
// Handles ALL Stremio and internal routes (secured and unsecured modes).

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const manifest = require('../../manifest.json');
const buildStreamResponse = require('../core/stremioStreamer.js');
const { getReview } = require('../api.js');
const { getAllCachedReviews } = require('../core/storage.js');
const buildReviewContent = require('../core/formatEnforcer.js');

const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

const router = express.Router();

// --- Helpers ---
function buildForceRefreshUrl(req) {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  url.searchParams.set('force', 'true');
  return `${url.pathname}${url.search}`;
}

function replaceTemplatePlaceholders(template, content, meta, req, isFull) {
  const forceUrl = buildForceRefreshUrl(req);
  const toggleTo = isFull ? '/review' : '/review-full';
  const toggleText = isFull ? 'Quick View' : 'Full View';
  const type = req.query.type;
  const id = req.query.id;

  return template
    .replace(/POSTER_CONTENT/g, content.posterContent || '')
    .replace(/HERO_CONTENT/g, content.heroContent || '')
    .replace(/SIDEBAR_CONTENT/g, content.sidebarContent || '')
    .replace(/MAIN_REVIEW_CARDS/g, content.mainReviewCards || '')
    .replace(/PLOT_SUMMARY/g, content.plotSummary || '')
    .replace(/OVERALL_VERDICT/g, content.overallVerdict || '')
    .replace(/REVIEW_TIMESTAMP/g, meta.ts ? new Date(meta.ts).toUTCString() : new Date().toUTCString())
    .replace(/FORCEREFRESHURL/g, `?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&force=true`)
    .replace(/TOGGLEURL/g, `${toggleTo}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
    .replace(/TOGGLETEXT/g, toggleText);
}

// --- API Handlers ---
async function handleReviewApiRequest(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = String(req.query.force || '').toLowerCase() === 'true';
    if (!type || !id) return res.status(400).json({ error: 'Missing type or id parameter.' });
    if (type !== 'movie' && type !== 'series') return res.status(400).json({ error: 'Invalid type.' });

    const review = await getReview(id.trim(), type, forceRefresh);
    return res.json(review);
  } catch (err) {
    console.error('Error in /api/review route:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function handleCachedReviewsApiRequest(req, res) {
  try {
    const cachedItems = await getAllCachedReviews();
    return res.json(cachedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// --- SSR Handlers ---
async function handleQuickReviewPage(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = String(req.query.force || '').toLowerCase() === 'true';
    if (!type || !id) return res.status(400).send('Missing type or id in URL query.');

    const reviewData = await getReview(id.trim(), type, forceRefresh);
    if (!reviewData || !reviewData.raw) return res.status(500).send('Failed to generate or retrieve review content.');

    const reviewMeta = {
      posterUrl: reviewData.posterUrl || null,
      stillUrl: reviewData.stillUrl || null,
      backdropUrl: reviewData.backdropUrl || null,
      title: reviewData.title || 'Unknown',
      year: reviewData.year || null,
      ts: reviewData.ts || Date.now(),
    };

    const content = buildReviewContent(reviewData.raw, reviewMeta);
    const templatePath = path.join(__dirname, '../..', 'public', 'review-quick.html');
    let template = await fs.readFile(templatePath, 'utf8');

    template = replaceTemplatePlaceholders(template, content, reviewMeta, req, false);
    return res.send(template);
  } catch (error) {
    console.error('SSR Error for quick review page:', error);
    return res.status(500).send('Error generating quick review page.');
  }
}

async function handleFullReviewPage(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = String(req.query.force || '').toLowerCase() === 'true';
    if (!type || !id) return res.status(400).send('Missing type or id in URL query.');

    const reviewData = await getReview(id.trim(), type, forceRefresh);
    if (!reviewData || !reviewData.raw) return res.status(500).send('Failed to generate or retrieve review content.');

    const reviewMeta = {
      posterUrl: reviewData.posterUrl || null,
      stillUrl: reviewData.stillUrl || null,
      backdropUrl: reviewData.backdropUrl || null,
      title: reviewData.title || 'Unknown',
      year: reviewData.year || null,
      ts: reviewData.ts || Date.now(),
    };

    const content = buildReviewContent(reviewData.raw, reviewMeta);
    const templatePath = path.join(__dirname, '../..', 'public', 'review-full.html');
    let template = await fs.readFile(templatePath, 'utf8');

    template = replaceTemplatePlaceholders(template, content, reviewMeta, req, true);
    return res.send(template);
  } catch (error) {
    console.error('SSR Error for full review page:', error);
    return res.status(500).send('Error generating full review page.');
  }
}

function handleCachedReviewsPageRequest(req, res) {
  return res.sendFile(path.join(__dirname, '../..', 'public', 'cached-reviews.html'));
}

// --- Stremio Routes ---
async function handleManifest(req, res) {
  return res.json(manifest);
}

async function handleStream(req, res) {
  try {
    const data = await buildStreamResponse(req);
    return res.json(data);
  } catch (err) {
    console.error('Stream handler error:', err);
    return res.status(500).json({ streams: [] });
  }
}

// --- Route Wiring (secured vs unsecured) ---
if (ADDON_PASSWORD) {
  const base = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All functional routes are password-protected.');
  // Stremio endpoints
  router.get(`${base}/manifest.json`, handleManifest);
  router.get(`${base}/stream/:type/:id.json`, handleStream);

  // Review pages
  router.get(`${base}/review`, (req, res) => {
    // compat alias: redirect to quick
    res.redirect(301, req.originalUrl.replace('/review', '/review-quick'));
  });
  router.get(`${base}/review-quick`, handleQuickReviewPage);
  router.get(`${base}/review-full`, handleFullReviewPage);

  // Static listing page
  router.get(`${base}/cached-reviews`, handleCachedReviewsPageRequest);

  // APIs
  router.get(`${base}/api/review`, handleReviewApiRequest);
  router.get(`${base}/api/cached-reviews`, handleCachedReviewsApiRequest);

  // Public endpoints forbidden
  const forbidden = (_req, res) => res.status(403).send('You are not authorized. Contact the administrator.');
  router.get('/manifest.json', forbidden);
  router.get('/stream/:type/:id.json', forbidden);
  router.get('/review', forbidden);
  router.get('/review-quick', forbidden);
  router.get('/review-full', forbidden);
  router.get('/cached-reviews', forbidden);
  router.get('/api/review', forbidden);
  router.get('/api/cached-reviews', forbidden);
} else {
  console.log('Addon is UNSECURED.');
  // Stremio endpoints
  router.get('/manifest.json', handleManifest);
  router.get('/stream/:type/:id.json', handleStream);

  // Review pages
  router.get('/review', (req, res) => {
    // compat alias: redirect to quick
    res.redirect(301, req.originalUrl.replace('/review', '/review-quick'));
  });
  router.get('/review-quick', handleQuickReviewPage);
  router.get('/review-full', handleFullReviewPage);

  // Static listing page
  router.get('/cached-reviews', handleCachedReviewsPageRequest);

  // APIs
  router.get('/api/review', handleReviewApiRequest);
  router.get('/api/cached-reviews', handleCachedReviewsApiRequest);
}

module.exports = router;

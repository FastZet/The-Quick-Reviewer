// src/routes/addonRouter.js
// Handles ALL Stremio and internal API routes with robust import of the stream builder.

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const manifest = require('../../manifest.json');

// Robustly resolve buildStreamResponse regardless of export shape
let buildStreamResponse;
const mod = require('../core/stremioStreamer.js');

if (typeof mod === 'function') {
  buildStreamResponse = mod;
} else if (mod && typeof mod.buildStreamResponse === 'function') {
  buildStreamResponse = mod.buildStreamResponse;
} else if (mod && typeof mod.default === 'function') {
  buildStreamResponse = mod.default;
} else {
  throw new Error('stremioStreamer.js does not export a callable buildStreamResponse');
}

const { getReview } = require('../api'); // returns { review, verdict, summary8 }
const { getAllCachedReviews } = require('../core/storage');

const router = express.Router();

const ADDON_PASSWORD = process.env.ADDON_PASSWORD || process.env.ADDON_PASSWORD || null;
const BASE_URL = process.env.BASE_URL || process.env.BASE_URL || process.env.HF_SPACE_URL || process.env.HF_SPACE_URL || null;

// Helpers
function resolveBaseUrl(req) {
  if (BASE_URL) return BASE_URL.replace(/\/$/, '');
  
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

async function handleReviewApiRequest(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = String(req.query.force || false).toLowerCase() === 'true';
    
    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    
    if (type !== 'movie' && type !== 'series') {
      return res.status(400).json({ error: 'Invalid type. Use movie or series.' });
    }
    
    const data = await getReview(String(id).trim(), String(type).trim(), forceRefresh);
    return res.json(data);
  } catch (err) {
    console.error('Error in api/review:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function handleCachedReviewsApiRequest(req, res) {
  try {
    const items = await getAllCachedReviews();
    return res.json(items);
  } catch (err) {
    console.error('Error in api/cached-reviews:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function handleReviewPageRequest(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = String(req.query.force || false).toLowerCase() === 'true';
    
    if (!type || !id) {
      return res.status(400).send('Missing type or id in URL query.');
    }
    
    const reviewData = await getReview(String(id).trim(), String(type).trim(), forceRefresh);
    const reviewHtml = reviewData ? reviewData.review : null;
    
    const templatePath = path.join(__dirname, '../..', 'public/review.html');
    let html = await fs.readFile(templatePath, 'utf-8');
    
    html = html
      .replace('{{LOADING_STATE}}', 'style="display: none"')
      .replace('{{REVIEW_CONTENT}}', reviewHtml || '<p>Review could not be loaded.</p>');
      
    return res.send(html);
  } catch (err) {
    console.error('SSR Error for review:', err);
    return res.status(500).send('Error generating review page.');
  }
}

function handleCachedReviewsPageRequest(req, res) {
  return res.sendFile(path.join(__dirname, '../..', 'public/cached-reviews.html'));
}

// Route registration
if (ADDON_PASSWORD) {
  console.log('Addon is SECURED. All functional routes are password-protected.');
  
  const secretPath = `/${ADDON_PASSWORD}`;
  
  // Functional routes under secret path
  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));
  router.get(`${secretPath}/stream/:type/:id.json`, async (req, res) => {
    try {
      const data = await buildStreamResponse(req);
      res.json(data);
    } catch (err) {
      console.error('Error in stream:', err);
      res.json({ streams: [] });
    }
  });
  router.get(`${secretPath}/review`, handleReviewPageRequest);
  router.get(`${secretPath}/cached-reviews`, handleCachedReviewsPageRequest);
  router.get(`${secretPath}/api/review`, handleReviewApiRequest);
  router.get(`${secretPath}/api/cached-reviews`, handleCachedReviewsApiRequest);
  
  // Public routes blocked
  const forbidden = (req, res) => res.status(403).send('You are not authorized. Contact the administrator.');
  router.get('/manifest.json', forbidden);
  router.get('/stream/:type/:id.json', forbidden);
  router.get('/review', forbidden);
  router.get('/cached-reviews', forbidden);
  router.get('/api/review', forbidden);
  router.get('/api/cached-reviews', forbidden);
} else {
  console.log('Addon is UNSECURED. Public routes are enabled.');
  
  // Public functional routes
  router.get('/manifest.json', (req, res) => res.json(manifest));
  router.get('/stream/:type/:id.json', async (req, res) => {
    try {
      const data = await buildStreamResponse(req);
      res.json(data);
    } catch (err) {
      console.error('Error in stream:', err);
      res.json({ streams: [] });
    }
  });
  router.get('/review', handleReviewPageRequest);
  router.get('/cached-reviews', handleCachedReviewsPageRequest);
  router.get('/api/review', handleReviewApiRequest);
  router.get('/api/cached-reviews', handleCachedReviewsApiRequest);
}

module.exports = router;

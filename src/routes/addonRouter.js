// src/routes/addonRouter.js — Handles all Stremio client-facing routes.

const express = require('express');
const path = require('path');
const manifest = require('../../manifest.json');
const { buildStreamResponse } = require('../core/stremioStreamer.js');
const { getReview } = require('../api');

const router = express.Router();
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

// --- Handler for serving the Stremio stream response ---
const handleStreamRequest = async (req, res) => {
  const streamData = await buildStreamResponse(req);
  res.json(streamData);
};

// --- Handler for serving the review page HTML ---
const handleReviewPageRequest = (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'review.html'));
};

// --- Handler for serving the review data from the internal API ---
const handleReviewApiRequest = async (req, res) => {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    const isValidType = type === 'movie' || type === 'series';
    if (!isValidType) {
      return res.status(400).json({ error: 'Invalid type. Use "movie" or "series".' });
    }

    const review = await getReview(String(id).trim(), type, forceRefresh);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All functional routes are password-protected.');

  // Manifest route
  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));

  // Stream route
  router.get(`${secretPath}/stream/:type/:id.json`, handleStreamRequest);

  // Admin page for cached reviews
  router.get(`${secretPath}/cached-reviews`, (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'cached-reviews.html'));
  });

  // --- SECURED REVIEW ROUTES ---
  // Serves the review.html page under the protected path
  router.get(`${secretPath}/review`, handleReviewPageRequest);

  // Serves the review data API under the protected path
  router.get(`${secretPath}/api/review`, handleReviewApiRequest);

} else {
  console.log('Addon is UNSECURED.');

  // Manifest route
  router.get('/manifest.json', (req, res) => res.json(manifest));

  // Stream route
  router.get('/stream/:type/:id.json', handleStreamRequest);
  
  // --- UNSECURED REVIEW ROUTES ---
  // The review page and its API are left public as there is no password
  router.get('/review', handleReviewPageRequest);
  router.get('/api/review', handleReviewApiRequest);
}

module.exports = router;

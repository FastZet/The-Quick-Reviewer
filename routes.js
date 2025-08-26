// routes.js — now includes an endpoint to view all cached reviews.

const express = require('express');
const { getReview } = require('./api');
const { getAllCachedReviews } = require('./cache');

const router = express.Router();

function normalizeDate(input) {
  if (!input) return new Date().toISOString().split('T')[0];
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString().split('T')[0];
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function isValidType(t) { return t === 'movie' || t === 'series'; }

// New route to get all cached reviews as JSON data.
router.get('/api/cached-reviews', (req, res) => {
  try {
    const cachedItems = getAllCachedReviews();
    // Format the data to be more useful for the frontend page.
    const formattedItems = cachedItems.map(item => {
      // The cache key is "YYYY-MM-DD:imdbId", so we split it to get the actual ID.
      const id = item.key.split(':').slice(1).join(':');
      return {
        id: id,
        type: item.type,
        ts: item.ts
      };
    });
    res.json(formattedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/api/review', async (req, res) => {
  try {
    const { type, id } = req.query;
    const date = normalizeDate(req.query.date);
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    if (!isValidType(type)) {
      return res.status(400).json({ error: 'Invalid type. Use "movie" or "series".' });
    }

    const review = await getReview(date, String(id).trim(), type, forceRefresh);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

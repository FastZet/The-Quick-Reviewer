// routes.js — now passes the force refresh parameter to the review manager.

const express = require('express');
const { getReview } = require('./api');
const router = express.Router();

function normalizeDate(input) {
  if (!input) return new Date().toISOString().split('T')[0];
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString().split('T')[0];
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function isValidType(t) { return t === 'movie' || t === 'series'; }

router.get('/api/review', async (req, res) => {
  try {
    const { type, id } = req.query;
    const date = normalizeDate(req.query.date);
    // THE FIX: Check if the 'force' query parameter is set to 'true'.
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    if (!isValidType(type)) {
      return res.status(400).json({ error: 'Invalid type. Use "movie" or "series".' });
    }

    // Pass the forceRefresh flag to the getReview function.
    const review = await getReview(date, String(id).trim(), type, forceRefresh);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

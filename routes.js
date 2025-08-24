// routes.js — sets up Express routes for review API and integrates with api.js

const express = require('express');
const { getReview } = require('./api');

const router = express.Router();

// Sanitize/normalize YYYY-MM-DD (fallback to today if invalid)
function normalizeDate(input) {
  if (!input) return new Date().toISOString().split('T')[0];
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString().split('T')[0];
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Validate supported types
function isValidType(t) {
  return t === 'movie' || t === 'series';
}

// Endpoint to generate or fetch a review
// Example: GET /api/review?type=movie&id=550&date=2025-08-11
router.get('/api/review', async (req, res) => {
  try {
    const { type, id } = req.query;
    const date = normalizeDate(req.query.date);

    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    if (!isValidType(type)) {
      return res.status(400).json({ error: 'Invalid type. Use "movie" or "series".' });
    }

    const review = await getReview(date, String(id).trim(), type);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

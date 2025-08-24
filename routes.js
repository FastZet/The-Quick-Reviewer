// routes.js — review API with additional logging

const express = require('express');
const { getReview } = require('./api');

const router = express.Router();

function normalizeDate(input) {
  if (!input) return new Date().toISOString().split('T');
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().toISOString().split('T');
  return `${m[1]}-${m[7]}-${m[8]}`;
}

function isValidType(t) {
  return t === 'movie' || t === 'series';
}

router.get('/api/review', async (req, res) => {
  const { type, id } = req.query;
  const date = normalizeDate(req.query.date);
  console.log(`[API] /api/review type=${type} id=${id} date=${date}`);

  try {
    if (!type || !id) {
      console.warn('[API] Missing type or id');
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    if (!isValidType(type)) {
      console.warn('[API] Invalid type:', type);
      return res.status(400).json({ error: 'Invalid type. Use "movie" or "series".' });
    }

    const review = await getReview(date, String(id).trim(), type);
    res.json({ review });
  } catch (err) {
    console.error('[API] Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

// routes.js — sets up Express routes for review API and integrates with api.js

const express = require('express');
const { getReview } = require('./api');

const router = express.Router();

// Endpoint to generate or fetch a review
// Example: GET /api/review?type=movie&id=550&date=2025-08-11
router.get('/api/review', async (req, res) => {
  try {
    const { type, id, date } = req.query;
    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id parameter.' });
    }
    const today = date || new Date().toISOString().split('T')[0];
    const review = await getReview(today, id, type);
    res.json({ review });
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

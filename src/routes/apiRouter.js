// src/routes/apiRouter.js — Handles all internal API routes for the frontend.

const express = require('express');
const { getReview } = require('../api');
// CHANGED: use unified storage instead of in-memory cache
const { getAllCachedReviews } = require('../core/storage');

const router = express.Router();

// Rate limiting logic for password validation
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

// --- Server-side endpoint for password validation ---
router.post('/validate-password', (req, res) => {
  const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;
  if (!ADDON_PASSWORD) {
    return res.status(403).json({ error: 'Password protection is not enabled.' });
  }

  const ip = req.ip;
  const { password } = req.body;
  const now = Date.now();
  let attempts = loginAttempts.get(ip) || { count: 0, firstAttemptTime: now, lockoutUntil: null };

  if (attempts.lockoutUntil && now < attempts.lockoutUntil) {
    const remainingLockout = Math.ceil((attempts.lockoutUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Please try again in ${remainingLockout} minutes.` });
  }

  if (password === ADDON_PASSWORD) {
    loginAttempts.delete(ip);
    const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = BASE_URL || (host ? `${proto}://${host}` : '');
    
    const manifestStremioUrl = `stremio://${base.replace(/^https?:\/\//, '')}/${ADDON_PASSWORD}/manifest.json`;
    const cacheUrl = `/${ADDON_PASSWORD}/cached-reviews`;
    
    return res.json({ manifestStremioUrl, cacheUrl });
  }

  // Incorrect password logic
  if (now - attempts.firstAttemptTime > ATTEMPT_WINDOW_MS) {
    attempts = { count: 1, firstAttemptTime: now, lockoutUntil: null };
  } else {
    attempts.count++;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    attempts.lockoutUntil = now + LOCKOUT_MS;
    loginAttempts.set(ip, attempts);
    return res.status(429).json({ error: 'Too many failed attempts. You are locked out for 10 minutes.' });
  } else {
    loginAttempts.set(ip, attempts);
    const remaining = MAX_ATTEMPTS - attempts.count;
    return res.status(401).json({ error: `Incorrect password. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` });
  }
});

// --- API for frontend to get cached reviews ---
// CHANGED: make async and await storage
router.get('/cached-reviews', async (req, res) => {
  try {
    const cachedItems = await getAllCachedReviews();
    res.json(cachedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- API for frontend to fetch a review ---
router.get('/review', async (req, res) => {
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
});

module.exports = router;

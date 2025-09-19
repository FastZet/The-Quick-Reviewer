// src/routes/apiRouter.js — Handles all internal API routes for the frontend.

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const { getAllCachedReviews } = require('../core/storage.js');
const buildReviewContent = require('../core/formatEnforcer.js'); // renamed from formatEnforcerV2
const { getReview } = require('../api.js');

const BASE_URL = process.env.BASE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

const router = express.Router();

// Password validation endpoint
if (ADDON_PASSWORD) {
  router.post('/api/validate-password', (req, res) => {
    const { password } = req.body;
    if (password === ADDON_PASSWORD) {
      const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
      const host = req.get('x-forwarded-host') || req.get('host');
      const base = BASE_URL || `${proto}://${host}`;
      const manifestStremioUrl = `${base}/${password}/manifest.json`.replace(/^https?:/, 'stremio:');
      const cacheUrl = `${base}/${password}/cached-reviews`;

      res.json({
        success: true,
        manifestStremioUrl,
        cacheUrl,
      });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  });
}

// Cached reviews API endpoint
router.get('/api/cached-reviews', async (req, res) => {
  try {
    const reviews = await getAllCachedReviews();
    res.json(reviews);
  } catch (error) {
    console.error('Error fetching cached reviews:', error);
    res.status(500).json({ error: 'Failed to fetch cached reviews' });
  }
});

// Review page endpoint
router.get('/review', async (req, res) => {
  const { type, id, force } = req.query;
  if (!type || !id) {
    return res.status(400).send('Missing required parameters: type and id');
  }

  const forceRefresh = String(force || '').toLowerCase() === 'true';
  console.log('Review page request:', { type, id, forceRefresh });

  try {
    const result = await getReview(id, type, forceRefresh);
    if (!result || !result.raw) {
      return res.status(404).send('Review not found or generation failed');
    }

    const reviewMeta = {
      title: result.title || 'Unknown',
      year: result.year || null,
      posterUrl: result.posterUrl || null,
      stillUrl: result.stillUrl || null,
      backdropUrl: result.backdropUrl || null,
    };

    const content = buildReviewContent(result.raw, reviewMeta);
    const templatePath = path.join(__dirname, '../..', 'public', 'review-quick.html');
    let template = await fs.readFile(templatePath, 'utf8');

    // Replace placeholders
    template = template
      .replace(/POSTER_CONTENT/g, content.posterContent)
      .replace(/HERO_CONTENT/g, content.heroContent)
      .replace(/SIDEBAR_CONTENT/g, content.sidebarContent)
      .replace(/MAIN_REVIEW_CARDS/g, content.mainReviewCards)
      .replace(/PLOT_SUMMARY/g, content.plotSummary)
      .replace(/OVERALL_VERDICT/g, content.overallVerdict)
      .replace(/REVIEW_TIMESTAMP/g, new Date(result.ts).toUTCString())
      .replace(/FORCEREFRESHURL/g, `?type=${type}&id=${encodeURIComponent(id)}&force=true`)
      .replace(/TOGGLEURL/g, `/review-full?type=${type}&id=${encodeURIComponent(id)}`)
      .replace(/TOGGLETEXT/g, 'Full View');

    res.send(template);
  } catch (error) {
    console.error('Error generating review page:', error);
    res.status(500).send('Internal server error');
  }
});

// Full review page endpoint  
router.get('/review-full', async (req, res) => {
  const { type, id, force } = req.query;
  if (!type || !id) {
    return res.status(400).send('Missing required parameters: type and id');
  }

  const forceRefresh = String(force || '').toLowerCase() === 'true';

  try {
    const result = await getReview(id, type, forceRefresh);
    if (!result || !result.raw) {
      return res.status(404).send('Review not found or generation failed');
    }

    const reviewMeta = {
      title: result.title || 'Unknown',
      year: result.year || null,
      posterUrl: result.posterUrl || null,
      stillUrl: result.stillUrl || null,
      backdropUrl: result.backdropUrl || null,
    };

    const content = buildReviewContent(result.raw, reviewMeta);
    const templatePath = path.join(__dirname, '../..', 'public', 'review-full.html');
    let template = await fs.readFile(templatePath, 'utf8');

    // Replace placeholders
    template = template
      .replace(/POSTER_CONTENT/g, content.posterContent)
      .replace(/HERO_CONTENT/g, content.heroContent)
      .replace(/SIDEBAR_CONTENT/g, content.sidebarContent)
      .replace(/MAIN_REVIEW_CARDS/g, content.mainReviewCards)
      .replace(/PLOT_SUMMARY/g, content.plotSummary)
      .replace(/OVERALL_VERDICT/g, content.overallVerdict)
      .replace(/REVIEW_TIMESTAMP/g, new Date(result.ts).toUTCString())
      .replace(/FORCEREFRESHURL/g, `?type=${type}&id=${encodeURIComponent(id)}&force=true`)
      .replace(/TOGGLEURL/g, `/review?type=${type}&id=${encodeURIComponent(id)}`)
      .replace(/TOGGLETEXT/g, 'Quick View');

    res.send(template);
  } catch (error) {
    console.error('Error generating full review page:', error);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;

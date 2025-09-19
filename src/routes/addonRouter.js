// src/routes/addonRouter.js
// Handles ALL Stremio and internal routes (secured and unsecured modes).
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const manifest = require('../../manifest.json');
const buildStreamResponse = require('../core/stremioStreamer.js');
const getReview = require('../api'); // FIX: use getReview (not getReviewString)
const { getAllCachedReviews } = require('../core/storage');
const buildReviewContent = require('../core/formatEnforcerV2');

const router = express.Router();

const ADDON_PASSWORD = process.env.ADDONPASSWORD || null;

// Constant for favicon links to keep HTML templates clean
const FAVICON_LINKS = `
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/favicon-16x16.png">
<link rel="manifest" href="assets/site.webmanifest">
`;

// API: review JSON
async function handleReviewApiRequest(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) return res.status(400).json({ error: 'Missing type or id parameter.' });
    if (type !== 'movie' && type !== 'series') {
      return res.status(400).json({ error: 'Invalid type.' });
    }

    const review = await getReview(id.trim(), type, forceRefresh); // FIX
    res.json(review);
  } catch (err) {
    console.error('Error in /api/review route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// API: cached reviews listing
async function handleCachedReviewsApiRequest(req, res) {
  try {
    const cachedItems = await getAllCachedReviews();
    res.json(cachedItems);
  } catch (err) {
    console.error('Error in /api/cached-reviews route:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// SSR: quick review page (hero-only view in v2)
async function handleQuickReviewPage(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) return res.status(400).send('Missing type or id in URL query.');

    const reviewData = await getReview(id.trim(), type, forceRefresh); // FIX
    if (!reviewData || !reviewData.raw) {
      return res.status(500).send('Failed to generate or retrieve review content.');
    }

    const reviewMetadata = {
      posterUrl: reviewData.posterUrl,
      stillUrl: reviewData.stillUrl,
      backdropUrl: reviewData.backdropUrl,
      title: reviewData.title,
      year: reviewData.year,
      imdbId: reviewData.imdbId,
    };

    const content = buildReviewContent(reviewData.raw, reviewMetadata);

    const templatePath = path.join(__dirname, '..', '..', 'public', 'review-quick.html');
    let html = await fs.readFile(templatePath, 'utf-8');

    // Toggle URL to full review
    const fullReviewUrl = req.originalUrl.replace('review-quick', 'review-full');

    // Force refresh URL
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    currentUrl.searchParams.set('force', 'true');
    const forceRefreshUrl = `${currentUrl.pathname}${currentUrl.search}`;

    html = html
      .replace('FAVICONLINKS', FAVICON_LINKS)
      .replace('POSTER_CONTENT', content.posterContent)
      .replace('HERO_CONTENT', content.heroContent)
      .replace('TOGGLE_URL', fullReviewUrl)
      .replace('TOGGLE_TEXT', 'Click for Full Review')
      .replace('SIDEBAR_CONTENT', content.sidebarContent)
      .replace('PLOT_SUMMARY', content.plotSummary)
      .replace('OVERALL_VERDICT', content.overallVerdict)
      .replace('TIMESTAMP', String(reviewData.ts))
      .replace('FORCE_REFRESH_URL', forceRefreshUrl);

    // Add force refresh script
    const forceRefreshScript = `
<script>
document.addEventListener('DOMContentLoaded', function () {
  const forceBtn = document.getElementById('force-refresh');
  if (forceBtn) {
    forceBtn.addEventListener('click', function (e) {
      e.preventDefault();
      forceBtn.disabled = true;
      forceBtn.innerHTML = 'Generating...';
      window.location.href = '${forceRefreshUrl}';
    });
  }
});
</script>`;
    html = html.replace('</body>', `${forceRefreshScript}</body>`);

    res.send(html);
  } catch (error) {
    console.error('SSR Error for quick review page:', error);
    res.status(500).send('Error generating quick review page.');
  }
}

// SSR: full review page (hero-only content per v2, but separate template)
async function handleFullReviewPage(req, res) {
  try {
    const { type, id } = req.query;
    const forceRefresh = req.query.force === 'true';

    if (!type || !id) return res.status(400).send('Missing type or id in URL query.');

    const reviewData = await getReview(id.trim(), type, forceRefresh); // FIX
    if (!reviewData || !reviewData.raw) {
      return res.status(500).send('Failed to generate or retrieve review content.');
    }

    const reviewMetadata = {
      posterUrl: reviewData.posterUrl,
      stillUrl: reviewData.stillUrl,
      backdropUrl: reviewData.backdropUrl,
      title: reviewData.title,
      year: reviewData.year,
      imdbId: reviewData.imdbId,
    };

    const content = buildReviewContent(reviewData.raw, reviewMetadata);

    const templatePath = path.join(__dirname, '..', '..', 'public', 'review-full.html');
    let html = await fs.readFile(templatePath, 'utf-8');

    // Toggle URL to quick review
    const quickReviewUrl = req.originalUrl.replace('review-full', 'review-quick');

    // Force refresh URL
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    currentUrl.searchParams.set('force', 'true');
    const forceRefreshUrl = `${currentUrl.pathname}${currentUrl.search}`;

    html = html
      .replace('FAVICONLINKS', FAVICON_LINKS)
      .replace('POSTER_CONTENT', content.posterContent)
      .replace('HERO_CONTENT', content.heroContent)
      .replace('TOGGLE_URL', quickReviewUrl)
      .replace('TOGGLE_TEXT', 'Click for Quick View')
      .replace('SIDEBAR_CONTENT', content.sidebarContent)
      .replace('MAIN_REVIEW_CARDS', content.mainReviewCards)
      .replace('TIMESTAMP', String(reviewData.ts))
      .replace('FORCE_REFRESH_URL', forceRefreshUrl);

    // Add force refresh script
    const forceRefreshScript = `
<script>
document.addEventListener('DOMContentLoaded', function () {
  const forceBtn = document.getElementById('force-refresh');
  if (forceBtn) {
    forceBtn.addEventListener('click', function (e) {
      e.preventDefault();
      forceBtn.disabled = true;
      forceBtn.innerHTML = 'Generating...';
      window.location.href = '${forceRefreshUrl}';
    });
  }
});
</script>`;
    html = html.replace('</body>', `${forceRefreshScript}</body>`);

    res.send(html);
  } catch (error) {
    console.error('SSR Error for full review page:', error);
    res.status(500).send('Error generating full review page.');
  }
}

// Static cached reviews page
function handleCachedReviewsPageRequest(req, res) {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'cached-reviews.html'));
}

// Route wiring (secured vs unsecured)
if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. All functional routes are password-protected.');

  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));
  router.get(`${secretPath}/stream/:type/:id.json`, (req, res) =>
    buildStreamResponse(req).then((data) => res.json(data))
  );

  // New review page routes
  router.get(`${secretPath}/review`, (req, res) =>
    res.redirect(301, req.originalUrl.replace('review', 'review-quick'))
  );
  router.get(`${secretPath}/review-quick`, handleQuickReviewPage);
  router.get(`${secretPath}/review-full`, handleFullReviewPage);
  router.get(`${secretPath}/cached-reviews`, handleCachedReviewsPageRequest);

  // Internal APIs
  router.get(`${secretPath}/api/review`, handleReviewApiRequest);
  router.get(`${secretPath}/api/cached-reviews`, handleCachedReviewsApiRequest);

  // Public endpoints forbidden when secured
  const forbidden = (_req, res) =>
    res.status(403).send('You are not authorized. Contact the administrator.');
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
  router.get('/manifest.json', (req, res) => res.json(manifest));
  router.get('/stream/:type/:id.json', (req, res) =>
    buildStreamResponse(req).then((data) => res.json(data))
  );

  // New review page routes
  router.get('/review', (req, res) =>
    res.redirect(301, req.originalUrl.replace('review', 'review-quick'))
  );
  router.get('/review-quick', handleQuickReviewPage);
  router.get('/review-full', handleFullReviewPage);

  // Static page
  router.get('/cached-reviews', handleCachedReviewsPageRequest);

  // Internal APIs
  router.get('/api/review', handleReviewApiRequest);
  router.get('/api/cached-reviews', handleCachedReviewsApiRequest);
}

module.exports = router;

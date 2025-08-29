// src/routes/addonRouter.js — Handles all Stremio client-facing routes.

const express = require('express');
const path = require('path');
const manifest = require('../../manifest.json');
const { buildStreamResponse } = require('../core/stremioStreamer.js');

const router = express.Router();
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;

const handleStreamRequest = async (req, res) => {
  const streamData = await buildStreamResponse(req);
  res.json(streamData);
};

if (ADDON_PASSWORD) {
  const secretPath = `/${ADDON_PASSWORD}`;
  console.log('Addon is SECURED. Stremio routes are password-protected.');
  
  router.get(`${secretPath}/manifest.json`, (req, res) => res.json(manifest));
  router.get(`${secretPath}/stream/:type/:id.json`, handleStreamRequest);
  
  // Also serve the cached-reviews page under the secret path
  router.get(`${secretPath}/cached-reviews`, (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'cached-reviews.html'));
  });

} else {
  console.log('Addon is UNSECURED.');
  router.get('/manifest.json', (req, res) => res.json(manifest));
  router.get('/stream/:type/:id.json', handleStreamRequest);
}

module.exports = router;

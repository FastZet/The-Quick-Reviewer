// index.js — main entry point combining server, routes, and addon logic

const express = require('express');
const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest.json');
const reviewRoutes = require('./routes');

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;

// Build Stremio addon
const builder = new addonBuilder(manifest);

builder.defineStreamHandler((args) => {
  const { id, type } = args;
  // Use absolute URL if BASE_URL is provided, else relative path
  const reviewPath = `/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  const reviewUrl = BASE_URL ? `${BASE_URL.replace(/\/+$/, '')}${reviewPath}` : reviewPath;

  return Promise.resolve([
    {
      id: `quick-reviewer-${type}-${id}`,
      title: 'Quick AI Review',
      url: reviewUrl,
      isRemote: true,
      poster: manifest.icon || undefined,
    }
  ]);
});

const addonInterface = builder.getInterface();

// Express app
const app = express();

// Static public files
app.use(express.static(path.join(__dirname, 'public')));

// Manifest endpoint
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Review HTML page route
app.get('/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// API routes
app.use(reviewRoutes);

// Addon interface routes
app.use('/', addonInterface);

// Health check
app.get('/health', (req, res) => res.send('OK'));

// CORS headers to ensure Stremio client compatibility
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.listen(PORT, () => {
  console.log(`Quick Reviewer Addon running on port ${PORT}`);
  if (BASE_URL) console.log(`Base URL (env): ${BASE_URL}`);
});

module.exports = app;

// src/core/stremioStreamer.js
// Builds Stremio stream objects. Returns two streams:
// 1) Summary stream - title is exactly 8 lines (the 8 bullets), nothing else.
// 2) Review stream - multi-line title with the one-line verdict.

const manifest = require('../../manifest.json');
const { getReview } = require('../api.js');

// Robustly resolve buildStreamTitle regardless of export shape
const titleMod = require('./streamTitleBuilder.js');
const buildStreamTitle = 
  typeof titleMod === 'function' ? titleMod :
  (titleMod && typeof titleMod.buildStreamTitle === 'function' ? titleMod.buildStreamTitle :
  (titleMod && typeof titleMod.default === 'function' ? titleMod.default : null));

if (!buildStreamTitle) {
  throw new Error('streamTitleBuilder.js does not export a callable buildStreamTitle');
}

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || process.env.ADDON_PASSWORD || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS || process.env.ADDON_TIMEOUT_MS || '13000', 10);

function resolveBaseUrl(req) {
  if (BASE_URL) return BASE_URL.replace(/\/$/, '');
  
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function buildReviewUrl(base, type, id) {
  const pathPrefix = ADDON_PASSWORD ? `/${ADDON_PASSWORD}` : '';
  return `${base}${pathPrefix}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

function joinSummaryLines(summary8) {
  if (!Array.isArray(summary8) || summary8.length !== 8) return null;
  return summary8.join('\n');
}

async function buildStreamResponse(req) {
  const { type, id } = req.params;
  const base = resolveBaseUrl(req);
  const reviewUrl = buildReviewUrl(base, String(type).trim(), String(id).trim());
  
  const baseStream = {
    name: 'The Quick Reviewer',
    poster: manifest.icon || undefined,
    behaviorHints: { notWebReady: true }
  };

  try {
    // First check if we have cached data (quick check without timeout)
    const cachedData = await getReview(String(id).trim(), String(type).trim(), false).catch(() => null);
    
    if (cachedData && cachedData.review && cachedData.review !== "Error: Review generation failed.") {
      // We have valid cached data, return proper streams immediately
      const streams = [];
      
      const summaryTitle = joinSummaryLines(cachedData?.summary8) || null;
      if (summaryTitle) {
        streams.push({
          id: `quick-reviewer-summary-${type}-${id}`,
          title: summaryTitle,
          externalUrl: reviewUrl,
          ...baseStream
        });
      }
      
      const verdict = cachedData?.verdict || null;
      streams.push({
        id: `quick-reviewer-${type}-${id}`,
        title: buildStreamTitle(verdict),
        externalUrl: reviewUrl,
        ...baseStream
      });
      
      return { streams };
    }
    
    // No cached data, try generation with timeout for new requests only
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ADDON_TIMEOUT_MS)
    );
    
    const reviewData = await Promise.race([
      getReview(String(id).trim(), String(type).trim(), false),
      timeoutPromise
    ]);
    
    const streams = [];
    
    const summaryTitle = joinSummaryLines(reviewData?.summary8) || null;
    if (summaryTitle) {
      streams.push({
        id: `quick-reviewer-summary-${type}-${id}`,
        title: summaryTitle,
        externalUrl: reviewUrl,
        ...baseStream
      });
    }
    
    const verdict = reviewData?.verdict || null;
    streams.push({
      id: `quick-reviewer-${type}-${id}`,
      title: buildStreamTitle(verdict),
      externalUrl: reviewUrl,
      ...baseStream
    });
    
    return { streams };
  } catch (error) {
    const timedOut = error && error.message === 'Timeout';
    return {
      streams: [{
        id: `quick-reviewer-${type}-${id}`,
        title: buildStreamTitle(null, { timedOut }),
        externalUrl: reviewUrl,
        ...baseStream
      }]
    };
  }
}

module.exports = buildStreamResponse;

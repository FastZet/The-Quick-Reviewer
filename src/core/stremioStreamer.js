// src/core/stremioStreamer.js — Contains the core logic for building the Stremio stream object.

const manifest = require('../../manifest.json');
const { getReview } = require('../api.js');
const { parseVerdictFromReview } = require('./reviewParser.js');
const { buildStreamTitle } = require('./streamTitleBuilder.js');

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS, 10) || 14000;

async function buildStreamResponse(req) {
  const { type, id } = req.params;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const streamPayload = {
    id: `quick-reviewer-${type}-${id}`,
    title: '',
    name: 'The Quick Reviewer',
    externalUrl: reviewUrl,
    poster: manifest.icon || undefined,
    behaviorHints: { "notWebReady": true }
  };

  try {
    console.log(`[Stream] Received request for ${id}. Starting review generation/retrieval...`);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ADDON_TIMEOUT_MS)
    );

    const reviewText = await Promise.race([
      getReview(String(id).trim(), type, false),
      timeoutPromise
    ]);

    const verdict = parseVerdictFromReview(reviewText);
    streamPayload.title = buildStreamTitle(verdict);
    
    if (verdict) {
      console.log(`[Stream] Generation for ${id} SUCCEEDED. Found clean verdict.`);
    } else {
      console.log(`[Stream] Generation for ${id} finished, but no verdict was parsed. Using fallback title structure.`);
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      console.warn(`[Stream] Generation for ${id} TIMED OUT at ${ADDON_TIMEOUT_MS}ms. Responding with fallback title, but generation continues in background.`);
      streamPayload.title = buildStreamTitle(null, { timedOut: true });
    } else {
      console.error(`[Stream] Generation for ${id} FAILED with an UNEXPECTED error:`, error.message);
      streamPayload.title = buildStreamTitle(null);
    }
  }

  return { streams: [streamPayload] };
}

module.exports = { buildStreamResponse };

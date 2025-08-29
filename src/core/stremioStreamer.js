// src/core/stremioStreamer.js — Contains the core logic for building the Stremio stream object.

const manifest = require('../../manifest.json');
const { getReview } = require('../api.js');
const { parseVerdictFromReview } = require('./reviewParser.js');

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS, 10) || 15000;

async function buildStreamResponse(req) {
  const { type, id } = req.params;

  // 1. Define the complete stream object with fallback values first.
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const reviewUrl = `${base}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const streamPayload = {
    id: `quick-reviewer-${type}-${id}`,
    title: '⚡ Click To Read The Quick AI Review',
    name: 'The Quick Reviewer', // Default fallback title
    externalUrl: reviewUrl,
    poster: manifest.icon || undefined,
    behaviorHints: { "notWebReady": true }
  };

  try {
    console.log(`[Stream] Received request for ${id}. Starting review generation/retrieval...`);

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ADDON_TIMEOUT_MS)
    );

    // 2. Race the review generation against the timeout.
    const reviewText = await Promise.race([
      getReview(String(id).trim(), type, false),
      timeoutPromise
    ]);

    // 3. If the race is won, attempt to parse the verdict and modify the payload.
    const verdict = parseVerdictFromReview(reviewText);
    if (verdict) {
      streamPayload.title = `⚡ Verdict: ${verdict} (Click to read full review)`;
      streamPayload.name = 'The Quick Reviewer';
      console.log(`[Stream] Generation for ${id} SUCCEEDED. Found verdict.`);
    } else {
      console.log(`[Stream] Generation for ${id} finished, but no verdict was parsed. Using fallback title.`);
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      console.warn(`[Stream] Generation for ${id} TIMED OUT. Responding with fallback title, but generation continues in background.`);
    } else {
      console.error(`[Stream] Generation for ${id} FAILED with an UNEXPECTED error:`, error.message);
    }
  }

  // 4. Finally, return the stream object.
  return { streams: [streamPayload] };
}

module.exports = { buildStreamResponse };

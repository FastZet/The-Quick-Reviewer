// src/core/stremioStreamer.js — Contains the core logic for building the Stremio stream object.

'use strict';

const manifest = require('../../manifest.json');
const { getReview } = require('../api.js');
// buildStreamTitle is kept for compatibility if used elsewhere
const { buildStreamTitle } = require('./streamTitleBuilder.js');

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS, 10) || 13000;

/**
 * Extract exactly 8 evaluative bullets (<= 25 chars each) from the AI text.
 * Returns a best-effort fallback if strict extraction fails.
 */
function extract8PointSummary(rawReviewText) {
  if (!rawReviewText) return [];

  try {
    // Prefer an explicit 8-Point block if present
    const block = rawReviewText.match(/8-Point Summary:(.*?)(?:\n\n|\n•|\n[A-Z]|$)/s);
    if (block) {
      const points = block[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('•'))
        .map(l => l.replace(/^•\s*/, '').trim().slice(0, 25))
        .slice(0, 8);

      if (points.length === 8) return points;
    }

    // Newer layout: eight bullets immediately after Release Country
    const afterIntro = rawReviewText.match(/Release Country:.*?\n((?:•[^\n]{1,25}\n?){8})/s);
    if (afterIntro) {
      const points = afterIntro[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('•'))
        .map(l => l.replace(/^•\s*/, '').trim().slice(0, 25))
        .slice(0, 8);

      if (points.length === 8) return points;
    }

    // Fallback: derive short judgements from strengths/weaknesses/verdict
    const out = [];

    const oneLineVerdict = (rawReviewText.match(/Verdict in One Line[:\s]*([^\n]+)/i) || [])[1];
    if (oneLineVerdict) {
      const words = oneLineVerdict.trim().split(/\s+/);
      if (words.length > 6) {
        out.push(words.slice(0, 4).join(' '));
        out.push(words.slice(4, 8).join(' '));
      } else {
        out.push(oneLineVerdict.trim().slice(0, 25));
      }
    }

    const strengths = (rawReviewText.match(/Strengths[:\s]*([\s\S]*?)(?:\n•\s*\*\*|\n[A-Z]|\n$)/i) || [])[1];
    if (strengths) {
      strengths
        .split(/[.;]/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .forEach(s => { if (out.length < 6) out.push(s.slice(0, 25)); });
    }

    const weaknesses = (rawReviewText.match(/Weaknesses[:\s]*([\s\S]*?)(?:\n•\s*\*\*|\n[A-Z]|\n$)/i) || [])[1];
    if (weaknesses) {
      weaknesses
        .split(/[.;]/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .forEach(s => { if (out.length < 8) out.push(s.slice(0, 25)); });
    }

    const pad = ['Mixed execution', 'Some highlights', 'Worth considering'];
    for (let i = 0; i < pad.length && out.length < 8; i++) out.push(pad[i]);

    return out.slice(0, 8);
  } catch (err) {
    console.warn('[Stream] 8-point extraction error:', err?.message || err);
    return [
      'Review available',
      'Click for details',
      'AI analysis ready',
      'Critical snapshot',
      'Spoiler-free',
      'Pros & cons',
      'Quick insights',
      'Open to read'
    ];
  }
}

/**
 * First stream: render ONLY the eight bullets, no header line.
 */
function build8PointStreamTitle(points) {
  if (!points || points.length === 0) {
    // Minimal fallback still without any header
    return ['● Review ready', '● Open to read', '● AI summary', '● No spoilers', '● Highlights', '● Drawbacks', '● Verdict soon', '● Tap to view'].join('\n');
  }
  return points.map(p => `● ${p}`).join('\n');
}

/**
 * Build a single-line verdict for stream #2.
 */
function buildSingleLineVerdict(verdict) {
  if (!verdict || !verdict.trim()) return 'Quick verdict ready';
  // Squeeze to one line, strip newlines
  return verdict.replace(/\s+/g, ' ').trim();
}

/**
 * Build a two-line verdict for stream #3.
 * - Prefer splitting across sentences/punctuation.
 * - Else split near the middle on a space.
 */
function buildTwoLineVerdict(verdict) {
  if (!verdict || !verdict.trim()) return 'Complete verdict\nOpen for details';

  const text = verdict.replace(/\s+/g, ' ').trim();

  // Try sentence split
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) {
    return `${sentences[0]}\n${sentences[1]}`;
  }

  // Try punctuation-based chunking
  const parts = text.split(/[,;–—-]\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}\n${parts.slice(1).join(', ')}`;
  }

  // Split near the middle on whitespace
  const mid = Math.floor(text.length / 2);
  const splitAt = text.indexOf(' ', mid);
  if (splitAt > 0 && splitAt < text.length - 1) {
    return `${text.slice(0, splitAt)}\n${text.slice(splitAt + 1)}`;
  }

  // Fallback: duplicate with a nuance marker
  return `${text}\n(extended view)`;
}

async function buildStreamResponse(req) {
  const { type, id } = req.params;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const secretPath = ADDON_PASSWORD ? `/${ADDON_PASSWORD}` : '';

  const quickUrl = `${base}${secretPath}/review-quick?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  const fullUrl = `${base}${secretPath}/review-full?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  const baseStreamConfig = {
    name: 'The Quick Reviewer',
    poster: manifest.icon || undefined,
    behaviorHints: { notWebReady: true }
  };

  let reviewData = null;
  let eight = [];

  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ADDON_TIMEOUT_MS));
    reviewData = await Promise.race([getReview(String(id).trim(), type, false), timeout]);
    if (reviewData && reviewData.raw) {
      eight = extract8PointSummary(reviewData.raw);
    }
  } catch (err) {
    console.warn('[Stream] Generation failed or timed out:', err?.message || err);
  }

  // Stream 1: Only the 8 points (no header line)
  const s1 = {
    id: `tqr-8pt-${type}-${id}`,
    title: build8PointStreamTitle(eight),
    externalUrl: quickUrl,
    ...baseStreamConfig
  };

  // Stream 2: One-line verdict, then explicit CTA line
  const s2 = {
    id: `tqr-quick-${type}-${id}`,
    title: `${buildSingleLineVerdict(reviewData?.verdict)}\nClick here for the quick ai review`,
    externalUrl: quickUrl,
    ...baseStreamConfig
  };

  // Stream 3: Two-line verdict (both lines are verdict content)
  const s3 = {
    id: `tqr-full-${type}-${id}`,
    title: buildTwoLineVerdict(reviewData?.verdict),
    externalUrl: fullUrl,
    ...baseStreamConfig
  };

  return { streams: [s1, s2, s3] };
}

module.exports = { buildStreamResponse };

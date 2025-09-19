// src/core/stremioStreamer.js
// Builds Stremio stream objects that open the addon’s review pages.
// - Uses underscore env vars only (BASE_URL, ADDON_PASSWORD, ADDON_TIMEOUT_MS).
// - Imports getReview correctly from api.js.
// - Returns three streams: 8-point summary, one-line verdict, two-line verdict.
// - Uses a timeout race to avoid blocking Stremio if generation is slow.

'use strict';

const buildStreamTitle = require('./streamTitleBuilder.js'); // kept for potential reuse
const { getReview } = require('../api.js');

// Canonical envs
const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS || '13000', 10);

// Extract exactly 8 evaluative bullets (<=25 chars each) from the AI text.
function extract8PointSummary(rawReviewText) {
  if (!rawReviewText) {
    return [
      'Review available', 'Click for details', 'AI analysis ready', 'Critical snapshot',
      'Spoiler-free', 'Pros & cons', 'Quick insights', 'Open to read'
    ];
  }
  try {
    // Prefer an explicit 8-Point block if present
    const block = rawReviewText.match(/8-Point Summary([\s\S]*?)(?:\n\s*[.•-]\s*\*\*\*|$)/i);
    if (block) {
      const points = block[1]
        .split('\n')
        .map(l => l.trim())
        .filter(l => /^[-•.]\s/.test(l))
        .map(l => l.replace(/^[-•.]\s*/, '').trim().slice(0, 25))
        .slice(0, 8);
      if (points.length === 8) return points;
    }

    // Newer layout: eight bullets immediately after "Release Country"
    const afterIntro = rawReviewText.match(/Release Country[\s\S]{0,2000}/i);
    if (afterIntro) {
      const points = afterIntro[0]
        .split('\n')
        .map(l => l.trim())
        .filter(l => /^[-•.]\s/.test(l))
        .map(l => l.replace(/^[-•.]\s*/, '').trim().slice(0, 25))
        .slice(0, 8);
      if (points.length === 8) return points;
    }

    // Fallback: derive short judgements from strengths/weaknesses/verdict
    const out = [];
    const verdictMatch = rawReviewText.match(/Verdict in One Line\s*([\s\S]*?)(?:\n{2,}|\r{2,}|$)/i);
    const verdict = verdictMatch ? String(verdictMatch[1]).trim() : null;

    if (verdict) {
      const words = verdict.split(/\s+/);
      if (words.length >= 6) {
        out.push(words.slice(0, 4).join(' ').slice(0, 25));
        out.push(words.slice(4, 8).join(' ').slice(0, 25));
      } else {
        out.push(verdict.slice(0, 25));
      }
    }

    const strengths = (rawReviewText.match(/Strengths([\s\S]*?)(?:\n\s*\*\*\*|$)/i)?.[1] || '')
      .split(/[.•-]\s/g).map(s => s.trim()).filter(Boolean).slice(0, 3);
    strengths.forEach(s => { if (out.length < 6) out.push(s.slice(0, 25)); });

    const weaknesses = (rawReviewText.match(/Weaknesses([\s\S]*?)(?:\n\s*\*\*\*|$)/i)?.[1] || '')
      .split(/[.•-]\s/g).map(s => s.trim()).filter(Boolean).slice(0, 3);
    weaknesses.forEach(s => { if (out.length < 8) out.push(s.slice(0, 25)); });

    const pad = ['Mixed execution', 'Some highlights', 'Worth considering'];
    for (let i = 0; i < pad.length && out.length < 8; i++) out.push(pad[i]);

    return out.slice(0, 8);
  } catch (err) {
    console.warn('Stream 8-point extraction error:', err?.message || err);
    return [
      'Review ready', 'Open to read', 'AI summary', 'No spoilers',
      'Highlights', 'Drawbacks', 'Verdict soon', 'Tap to view'
    ];
  }
}

// Stream 1: Only the 8 points (no header line)
function build8PointStreamTitle(points) {
  if (!points || points.length === 0) {
    return [
      'Review ready', 'Open to read', 'AI summary', 'No spoilers',
      'Highlights', 'Drawbacks', 'Verdict soon', 'Tap to view'
    ].join(', ');
  }
  return points.map(p => p.trim()).join(', ');
}

// Stream 2: Single-line verdict (then CTA in Stremio’s UI)
function buildSingleLineVerdict(verdict) {
  if (!verdict || !verdict.trim()) return 'Quick verdict ready';
  return verdict.replace(/\s+/g, ' ').trim();
}

// Stream 3: Two-line verdict (split across sentences or near middle)
function buildTwoLineVerdict(verdict) {
  if (!verdict || !verdict.trim()) return 'Complete verdict\nfor details';
  const text = verdict.replace(/\s+/g, ' ').trim();

  // Try sentence split
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) return `${sentences[0]}\n${sentences[1]}`;

  // Try punctuation-based chunking
  const parts = text.split(/[–—\-,:;]\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}\n${parts.slice(1).join(' ')}`;

  // Split near the middle on whitespace
  const mid = Math.floor(text.length / 2);
  const splitAt = text.indexOf(' ', mid);
  if (splitAt > 0 && splitAt < text.length - 1) {
    return `${text.slice(0, splitAt)}\n${text.slice(splitAt + 1)}`;
  }

  // Fallback
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
    poster: undefined,
    behaviorHints: { notWebReady: true },
  };

  let reviewData = null;
  let eight = null;

  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ADDON_TIMEOUT_MS));
    reviewData = await Promise.race([
      getReview(id.trim(), type, false), // do not force in the stream call
      timeout,
    ]);
    if (reviewData && reviewData.raw) {
      eight = extract8PointSummary(reviewData.raw);
    }
  } catch (err) {
    console.warn('Stream generation failed or timed out:', err?.message || err);
  }

  // Stream 1: Only the 8 points (no header)
  const s1 = {
    id: `tqr-8pt-${type}-${id}`,
    title: build8PointStreamTitle(eight),
    externalUrl: quickUrl,
    ...baseStreamConfig,
  };

  // Stream 2: One-line verdict
  const s2 = {
    id: `tqr-quick-${type}-${id}`,
    title: buildSingleLineVerdict(reviewData?.verdict),
    externalUrl: quickUrl,
    ...baseStreamConfig,
  };

  // Stream 3: Two-line verdict
  const s3 = {
    id: `tqr-full-${type}-${id}`,
    title: buildTwoLineVerdict(reviewData?.verdict),
    externalUrl: fullUrl,
    ...baseStreamConfig,
  };

  return { streams: [s1, s2, s3] };
}

module.exports = buildStreamResponse;

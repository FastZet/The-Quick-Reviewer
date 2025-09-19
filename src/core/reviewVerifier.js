// src/core/reviewVerifier.js — Validates AI output format for The Quick Reviewer.

'use strict';

const DEBUG = String(process.env.REVIEW_VERIFY_DEBUG || 'false').toLowerCase() === 'true';
function vlog(...args) { if (DEBUG) console.log('Verify:', ...args); }

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Generic matcher for bullet headings like "• Heading -" content
function headingExists(text, heading) {
  const pattern = new RegExp(String.raw`${escapeRegExp(heading)}\s*\-`, 'mi');
  return pattern.test(text);
}

// Extracts lines immediately following the "8-Point Summary" header that begin with a bullet.
// Returns an array of bullet texts (without the bullet symbol).
function extract8PointBullets(text) {
  const headerRe = /8-Point Summary/mi;
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return [];

  const startIdx = headerMatch.index + headerMatch[0].length;
  const tail = text.slice(startIdx);

  // Stop when the next section heading ("• Title -") begins or end of string
  const stopIdx = tail.search(/\n\s*•\s*[A-Z][^\n]*\-\s*|$/m);
  const body = (stopIdx > 0) ? tail.slice(0, stopIdx) : tail;

  const bullets = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*[-•]\s*(.*)$/);
    if (m) bullets.push(m[1].trim());
  }
  return bullets;
}

// Optional: validates a dedicated "Two-Line Verdict" block when present.
function validateTwoLineVerdict(text) {
  const header = text.match(/Two-Line Verdict/mi);
  if (!header) return true; // optional
  const start = header.index + header[0].length;
  const tail = text.slice(start);

  // Grab the next two bullet lines only
  const bulletRe = /^\s*[-•]\s*(.*)$/gim;
  const found = [];
  let m;
  while ((m = bulletRe.exec(tail)) && found.length < 2) found.push(m[1].trim());

  if (found.length !== 2) {
    vlog('Two-Line Verdict present but not exactly two bullets');
    return false;
  }

  // Lightweight length constraints (80 chars each), no emojis
  const bad = found.some((s) => s.length === 0 || s.length > 80 || /[\u{1F300}-\u{1FAFF}]/u.test(s));
  if (bad) {
    vlog('Two-Line Verdict bullets violate length/content constraints');
    return false;
  }
  return true;
}

function verify8PointSummary(text) {
  if (!/8-Point Summary/mi.test(text)) {
    vlog('Missing or malformed 8-Point Summary heading line');
    return false;
  }
  const bullets = extract8PointBullets(text);
  if (bullets.length !== 8) {
    vlog('8-Point Summary count != 8, got', bullets.length);
    return false;
  }
  for (const b of bullets) {
    if (b.length === 0 || b.length > 25) {
      vlog('8-Point bullet length violation:', b);
      return false;
    }
    // Discourage category labels like "Plot", "Acting", "Visuals"
    if (/(^plot$|^acting$|visuals|cinematography|writing|direction|pacing)/i.test(b)) {
      vlog('8-Point bullet looks like a labeled category:', b);
      return false;
    }
  }
  return true;
}

/**
 * verifyReviewFormat(raw, type) - Validates presence of required sections with merged headings.
 * - Enforces 8-Point Summary constraints.
 * - Accepts "Audience Reception" with or without "(Reaction)".
 * - "Two-Line Verdict" block is optional but validated if present.
 */
function verifyReviewFormat(raw, type) {
  if (!raw || typeof raw !== 'string') return false;

  // Basic identity blocks: either Movie or Series/Episode
  const hasMovieName = headingExists(raw, 'Name Of The Movie');
  const hasSeriesName = headingExists(raw, 'Name Of The Series');
  const hasEpisodeName = headingExists(raw, 'Name Of The Episode');
  const hasSeasonEpisode = headingExists(raw, 'Season Episode');
  const isEpisodeExpected = (type === 'series') && hasSeriesName && hasEpisodeName && hasSeasonEpisode;

  // Basic info (common)
  const basicsOk =
    (hasMovieName || hasSeriesName) &&
    headingExists(raw, 'Casts') &&
    headingExists(raw, 'Directed By') &&
    headingExists(raw, 'Genre') &&
    headingExists(raw, 'Released On') &&
    headingExists(raw, 'Release Medium') &&
    headingExists(raw, 'Release Country');

  if (!basicsOk) {
    vlog('Basic info blocks missing');
    return false;
  }

  // Episode specifics (if applicable)
  if (isEpisodeExpected) {
    if (!hasSeriesName || !hasEpisodeName || !hasSeasonEpisode) {
      vlog('Episode identity blocks missing (series/episode/season-episode)');
      return false;
    }
  }

  // Merged analysis sections
  const mergedOk =
    headingExists(raw, 'Plot Summary') &&
    headingExists(raw, 'Story Writing') &&
    headingExists(raw, 'Performances Characters') &&
    headingExists(raw, 'Direction Pacing') &&
    headingExists(raw, 'Visuals Sound');

  if (!mergedOk) {
    vlog('One or more merged analysis sections missing');
    return false;
  }

  // Response and numbers sections
  const criticsOk = headingExists(raw, 'Critical Reception');
  const audienceOk = headingExists(raw, 'Audience Reception (Reaction)') || headingExists(raw, 'Audience Reception');
  const boOk = headingExists(raw, 'Box Office and Viewership');
  const strengthsOk = headingExists(raw, 'Strengths');
  const weaknessesOk = headingExists(raw, 'Weaknesses');

  if (!criticsOk || !audienceOk || !boOk || !strengthsOk || !weaknessesOk) {
    vlog('Reception/box-office/strengths/weaknesses blocks missing');
    return false;
  }

  // Closing sections (rating includes placeholder span)
  const closingOk =
    headingExists(raw, 'Overall Verdict') &&
    /Rating\s*\-\s*\d+(\.\d+)?\/10.*?<span id="rating-context-placeholder"><\/span>/mi.test(raw) &&
    headingExists(raw, 'Verdict in One Line');

  if (!closingOk) {
    vlog('Closing blocks (Overall/Rating/Verdict in One Line) missing or malformed');
    return false;
  }

  // 8-Point Summary rules
  if (!verify8PointSummary(raw)) return false;

  // Optional Two-Line Verdict block
  if (!validateTwoLineVerdict(raw)) return false;

  return true;
}

module.exports = verifyReviewFormat;

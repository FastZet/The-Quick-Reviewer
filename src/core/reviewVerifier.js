// src/core/reviewVerifier.js — Validates AI output format for The Quick Reviewer.

'use strict';

const DEBUG =
  String(process.env.REVIEW_VERIFY_DEBUG || 'false').toLowerCase() === 'true';

function vlog(...args) {
  if (DEBUG) console.log('[Verify]', ...args);
}

// Generic matcher for bullet headings like: • **Heading:** content
function headingExists(text, heading) {
  const pattern = new RegExp(
    String.raw`^\s*•\s*\*\*\s*${escapeRegExp(heading)}\s*\*\*\s*:\s*.+`,
    'mi'
  );
  return pattern.test(text);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extracts lines immediately following the "8-Point Summary" header that begin with a bullet.
// Returns an array of bullet texts (without the bullet symbol).
function extract8PointBullets(text) {
  // Find the header line
  const headerRe = /^\s*•\s*\*\*\s*8-Point Summary\s*\*\*\s*:\s*$/mi;
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return [];

  // Slice from after header match
  const startIdx = headerMatch.index + headerMatch[0].length;

  // Take the following lines until the next bold heading bullet or end of string
  const tail = text.slice(startIdx);

  // Stop when we hit another bold heading bullet (e.g., • **Plot Summary:**)
  const stopIdx = tail.search(/^\s*•\s*\*\*.+?\*\*\s*:/m);
  const body = stopIdx >= 0 ? tail.slice(0, stopIdx) : tail;

  // Collect bullet lines (• line)
  const bullets = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*•\s*(.+?)\s*$/);
    if (m && m[1]) bullets.push(m[1].trim());
  }
  return bullets;
}

// Optional: validates a dedicated Two-Line Verdict block when present.
function validateTwoLineVerdict(text) {
  const headerRe = /^\s*•\s*\*\*\s*Two-Line Verdict\s*\*\*\s*:\s*$/mi;
  const header = text.match(headerRe);
  if (!header) return true; // optional

  const start = header.index + header[0].length;
  const tail = text.slice(start);

  // Grab the next two bullet lines only
  const bulletRe = /^\s*•\s*(.+?)\s*$/gim;
  const found = [];
  let m;
  while ((m = bulletRe.exec(tail)) !== null && found.length < 2) {
    found.push((m[1] || '').trim());
  }

  if (found.length !== 2) {
    vlog('Two-Line Verdict present but not exactly two bullets');
    return false;
  }

  // Lightweight length constraints (<= 80 chars each, no emojis/hashtags)
  const bad = found.some(
    (s) =>
      s.length === 0 ||
      s.length > 80 ||
      /[#\u{1F300}-\u{1FAFF}]/u.test(s)
  );
  if (bad) {
    vlog('Two-Line Verdict bullets violate length/content constraints');
    return false;
  }
  return true;
}

function verify8PointSummary(text) {
  // Header line must exist alone (no content after colon on same line)
  const headerAlone = /^\s*•\s*\*\*\s*8-Point Summary\s*\*\*\s*:\s*$/mi.test(text);
  if (!headerAlone) {
    vlog('Missing or malformed "8-Point Summary" heading line');
    return false;
  }

  const bullets = extract8PointBullets(text);
  if (bullets.length !== 8) {
    vlog(`8-Point Summary count != 8 (got ${bullets.length})`);
    return false;
  }

  // Each bullet must be evaluative and short (<= 25 chars)
  for (const b of bullets) {
    if (b.length === 0 || b.length > 25) {
      vlog('8-Point bullet length violation:', b);
      return false;
    }
    // Discourage category labels like "Plot:" "Acting:" "Visuals:"
    if (/^\s*(plot|acting|visuals?|cinematography|writing|direction|pacing)\s*:/i.test(b)) {
      vlog('8-Point bullet looks like a labeled category:', b);
      return false;
    }
  }
  return true;
}

/**
 * verifyReviewFormat(raw, type)
 * - Validates presence of required sections with merged headings.
 * - Enforces 8-Point Summary constraints.
 * - Accepts Audience Reception with or without "& Reaction".
 * - Two-Line Verdict block is optional but validated if present.
 */
function verifyReviewFormat(raw, type) {
  if (!raw || typeof raw !== 'string') return false;

  // Basic identity blocks (either Movie or Series + Episode)
  const hasMovieName = headingExists(raw, 'Name Of The Movie');
  const hasSeriesName = headingExists(raw, 'Name Of The Series');
  const hasEpisodeName = headingExists(raw, 'Name Of The Episode');
  const hasSeasonEpisode = headingExists(raw, 'Season & Episode');

  const isEpisodeExpected = type === 'series' && (hasSeriesName || hasEpisodeName || hasSeasonEpisode);

  // Basic info common
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

  // Episode specifics if looks like episode
  if (isEpisodeExpected) {
    if (!(hasSeriesName && hasEpisodeName && hasSeasonEpisode)) {
      vlog('Episode identity blocks missing (series/episode/season-episode)');
      return false;
    }
  }

  // Merged analysis sections
  const mergedOk =
    headingExists(raw, 'Plot Summary') &&
    headingExists(raw, 'Story & Writing') &&
    headingExists(raw, 'Performances & Characters') &&
    headingExists(raw, 'Direction & Pacing') &&
    headingExists(raw, 'Visuals & Sound');

  if (!mergedOk) {
    vlog('One or more merged analysis sections missing');
    return false;
  }

  // Response and numbers sections
  const criticsOk = headingExists(raw, 'Critical Reception');
  const audienceOk =
    headingExists(raw, 'Audience Reception & Reaction') ||
    headingExists(raw, 'Audience Reception');
  const boOk = headingExists(raw, 'Box Office and Viewership');
  const strengthsOk = headingExists(raw, 'Strengths');
  const weaknessesOk = headingExists(raw, 'Weaknesses');

  if (!(criticsOk && audienceOk && boOk && strengthsOk && weaknessesOk)) {
    vlog('Reception/box-office/strengths/weaknesses blocks missing');
    return false;
  }

  // Closing sections
  const closingOk =
    headingExists(raw, 'Overall Verdict') &&
    /(^|\n)\s*Rating:\s*\d+(?:\.\d+)?\s*\/\s*10\s*(?:<span[^>]*id\s*=\s*["']rating-context-placeholder["'][^>]*>\s*<\/span>)?/mi.test(
      raw
    ) &&
    headingExists(raw, 'Verdict in One Line');

  if (!closingOk) {
    vlog('Closing blocks (Overall/Ratings/Verdict in One Line) missing or malformed');
    return false;
  }

  // 8-Point Summary hard rules
  if (!verify8PointSummary(raw)) return false;

  // Optional: Two-Line Verdict block (if present)
  if (!validateTwoLineVerdict(raw)) return false;

  return true;
}

module.exports = { verifyReviewFormat };

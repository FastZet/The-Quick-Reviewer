// src/core/formatEnforcerV2.js — Builds structured HTML for the v2 review pages (hero-only view per spec).

'use strict';

function clean(text) {
  return text ? text.trim().replace(/^[*_]+|[*_]+$/g, '').trim() : '';
}

// Build a robust section extractor that supports our bullet+bold style:
// • **Section Name:** content (until next bold-bullet heading or EOF)
function extractSection(raw, heading) {
  const pattern = new RegExp(
    String.raw`^\s*•\s*\*\*\s*${escapeRegExp(heading)}\s*\*\*\s*:\s*([\s\S]*?)(?=^\s*•\s*\*\*|\s*$)`,
    'gmi'
  );
  const m = pattern.exec(raw);
  return m && m[1] ? clean(m[1]) : '';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Grab rating as "N/10"
function extractRating(raw) {
  const m = raw.match(/^\s*Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/mi);
  return m ? m[1] : null;
}

// Grab single-line verdict
function extractOneLineVerdict(raw) {
  const m = raw.match(/^\s*•\s*\*\*\s*Verdict in One Line\s*\*\*\s*:\s*([^\n]+)/mi);
  return m ? clean(m[1]) : '';
}

// Optional block: Two-Line Verdict (two bullets after the header line)
function extractTwoLineVerdict(raw) {
  const header = raw.match(/^\s*•\s*\*\*\s*Two-Line Verdict\s*\*\*\s*:\s*$/mi);
  if (!header) return null;
  const start = header.index + header[0].length;
  const tail = raw.slice(start);
  const bulletRe = /^\s*•\s*(.+?)\s*$/gim;
  const out = [];
  let m;
  while ((m = bulletRe.exec(tail)) && out.length < 2) {
    out.push(clean(m[1]));
  }
  if (out.length === 2) return out;
  return null;
}

function buildPosterContent(posterUrl, stillUrl, title) {
  const imageUrl = stillUrl || posterUrl;
  if (imageUrl) {
    return `<img src="${imageUrl}" alt="${title || 'Poster'}" class="poster-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="poster-fallback" style="display:none;">
                <span class="poster-icon">🎬</span>
                <div class="poster-title">${title || 'Review'}</div>
            </div>`;
  }
  return `<div class="poster-fallback">
            <span class="poster-icon">🎬</span>
            <div class="poster-title">${title || 'Review'}</div>
          </div>`;
}

// Build minimal hero with only Rating + single-line Verdict
function buildHeroContent(data, title, year) {
  const name =
    data.get('Name Of The Movie') ||
    data.get('Name Of The Series') ||
    title ||
    'Untitled';
  const seasonEp = data.get('Season & Episode');
  const epName = data.get('Name Of The Episode');

  const heading = seasonEp
    ? `${name}${year ? ` (${year})` : ''}`
    : `${name}${year ? ` (${year})` : ''}`;

  const episodeLine = seasonEp
    ? `<div class="episode-info">${epName ? `${epName} • ` : ''}${seasonEp}</div>`
    : ``;

  const ratingText = data.get('Rating');
  const score = extractRatingScore(ratingText);
  const label = getRatingLabel(score);

  const verdict = data.get('Verdict in One Line') || 'Verdict not available';

  // Only rating + one-line verdict in hero per requirement
  return `
    <h1>${escapeHtml(heading)}</h1>
    ${episodeLine}
    <div class="movie-meta">
      ${formatMetaItems(data)}
    </div>
    <div class="rating-badge">
      <div class="rating-score">${escapeHtml(score)}</div>
      <div class="rating-details">
        <div class="rating-label">${escapeHtml(label)}</div>
        <div class="verdict-text">${escapeHtml(verdict)}</div>
      </div>
    </div>
    <div class="hero-actions">
      <a id="force-refresh" class="control-btn" href="{{FORCE_REFRESH_URL}}">↻ Regenerate</a>
      <a class="control-btn secondary" href="{{TOGGLE_URL}}">{{TOGGLE_TEXT}}</a>
    </div>
  `;
}

function extractRatingScore(ratingText) {
  if (!ratingText) return 'N/A';
  const m = ratingText.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  return m ? m[1] : 'N/A';
}

function getRatingLabel(score) {
  const n = parseFloat(score);
  if (isNaN(n)) return 'Not Rated';
  if (n >= 9) return 'Exceptional';
  if (n >= 7) return 'Strong';
  if (n >= 5) return 'Average';
  if (n >= 3) return 'Weak';
  return 'Poor';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Build compact “meta chips” for hero area
function formatMetaItems(data) {
  const items = [];

  if (data.has('Directed By')) {
    items.push(metaItem('🎬', data.get('Directed By')));
  }
  const releasedOn = data.get('Released On');
  if (releasedOn) {
    const year = releasedOn.split(',').pop().trim() || releasedOn.split(' ').pop();
    items.push(metaItem('📅', year));
  }
  if (data.has('Genre')) items.push(metaItem('🎭', data.get('Genre')));
  if (data.has('Casts')) {
    const cast = data.get('Casts').split(',').slice(0, 3).map(s => s.trim()).join(', ');
    items.push(metaItem('👥', cast));
  }
  if (data.has('Language')) items.push(metaItem('🗣️', data.get('Language')));
  if (data.has('Release Country')) items.push(metaItem('🌍', data.get('Release Country')));
  if (data.has('Release Medium')) items.push(metaItem('📺', data.get('Release Medium')));

  return items.join('');
}

function metaItem(icon, text) {
  return `<div class="meta-item"><span>${icon}</span><span>${escapeHtml(text)}</span></div>`;
}

// Parse raw → Map of merged headings and basics
function parseRawReview(raw) {
  const headings = [
    'Name Of The Movie',
    'Name Of The Series',
    'Name Of The Episode',
    'Season & Episode',
    'Casts',
    'Directed By',
    'Language',
    'Genre',
    'Released On',
    'Release Medium',
    'Release Country',
    'Plot Summary',
    // merged blocks
    'Story & Writing',
    'Performances & Characters',
    'Direction & Pacing',
    'Visuals & Sound',
    // reception and misc
    'Strengths',
    'Weaknesses',
    'Critical Reception',
    'Audience Reception & Reaction',
    'Audience Reception',
    'Box Office and Viewership',
    'Who would like it',
    'Who would not like it',
    'Similar Films',
    'Overall Verdict',
    'Rating',
    'Verdict in One Line',
    'Two-Line Verdict'
  ];

  const map = new Map();

  for (const h of headings) {
    if (h === 'Audience Reception') {
      // Only set if the extended "& Reaction" was not found
      if (!map.has('Audience Reception & Reaction')) {
        const v = extractSection(raw, h);
        if (v) map.set(h, v);
      }
      continue;
    }
    const v = extractSection(raw, h);
    if (v) map.set(h, v);
  }

  // Rating: ensure canonical field holds "X/10"
  const ratingMatch = raw.match(/^\s*Rating:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/mi);
  if (ratingMatch) map.set('Rating', `${ratingMatch[1]}/10`);

  // Single-line verdict
  const v1 = extractOneLineVerdict(raw);
  if (v1) map.set('Verdict in One Line', v1);

  // Two-line verdict optional
  const v2 = extractTwoLineVerdict(raw);
  if (v2) map.set('Two-Line Verdict', v2.join('\n'));

  return map;
}

// Public API: build all SSR pieces the router expects
function buildReviewContent(rawReviewText, reviewMeta = {}) {
  const data = parseRawReview(rawReviewText);

  const posterContent = buildPosterContent(
    reviewMeta.posterUrl,
    reviewMeta.stillUrl,
    reviewMeta.title
  );

  const heroContent = buildHeroContent(
    data,
    reviewMeta.title,
    reviewMeta.year
  );

  // Per requirement, pages should only show rating + single-line verdict in hero
  const mainReviewCards = ''; // no cards
  const sidebarContent = ''; // no sidebar cards

  // Kept for backward replacement in quick template, but intentionally empty
  const plotSummary = '';
  const overallVerdict = '';

  return {
    posterContent,
    heroContent,
    sidebarContent,
    mainReviewCards,
    plotSummary,
    overallVerdict
  };
}

module.exports = { buildReviewContent };

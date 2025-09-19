/*
 * src/core/formatEnforcer.js
 * Enhanced parser and formatter for plain markdown AI output to structured HTML
 */

'use strict';

function cleanText(text) {
  return text ? text.trim().replace(/\s+/g, ' ').trim() : '';
}

// Generic extractor for markdown headers like ## Heading
function extractSection(raw, heading) {
  const pattern = new RegExp(`^##\\s*${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##|$)`, 'mi');
  const match = raw.match(pattern);
  return match && match[1] ? cleanText(match[1]) : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract X/10 rating from Rating section
function extractRating(raw) {
  const ratingSection = extractSection(raw, 'Rating');
  if (!ratingSection) return null;
  
  const match = ratingSection.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  return match ? match[1] : null;
}

// Extract single-line verdict
function extractOneLineVerdict(raw) {
  const verdict = extractSection(raw, 'Verdict in One Line');
  return verdict || 'Verdict not available';
}

// Extract two-line verdict bullets
function extractTwoLineVerdict(raw) {
  const twoLineSection = extractSection(raw, 'Two-Line Verdict');
  if (!twoLineSection) return null;
  
  const lines = twoLineSection.split('\n')
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(line => line.length > 0);
  
  return lines.length >= 2 ? [lines[0], lines[1]] : null;
}

// Generate 8-point summary from strengths and weaknesses
function generate8PointSummary(raw) {
  const points = [];
  
  // Extract from Strengths section
  const strengths = extractSection(raw, 'Strengths');
  if (strengths) {
    const strengthPoints = strengths.split(/[-*]\s*/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.length <= 25)
      .slice(0, 4);
    points.push(...strengthPoints);
  }
  
  // Extract from Weaknesses section  
  const weaknesses = extractSection(raw, 'Weaknesses');
  if (weaknesses) {
    const weaknessPoints = weaknesses.split(/[-*]\s*/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.length <= 25)
      .slice(0, 4);
    points.push(...weaknessPoints);
  }
  
  // Generate additional points from other sections if needed
  if (points.length < 8) {
    const rating = extractRating(raw);
    const ratingNum = parseFloat(rating);
    
    if (!isNaN(ratingNum)) {
      if (ratingNum >= 8) points.push('Highly rated');
      else if (ratingNum >= 6) points.push('Good rating');
      else if (ratingNum >= 4) points.push('Mixed rating');
      else points.push('Low rating');
    }
    
    // Add generic points to fill remaining slots
    const fillers = [
      'Worth watching',
      'Has highlights', 
      'Some issues',
      'Check it out',
      'Mixed results',
      'Decent effort'
    ];
    
    while (points.length < 8) {
      points.push(fillers[(points.length - 4) % fillers.length]);
    }
  }
  
  return points.slice(0, 8);
}

function buildPosterContent(posterUrl, stillUrl, title) {
  const imageUrl = stillUrl || posterUrl;
  
  if (imageUrl) {
    return `<img src="${imageUrl}" alt="${title} Poster" class="poster-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
    <div class="poster-fallback" style="display:none">
      <span class="poster-icon">🎬</span>
      <div class="poster-title">${title} Review</div>
    </div>`;
  }
  
  return `<div class="poster-fallback">
    <span class="poster-icon">🎬</span>
    <div class="poster-title">${title} Review</div>
  </div>`;
}

// Build enhanced hero with rating, verdict and 8-point summary
function buildHeroContent(data, title, year) {
  const name = data.get('Name Of The Movie') || data.get('Name Of The Series') || title || 'Untitled';
  const seasonEp = data.get('Season Episode');
  const epName = data.get('Name Of The Episode');
  
  const heading = seasonEp ? `${name} ${year ? `(${year})` : ''}` : `${name} ${year ? `(${year})` : ''}`;
  const episodeLine = seasonEp ? `<div class="episode-info">${epName ? `${epName} • ` : ''}${seasonEp}</div>` : '';
  
  const rating = data.get('Rating');
  const score = extractRatingScore(rating);
  const label = getRatingLabel(score);
  const verdict = data.get('Verdict in One Line') || 'Verdict not available';
  
  // Generate 8-point summary for the rating badge area
  const eightPoints = data.get('8PointSummary') || [];
  const pointsHtml = eightPoints.length > 0 
    ? `<div class="eight-points">${eightPoints.map(p => `<span class="point">${escapeHtml(p)}</span>`).join('')}</div>`
    : '';
  
  return `<h1>${escapeHtml(heading)}</h1>
  ${episodeLine}
  <div class="movie-meta">${formatMetaItems(data)}</div>
  <div class="rating-badge">
    <div class="rating-score">${escapeHtml(score)}</div>
    <div class="rating-details">
      <div class="rating-label">${escapeHtml(label)}</div>
      <div class="verdict-text">${escapeHtml(verdict)}</div>
      ${pointsHtml}
    </div>
  </div>
  <div class="hero-actions">
    <a id="force-refresh" class="control-btn" href="FORCE_REFRESH_URL">Regenerate</a>
    <a class="control-btn secondary" href="TOGGLE_URL">TOGGLE_TEXT</a>
  </div>`;
}

function extractRatingScore(ratingText) {
  if (!ratingText) return 'N/A';
  const match = ratingText.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : 'N/A';
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
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build compact meta chips for hero area
function formatMetaItems(data) {
  const items = [];
  
  if (data.has('Directed By')) items.push(metaItem('🎬', data.get('Directed By')));
  
  const releasedOn = data.get('Released On');
  if (releasedOn) {
    const year = releasedOn.split(',').pop().trim() || releasedOn.split(' ').pop();
    items.push(metaItem('📅', year));
  }
  
  if (data.has('Genre')) items.push(metaItem('🎭', data.get('Genre')));
  
  if (data.has('Casts')) {
    const cast = data.get('Casts').split(',').slice(0, 3).map(s => s.trim()).join(', ');
    items.push(metaItem('🎭', cast));
  }
  
  if (data.has('Language')) items.push(metaItem('🗣️', data.get('Language')));
  if (data.has('Release Country')) items.push(metaItem('🌍', data.get('Release Country')));
  if (data.has('Release Medium')) items.push(metaItem('📺', data.get('Release Medium')));
  
  return items.join('');
}

function metaItem(icon, text) {
  return `<div class="meta-item"><span>${icon}</span><span>${escapeHtml(text)}</span></div>`;
}

// Parse raw markdown into structured data map
function parseRawReview(raw) {
  const headings = [
    'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season Episode',
    'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country',
    'Plot Summary', 'Story Writing', 'Performances Characters', 'Direction Pacing', 'Visuals Sound',
    'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception', 'Box Office and Viewership',
    'Who would like it', 'Who would not like it', 'Similar Films', 'Overall Verdict',
    'Rating', 'Verdict in One Line', 'Two-Line Verdict'
  ];
  
  const map = new Map();
  
  // Extract all sections
  for (const heading of headings) {
    const content = extractSection(raw, heading);
    if (content) {
      map.set(heading, content);
    }
  }
  
  // Generate 8-point summary
  const eightPoints = generate8PointSummary(raw);
  map.set('8PointSummary', eightPoints);
  
  // Extract rating score
  const rating = extractRating(raw);
  if (rating) {
    map.set('RatingScore', rating);
  }
  
  // Extract verdicts
  const oneLineVerdict = extractOneLineVerdict(raw);
  map.set('Verdict in One Line', oneLineVerdict);
  
  const twoLineVerdict = extractTwoLineVerdict(raw);
  if (twoLineVerdict) {
    map.set('Two-Line Verdict', twoLineVerdict);
  }
  
  return map;
}

// Build full review content with detailed sections
function buildMainReviewCards(data) {
  const cards = [];
  
  // Plot Summary Card
  const plotSummary = data.get('Plot Summary');
  if (plotSummary) {
    cards.push(`
      <div class="review-card">
        <h3><span class="icon">📖</span>Plot Summary</h3>
        <div class="review-text">${escapeHtml(plotSummary)}</div>
      </div>
    `);
  }
  
  // Analysis Cards
  const analysisCards = [
    { key: 'Story Writing', icon: '✍️', title: 'Story & Writing' },
    { key: 'Performances Characters', icon: '🎭', title: 'Performances & Characters' },
    { key: 'Direction Pacing', icon: '🎬', title: 'Direction & Pacing' },
    { key: 'Visuals Sound', icon: '🎨', title: 'Visuals & Sound' }
  ];
  
  for (const { key, icon, title } of analysisCards) {
    const content = data.get(key);
    if (content) {
      cards.push(`
        <div class="review-card">
          <h3><span class="icon">${icon}</span>${title}</h3>
          <div class="review-text">${escapeHtml(content)}</div>
        </div>
      `);
    }
  }
  
  // Strengths & Weaknesses
  const strengths = data.get('Strengths');
  const weaknesses = data.get('Weaknesses');
  
  if (strengths || weaknesses) {
    let prosConsHtml = '<div class="review-card"><h3><span class="icon">⚖️</span>Pros & Cons</h3><div class="review-text">';
    
    if (strengths) {
      prosConsHtml += `<strong>Strengths:</strong><br>${escapeHtml(strengths)}<br><br>`;
    }
    
    if (weaknesses) {
      prosConsHtml += `<strong>Weaknesses:</strong><br>${escapeHtml(weaknesses)}`;
    }
    
    prosConsHtml += '</div></div>';
    cards.push(prosConsHtml);
  }
  
  // Overall Verdict
  const overallVerdict = data.get('Overall Verdict');
  if (overallVerdict) {
    cards.push(`
      <div class="review-card">
        <h3><span class="icon">🎯</span>Final Verdict</h3>
        <div class="review-text">${escapeHtml(overallVerdict)}</div>
      </div>
    `);
  }
  
  return cards.join('');
}

// Build sidebar with stats and recommendations
function buildSidebarContent(data) {
  const cards = [];
  
  // Reception Stats Card
  const criticalReception = data.get('Critical Reception');
  const audienceReception = data.get('Audience Reception');
  const boxOffice = data.get('Box Office and Viewership');
  
  if (criticalReception || audienceReception || boxOffice) {
    let statsHtml = '<div class="sidebar-card"><h4>Reception & Performance</h4>';
    
    if (criticalReception) {
      statsHtml += `<div class="stat-item"><span class="stat-label">Critics</span><span class="stat-value">${escapeHtml(criticalReception)}</span></div>`;
    }
    
    if (audienceReception) {
      statsHtml += `<div class="stat-item"><span class="stat-label">Audience</span><span class="stat-value">${escapeHtml(audienceReception)}</span></div>`;
    }
    
    if (boxOffice) {
      statsHtml += `<div class="stat-item"><span class="stat-label">Box Office</span><span class="stat-value">${escapeHtml(boxOffice)}</span></div>`;
    }
    
    statsHtml += '</div>';
    cards.push(statsHtml);
  }
  
  // Recommendations Card
  const whoWouldLike = data.get('Who would like it');
  const whoWouldNotLike = data.get('Who would not like it');
  
  if (whoWouldLike || whoWouldNotLike) {
    let recHtml = '<div class="sidebar-card"><h4>Audience Fit</h4>';
    
    if (whoWouldLike) {
      const tags = whoWouldLike.split(',').map(tag => 
        `<span class="recommendation-tag positive">${escapeHtml(tag.trim())}</span>`
      ).join('');
      recHtml += `<p><strong>Perfect for:</strong></p><div class="recommendation-tags">${tags}</div>`;
    }
    
    if (whoWouldNotLike) {
      const tags = whoWouldNotLike.split(',').map(tag => 
        `<span class="recommendation-tag negative">${escapeHtml(tag.trim())}</span>`
      ).join('');
      recHtml += `<p><strong>Not ideal for:</strong></p><div class="recommendation-tags">${tags}</div>`;
    }
    
    recHtml += '</div>';
    cards.push(recHtml);
  }
  
  // Similar Films Card
  const similarFilms = data.get('Similar Films');
  if (similarFilms) {
    cards.push(`
      <div class="sidebar-card">
        <h4>Similar Films</h4>
        <div class="similar-films-list">${escapeHtml(similarFilms)}</div>
      </div>
    `);
  }
  
  return cards.join('');
}

/**
 * Main public API - transforms raw AI markdown into structured HTML components
 * @param {string} rawReviewText - Plain markdown from AI
 * @param {object} reviewMeta - Metadata (title, year, posterUrl, etc.)
 * @returns {object} - All HTML components needed by templates
 */
function buildReviewContent(rawReviewText, reviewMeta) {
  const data = parseRawReview(rawReviewText);
  
  const posterContent = buildPosterContent(reviewMeta.posterUrl, reviewMeta.stillUrl, reviewMeta.title);
  const heroContent = buildHeroContent(data, reviewMeta.title, reviewMeta.year);
  const mainReviewCards = buildMainReviewCards(data);
  const sidebarContent = buildSidebarContent(data);
  
  // Legacy fields for backward compatibility
  const plotSummary = data.get('Plot Summary') || '';
  const overallVerdict = data.get('Overall Verdict') || '';
  
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

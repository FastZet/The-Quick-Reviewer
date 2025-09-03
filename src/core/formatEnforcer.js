// src/core/formatEnforcer.js — Cleans and builds a structured HTML review.

function cleanSectionContent(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^[*_]+/, '');
  cleaned = cleaned.replace(/[*_]+$/, '');
  return cleaned.trim();
}

/**
 * Rebuilds the entire review to conform to a strict, consistent format.
 * Fixes merged sections, inconsistent headings, and other AI formatting quirks.
 * @param {string} rawReviewText - The full, raw review text from the Gemini API.
 * @returns {string} The perfectly formatted review text.
 */
function enforceReviewStructure(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') return '';

  const ALL_SECTIONS = [
    // Intro Headers
    'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 
    'Casts', 'Directed By', 'Directed by', 'Language', 'Genre', 'Released On', 
    'Release Medium', 'Release Country',
    // Main Content Headers
    'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development',
    'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision',
    'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception',
    'Audience Reception & Reaction', 'Box Office and Viewership',
    'Who would like it', 'Who would not like it', 'Overall Verdict',
    // Outro Headers
    'Rating', 'Verdict in One Line'
  ];

  const contentMap = new Map();

  // --- 1. Extract content for every possible section ---
  for (const header of ALL_SECTIONS) {
    const regex = new RegExp(
      `[•*\\s]*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|Rating:|Verdict in One Line:|$)`, 'i'
    );
    const match = rawReviewText.match(regex);
    if (match && match[1]) {
      const canonicalHeader = header === 'Directed by' ? 'Directed By' : header;
      const cleanedContent = cleanSectionContent(match[1]);
      contentMap.set(canonicalHeader, cleanedContent);
    }
  }

  // Helper converts newlines to <br> tags. 
  const formatText = (text = '') => {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  };

  // --- 2. Rebuild the review as an HTML string ---
  let introHtml = '<div class="review-intro">';
  const introHeaders = ['Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country'];
  for (const header of introHeaders) {
    if (contentMap.has(header)) {
      introHtml += `<div>• <strong>${header}:</strong> ${formatText(contentMap.get(header))}</div>`;
    }
  }
  introHtml += '</div>';

  let accordionHtml = '<div class="accordion">';
  const mainContentHeaders = [
    'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Overall Verdict'
  ];
  for (const header of mainContentHeaders) {
    if (contentMap.has(header)) {
      const isActive = header === 'Plot Summary';
      accordionHtml += `
        <div class="accordion-item ${isActive ? 'active' : ''}">
          <button class="accordion-header">${header}</button>
          <div class="accordion-content">
            <div class="accordion-content-inner">${formatText(contentMap.get(header))}</div>
          </div>
        </div>`;
    }
  }
  accordionHtml += '</div>';

  let outroHtml = '<div class="review-outro">';
  if (contentMap.has('Rating')) {
    const ratingContent = formatText(contentMap.get('Rating')) + '<span id="rating-context-placeholder"></span>';
    outroHtml += `<div><strong>Rating:</strong> ${ratingContent}</div>`;
  }
  if (contentMap.has('Verdict in One Line')) {
    outroHtml += `<div><strong>Verdict in One Line:</strong> ${formatText(contentMap.get('Verdict in One Line'))}</div>`;
  }
  outroHtml += '</div>';

  console.log('[FormatEnforcer] Review HTML structure has been successfully generated.');
  return introHtml + accordionHtml + outroHtml;
}

module.exports = {
  cleanVerdict: cleanSectionContent,
  enforceReviewStructure,
};

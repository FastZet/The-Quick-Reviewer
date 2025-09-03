// src/core/formatEnforcer.js — Cleans and builds a structured HTML review.

function cleanSectionContent(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^[*_]+/, '');
  cleaned = cleaned.replace(/[*_]+$/, '');
  return cleaned.trim();
}

/**
 * Creates the HTML for the always-visible rating scale.
 * @returns {string} The HTML structure for the rating scale.
 */
function createRatingScaleHtml() {
  return `
    <div class="rating-scale">
      <strong>Rating Scale</strong>
      <ul>
        <li><strong>9–10:</strong> Exceptional, masterpiece</li>
        <li><strong>7–8:</strong> Strong, worth watching</li>
        <li><strong>5–6:</strong> Average, but forgettable</li>
        <li><strong>3–4:</strong> Weak, with major flaws</li>
        <li><strong>1–2:</strong> Poor, barely redeemable</li>
        <li><strong>0:</strong> Unwatchable, a failure</li>
      </ul>
    </div>
  `.trim();
}

function enforceReviewStructure(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') return '';

  const ALL_SECTIONS = [ 'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Directed by', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country', 'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Overall Verdict', 'Rating', 'Verdict in One Line' ];
  const contentMap = new Map();

  for (const header of ALL_SECTIONS) {
    const regex = new RegExp(`[•*\\s]*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|Rating:|Verdict in One Line:|$)`, 'i');
    const match = rawReviewText.match(regex);
    if (match && match[1]) {
      const canonicalHeader = header === 'Directed by' ? 'Directed By' : header;
      contentMap.set(canonicalHeader, cleanSectionContent(match[1]));
    }
  }

  const formatText = (text = '') => text ? text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') : '';

  let introHtml = '<div class="review-intro">';
  const introHeaders = ['Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country'];
  introHeaders.forEach(header => {
    if (contentMap.has(header)) introHtml += `<div>• <strong>${header}:</strong> ${formatText(contentMap.get(header))}</div>`;
  });
  introHtml += '</div>';

  let accordionHtml = '<div class="accordion">';
  const mainContentHeaders = [ 'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Overall Verdict' ];
  mainContentHeaders.forEach(header => {
    if (contentMap.has(header)) {
      const isActive = header === 'Plot Summary';
      accordionHtml += `<div class="accordion-item ${isActive ? 'active' : ''}"><button class="accordion-header">${header}</button><div class="accordion-content"><div class="accordion-content-inner">${formatText(contentMap.get(header))}</div></div></div>`;
    }
  });
  accordionHtml += '</div>';

  let outroHtml = '<div class="review-outro">';
  if (contentMap.has('Rating')) {
    const ratingContent = formatText(contentMap.get('Rating')).replace('<span id="rating-context-placeholder"></span>', '');
    outroHtml += `<div class="outro-line"><strong>Rating:</strong> <span>${ratingContent}</span></div>`;
  }
  if (contentMap.has('Verdict in One Line')) {
    outroHtml += `<div class="outro-line"><strong>Verdict in One Line:</strong> <span>${formatText(contentMap.get('Verdict in One Line'))}</span></div>`;
  }
  // Add the always-visible rating scale at the end
  outroHtml += createRatingScaleHtml();
  outroHtml += '</div>';

  console.log('[FormatEnforcer] Review HTML structure has been successfully generated.');
  return introHtml + accordionHtml + outroHtml;
}

module.exports = { enforceReviewStructure };

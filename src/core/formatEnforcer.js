// src/core/formatEnforcer.js — Cleans and builds a structured HTML review.

function cleanVerdict(verdictText) {
  if (!verdictText) return '';
  // Removes leading/trailing asterisks, underscores, and trims whitespace.
  return verdictText.replace(/^[\s*_]+|[\s*_]+$/g, '').trim();
}

/**
 * Takes raw review text and converts it into a structured HTML block with an accordion.
 * @param {string} rawReviewText - The full, raw review text from the Gemini API.
 * @returns {string} A string containing the complete HTML for the review box.
 */
function enforceReviewStructure(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') return '';

  // The "golden source" of all possible sections in their correct order.
  const ALL_SECTIONS = [
    // Intro Headers (handled separately but defined for completeness)
    'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 
    'Casts', 'Directed By', 'Directed by', 'Language', 'Genre', 'Released On', 
    'Release Medium', 'Release Country',
    // Main Content Headers
    'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development',
    'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision',
    'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception',
    'Audience Reception & Reaction', 'Box Office and Viewership',
    'Who would like it', 'Who would not like it', 'Overall Verdict',
    // Outro Headers (handled separately)
    'Rating', 'Verdict in One Line'
  ];

  const contentMap = new Map();

  // --- 1. Extract content for every possible section ---
  for (const header of ALL_SECTIONS) {
    // This robust regex finds a header, ignoring surrounding formatting,
    // and captures everything until the next bullet point heading or the end of the text.
    const regex = new RegExp(
      `[•*\\s]*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|$)`, 'i'
    );
    const match = rawReviewText.match(regex);
    if (match && match[1]) {
      // Use the canonical header name as the key for consistency.
      const canonicalHeader = header === 'Directed by' ? 'Directed By' : header;
      contentMap.set(canonicalHeader, match[1].trim());
    }
  }

  // Helper to format text content for HTML display
  const formatText = (text = '') => text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

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
  let mainContentAdded = false;
  for (const header of mainContentHeaders) {
    if (contentMap.has(header)) {
      const isActive = header === 'Plot Summary';
      accordionHtml += `
        <div class="accordion-item ${isActive ? 'active' : ''}">
          <button class="accordion-header">${header}</button>
          <div class="accordion-content">
            <div class="accordion-content-inner">${formatText(contentMap.get(header))}</div>
          </div>

// src/core/formatEnforcer.js — Cleans and enforces a strict structure on AI-generated review text.

/**
 * Removes leading/trailing Markdown characters (like **) and whitespace from the verdict.
 * @param {string} verdictText - The raw verdict string.
 * @returns {string} A clean string suitable for display in plain text fields.
 */
function cleanVerdict(verdictText) {
  if (!verdictText) return '';
  // Removes leading/trailing asterisks, underscores, and trims whitespace.
  return verdictText.replace(/^[\s*_]+|[\s*_]+$/g, '').trim();
}

/**
 * Rebuilds the entire review to conform to a strict, consistent format.
 * Fixes merged sections, inconsistent headings, and other AI formatting quirks.
 * @param {string} rawReviewText - The full, raw review text from the Gemini API.
 * @returns {string} The perfectly formatted review text.
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

  // --- 2. Rebuild the review string from the extracted parts ---
  let finalReview = '';
  
  // A. Rebuild the intro section (no extra spacing)
  const introHeaders = ['Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country'];
  for (const header of introHeaders) {
    if (contentMap.has(header)) {
      finalReview += `• **${header}:** ${contentMap.get(header)}\n`;
    }
  }

  // B. Rebuild the main content section (with extra spacing)
  const mainContentHeaders = [
    'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development',
    'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision',
    'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception',
    'Audience Reception & Reaction', 'Box Office and Viewership',
    'Who would like it', 'Who would not like it', 'Overall Verdict'
  ];
  let mainContentAdded = false;
  for (const header of mainContentHeaders) {
    if (contentMap.has(header)) {
      if (!mainContentAdded) {
        finalReview += '\n'; // Add initial space before the first main section
        mainContentAdded = true;
      }
      finalReview += `• **${header}:** ${contentMap.get(header)}\n\n`;
    }
  }
  finalReview = finalReview.trim(); // Remove trailing newlines

  // C. Rebuild the outro section
  if (contentMap.has('Rating')) {
    finalReview += `\n\nRating: ${contentMap.get('Rating')}`;
  }
  if (contentMap.has('Verdict in One Line')) {
    finalReview += `\nVerdict in One Line: ${contentMap.get('Verdict in One Line')}`;
  }

  console.log('[FormatEnforcer] Review structure has been successfully enforced.');
  return finalReview.trim();
}

module.exports = {
  cleanVerdict,
  enforceReviewStructure,
};

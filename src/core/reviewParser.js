// reviewParser.js — A utility to extract specific sections from a generated review.

/**
 * Parses the raw text of an AI-generated review to find the "Verdict in One Line".
 * This method is more robust as it does not depend on the final HTML structure.
 *
 * @param {string} rawReviewText The full, raw review content from the AI.
 * @returns {string|null} The extracted and cleaned verdict string, or null if not found.
 */
function parseVerdictFromReview(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') {
    return null;
  }

  // Regex to find the "Verdict in One Line:" heading and capture the text after it.
  const verdictRegex = /Verdict in One Line:([^\n]+)/im;
  const match = rawReviewText.match(verdictRegex);

  if (match && match[1]) {
    // Clean up any extraneous markdown or whitespace
    const cleanVerdict = match[1].replace(/[*_]/g, '').trim();
    if (cleanVerdict) {
        console.log('[Parser] Found verdict directly from raw AI text.');
        return cleanVerdict;
    }
  }
  
  console.warn(`[Parser] Verdict could not be found in the raw AI-generated text.`);
  return null;
}

module.exports = {
  parseVerdictFromReview,
};

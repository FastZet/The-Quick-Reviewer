// reviewParser.js — A utility to extract specific sections from a generated review.

/**
 * Parses the full text of an AI-generated review to find the "Verdict in One Line".
 * This regex is designed to be highly robust against formatting variations from the AI.
 * It now also cleans any HTML tags from the result.
 *
 * @param {string} reviewText The full review content, which may contain HTML.
 * @returns {string|null} The extracted and cleaned verdict string, or null if not found.
 */
function parseVerdictFromReview(reviewText) {
  if (!reviewText || typeof reviewText !== 'string') {
    return null;
  }

  // This regex finds a line containing "Verdict in One Line" and captures the text after the colon.
  const verdictRegex = /^.*Verdict in One Line.*:\s*([^\n]*)/im;
  
  const match = reviewText.match(verdictRegex);

  // If a match is found, the captured group is the verdict text.
  if (match && match[1]) {
    const cleanVerdict = match[1].replace(/<[^>]*>/g, '').trim();
    return cleanVerdict;
  }
  
  console.warn(`[Parser] Verdict could not be found. The AI-generated text did not contain the expected 'Verdict in One Line:' heading. Full text received from AI:\n---\n${reviewText}\n---`);
  return null;
}

module.exports = {
  parseVerdictFromReview,
};

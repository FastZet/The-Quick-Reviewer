// reviewParser.js — A utility to extract specific sections from a generated review.

/**
 * Parses the full text of an AI-generated review to find the "Verdict in One Line".
 * This function is designed to be robust against formatting variations from the AI.
 * It first tries to find a specific heading, and if that fails, it uses a fallback
 * method based on the review's structure.
 *
 * @param {string} reviewText The full review content, which may contain HTML.
 * @returns {string|null} The extracted and cleaned verdict string, or null if not found.
 */
function parseVerdictFromReview(reviewText) {
  if (!reviewText || typeof reviewText !== 'string') {
    return null;
  }

  // --- Primary Method: Look for the explicit heading ---
  const primaryRegex = /^.*Verdict in One Line.*:\s*([^\n]*)/im;
  let match = reviewText.match(primaryRegex);

  if (match && match[1]) {
    const cleanVerdict = match[1].replace(/<[^>]*>/g, '').trim();
    if (cleanVerdict) {
        console.log('[Parser] Found verdict using primary method.');
        return cleanVerdict;
    }
  }

  // --- Fallback Method: Look for text immediately after the rating ---
  // This handles cases where the AI forgets the "Verdict in One Line" heading.
  // It looks for the rating's closing span tag and captures the text that follows.
  const fallbackRegex = /<span id="rating-context-placeholder"><\/span>([\s\S]*?)<\/div>/im;
  match = reviewText.match(fallbackRegex);

  if (match && match[1]) {
    // Clean up any HTML tags and whitespace from the captured text
    const cleanVerdict = match[1].replace(/<[^>]*>/g, '').trim();
    if (cleanVerdict) {
        console.log('[Parser] Verdict not found with primary method. Using fallback logic successfully.');
        return cleanVerdict;
    }
  }
  
  console.warn(`[Parser] Verdict could not be found. The AI-generated text did not contain the expected 'Verdict in One Line:' heading or a parsable fallback. Full text received from AI:\n---\n${reviewText}\n---`);
  return null;
}

module.exports = {
  parseVerdictFromReview,
};

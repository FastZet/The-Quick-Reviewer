// src/core/reviewVerifier.js — Validates AI-generated review formats.

/**
 * Verifies if the raw review text from the AI matches the expected format for the content type.
 * @param {string} rawReviewText The raw, unformatted text from the Gemini API.
 * @param {string} type The expected content type ('movie' or 'series').
 * @returns {boolean} True if the format is valid, false otherwise.
 */
function verifyReviewFormat(rawReviewText, type) {
  if (!rawReviewText) return false;

  const hasMovieHeader = /•\s*\*\*Name Of The Movie:/i.test(rawReviewText);
  const hasSeriesHeaders = /•\s*\*\*Name Of The Series:/i.test(rawReviewText) ||
                           /•\s*\*\*Name Of The Episode:/i.test(rawReviewText);

  if (type === 'movie') {
    if (hasSeriesHeaders) {
      console.warn('[Verifier] Validation FAILED: Movie review contains series-specific headers.');
      return false; // A movie review should NOT have series headers.
    }
    if (!hasMovieHeader) {
      console.warn('[Verifier] Validation FAILED: Movie review is missing the "Name Of The Movie" header.');
      return false; // A movie review MUST have a movie header.
    }
  }

  if (type === 'series') {
    if (hasMovieHeader) {
      console.warn('[Verifier] Validation FAILED: Series review contains a movie-specific header.');
      return false; // A series review should NOT have a movie header.
    }
    if (!hasSeriesHeaders) {
      console.warn('[Verifier] Validation FAILED: Series review is missing series-specific headers.');
      return false; // A series review MUST have series headers.
    }
  }

  console.log(`[Verifier] Validation PASSED for type: ${type}.`);
  return true;
}

module.exports = { verifyReviewFormat };

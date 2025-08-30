// src/core/streamTitleBuilder.js — A dedicated module for formatting stream titles.

/**
 * Constructs a formatted, multi-line title for the Stremio stream object.
 * @param {string|null} verdict - The one-line verdict, or null if not available.
 * @param {object} options - Optional parameters.
 * @param {boolean} [options.timedOut=false] - If true, returns a timeout-specific title.
 * @returns {string} The formatted, multi-line string.
 */
function buildStreamTitle(verdict, options = {}) {
  // Handle the timeout case first
  if (options.timedOut) {
    return [
      '⚡ Finalizing AI Review...',
      'Click to open, it will appear in a moment!'
    ].join('\n');
  }

  // Build the standard title
  const titleParts = [
    '⚡ Quick AI Review'
  ];

  if (verdict) {
    titleParts.push(`Verdict: ${verdict}`);
  }

  titleParts.push('Click here to read the full AI review!');

  return titleParts.join('\n');
}

module.exports = { buildStreamTitle };

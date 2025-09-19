/*
 * src/core/reviewParser.js
 * Modern parser for markdown-based AI review content
 */

'use strict';

/**
 * Extract verdict from simple markdown structure
 * @param {string} rawReviewText - Raw markdown from AI 
 * @returns {string|null} - Extracted verdict or null
 */
function parseVerdictFromReview(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') {
    return null;
  }
  
  // Look for ## Verdict in One Line header
  const pattern = /^##\s*Verdict in One Line\s*$\s*([^\n#]+)/mi;
  const match = rawReviewText.match(pattern);
  
  if (match && match[1]) {
    const verdict = match[1].trim();
    if (verdict.length > 0) {
      console.log('[Parser] Found verdict from markdown structure');
      return verdict;
    }
  }
  
  console.warn('[Parser] Verdict not found in expected markdown format');
  return null;
}

/**
 * Extract any section from markdown structure
 * @param {string} rawReviewText - Raw markdown from AI
 * @param {string} sectionName - Name of section to extract
 * @returns {string|null} - Extracted content or null
 */
function extractSection(rawReviewText, sectionName) {
  if (!rawReviewText || typeof rawReviewText !== 'string') {
    return null;
  }
  
  const escapedSection = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^##\\s*${escapedSection}\\s*$([\\s\\S]*?)(?=^##|$)`, 'mi');
  const match = rawReviewText.match(pattern);
  
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Extract rating value from Rating section
 * @param {string} rawReviewText - Raw markdown from AI
 * @returns {string|null} - Rating value (e.g., "7.5") or null
 */
function extractRating(rawReviewText) {
  const ratingSection = extractSection(rawReviewText, 'Rating');
  if (!ratingSection) return null;
  
  const match = ratingSection.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  return match ? match[1] : null;
}

/**
 * Extract two-line verdict bullets
 * @param {string} rawReviewText - Raw markdown from AI
 * @returns {Array|null} - Array of two lines or null
 */
function extractTwoLineVerdict(rawReviewText) {
  const section = extractSection(rawReviewText, 'Two-Line Verdict');
  if (!section) return null;
  
  const lines = section.split('\n')
    .map(line => line.replace(/^-\s*/, '').trim())
    .filter(line => line.length > 0);
  
  return lines.length >= 2 ? [lines[0], lines[1]] : null;
}

module.exports = { 
  parseVerdictFromReview,
  extractSection,
  extractRating,
  extractTwoLineVerdict
};

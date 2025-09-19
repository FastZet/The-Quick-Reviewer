/*
 * src/core/streamTitleBuilder.js
 * Modern stream title builder for 8-point summary, single-line and two-line verdicts
 */

'use strict';

const { extractSection, extractRating, extractTwoLineVerdict } = require('./reviewParser');

/**
 * Extract exactly 8 evaluative points from markdown structure
 * @param {string} rawReviewText - Raw markdown from AI
 * @returns {Array} - Array of 8 evaluative points (≤25 chars each)
 */
function extract8PointSummary(rawReviewText) {
  if (!rawReviewText) {
    return ['Review available', 'Click for details', 'AI analysis ready', 'Critical snapshot', 'Spoiler-free', 'Pros & cons', 'Quick insights', 'Open to read'];
  }

  const points = [];
  
  // Extract from Strengths section
  const strengths = extractSection(rawReviewText, 'Strengths');
  if (strengths) {
    const strengthPoints = strengths.split(/[-*]\s*/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.length <= 25)
      .slice(0, 4);
    points.push(...strengthPoints);
  }
  
  // Extract from Weaknesses section  
  const weaknesses = extractSection(rawReviewText, 'Weaknesses');
  if (weaknesses) {
    const weaknessPoints = weaknesses.split(/[-*]\s*/)
      .map(p => p.trim())
      .filter(p => p.length > 0 && p.length <= 25)
      .slice(0, 4);
    points.push(...weaknessPoints);
  }
  
  // Generate additional evaluative points if needed
  if (points.length < 8) {
    const rating = extractRating(rawReviewText);
    const ratingNum = parseFloat(rating);
    
    if (!isNaN(ratingNum)) {
      if (ratingNum >= 8) points.push('Highly rated');
      else if (ratingNum >= 6) points.push('Good rating');
      else if (ratingNum >= 4) points.push('Mixed rating');
      else points.push('Low rating');
    }
    
    // Add generic evaluative points to reach 8 total
    const fillers = [
      'Worth watching',
      'Has highlights', 
      'Some issues',
      'Check it out',
      'Mixed results',
      'Decent effort'
    ];
    
    while (points.length < 8) {
      points.push(fillers[(points.length - 4) % fillers.length]);
    }
  }
  
  return points.slice(0, 8);
}

/**
 * Build 8-point stream title (comma-separated list)
 * @param {Array} points - Array of 8 evaluative points
 * @returns {string} - Formatted stream title for Stremio
 */
function build8PointStreamTitle(points) {
  if (!points || points.length === 0) {
    return ['Review ready', 'Open to read', 'AI summary', 'No spoilers', 'Highlights', 'Drawbacks', 'Verdict soon', 'Tap to view'].join(', ');
  }
  
  return points.map(p => p.trim()).join(', ');
}

/**
 * Build single-line verdict stream title
 * @param {string} verdict - Single-line verdict from AI
 * @returns {string} - Formatted stream title for Stremio
 */
function buildSingleLineVerdict(verdict) {
  if (!verdict || !verdict.trim()) {
    return 'Quick verdict ready';
  }
  
  return verdict.replace(/\s+/g, ' ').trim();
}

/**
 * Build two-line verdict stream title
 * @param {string|Array} verdict - Either single verdict or array of two lines
 * @returns {string} - Formatted two-line stream title for Stremio
 */
function buildTwoLineVerdict(verdict) {
  // If already an array (from extractTwoLineVerdict), use it
  if (Array.isArray(verdict) && verdict.length >= 2) {
    return `${verdict[0]}\n${verdict[1]}`;
  }
  
  // If string, try to split it intelligently
  if (typeof verdict === 'string' && verdict.trim()) {
    const text = verdict.replace(/\s+/g, ' ').trim();
    
    // Try sentence split
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    if (sentences.length >= 2) {
      return `${sentences[0]}\n${sentences[1]}`;
    }
    
    // Try punctuation-based chunking
    const parts = text.split(/[,-]/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}\n${parts.slice(1).join('')}`;
    }
    
    // Split near the middle on whitespace
    const mid = Math.floor(text.length / 2);
    const splitAt = text.indexOf(' ', mid);
    if (splitAt > 0 && splitAt < text.length - 1) {
      return `${text.slice(0, splitAt)}\n${text.slice(splitAt + 1)}`;
    }
    
    // Fallback: return as single line
    return text;
  }
  
  return 'Complete verdict\nextended view';
}

module.exports = { 
  extract8PointSummary,
  build8PointStreamTitle, 
  buildSingleLineVerdict, 
  buildTwoLineVerdict 
};

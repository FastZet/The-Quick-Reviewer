/*
 * src/core/reviewVerifier.js
 * Simplified validation for plain markdown AI output
 */

'use strict';

const DEBUG = String(process.env.REVIEWVERIFY_DEBUG || 'false').toLowerCase() === 'true';

function vlog(...args) {
  if (DEBUG) console.log('[Verify]', ...args);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Generic matcher for markdown headers like ## Heading
function headingExists(text, heading) {
  const pattern = new RegExp(`^##\\s*${escapeRegExp(heading)}`, 'mi');
  return pattern.test(text);
}

// Extract content after a markdown header
function extractSection(text, heading) {
  const pattern = new RegExp(`^##\\s*${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##|$)`, 'mi');
  const match = text.match(pattern);
  return match && match[1] ? match[1].trim() : null;
}

// Check if rating section exists and has valid format
function validateRating(text) {
  const ratingSection = extractSection(text, 'Rating');
  if (!ratingSection) {
    vlog('Rating section missing');
    return false;
  }
  
  // Look for X/10 format
  const ratingMatch = ratingSection.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  if (!ratingMatch) {
    vlog('Rating not in X/10 format');
    return false;
  }
  
  const score = parseFloat(ratingMatch[1]);
  if (score < 0 || score > 10) {
    vlog('Rating score out of valid range (0-10)');
    return false;
  }
  
  return true;
}

// Check if verdict sections exist
function validateVerdicts(text) {
  const oneLineVerdict = extractSection(text, 'Verdict in One Line');
  if (!oneLineVerdict) {
    vlog('Single-line verdict missing');
    return false;
  }
  
  if (oneLineVerdict.length === 0 || oneLineVerdict.length > 200) {
    vlog('Single-line verdict length invalid');
    return false;
  }
  
  // Two-line verdict is optional but validate if present
  const twoLineSection = extractSection(text, 'Two-Line Verdict');
  if (twoLineSection) {
    const lines = twoLineSection.split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length > 0);
    
    if (lines.length !== 2) {
      vlog('Two-line verdict does not have exactly 2 lines');
      return false;
    }
    
    // Check line lengths (reasonable limits)
    for (const line of lines) {
      if (line.length === 0 || line.length > 100) {
        vlog('Two-line verdict line length invalid:', line);
        return false;
      }
    }
  }
  
  return true;
}

// Check basic content sections exist
function validateContentSections(text) {
  const requiredSections = [
    'Plot Summary',
    'Strengths', 
    'Weaknesses',
    'Story Writing',
    'Performances Characters',
    'Direction Pacing',
    'Visuals Sound'
  ];
  
  for (const section of requiredSections) {
    const content = extractSection(text, section);
    if (!content || content.trim().length === 0) {
      vlog(`Required section missing or empty: ${section}`);
      return false;
    }
  }
  
  return true;
}

// Check basic info sections exist (movie vs series specific)
function validateBasicInfo(text, type) {
  const commonSections = [
    'Casts',
    'Directed By', 
    'Genre',
    'Released On',
    'Release Medium',
    'Release Country'
  ];
  
  // Check movie vs series specific sections
  if (type === 'series') {
    if (!headingExists(text, 'Name Of The Series')) {
      vlog('Series name section missing');
      return false;
    }
    
    // Episode might have additional sections
    const hasEpisodeName = headingExists(text, 'Name Of The Episode');
    const hasSeasonEpisode = headingExists(text, 'Season Episode');
    
    if (hasEpisodeName && !hasSeasonEpisode) {
      vlog('Episode has name but missing season/episode info');
      return false;
    }
  } else {
    if (!headingExists(text, 'Name Of The Movie')) {
      vlog('Movie name section missing');
      return false;
    }
  }
  
  // Check common required sections
  for (const section of commonSections) {
    if (!headingExists(text, section)) {
      vlog(`Basic info section missing: ${section}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Simplified review format verification for plain markdown output
 * @param {string} raw - The raw AI-generated review text
 * @param {string} type - Content type ('movie' or 'series')
 * @returns {boolean} - True if format is acceptable
 */
function verifyReviewFormat(raw, type) {
  if (!raw || typeof raw !== 'string') {
    vlog('Invalid input: not a string');
    return false;
  }
  
  // Basic completeness checks
  if (raw.trim().length < 500) {
    vlog('Review too short (minimum 500 characters)');
    return false;
  }
  
  // Validate basic info sections
  if (!validateBasicInfo(raw, type)) {
    return false;
  }
  
  // Validate content sections
  if (!validateContentSections(raw)) {
    return false;
  }
  
  // Validate rating format
  if (!validateRating(raw)) {
    return false;
  }
  
  // Validate verdict sections
  if (!validateVerdicts(raw)) {
    return false;
  }
  
  // Optional sections that should exist but are not critical
  const optionalSections = [
    'Critical Reception',
    'Audience Reception',
    'Box Office and Viewership',
    'Who would like it',
    'Who would not like it',
    'Similar Films',
    'Overall Verdict'
  ];
  
  let missingOptional = 0;
  for (const section of optionalSections) {
    if (!headingExists(raw, section)) {
      missingOptional++;
    }
  }
  
  // Allow some optional sections to be missing, but not too many
  if (missingOptional > 2) {
    vlog(`Too many optional sections missing: ${missingOptional}/${optionalSections.length}`);
    return false;
  }
  
  vlog('Review format validation passed');
  return true;
}

module.exports = verifyReviewFormat;

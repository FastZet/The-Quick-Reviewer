/*
 * src/core/reviewVerifier.js
 * DEBUG VERSION - Simplified validation with detailed logging for troubleshooting
 */

'use strict';

// Enable debug logging by default for troubleshooting
const DEBUG = true;

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
  vlog('Rating section extracted:', ratingSection);
  
  if (!ratingSection) {
    vlog('Rating section missing');
    return false;
  }
  
  // Look for X/10 format
  const ratingMatch = ratingSection.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  vlog('Rating match result:', ratingMatch);
  
  if (!ratingMatch) {
    vlog('Rating not in X/10 format');
    return false;
  }
  
  const score = parseFloat(ratingMatch[1]);
  if (score < 0 || score > 10) {
    vlog('Rating score out of valid range (0-10):', score);
    return false;
  }
  
  vlog('Rating validation passed:', score);
  return true;
}

// Check if verdict sections exist
function validateVerdicts(text) {
  const oneLineVerdict = extractSection(text, 'Verdict in One Line');
  vlog('One-line verdict extracted:', oneLineVerdict);
  
  if (!oneLineVerdict) {
    vlog('Single-line verdict missing');
    return false;
  }
  
  if (oneLineVerdict.length === 0 || oneLineVerdict.length > 200) {
    vlog('Single-line verdict length invalid:', oneLineVerdict.length);
    return false;
  }
  
  vlog('Single-line verdict validation passed');
  
  // Two-line verdict is optional but validate if present
  const twoLineSection = extractSection(text, 'Two-Line Verdict');
  vlog('Two-line verdict section:', twoLineSection);
  
  if (twoLineSection) {
    const lines = twoLineSection.split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length > 0);
    
    vlog('Two-line verdict parsed lines:', lines);
    
    if (lines.length !== 2) {
      vlog('Two-line verdict does not have exactly 2 lines:', lines.length);
      return false;
    }
    
    // Check line lengths (reasonable limits)
    for (const line of lines) {
      if (line.length === 0 || line.length > 100) {
        vlog('Two-line verdict line length invalid:', line.length, 'content:', line);
        return false;
      }
    }
    
    vlog('Two-line verdict validation passed');
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
  
  vlog('Checking required content sections...');
  
  for (const section of requiredSections) {
    const content = extractSection(text, section);
    vlog(`Section "${section}":`, content ? `Found (${content.length} chars)` : 'MISSING');
    
    if (!content || content.trim().length === 0) {
      vlog(`Required section missing or empty: ${section}`);
      return false;
    }
  }
  
  vlog('All required content sections validated successfully');
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
  
  vlog('Checking basic info sections for type:', type);
  
  // Check movie vs series specific sections
  if (type === 'series') {
    if (!headingExists(text, 'Name Of The Series')) {
      vlog('Series name section missing');
      return false;
    }
    vlog('Series name section found');
    
    // Episode might have additional sections
    const hasEpisodeName = headingExists(text, 'Name Of The Episode');
    const hasSeasonEpisode = headingExists(text, 'Season Episode');
    
    vlog('Episode sections - Name:', hasEpisodeName, 'Season/Episode:', hasSeasonEpisode);
    
    if (hasEpisodeName && !hasSeasonEpisode) {
      vlog('Episode has name but missing season/episode info');
      return false;
    }
  } else {
    if (!headingExists(text, 'Name Of The Movie')) {
      vlog('Movie name section missing');
      return false;
    }
    vlog('Movie name section found');
  }
  
  // Check common required sections
  for (const section of commonSections) {
    const exists = headingExists(text, section);
    vlog(`Basic info section "${section}":`, exists ? 'Found' : 'MISSING');
    
    if (!exists) {
      vlog(`Basic info section missing: ${section}`);
      return false;
    }
  }
  
  vlog('All basic info sections validated successfully');
  return true;
}

/**
 * DEBUG VERSION - Simplified review format verification with extensive logging
 * @param {string} raw - The raw AI-generated review text
 * @param {string} type - Content type ('movie' or 'series')
 * @returns {boolean} - True if format is acceptable
 */
function verifyReviewFormat(raw, type) {
  vlog('=== REVIEW VERIFICATION START ===');
  vlog('Content type:', type);
  vlog('Content length:', raw ? raw.length : 0);
  
  if (!raw || typeof raw !== 'string') {
    vlog('FAIL: Invalid input - not a string');
    return false;
  }
  
  // Show first 500 characters for debugging
  vlog('Content preview:', raw.substring(0, 500) + (raw.length > 500 ? '...' : ''));
  
  // Basic completeness checks
  if (raw.trim().length < 500) {
    vlog('FAIL: Review too short (minimum 500 characters)');
    return false;
  }
  
  // Show all headers found in the content
  const headerMatches = raw.match(/^##\s+.+$/gm);
  vlog('Headers found:', headerMatches || 'None');
  
  // Validate basic info sections
  vlog('--- Validating Basic Info ---');
  if (!validateBasicInfo(raw, type)) {
    vlog('FAIL: Basic info validation failed');
    return false;
  }
  
  // Validate content sections
  vlog('--- Validating Content Sections ---');
  if (!validateContentSections(raw)) {
    vlog('FAIL: Content sections validation failed');
    return false;
  }
  
  // Validate rating format
  vlog('--- Validating Rating ---');
  if (!validateRating(raw)) {
    vlog('FAIL: Rating validation failed');
    return false;
  }
  
  // Validate verdict sections
  vlog('--- Validating Verdicts ---');
  if (!validateVerdicts(raw)) {
    vlog('FAIL: Verdict validation failed');
    return false;
  }
  
  // Optional sections check
  vlog('--- Checking Optional Sections ---');
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
    const exists = headingExists(raw, section);
    vlog(`Optional section "${section}":`, exists ? 'Found' : 'Missing');
    if (!exists) missingOptional++;
  }
  
  vlog('Missing optional sections:', missingOptional, 'out of', optionalSections.length);
  
  // Allow some optional sections to be missing, but not too many
  if (missingOptional > 2) {
    vlog(`FAIL: Too many optional sections missing: ${missingOptional}/${optionalSections.length}`);
    return false;
  }
  
  vlog('=== REVIEW VERIFICATION SUCCESS ===');
  return true;
}

module.exports = verifyReviewFormat;

/*
 * src/core/reviewVerifier.js
 * Fixed version with more robust section extraction
 */

'use strict';

// Enable debug logging via environment variable
const DEBUG = String(process.env.REVIEW_VERIFIER_DEBUG || 'false').toLowerCase() === 'true';

function vlog(...args) {
  if (DEBUG) console.log('[Verify]', ...args);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Generic matcher for markdown headers like ## Heading
function headingExists(text, heading) {
  const pattern = new RegExp(`^##\\s*${escapeRegExp(heading)}\\s*$`, 'mi');
  return pattern.test(text);
}

// Extract content after a markdown header - COMPLETELY REWRITTEN
function extractSection(text, heading) {
  const lines = text.split('\n');
  const targetHeader = `## ${heading}`;
  
  let startIndex = -1;
  let endIndex = lines.length;
  
  // Find the target header line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === targetHeader || line === `## ${heading}  `) { // Handle trailing spaces
      startIndex = i;
      break;
    }
  }
  
  if (startIndex === -1) {
    vlog(`Header "${heading}" not found`);
    return null;
  }
  
  // Find the next header to determine end
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ') && line.length > 3) {
      endIndex = i;
      break;
    }
  }
  
  // Extract content between headers
  const contentLines = lines.slice(startIndex + 1, endIndex);
  const content = contentLines.join('\n').trim();
  
  if (DEBUG) {
    vlog(`Section "${heading}" extraction:`, {
      startIndex,
      endIndex,
      contentLength: content.length,
      preview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
    });
  }
  
  return content.length > 0 ? content : null;
}

// Rest of the functions remain the same...
function validateRating(text) {
  const ratingSection = extractSection(text, 'Rating');
  vlog('Rating section extracted:', ratingSection);
  
  if (!ratingSection) {
    vlog('Rating section missing');
    return false;
  }
  
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
  return true;
}

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
  
  if (type === 'series') {
    if (!headingExists(text, 'Name Of The Series')) {
      vlog('Series name section missing');
      return false;
    }
    vlog('Series name section found');
  } else {
    if (!headingExists(text, 'Name Of The Movie')) {
      vlog('Movie name section missing');
      return false;
    }
    vlog('Movie name section found');
  }
  
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

function verifyReviewFormat(raw, type) {
  vlog('=== REVIEW VERIFICATION START ===');
  vlog('Content type:', type);
  vlog('Content length:', raw ? raw.length : 0);
  
  if (!raw || typeof raw !== 'string') {
    vlog('FAIL: Invalid input - not a string');
    return false;
  }
  
  if (DEBUG) {
    vlog('Content preview:', raw.substring(0, 500) + (raw.length > 500 ? '...' : ''));
  }
  
  if (raw.trim().length < 500) {
    vlog('FAIL: Review too short (minimum 500 characters)');
    return false;
  }
  
  if (DEBUG) {
    const headerMatches = raw.match(/^##\s+.+$/gm);
    vlog('Headers found:', headerMatches || 'None');
  }
  
  vlog('--- Validating Basic Info ---');
  if (!validateBasicInfo(raw, type)) {
    vlog('FAIL: Basic info validation failed');
    return false;
  }
  
  vlog('--- Validating Content Sections ---');
  if (!validateContentSections(raw)) {
    vlog('FAIL: Content sections validation failed');
    return false;
  }
  
  vlog('--- Validating Rating ---');
  if (!validateRating(raw)) {
    vlog('FAIL: Rating validation failed');
    return false;
  }
  
  vlog('--- Validating Verdicts ---');
  if (!validateVerdicts(raw)) {
    vlog('FAIL: Verdict validation failed');
    return false;
  }
  
  vlog('=== REVIEW VERIFICATION SUCCESS ===');
  return true;
}

module.exports = verifyReviewFormat;

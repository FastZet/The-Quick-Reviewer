// src/core/stremioStreamer.js — Contains the core logic for building the Stremio stream object.

const manifest = require('../../manifest.json');
const { getReview } = require('../api.js');
const { buildStreamTitle } = require('./streamTitleBuilder.js');

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS, 10) || 13000;

function extract8PointSummary(rawReviewText) {
  if (!rawReviewText) return [];
  
  try {
    // Look for 8-Point Summary section in the AI response
    const summaryMatch = rawReviewText.match(/8-Point Summary:(.*?)(?:\n\n|\n•|\n[A-Z]|$)/s);
    if (summaryMatch) {
      const summaryText = summaryMatch[1];
      const points = summaryText.split(/\n/).filter(line => line.trim().startsWith('•')).slice(0, 8);
      return points.map(point => point.replace('•', '').trim().substring(0, 25)); // Updated to 25 chars
    }
    
    // Look for direct 8-point bullets after basic info (new format)
    const directBulletsMatch = rawReviewText.match(/Release Country:.*?\n((?:•[^\n]{1,25}\n?){8})/s);
    if (directBulletsMatch) {
      const directBullets = directBulletsMatch[1];
      const points = directBullets.split(/\n/).filter(line => line.trim().startsWith('•')).slice(0, 8);
      return points.map(point => point.replace('•', '').trim().substring(0, 25));
    }
    
    // Fallback: Extract evaluative statements from existing sections
    const fallbackPoints = [];
    
    // Look for evaluative statements in the review content
    const verdictMatch = rawReviewText.match(/Verdict in One Line:(.*?)(?:\n|$)/s);
    if (verdictMatch) {
      const verdict = verdictMatch[1].trim();
      // Split verdict into shorter evaluative pieces
      const words = verdict.split(' ');
      if (words.length > 5) {
        fallbackPoints.push(words.slice(0, 4).join(' '));
        fallbackPoints.push(words.slice(4, 8).join(' '));
      } else {
        fallbackPoints.push(verdict.substring(0, 25));
      }
    }
    
    // Extract from Strengths
    const strengthMatch = rawReviewText.match(/Strengths:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (strengthMatch && fallbackPoints.length < 6) {
      const strengths = strengthMatch[1].trim();
      const strengthParts = strengths.split(/[.,;]/).slice(0, 3);
      strengthParts.forEach(part => {
        if (fallbackPoints.length < 6) {
          fallbackPoints.push(part.trim().substring(0, 25));
        }
      });
    }
    
    // Extract from Weaknesses  
    const weakMatch = rawReviewText.match(/Weaknesses:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (weakMatch && fallbackPoints.length < 8) {
      const weaknesses = weakMatch[1].trim();
      const weakParts = weaknesses.split(/[.,;]/).slice(0, 2);
      weakParts.forEach(part => {
        if (fallbackPoints.length < 8) {
          fallbackPoints.push(part.trim().substring(0, 25));
        }
      });
    }
    
    // Fill remaining slots with generic evaluative points
    const genericPoints = [
      "Mixed execution",
      "Some highlights", 
      "Worth considering"
    ];
    
    for (let i = fallbackPoints.length; i < 8 && i - fallbackPoints.length < genericPoints.length; i++) {
      fallbackPoints.push(genericPoints[i - fallbackPoints.length]);
    }
    
    return fallbackPoints.slice(0, 8);
  } catch (error) {
    console.warn('[Stream] Error extracting 8-point summary:', error.message);
    return [
      "Review available",
      "Click for details",
      "AI analysis ready",
      "Professional critique", 
      "Spoiler-free content",
      "Multiple sections",
      "Full breakdown",
      "Worth reading"
    ];
  }
}

function build8PointStreamTitle(points) {
  if (!points || points.length === 0) {
    return "⚡ Quick 8-Point Review\nClick to see detailed analysis";
  }
  
  // No header line - just the bullets directly
  const formattedPoints = points.map(point => `● ${point}`).join('\n');
  
  return formattedPoints;
}

function buildVerdictText(verdict, isFullReview = false) {
  if (!verdict) {
    return isFullReview ? 'Click for comprehensive analysis\nComplete critical breakdown' : 'Click to read plot & verdict';
  }
  
  if (isFullReview) {
    // For full review: split verdict into 2 lines if long enough, or add descriptive second line
    if (verdict.length > 40) {
      const midPoint = verdict.indexOf(' ', verdict.length / 2);
      if (midPoint > 0) {
        return verdict.substring(0, midPoint) + '\n' + verdict.substring(midPoint + 1);
      }
    }
    // Add descriptive second line for full reviews
    return verdict + '\n' + 'Complete critical analysis';
  }
  
  // For quick review: single line verdict only
  return verdict;
}

async function buildStreamResponse(req) {
  const { type, id } = req.params;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const base = BASE_URL || (host ? `${proto}://${host}` : '');
  const secretPath = ADDON_PASSWORD ? `/${ADDON_PASSWORD}` : '';

  // Build URLs for different review types
  const quickReviewUrl = `${base}${secretPath}/review-quick?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  const fullReviewUrl = `${base}${secretPath}/review-full?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

  // Base stream configuration
  const baseStreamConfig = {
    name: 'The Quick Reviewer',
    poster: manifest.icon || undefined,
    behaviorHints: { notWebReady: true }
  };

  let streams = [];
  let reviewData = null;
  let eightPoints = [];

  try {
    console.log(`[Stream] Received request for ${id}. Starting review generation/retrieval...`);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ADDON_TIMEOUT_MS)
    );

    reviewData = await Promise.race([
      getReview(String(id).trim(), type, false),
      timeoutPromise
    ]);

    if (reviewData && reviewData.raw) {
      eightPoints = extract8PointSummary(reviewData.raw);
      console.log(`[Stream] Generation for ${id} SUCCEEDED. Extracted ${eightPoints.length} points.`);
    } else {
      console.log(`[Stream] Generation for ${id} completed but no raw review data available.`);
    }
  } catch (error) {
    if (error.message === 'Timeout') {
      console.warn(`[Stream] Generation for ${id} TIMED OUT. Using fallback content.`);
    } else {
      console.error(`[Stream] Generation for ${id} FAILED with error:`, error.message);
    }
  }

  // Stream 1: 8-Point Summary Stream (no title line, just bullets)
  const eightPointStream = {
    id: `quick-reviewer-summary-${type}-${id}`,
    title: build8PointStreamTitle(eightPoints),
    externalUrl: quickReviewUrl,
    ...baseStreamConfig
  };

  // Stream 2: Quick Review Stream (single-line verdict)
  const quickStream = {
    id: `quick-reviewer-quick-${type}-${id}`,
    title: `⚡ Quick Review\n${buildVerdictText(reviewData?.verdict, false)}\n📖 Plot Summary + Overall Verdict`,
    externalUrl: quickReviewUrl,
    ...baseStreamConfig
  };

  // Stream 3: Full Review Stream (two-line verdict)
  const fullStream = {
    id: `quick-reviewer-full-${type}-${id}`,
    title: `⚡ Complete Review\n${buildVerdictText(reviewData?.verdict, true)}\n🎬 All Sections + Detailed Analysis`,
    externalUrl: fullReviewUrl,
    ...baseStreamConfig
  };

  streams = [eightPointStream, quickStream, fullStream];

  console.log(`[Stream] Returning ${streams.length} streams for ${id}`);
  return { streams };
}

module.exports = { buildStreamResponse };

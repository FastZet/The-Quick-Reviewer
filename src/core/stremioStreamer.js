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
    // Look for 8-point summary section in the AI response
    const summaryMatch = rawReviewText.match(/8-Point Summary:(.*?)(?:\n\n|\n•|\n[A-Z]|$)/s);
    if (summaryMatch) {
      const summaryText = summaryMatch[1];
      const points = summaryText.split(/\n/).filter(line => line.trim().startsWith('•')).slice(0, 8);
      return points.map(point => point.replace('•', '').trim().substring(0, 20));
    }
    
    // Fallback: Extract key points from existing sections
    const fallbackPoints = [];
    
    // Extract from Plot Summary
    const plotMatch = rawReviewText.match(/Plot Summary:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (plotMatch) {
      fallbackPoints.push("Plot: " + plotMatch[1].trim().substring(0, 15));
    }
    
    // Extract from Performances
    const perfMatch = rawReviewText.match(/Performances:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (perfMatch) {
      fallbackPoints.push("Acting: " + perfMatch[1].trim().substring(0, 13));
    }
    
    // Extract from Cinematography
    const cinemMatch = rawReviewText.match(/Cinematography:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (cinemMatch) {
      fallbackPoints.push("Visuals: " + cinemMatch[1].trim().substring(0, 12));
    }
    
    // Extract from Strengths
    const strengthMatch = rawReviewText.match(/Strengths:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (strengthMatch) {
      fallbackPoints.push("Pros: " + strengthMatch[1].trim().substring(0, 15));
    }
    
    // Extract from Weaknesses
    const weakMatch = rawReviewText.match(/Weaknesses:(.*?)(?:\n•|\n[A-Z]|$)/s);
    if (weakMatch) {
      fallbackPoints.push("Cons: " + weakMatch[1].trim().substring(0, 15));
    }
    
    // Extract rating
    const ratingMatch = rawReviewText.match(/Rating:\s*(\d+(?:\.\d+)?\/10)/);
    if (ratingMatch) {
      fallbackPoints.push("Score: " + ratingMatch[1]);
    }
    
    // Extract verdict
    const verdictMatch = rawReviewText.match(/Verdict in One Line:(.*?)(?:\n|$)/s);
    if (verdictMatch) {
      fallbackPoints.push("Verdict: " + verdictMatch[1].trim().substring(0, 12));
    }
    
    // Fill remaining slots with generic points
    const genericPoints = [
      "Genre mix analysis",
      "Technical quality", 
      "Entertainment value"
    ];
    
    for (let i = fallbackPoints.length; i < 8 && i < genericPoints.length; i++) {
      fallbackPoints.push(genericPoints[i]);
    }
    
    return fallbackPoints.slice(0, 8);
  } catch (error) {
    console.warn('[Stream] Error extracting 8-point summary:', error.message);
    return [
      "Review available",
      "Click to read more",
      "AI-generated content",
      "Spoiler-free analysis",
      "Professional critique",
      "In-depth coverage",
      "Multiple sections",
      "Full breakdown"
    ];
  }
}

function build8PointStreamTitle(points) {
  if (!points || points.length === 0) {
    return "⚡ Quick 8-Point Review\nClick to see detailed analysis";
  }
  
  const header = "⚡ 8-Point Quick Review";
  const formattedPoints = points.map(point => `• ${point}`).join('\n');
  
  return `${header}\n${formattedPoints}`;
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

  // Stream 1: 8-Point Summary Stream
  const eightPointStream = {
    id: `quick-reviewer-summary-${type}-${id}`,
    title: build8PointStreamTitle(eightPoints),
    externalUrl: quickReviewUrl,
    ...baseStreamConfig
  };

  // Stream 2: Quick Review Stream
  const quickStream = {
    id: `quick-reviewer-quick-${type}-${id}`,
    title: `⚡ Quick Review\n${reviewData?.verdict || 'Click to read plot & verdict'}\n📖 Plot Summary + Overall Verdict`,
    externalUrl: quickReviewUrl,
    ...baseStreamConfig
  };

  // Stream 3: Full Review Stream
  const fullStream = {
    id: `quick-reviewer-full-${type}-${id}`,
    title: `⚡ Complete Review\n${reviewData?.verdict || 'Click for full analysis'}\n🎬 All Sections + Detailed Analysis`,
    externalUrl: fullReviewUrl,
    ...baseStreamConfig
  };

  streams = [eightPointStream, quickStream, fullStream];

  console.log(`[Stream] Returning ${streams.length} streams for ${id}`);
  return { streams };
}

module.exports = { buildStreamResponse };

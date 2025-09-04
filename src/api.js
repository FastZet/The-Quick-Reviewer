// src/api.js — The main orchestrator for review generation with self-correction.

const { readReview, saveReview } = require('./core/cache');
const { scrapeImdbForEpisodeTitle } = require('./core/scraper');
const { enforceReviewStructure } = require('./core/formatEnforcer');
const { fetchMovieSeriesMetadata, fetchEpisodeMetadata } = require('./services/metadataService');
const { buildPromptFromMetadata } = require('./config/promptBuilder');
const { generateReview } = require('./services/geminiService');
const { parseVerdictFromReview } = require('./core/reviewParser');
const { verifyReviewFormat } = require('./core/reviewVerifier');

const pendingReviews = new Map();
const MAX_GENERATION_ATTEMPTS = 2;

// --- Main Orchestrator ---
async function getReview(id, type, forceRefresh = false) {
  console.log(`\n===== [API] New Request Start =====`);
  console.log(`[API] Received request for type: ${type}, id: ${id}, forceRefresh: ${forceRefresh}`);
  
  if (!forceRefresh) {
    const cached = readReview(id);
    if (cached) {
      console.log(`[Cache] Cache hit for ${id}. Returning cached review.`);
      return cached;
    }
    if (pendingReviews.has(id)) {
      console.log(`[API] Generation for ${id} is already in progress. Awaiting result...`);
      return await pendingReviews.get(id);
    }
    console.log(`[Cache] Cache miss for ${id}. Proceeding to generate new review.`);
  }

  const generationPromise = (async () => {
    try {
      let metadata, prompt, rawReview, isValid = false;

      // --- Self-Correction Loop ---
      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        console.log(`[API] Generation attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} for ${id}...`);

        // Only fetch metadata on the first attempt
        if (attempt === 1) {
          const idParts = String(id).split(':');
          const isEpisode = type === 'series' && idParts.length === 3;
          if (isEpisode) { /* ... episode logic ... */ } 
          else { /* ... movie/series logic ... */ }
          if (!metadata || !prompt) throw new Error("Failed to gather metadata or build prompt.");
        }
        rawReview = await generateReview(prompt);
        isValid = verifyReviewFormat(rawReview, type);

        if (isValid) {
          console.log(`[API] Review for ${id} passed verification on attempt ${attempt}.`);
          break; // Exit loop on success
        } else {
          console.warn(`[API] Review for ${id} failed verification on attempt ${attempt}. Retrying...`);
        }
      }

      if (!isValid) {
        console.error(`[API] Review for ${id} failed verification after all ${MAX_GENERATION_ATTEMPTS} attempts.`);
        throw new Error("AI failed to generate a review with the correct format.");
      }

      const verdict = parseVerdictFromReview(rawReview);
      const finalReviewHtml = enforceReviewStructure(rawReview);
      
      const result = { review: finalReviewHtml, verdict: verdict };
      saveReview(id, result, type);
      
      console.log(`===== [API] Request End (Success) =====\n`);
      return result;
      
    } catch (error) {
        console.error(`[API] An error occurred during review generation for ${id}:`, error);
        return { review: 'Error: Review generation failed after multiple attempts.', verdict: null };
    } finally {
      pendingReviews.delete(id);
    }
  })();

  pendingReviews.set(id, generationPromise);
  return await generationPromise;
}

function reconcileLanguage(reviewText, apiLanguages, sourceName) {
    const langRegex = /• \*\*Language:\*\*([^\n]*)/;
    const match = reviewText.match(langRegex);
    const aiLangs = match ? match[1].trim().split(',').map(l => l.trim()).filter(Boolean) : [];
    const apiLangs = (apiLanguages || []).filter(Boolean);

    if (apiLangs.length === 0 && aiLangs.length === 0) {
        return match ? reviewText.replace(langRegex, '').replace(/^\s*[\r\n]/gm, '') : reviewText;
    }

    if (apiLangs.length > 0 && aiLangs.length === 0) {
        const apiLangLine = `• **Language:** ${apiLangs.join(', ')}`;
        if (match) {
            return reviewText.replace(langRegex, apiLangLine);
        } else {
            const directorRegex = /(• \*\*(?:Directed By|Directed by):\*\*[^\n]*)/;
            return reviewText.replace(directorRegex, `$1\n${apiLangLine}`);
        }
    }

    if (apiLangs.length === 0 && aiLangs.length > 0) {
        const aiLangLine = `• **Language:** ${aiLangs.join(', ')} (Gemini AI)`;
        return reviewText.replace(langRegex, aiLangLine);
    }

    const combinedLangs = new Set([...aiLangs, ...apiLangs]);
    const finalLangs = Array.from(combinedLangs).map(lang => {
        const inApi = apiLangs.includes(lang);
        const inAi = aiLangs.includes(lang);
        if (inApi && inAi) return lang;
        if (inApi) return `${lang} (${sourceName.toUpperCase()})`;
        return `${lang} (Gemini AI)`;
    });

    const finalLine = `• **Language:** ${finalLangs.join(', ')}`;
    return reviewText.replace(langRegex, finalLine);
}

module.exports = { getReview };

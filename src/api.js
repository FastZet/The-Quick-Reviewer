// src/api.js — The main orchestrator for review generation.

const { readReview, saveReview } = require('./core/cache');
const { scrapeImdbForEpisodeTitle } = require('./core/scraper');
const { enforceReviewStructure } = require('./core/formatEnforcer');
const { fetchMovieSeriesMetadata, fetchEpisodeMetadata } = require('./services/metadataService');
const { buildPromptFromMetadata } = require('./config/promptBuilder');
const { generateReview } = require('./services/geminiService');

const pendingReviews = new Map();

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
      const idParts = String(id).split(':');
      const isEpisode = type === 'series' && idParts.length === 3;
      let metadata, prompt;
      
      if (isEpisode) {
        const [seriesId, season, episode] = idParts;
        console.log(`[API] Handling episode: ${seriesId} S${season}E${episode}`);
        const [scrapedEpisodeTitle, episodeMetadata, seriesMetadata] = await Promise.all([
          scrapeImdbForEpisodeTitle(seriesId, season, episode),
          fetchEpisodeMetadata(seriesId, season, episode),
          fetchMovieSeriesMetadata('series', seriesId)
        ]);
        metadata = episodeMetadata;
        if (metadata && seriesMetadata) {
          console.log("[API] Successfully gathered all required metadata for episode.");
          const seriesInfo = { title: seriesMetadata.data.title || seriesMetadata.data.name || seriesMetadata.data.Title };
          metadata.languages = seriesMetadata.languages;
          metadata.source = seriesMetadata.source;
          prompt = buildPromptFromMetadata(metadata, type, seriesInfo, scrapedEpisodeTitle);
        }
      } else {
        console.log(`[API] Handling ${type}: ${id}`);
        metadata = await fetchMovieSeriesMetadata(type, id);
        if (metadata) {
          console.log(`[API] Successfully gathered metadata for ${type}.`);
          prompt = buildPromptFromMetadata(metadata, type);
        }
      }

      if (!metadata || !prompt) {
        console.error(`[API] Failed to get metadata or build prompt for ${id}.`);
        const fallbackText = 'Plot Summary:\n- Unable to fetch official metadata for this item. Please try again later.';
        saveReview(id, fallbackText, type);
        return fallbackText;
      }

      console.log(`[API] Generating review for ${id}...`);
      let rawReview = await generateReview(prompt);

      let finalReview = rawReview;
      if (finalReview && !finalReview.startsWith('Error')) {
        finalReview = enforceReviewStructure(rawReview);
        finalReview = reconcileLanguage(finalReview, metadata.languages, metadata.source);
      }
      
      console.log(`[API] Review generation finished for ${id}. Saving to cache.`);
      saveReview(id, finalReview, type);
      console.log(`===== [API] Request End (Success) =====\n`);
      return finalReview;
    } catch (error) {
        console.error(`[API] An error occurred during review generation for ${id}:`, error);
        return 'Error: Review generation failed.';
    } finally {
      pendingReviews.delete(id);
      console.log(`[API] Removed ${id} from pending queue.`);
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

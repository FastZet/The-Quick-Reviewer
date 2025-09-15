// src/api.js — The main orchestrator for review generation with self-correction.

const { readReview, saveReview } = require('./core/storage');
const { scrapeImdbForEpisodeTitle } = require('./core/scraper');
const { fetchMovieSeriesMetadata, fetchEpisodeMetadata } = require('./services/metadataService');
const { buildPromptFromMetadata } = require('./config/promptBuilder');
const { generateReview } = require('./services/geminiService');
const { parseVerdictFromReview } = require('./core/reviewParser');
const { verifyReviewFormat } = require('./core/reviewVerifier');

const pendingReviews = new Map();
const MAX_GENERATION_ATTEMPTS = 2;

async function getReview(id, type, forceRefresh = false) {
  console.log(`\n===== [API] New Request Start =====`);
  console.log(`[API] Received request for type: ${type}, id: ${id}, forceRefresh: ${forceRefresh}`);
  
  if (!forceRefresh) {
    const cached = await readReview(id);

    // CORRECTED & HARDENED CACHE CHECK:
    // We now verify that `cached.review` is an object and has a `raw` property.
    // This prevents errors from stale cache entries that might be strings or other types.
    if (cached && typeof cached.review === 'object' && cached.review !== null && 'raw' in cached.review) {
      console.log(`[Cache] Cache hit for ${id}. Returning valid cached review.`);
      return { ...cached.review, ts: cached.ts };
    }

    if (pendingReviews.has(id)) {
      console.log(`[API] Generation for ${id} is already in progress. Awaiting result...`);
      return await pendingReviews.get(id);
    }
    console.log(`[Cache] Cache miss or invalid cache structure for ${id}. Proceeding to generate new review.`);
  }

  const generationPromise = (async () => {
    try {
      let metadata, prompt, rawReview, isValid = false;

      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        console.log(`[API] Generation attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} for ${id}...`);
        
        if (attempt === 1) {
          const idParts = String(id).split(':');
          const isEpisode = type === 'series' && idParts.length === 3;

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
              const seriesInfo = { title: seriesMetadata.data.title || seriesMetadata.data.name || seriesMetadata.data.Title };
              metadata.languages = seriesMetadata.languages;
              metadata.source = seriesMetadata.source;
              prompt = buildPromptFromMetadata(metadata, type, seriesInfo, scrapedEpisodeTitle);
            }
          } else {
            console.log(`[API] Handling ${type}: ${id}`);
            metadata = await fetchMovieSeriesMetadata(type, id);
            if (metadata) {
              prompt = buildPromptFromMetadata(metadata, type);
            }
          }

          if (!metadata || !prompt) {
            throw new Error("Failed to gather metadata or build prompt.");
          }
        }

        rawReview = await generateReview(prompt);
        isValid = verifyReviewFormat(rawReview, type);

        if (isValid) {
          console.log(`[API] Review for ${id} passed verification on attempt ${attempt}.`);
          break;
        } else {
          console.warn(`[API] Review for ${id} failed verification on attempt ${attempt}. Retrying...`);
        }
      }

      if (!isValid) {
        console.error(`[API] Review for ${id} failed verification after all ${MAX_GENERATION_ATTEMPTS} attempts.`);
        throw new Error("AI failed to generate a review with the correct format.");
      }

      const verdict = parseVerdictFromReview(rawReview);
      
      const result = { raw: rawReview, verdict: verdict };
      await saveReview(id, result, type);
      
      console.log(`===== [API] Request End (Success) =====\n`);
      return { ...result, ts: Date.now() };

    } catch (error) {
        console.error(`[API] An error occurred during review generation for ${id}:`, error);
        return { 
          raw: `Error: Review generation failed. ${error.message}`, 
          verdict: null,
          ts: Date.now()
        };
    } finally {
      pendingReviews.delete(id);
    }
  })();

  pendingReviews.set(id, generationPromise);
  return await generationPromise;
}

module.exports = { getReview };

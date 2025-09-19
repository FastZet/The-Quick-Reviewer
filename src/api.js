/*
 * src/api.js
 * The main orchestrator for review generation with self-correction
 */

const { readReview, saveReview } = require('./core/storage');
const { scrapeImdbForEpisodeTitle } = require('./core/scraper');
const { fetchMovieSeriesMetadata, fetchEpisodeMetadata } = require('./services/metadataService');
const { buildPromptFromMetadata } = require('./config/promptBuilder');
const { generateReview } = require('./services/aiService');
const { parseVerdictFromReview } = require('./core/reviewParser');
const verifyReviewFormat = require('./core/reviewVerifier');  // FIXED: Direct import instead of destructuring

const pendingReviews = new Map();
const MAX_GENERATION_ATTEMPTS = 2;

async function getReview(id, type, forceRefresh = false) {
  console.log('===== [API] New Request Start =====');
  console.log(`[API] Received request for type: ${type}, id: ${id}, forceRefresh: ${forceRefresh}`);
  
  if (!forceRefresh) {
    const cached = await readReview(id);
    
    // CORRECTED HARDENED CACHE CHECK
    // We now verify that cached.review is an object and has a raw property.
    // This prevents errors from stale cache entries that might be strings or other types.
    if (cached && typeof cached.review === 'object' && cached.review !== null && 'raw' in cached.review) {
      console.log(`[Cache] Cache hit for ${id}. Returning valid cached review.`);
      return { ...cached.review, ts: cached.ts };
    }
  }

  if (pendingReviews.has(id)) {
    console.log(`[API] Generation for ${id} is already in progress. Awaiting result...`);
    return await pendingReviews.get(id);
  }

  console.log(`[Cache] Cache miss or invalid cache structure for ${id}. Proceeding to generate new review.`);
  
  const generationPromise = (async () => {
    try {
      let metadata, seriesMetadata, prompt, rawReview, isValid = false;
      let posterUrl = null;
      let stillUrl = null;
      let backdropUrl = null;

      // Attempt generation up to MAX_GENERATION_ATTEMPTS times
      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        console.log(`[API] Generation attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} for ${id}...`);
        console.log(`[API] Handling ${type}: ${id}`);

        try {
          if (type === 'series') {
            // For TV series episodes
            const parts = id.split(':');
            const imdbId = parts[0];
            const season = parseInt(parts[1], 10);
            const episode = parseInt(parts[2], 10);

            // First, get series metadata - FIXED: correct parameter order
            seriesMetadata = await fetchMovieSeriesMetadata('series', imdbId);
            if (!seriesMetadata) {
              throw new Error(`Failed to fetch series metadata for ${imdbId}`);
            }

            // Extract series poster/backdrop from series metadata
            posterUrl = seriesMetadata.posterUrl;
            backdropUrl = seriesMetadata.backdropUrl;

            // Then get episode-specific metadata
            metadata = await fetchEpisodeMetadata(imdbId, season, episode, seriesMetadata.tmdbId);
            if (metadata && metadata.stillUrl) {
              stillUrl = metadata.stillUrl;
            }

            // Try to scrape episode title from IMDb
            const scrapedTitle = await scrapeImdbForEpisodeTitle(imdbId, season, episode);

            // Build prompt for episode
            prompt = buildPromptFromMetadata(metadata, 'series', seriesMetadata, scrapedTitle);
          } else {
            // For movies - FIXED: correct parameter order
            metadata = await fetchMovieSeriesMetadata('movie', id);
            if (!metadata) {
              throw new Error(`Failed to fetch movie metadata for ${id}`);
            }

            posterUrl = metadata.posterUrl;
            backdropUrl = metadata.backdropUrl;
            
            // Build prompt for movie
            prompt = buildPromptFromMetadata(metadata, 'movie');
          }

          if (!metadata || !prompt) {
            throw new Error('Failed to gather metadata or build prompt.');
          }

          // Generate the review
          rawReview = await generateReview(prompt);
          
          // Verify the format
          isValid = verifyReviewFormat(rawReview, type);
          
          if (isValid) {
            console.log(`[API] Review for ${id} passed verification on attempt ${attempt}.`);
            break;
          } else {
            console.warn(`[API] Review for ${id} failed verification on attempt ${attempt}. Retrying...`);
          }
        } catch (attemptError) {
          console.error(`[API] Attempt ${attempt} failed for ${id}:`, attemptError.message);
          if (attempt === MAX_GENERATION_ATTEMPTS) {
            throw attemptError;
          }
        }
      }

      if (!isValid) {
        console.error(`[API] Review for ${id} failed verification after all ${MAX_GENERATION_ATTEMPTS} attempts.`);
        throw new Error('AI failed to generate a review with the correct format.');
      }

      // Extract verdict for quick access
      const verdict = parseVerdictFromReview(rawReview);

      // Extract year helper
      function extractYear(metadata) {
        if (!metadata || !metadata.data) return null;
        
        const releaseDate = metadata.data.release_date || metadata.data.first_air_date || metadata.data.Released;
        if (releaseDate) {
          const yearMatch = releaseDate.match(/\d{4}/);
          return yearMatch ? yearMatch[0] : null;
        }
        return null;
      }

      // Enhanced result object with image metadata
      const result = {
        raw: rawReview,
        verdict: verdict,
        posterUrl: posterUrl,
        stillUrl: stillUrl,
        backdropUrl: backdropUrl,
        title: metadata?.data?.title || metadata?.data?.name || metadata?.data?.Title || 'Unknown',
        year: extractYear(metadata),
        imdbId: id.split(':')[0] // Extract base IMDb ID
      };

      await saveReview(id, result, type);
      console.log('===== [API] Request End: Success =====');
      return { ...result, ts: Date.now() };

    } catch (error) {
      console.error(`[API] An error occurred during review generation for ${id}:`, error);
      return {
        raw: `Error: Review generation failed. ${error.message}`,
        verdict: null,
        posterUrl: null,
        stillUrl: null,
        backdropUrl: null,
        title: 'Error',
        year: null,
        imdbId: id.split(':')[0],
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

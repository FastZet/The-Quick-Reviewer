// src/services/metadataService.js — Fetches and normalizes metadata from external APIs.

const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;

async function resolveImdbToTmdbId(imdbId, type) {
  if (!TMDB_API_KEY) return null;
  const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  console.log(`[TMDB] Resolving IMDb ID ${imdbId} to a TMDB ID...`);
  try {
    const res = await axios.get(url, { timeout: 8000 });
    const results = (type === 'series') ? res.data.tv_results : res.data.movie_results;
    if (results && results.length > 0) {
      const tmdbId = results[0].id;
      console.log(`[TMDB] Success! Resolved IMDb ID ${imdbId} to TMDB ID ${tmdbId}`);
      return tmdbId;
    }
    console.warn(`[TMDB] Could not find a TMDB ID for IMDb ID ${imdbId}`);
    return null;
  } catch (error) {
    console.error(`[TMDB] Error resolving IMDb ID ${imdbId}: ${error.message}`);
    return null;
  }
}

async function fetchMovieSeriesMetadata(type, imdbId) {
  const tmdbId = await resolveImdbToTmdbId(imdbId, type);
  let apiLanguages = [];
  
  // TMDB (Primary)
  if (tmdbId) {
    try {
      const tmdbType = (type === 'series') ? 'tv' : 'movie';
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log(`[TMDB] Fetching metadata for ${type} (TMDB ID: ${tmdbId})...`);
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        console.log(`[TMDB] Successfully fetched metadata for ${type} (TMDB ID: ${tmdbId}).`);
        if (res.data.spoken_languages && res.data.spoken_languages.length > 0) {
          apiLanguages = res.data.spoken_languages.map(lang => lang.english_name);
        }
        return { source: 'tmdb', data: res.data, languages: apiLanguages };
      }
    } catch (error) {
      console.warn(`[TMDB] Failed to fetch from TMDB for ${imdbId} (TMDB ID: ${tmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    console.log(`[OMDB] TMDB failed or unavailable. Falling back to OMDB for ${imdbId}.`);
    try {
      const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        console.log(`[OMDB] Successfully fetched metadata for ${imdbId} from OMDB.`);
        if (res.data.Language) {
          apiLanguages = res.data.Language.split(',').map(lang => lang.trim());
        }
        return { source: 'omdb', data: res.data, languages: apiLanguages };
      }
    } catch (error) {
      console.warn(`[OMDB] Failed to fetch from OMDB for ${imdbId}: ${error.message}`);
    }
  }
  console.error(`[Metadata] All metadata providers failed for ${type} with ID ${imdbId}.`);
  return null;
}

async function fetchEpisodeMetadata(seriesImdbId, season, episode) {
  const seriesTmdbId = await resolveImdbToTmdbId(seriesImdbId, 'series');
  // TMDB (Primary)
  if (seriesTmdbId) {
    try {
      const url = `https://api.themoviedb.org/3/tv/${seriesTmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log(`[TMDB] Fetching episode metadata for S${season}E${episode} (Series TMDB ID: ${seriesTmdbId})...`);
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        console.log(`[TMDB] Successfully fetched metadata for episode S${season}E${episode}.`);
        return { source: 'tmdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[TMDB] Failed for episode S${season}E${episode} (Series TMDB ID: ${seriesTmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    console.log(`[OMDB] TMDB failed for episode. Falling back to OMDB for ${seriesImdbId}.`);
    try {
      const url = `http://www.omdbapi.com/?i=${seriesImdbId}&Season=${season}&Episode=${episode}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        console.log(`[OMDB] Successfully fetched episode metadata for S${season}E${episode} from OMDB.`);
        return { source: 'omdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[OMDB] Failed for episode S${season}E${episode}: ${error.message}`);
    }
  }
  console.error(`[Metadata] All metadata providers failed for episode S${season}E${episode} of series ${seriesImdbId}.`);
  return null;
}

module.exports = {
  fetchMovieSeriesMetadata,
  fetchEpisodeMetadata
};

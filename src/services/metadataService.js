/*
 * src/services/metadataService.js
 * Enhanced metadata service with robust retry logic for each provider
 */

'use strict';

const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const TVDB_API_KEY = process.env.TVDB_API_KEY || null;
const TVDB_PIN = process.env.TVDB_PIN || null;
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

// Enhanced retry configuration
const RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Progressive backoff: 1s, 2s, 4s

// TVDB Auth Token Cache
let tvdbToken = null;
let tvdbTokenExpiry = 0;

// Helper function for retries with exponential backoff
async function retryWithBackoff(operation, context, attempts = RETRY_ATTEMPTS) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      const isLastAttempt = attempt === attempts;
      const shouldRetry = isRetryableError(error) && !isLastAttempt;
      
      console.error(`${context} Error on attempt ${attempt}/${attempts}:`, error.message);
      
      if (!shouldRetry) {
        throw error;
      }
      
      const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`${context} Retrying in ${delay}ms... (attempt ${attempt + 1}/${attempts})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Check if error is retryable (network issues, temporary server errors)
function isRetryableError(error) {
  const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
  const retryableStatuses = [429, 500, 502, 503, 504];
  
  return (
    retryableCodes.includes(error.code) ||
    retryableStatuses.includes(error.response?.status) ||
    error.message.includes('timeout')
  );
}

// TVDB Authentication with retry
async function getTvdbToken() {
  if (!TVDB_API_KEY) return null;
  
  const now = Date.now();
  if (tvdbToken && now < tvdbTokenExpiry - 60000) {
    return tvdbToken;
  }
  
  return retryWithBackoff(async () => {
    const payload = TVDB_PIN ? 
      { apikey: TVDB_API_KEY, pin: TVDB_PIN } : 
      { apikey: TVDB_API_KEY };
      
    const res = await axios.post('https://api4.thetvdb.com/v4/login', payload, {
      timeout: 8000
    });
    
    const token = res.data?.data?.token;
    if (!token) {
      throw new Error('TVDB login succeeded but no token returned');
    }
    
    tvdbToken = token;
    tvdbTokenExpiry = now + (23 * 60 * 60 * 1000); // 23 hours
    return tvdbToken;
  }, 'TVDB Auth');
}

// TMDB ID Resolution with retry
async function resolveImdbToTmdbId(imdbId, type) {
  if (!TMDB_API_KEY) return null;
  
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  
  console.log(`TMDB Resolving IMDb ID ${imdbId} to a TMDB ID...`);
  
  return retryWithBackoff(async () => {
    const res = await axios.get(url, { timeout: 8000 });
    const results = type === 'series' ? res.data?.tv_results : res.data?.movie_results;
    
    if (results && results.length > 0) {
      const tmdbId = results[0].id;
      console.log(`TMDB Success! Resolved IMDb ID ${imdbId} to TMDB ID ${tmdbId}`);
      return tmdbId;
    }
    
    console.warn(`TMDB Could not find a TMDB ID for IMDb ID ${imdbId}`);
    return null;
  }, `TMDB Resolve ${imdbId}`);
}

// TVDB ID Resolution with retry
async function resolveImdbToTvdbId(imdbId, type) {
  if (!TVDB_API_KEY) return null;
  
  const token = await getTvdbToken();
  if (!token) return null;
  
  const t = type === 'series' ? 'series' : 'movie';
  const url = `https://api4.thetvdb.com/v4/search/remote-ids?imdbId=${encodeURIComponent(imdbId)}&type=${t}`;
  
  console.log(`TVDB Resolving IMDb ID ${imdbId} to a TVDB ID...`);
  
  return retryWithBackoff(async () => {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const arr = res.data?.data;
    if (Array.isArray(arr) && arr.length > 0) {
      const tvdbId = arr[0]?.id;
      if (tvdbId) {
        console.log(`TVDB Success! Resolved IMDb ID ${imdbId} to TVDB ID ${tvdbId}`);
        return tvdbId;
      }
    }
    
    console.warn(`TVDB Could not find a TVDB ID for IMDb ID ${imdbId}`);
    return null;
  }, `TVDB Resolve ${imdbId}`);
}

// TVDB Details Fetch with retry
async function fetchTvdbDetails(type, tvdbId) {
  const token = await getTvdbToken();
  if (!token) return null;
  
  const isSeries = type === 'series';
  const baseUrl = isSeries ? 
    `https://api4.thetvdb.com/v4/series/${tvdbId}` : 
    `https://api4.thetvdb.com/v4/movies/${tvdbId}`;
    
  return retryWithBackoff(async () => {
    console.log(`TVDB Fetching metadata for ${type} TVDB ID ${tvdbId}...`);
    
    const res = await axios.get(baseUrl, {
      timeout: 8000,
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const data = res.data?.data || null;
    if (!data) return null;
    
    const posterUrl = data.image || null;
    const backdropUrl = null; // Not always present
    
    // Extract languages
    const languages = [];
    if (data.originalLanguage?.name) languages.push(data.originalLanguage.name);
    if (Array.isArray(data.languages)) {
      for (const lang of data.languages) {
        if (typeof lang === 'string') languages.push(lang);
        else if (lang?.name) languages.push(lang.name);
      }
    }
    
    return {
      source: 'tvdb',
      data,
      languages: languages.length ? languages : undefined,
      posterUrl,
      backdropUrl
    };
  }, `TVDB Details ${tvdbId}`);
}

// TMDB Details Fetch with retry
async function fetchTmdbDetails(tmdbId, type) {
  if (!TMDB_API_KEY) return null;
  
  const tmdbType = type === 'series' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
  
  return retryWithBackoff(async () => {
    console.log(`TMDB Fetching metadata for ${type} TMDB ID ${tmdbId}...`);
    
    const res = await axios.get(url, { timeout: 8000 });
    
    if (!res.data) return null;
    
    let posterUrl = null;
    let backdropUrl = null;
    
    if (res.data.poster_path) {
      posterUrl = `${TMDB_IMAGE_BASE_URL}${res.data.poster_path}`;
      console.log(`TMDB Found poster ${posterUrl}`);
    }
    
    if (res.data.backdrop_path) {
      backdropUrl = `${TMDB_IMAGE_BASE_URL}${res.data.backdrop_path}`;
      console.log(`TMDB Found backdrop ${backdropUrl}`);
    }
    
    let apiLanguages;
    if (res.data.spoken_languages && res.data.spoken_languages.length > 0) {
      apiLanguages = res.data.spoken_languages
        .map(lang => lang.english_name || lang.name)
        .filter(Boolean);
    }
    
    return {
      source: 'tmdb',
      data: res.data,
      languages: apiLanguages,
      posterUrl,
      backdropUrl
    };
  }, `TMDB Details ${tmdbId}`);
}

// OMDb Fetch with retry
async function fetchOmdbDetails(imdbId) {
  if (!OMDB_API_KEY) return null;
  
  const url = `http://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${OMDB_API_KEY}`;
  
  return retryWithBackoff(async () => {
    console.log(`OMDb fallback for ${imdbId} (TMDB/TVDB unavailable).`);
    
    const res = await axios.get(url, { timeout: 8000 });
    
    if (res.data && res.data.Response === 'True') {
      let posterUrl = null;
      if (res.data.Poster && res.data.Poster !== 'N/A') {
        posterUrl = res.data.Poster;
        console.log(`OMDb Found poster ${posterUrl}`);
      }
      
      return {
        source: 'omdb',
        data: res.data,
        languages: res.data.Language ? res.data.Language.split(',').map(s => s.trim()) : undefined,
        posterUrl,
        backdropUrl: null
      };
    }
    
    return null;
  }, `OMDb ${imdbId}`);
}

// Primary Movie/Series fetch with complete retry logic
async function fetchMovieSeriesMetadata(type, imdbId) {
  // Step 1: TMDB Primary (with retry)
  try {
    const tmdbId = await resolveImdbToTmdbId(imdbId, type);
    if (tmdbId) {
      const tmdbResult = await fetchTmdbDetails(tmdbId, type);
      if (tmdbResult) {
        return { ...tmdbResult, tmdbId };
      }
    }
  } catch (error) {
    console.warn(`TMDB failed completely for ${imdbId}:`, error.message);
  }
  
  // Step 2: TVDB Secondary (with retry)
  try {
    const tvdbId = await resolveImdbToTvdbId(imdbId, type);
    if (tvdbId) {
      const tvdbResult = await fetchTvdbDetails(type, tvdbId);
      if (tvdbResult) {
        return { ...tvdbResult, tvdbId };
      }
    }
  } catch (error) {
    console.warn(`TVDB failed completely for ${imdbId}:`, error.message);
  }
  
  // Step 3: OMDb Fallback (with retry)
  try {
    const omdbResult = await fetchOmdbDetails(imdbId);
    if (omdbResult) {
      return omdbResult;
    }
  } catch (error) {
    console.warn(`OMDb failed completely for ${imdbId}:`, error.message);
  }
  
  console.error(`Metadata: All providers failed for ${imdbId} with type ${type}`);
  return null;
}

// Episode fetch with enhanced retry
async function fetchEpisodeMetadata(seriesImdbId, season, episode, seriesTmdbId) {
  let stillUrl = null;
  
  // TMDB Primary for episode still (with retry)
  if (seriesTmdbId && TMDB_API_KEY) {
    try {
      const url = `https://api.themoviedb.org/3/tv/${seriesTmdbId}/season/${encodeURIComponent(season)}/episode/${encodeURIComponent(episode)}?api_key=${TMDB_API_KEY}&language=en-US`;
      
      await retryWithBackoff(async () => {
        console.log(`TMDB Fetching episode metadata for S${season}E${episode} (Series TMDB ID ${seriesTmdbId})...`);
        
        const res = await axios.get(url, { timeout: 8000 });
        if (res.data && res.data.still_path) {
          stillUrl = `${TMDB_IMAGE_BASE_URL}${res.data.still_path}`;
          console.log(`TMDB Found episode still ${stillUrl}`);
        }
        
        return {
          source: 'tmdb',
          data: res.data,
          stillUrl
        };
      }, `TMDB Episode S${season}E${episode}`);
    } catch (error) {
      console.warn(`TMDB Failed for episode S${season}E${episode} (Series TMDB ID ${seriesTmdbId}):`, error.message);
    }
  }
  
  // OMDb Fallback (with retry)
  if (!stillUrl && OMDB_API_KEY) {
    try {
      const url = `http://www.omdbapi.com/?i=${encodeURIComponent(seriesImdbId)}&Season=${encodeURIComponent(season)}&Episode=${encodeURIComponent(episode)}&apikey=${OMDB_API_KEY}`;
      
      const result = await retryWithBackoff(async () => {
        console.log(`OMDb fallback for episode S${season}E${episode} (series ${seriesImdbId}).`);
        
        const res = await axios.get(url, { timeout: 8000 });
        if (res.data && res.data.Response === 'True') {
          if (res.data.Poster && res.data.Poster !== 'N/A') {
            stillUrl = res.data.Poster;
            console.log(`OMDb Found episode poster/still ${stillUrl}`);
          }
          
          return {
            source: 'omdb',
            data: res.data,
            stillUrl
          };
        }
        return null;
      }, `OMDb Episode S${season}E${episode}`);
      
      if (result) return result;
    } catch (error) {
      console.warn(`OMDb Failed for episode S${season}E${episode}:`, error.message);
    }
  }
  
  console.error(`Metadata: All providers failed for episode S${season}E${episode} of series ${seriesImdbId}.`);
  return null;
}

module.exports = {
  fetchMovieSeriesMetadata,
  fetchEpisodeMetadata
};

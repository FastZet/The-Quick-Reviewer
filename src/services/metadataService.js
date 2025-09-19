// src/services/metadataService.js

'use strict';

const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const TVDB_API_KEY = process.env.TVDB_API_KEY || null;
const TVDB_PIN = process.env.TVDB_PIN || null;

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

// --- TVDB Auth Token Cache ---
let tvdbToken = null;
let tvdbTokenExpiry = 0;

async function getTvdbToken() {
  if (!TVDB_API_KEY) return null;
  const now = Date.now();
  if (tvdbToken && now < (tvdbTokenExpiry - 60000)) return tvdbToken;
  try {
    const payload = TVDB_PIN ? { apikey: TVDB_API_KEY, pin: TVDB_PIN } : { apikey: TVDB_API_KEY };
    const res = await axios.post('https://api4.thetvdb.com/v4/login', payload, { timeout: 8000 });
    const token = res.data?.data?.token;
    if (!token) {
      console.warn('TVDB login succeeded but no token returned');
      return null;
    }
    tvdbToken = token;
    // Tokens typically last ~24h; refresh a bit earlier
    tvdbTokenExpiry = now + (23 * 60 * 60 * 1000);
    return tvdbToken;
  } catch (err) {
    console.warn('TVDB login failed:', err?.message || err);
    return null;
  }
}

// --- TMDB Helpers ---
async function resolveImdbToTmdbId(imdbId, type) {
  if (!TMDB_API_KEY) return null;
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  console.log('TMDB Resolving IMDb ID', imdbId, 'to a TMDB ID...');
  try {
    const res = await axios.get(url, { timeout: 8000 });
    const results = type === 'series' ? res.data?.tv_results : res.data?.movie_results;
    if (results && results.length > 0) {
      const tmdbId = results[0].id;
      console.log('TMDB Success! Resolved IMDb ID', imdbId, 'to TMDB ID', tmdbId);
      return tmdbId;
    }
    console.warn('TMDB Could not find a TMDB ID for IMDb ID', imdbId);
    return null;
  } catch (error) {
    console.error('TMDB Error resolving IMDb ID', imdbId, error.message);
    return null;
  }
}

// --- TVDB Helpers ---
async function resolveImdbToTvdbId(imdbId, type) {
  if (!TVDB_API_KEY) return null;
  const token = await getTvdbToken();
  if (!token) return null;
  const t = type === 'series' ? 'series' : 'movie';
  const url = `https://api4.thetvdb.com/v4/search/remote-ids?imdbId=${encodeURIComponent(imdbId)}&type=${t}`;
  console.log('TVDB Resolving IMDb ID', imdbId, 'to a TVDB ID...');
  try {
    const res = await axios.get(url, { timeout: 8000, headers: { Authorization: `Bearer ${token}` } });
    const arr = res.data?.data;
    if (Array.isArray(arr) && arr.length > 0) {
      const tvdbId = arr[0]?.id;
      if (tvdbId) {
        console.log('TVDB Success! Resolved IMDb ID', imdbId, 'to TVDB ID', tvdbId);
        return tvdbId;
      }
    }
    console.warn('TVDB Could not find a TVDB ID for IMDb ID', imdbId);
    return null;
  } catch (error) {
    console.error('TVDB Error resolving IMDb ID', imdbId, error.message);
    return null;
  }
}

async function fetchTvdbDetails(type, tvdbId) {
  const token = await getTvdbToken();
  if (!token) return null;
  const isSeries = type === 'series';
  const baseUrl = isSeries
    ? `https://api4.thetvdb.com/v4/series/${tvdbId}`
    : `https://api4.thetvdb.com/v4/movies/${tvdbId}`;
  try {
    console.log('TVDB Fetching metadata for', type, 'TVDB ID', tvdbId, '...');
    const res = await axios.get(baseUrl, { timeout: 8000, headers: { Authorization: `Bearer ${token}` } });
    const data = res.data?.data || null;
    if (!data) return null;

    const posterUrl = data.image || null;
    const backdropUrl = null; // not always present

    const languages = [];
    if (data.originalLanguage?.name) languages.push(data.originalLanguage.name);
    if (Array.isArray(data.languages)) {
      for (const lang of data.languages) {
        if (typeof lang === 'string') languages.push(lang);
        else if (lang?.name) languages.push(lang.name);
      }
    }

    return { source: 'tvdb', data, languages: languages.length ? languages : undefined, posterUrl, backdropUrl };
  } catch (error) {
    console.warn('TVDB Failed to fetch from TVDB for', type, 'ID', tvdbId, error.message);
    return null;
  }
}

// --- Primary Movie/Series fetch with TMDB -> TVDB -> OMDb cascade ---
async function fetchMovieSeriesMetadata(type, imdbId) {
  // TMDB Primary
  const tmdbId = await resolveImdbToTmdbId(imdbId, type);
  let apiLanguages;
  let posterUrl = null;
  let backdropUrl = null;

  if (tmdbId) {
    try {
      const tmdbType = type === 'series' ? 'tv' : 'movie';
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log('TMDB Fetching metadata for', type, 'TMDB ID', tmdbId, '...');
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        if (res.data.poster_path) {
          posterUrl = `${TMDB_IMAGE_BASE_URL}${res.data.poster_path}`;
          console.log('TMDB Found poster', posterUrl);
        }
        if (res.data.backdrop_path) {
          backdropUrl = `${TMDB_IMAGE_BASE_URL}${res.data.backdrop_path}`;
          console.log('TMDB Found backdrop', backdropUrl);
        }
        if (res.data.spoken_languages && res.data.spoken_languages.length > 0) {
          apiLanguages = res.data.spoken_languages.map((lang) => lang.english_name || lang.name).filter(Boolean);
        }
        return { source: 'tmdb', data: res.data, languages: apiLanguages, posterUrl, backdropUrl };
      }
    } catch (error) {
      console.warn('TMDB Failed to fetch from TMDB for', imdbId, 'TMDB ID', tmdbId, error.message);
      // continue to TVDB
    }
  }

  // TVDB Secondary
  const tvdbId = await resolveImdbToTvdbId(imdbId, type);
  if (tvdbId) {
    const tvdb = await fetchTvdbDetails(type, tvdbId);
    if (tvdb) return tvdb;
  }

  // OMDb Fallback
  if (OMDB_API_KEY) {
    console.log('OMDb fallback for', imdbId, '(TMDB/TVDB unavailable).');
    try {
      const url = `http://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        if (res.data.Poster && res.data.Poster !== 'N/A') {
          posterUrl = res.data.Poster;
          console.log('OMDb Found poster', posterUrl);
        }
        return {
          source: 'omdb',
          data: res.data,
          languages: res.data.Language ? res.data.Language.split(',').map((s) => s.trim()) : undefined,
          posterUrl,
          backdropUrl: null,
        };
      }
    } catch (error) {
      console.warn('OMDb Failed to fetch for', imdbId, error.message);
    }
  }

  console.error('Metadata: All providers failed for', type, 'with ID', imdbId);
  return null;
}

// --- Episode fetch (TMDB primary, OMDb fallback) ---
async function fetchEpisodeMetadata(seriesImdbId, season, episode) {
  const seriesTmdbId = await resolveImdbToTmdbId(seriesImdbId, 'series');
  let stillUrl = null;

  // TMDB Primary for episode still
  if (seriesTmdbId) {
    try {
      const url = `https://api.themoviedb.org/3/tv/${seriesTmdbId}/season/${encodeURIComponent(season)}/episode/${encodeURIComponent(episode)}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log('TMDB Fetching episode metadata for S', season, 'E', episode, 'Series TMDB ID', seriesTmdbId, '...');
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        if (res.data.still_path) {
          stillUrl = `${TMDB_IMAGE_BASE_URL}${res.data.still_path}`;
          console.log('TMDB Found episode still', stillUrl);
        }
        return { source: 'tmdb', data: res.data, stillUrl };
      }
    } catch (error) {
      console.warn('TMDB Failed for episode S', season, 'E', episode, 'Series TMDB ID', seriesTmdbId, error.message);
    }
  }

  // OMDb Fallback
  if (OMDB_API_KEY) {
    console.log('OMDb fallback for episode S', season, 'E', episode, 'series', seriesImdbId, '.');
    try {
      const url = `http://www.omdbapi.com/?i=${encodeURIComponent(seriesImdbId)}&Season=${encodeURIComponent(season)}&Episode=${encodeURIComponent(episode)}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        if (res.data.Poster && res.data.Poster !== 'N/A') {
          stillUrl = res.data.Poster;
          console.log('OMDb Found episode poster/still', stillUrl);
        }
        return { source: 'omdb', data: res.data, stillUrl };
      }
    } catch (error) {
      console.warn('OMDb Failed for episode S', season, 'E', episode, error.message);
    }
  }

  console.error('Metadata: All providers failed for episode S', season, 'E', episode, 'of series', seriesImdbId, '.');
  return null;
}

module.exports = {
  fetchMovieSeriesMetadata,
  fetchEpisodeMetadata,
};

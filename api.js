// api.js — metadata + review generation with verbose logging and configurable model

const axios = require('axios');
const { readReview, saveReview } = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function mapTmdbType(type) {
  if (type === 'series') return 'tv';
  if (type === 'movie') return 'movie';
  return type || 'movie';
}

async function resolveImdbToTmdbId(originalType, id) {
  if (!/^tt\d+$/i.test(id)) return null;
  const tmdbType = mapTmdbType(originalType);
  const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?api_key=${encodeURIComponent(
    TMDB_API_KEY
  )}&language=en-US&external_source=imdb_id`;
  console.log(`[TMDB] Resolving IMDb ${id} via /find for type=${tmdbType}`);
  const findRes = await axios.get(findUrl, { timeout: 10000 });
  const results = tmdbType === 'movie' ? findRes.data?.movie_results : findRes.data?.tv_results;
  const tmdbId = Array.isArray(results) && results.length ? results.id : null;
  console.log(`[TMDB] IMDb ${id} -> TMDB ${tmdbId}`);
  return tmdbId;
}

async function fetchMetadata(type, id) {
  if (!TMDB_API_KEY) {
    console.warn('[TMDB] TMDB_API_KEY missing');
    return null;
  }
  try {
    const tmdbType = mapTmdbType(type);
    let tmdbId = id;

    // Resolve IMDb IDs to TMDB IDs first
    const resolved = await resolveImdbToTmdbId(type, id);
    if (resolved) tmdbId = resolved;

    const url = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(
      TMDB_API_KEY
    )}&language=en-US`;
    console.log(`[TMDB] Fetching ${tmdbType} details: ${url}`);
    const res = await axios.get(url, { timeout: 10000 });
    console.log(`[TMDB] Received metadata for ${tmdbType}:${tmdbId} (title=${res.data?.title || res.data?.name})`);
    return res.data || null;
  } catch (err) {
    console.error('[TMDB] Metadata fetch failed:', err?.response?.data || err.message);
    return null;
  }
}

function buildPromptFromMetadata(metadata, originalType) {
  const isSeries =
    metadata?.media_type === 'tv' ||
    originalType === 'series' ||
    Boolean(metadata?.first_air_date);

  const title = metadata?.title || metadata?.name || 'Unknown Title';
  const overview = metadata?.overview || '';
  const release = metadata?.release_date || metadata?.first_air_date || '';
  const year = release ? (release.split('-') || '').trim() : '';

  const prompt = `
You are a professional film/TV critic. Write a spoiler-free review for the following ${isSeries ? 'series' : 'movie'}.

Title: ${title}
${year ? `Year: ${year}` : ''}
${overview ? `Overview: ${overview}` : ''}

Output format (plain text, no markdown):
Plot Summary:
- 2–3 sentences that set up the premise without revealing twists, surprises, or critical outcomes.

Review Highlights:
- 4–6 short bullet points focusing on tone, performances, direction, writing, pacing, visuals, music, and what kind of audience will enjoy it.
- Keep it concise and helpful.
- Avoid spoilers completely.
- Do not include production trivia or box office details.

If information is missing, gracefully omit it without inventing specifics.
  `.trim();

  return prompt;
}

async function generateReview(metadata, originalType) {
  if (!GEMINI_API_KEY) return 'Gemini API key missing — cannot generate review.';
  try {
    const prompt = buildPromptFromMetadata(metadata, originalType);
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent`;
    console.log(`[Gemini] Calling ${endpoint}`);

    const res = await axios.post(
      endpoint,
      { contents: [{ parts: [{ text: prompt }] }] },
      { params: { key: GEMINI_API_KEY }, timeout: 20000 }
    );

    const reviewText =
      res.data?.candidates?.?.content?.parts?.?.text ||
      'No review generated.';
    console.log('[Gemini] Review generated');
    return reviewText.trim();
  } catch (err) {
    console.error('[Gemini] Review generation failed:', err?.response?.data || err.message);
    return 'Error generating review.';
  }
}

async function getReview(date, id, type) {
  console.log(`[Review] getReview date=${date} type=${type} id=${id}`);
  // Cache first
  const cached = readReview(date, id);
  if (cached) {
    console.log('[Cache] hit');
    return cached;
  }
  console.log('[Cache] miss');

  const metadata = await fetchMetadata(type, id);
  if (!metadata) {
    const fallback = [
      'Plot Summary:',
      '- Unable to fetch official metadata right now. This is a generic, spoiler-free placeholder.',
      '',
      'Review Highlights:',
      '- Review unavailable due to a metadata fetch error.',
      '- Please try again later.'
    ].join('\n');
    saveReview(date, id, fallback);
    return fallback;
  }

  const review = await generateReview(metadata, type);

  saveReview(date, id, review);
  return review;
}

module.exports = {
  getReview
};

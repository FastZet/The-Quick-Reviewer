// api.js — handles review generation/fetching
// Interacts with TMDB for metadata and Gemini API for AI-generated review content.

const axios = require('axios');
const { readReview, saveReview } = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

// Map Stremio type to TMDB path segment
function mapTmdbType(type) {
  if (type === 'series') return 'tv';
  if (type === 'movie') return 'movie';
  return type || 'movie';
}

async function fetchMetadata(type, id) {
  if (!TMDB_API_KEY) return null;
  try {
    const tmdbType = mapTmdbType(type);
    const url = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(
      id
    )}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=en-US`;
    const res = await axios.get(url, { timeout: 10000 });
    return res.data || null;
  } catch (err) {
    console.error('TMDB metadata fetch failed:', err?.response?.data || err.message);
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
  const year = release ? (release.split('-')[0] || '').trim() : '';

  // Spoiler-free Plot Summary first, then concise bullets.
  // Output plain text so review.html can render as-is.
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

    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      { contents: [{ parts: [{ text: prompt }] }] },
      { params: { key: GEMINI_API_KEY }, timeout: 20000 }
    );

    const reviewText =
      res.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      'No review generated.';
    return reviewText.trim();
  } catch (err) {
    console.error('Gemini review generation failed:', err?.response?.data || err.message);
    return 'Error generating review.';
  }
}

async function getReview(date, id, type) {
  // First try cache
  const cached = readReview(date, id);
  if (cached) return cached;

  // Fetch metadata
  const metadata = await fetchMetadata(type, id);
  if (!metadata) {
    // Still return a structured placeholder so the UI looks consistent
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

  // Generate review via Gemini (with Plot Summary on top)
  const review = await generateReview(metadata, type);

  // Save to cache
  saveReview(date, id, review);

  return review;
}

module.exports = {
  getReview
};

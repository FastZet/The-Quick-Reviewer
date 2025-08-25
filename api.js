// api.js — handles review generation using the official Google AI SDK.

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readReview, saveReview } = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
// This can now be safely controlled by the environment variable you set.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';

// Initialize the Google AI Client if the API key is present
let model;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

function mapTmdbType(type) {
  if (type === 'series') return 'tv';
  return 'movie';
}

async function fetchMetadata(type, id) {
  if (!TMDB_API_KEY) return null;
  try {
    const tmdbType = mapTmdbType(type);
    const url = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=en-US`;
    const res = await axios.get(url, { timeout: 10000 });
    return res.data || null;
  } catch (err) {
    console.error('TMDB metadata fetch failed:', err?.response?.data || err.message);
    return null;
  }
}

function buildPromptFromMetadata(metadata, originalType) {
  const isSeries = originalType === 'series' || Boolean(metadata?.first_air_date);
  const title = metadata?.title || metadata?.name || 'Unknown Title';
  const overview = metadata?.overview || '';
  const release = metadata?.release_date || metadata?.first_air_date || '';
  const year = release ? (release.split('-')[0] || '').trim() : '';

  return `
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
}

async function generateReview(metadata, originalType) {
  if (!model) return 'Gemini API key missing — cannot generate review.';
  try {
    const prompt = buildPromptFromMetadata(metadata, originalType);
    console.log(`[Gemini SDK] Generating content with model: ${GEMINI_MODEL}`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const reviewText = response.text();
    
    return reviewText.trim() || 'No review generated.';
  } catch (err) {
    console.error('Gemini SDK review generation failed:', err);
    return 'Error generating review.';
  }
}

async function getReview(date, id, type) {
  const cached = readReview(date, id);
  if (cached) return cached;

  const metadata = await fetchMetadata(type, id);
  if (!metadata) {
    const fallback = [
      'Plot Summary:',
      '- Unable to fetch official metadata right now. This is a generic, spoiler-free placeholder.',
      '',
      'Review Highlights:',
      '- Review unavailable due to a metadata fetch error.',
      '- Please try again later.'
    ].join('\\n');
    saveReview(date, id, fallback);
    return fallback;
  }

  const review = await generateReview(metadata, type);
  saveReview(date, id, review);
  return review;
}

module.exports = { getReview };

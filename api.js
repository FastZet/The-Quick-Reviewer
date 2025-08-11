// api.js — handles review generation/fetching
// This file contains the logic to interact with TMDB/OMDB for metadata
// and Gemini API for AI-generated review content.

const axios = require('axios');
const { readReview, saveReview } = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

async function fetchMetadata(type, id) {
  // Try TMDB first
  if (!TMDB_API_KEY) return null;
  try {
    const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=en-US`;
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    console.error('TMDB metadata fetch failed:', err.message);
    return null;
  }
}

async function generateReview(metadata) {
  if (!GEMINI_API_KEY) return 'Gemini API key missing — cannot generate review.';
  try {
    const prompt = `Provide a spoiler-free bullet-point review for the following ${metadata.media_type || 'title'}:\n\nTitle: ${metadata.title || metadata.name}\nOverview: ${metadata.overview}\nRelease Date: ${metadata.release_date || metadata.first_air_date}\n\nUse short bullet points and keep it concise.`;

    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      { contents: [{ parts: [{ text: prompt }] }] },
      { params: { key: GEMINI_API_KEY } }
    );

    const reviewText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No review generated.';
    return reviewText.trim();
  } catch (err) {
    console.error('Gemini review generation failed:', err.message);
    return 'Error generating review.';
  }
}

async function getReview(date, id, type) {
  // First try cache
  const cached = readReview(date, id);
  if (cached) return cached;

  // Fetch metadata
  const metadata = await fetchMetadata(type, id);
  if (!metadata) return 'No metadata found — cannot generate review.';

  // Generate review via Gemini
  const review = await generateReview(metadata);

  // Save to cache
  saveReview(date, id, review);

  return review;
}

module.exports = {
  getReview
};

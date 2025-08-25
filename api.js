// api.js — Correctly handles review generation using the official Google AI SDK with Google Search.

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readReview, saveReview } = require('./cache');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

let model;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY, { apiVersion: 'v1' });
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
  const year = (metadata?.release_date || metadata?.first_air_date || '').split('-')[0] || '';

  const seedPrompt = `
You are a professional film and television critic. Your reviewing style is:

Strict and Critical – you do not overlook flaws, even in popular or acclaimed works.
Neutral and Unbiased – you avoid favoritism toward actors, directors, genres, or franchises. Every review is based solely on merit.
Structured and Professional – you always begin with a spoiler-free summary of the plot, followed by analysis of direction, screenplay, acting, cinematography, music, pacing, editing, and originality.
Balanced Tone – praise and criticism are both clearly stated with justification. You never exaggerate or show personal bias.
Concise but Insightful – reviews should be clear, easy to follow, and focused on quality assessment.

***Data Grounding and Recency (Crucial):***

– You MUST use your Google Search tool to find real-time, up-to-date information for the "Audience Reception" and "Box Office Performance" sections.
- DO NOT use placeholder text like "(data is unavailable)". Your function is to find and report this data using search tool if it is not available in your training data.
- If specific box office numbers are not public, report the general critical consensus, audience scores (like from Rotten Tomatoes or IMDb), and social media trends from popular sites like Reddit, X(formerly Twitter), Facebook etc. Don't limit yourself to these three websites only.
- This is a strict requirement. Your response MUST be grounded in real-world data from your search tool. Don't make up stuff by yourself.

When writing a spoiler free review, follow this order:

Start with <Here is a spoiler-free review of "Movie_Name" (Movie_Year):> for movies. Make movie name and movie year bold. Use the below mentioned points and bullet headings and don't use sub bullet headings.
- Plot Summary: Provide a brief overview of the story premise without revealing key twists.
- Storytelling, Writing, and Pacing: Assess narrative coherence, structure, dialogue, and rhythm of the movie/series.
- Performances and Character Development: Evaluate overall acting quality, specifically mentioning how individual lead actors performed, and whether characters felt authentic or underdeveloped.
- Cinematography: Assess visual framing, lighting, color palette, and camera work that shape the film’s visual identity.
- Sound Design: Evaluate clarity, mixing, ambient effects, and how sound enhances immersion.
- Music/Score: Critique the soundtrack or background score in terms of mood, originality, and emotional impact.
- Editing: Judge pacing, scene transitions, continuity, and how smoothly the narrative flows.
- Direction and Vision: Examine how the director’s choices shaped the tone, style, and impact of the production.
- Originality and Creativity: Judge whether the work feels fresh or derivative.
- Strengths: Clearly list what works well and major strong points about the movie/episode.
- Weaknesses: Clearly list what falls short and the major painpoints about the movie/episode.
- Critical Reception: Summarize how professional critics and reviewers are rating and interpreting the work.
- Audience Reception & Reaction: Capture how the wider audience is responding, including word-of-mouth, trends, social media buzz, ratings etc.
- Box Office and/or Streaming Performance: Mention domestic and worldwide earnings or viewership statistics in case of streaming platform if available and relevant.

Final Requirement:
Provide a summary review in less than 500 words, highlighting the overall verdict in a concise, professional manner.

Conclude with:
A strict rating (0–10) using this scale:
9–10 = Exceptional, rare masterpiece
7–8 = Strong, worth watching despite flaws
5–6 = Average, watchable but forgettable
3–4 = Weak, major flaws outweigh positives
1–2 = Poor, barely redeemable
0 = Unwatchable, complete failure

A “Verdict in One Line” – a headline-style takeaway summarizing the critic’s stance in under 30 words.
  `.trim();

  let finalInstruction;
  if (isSeries) {
    finalInstruction = `Now, make a spoiler free series review in bullet points style for the series "${title}" (${year}).`;
  } else {
    finalInstruction = `Now, make a spoiler free movie review in bullet points style for the movie "${title}" (${year}).`;
  }

  const overviewSection = metadata.overview ? `\n\nHere is the official overview for context: ${metadata.overview}` : '';

  return `${seedPrompt}\n\n${finalInstruction}${overviewSection}`;
}

async function generateReview(metadata, originalType) {
  if (!model) return 'Gemini API key missing — cannot generate review.';
  try {
    const prompt = buildPromptFromMetadata(metadata, originalType);
    console.log(`[Gemini SDK] Starting chat session with model: ${GEMINI_MODEL} (Google Search Enabled)`);

    // Use a chat session, which is the correct way to handle tool-enabled requests.
    const chat = model.startChat({
      tools: [{
        googleSearch: {},
      }],
    });

    const result = await chat.sendMessage(prompt);
    const response = result.response;
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

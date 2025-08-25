// api.js — Correctly handles review generation using the official Google AI SDK with Google Search.

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { readReview, saveReview } = require('./cache');
const scraper = require('./scraper.js');

const TMDB_API_KEY = process.env.TMDB_API_KEY || null;
const OMDB_API_KEY = process.env.OMDB_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_RETRIES = 2;

let model;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY, { apiVersion: 'v1' });
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

// --- API Fetching Logic ---

// NEW FUNCTION: Translates an IMDb ID (e.g., tt0455275) to a TMDB ID (e.g., 2174)
async function resolveImdbToTmdbId(imdbId, type) {
  if (!TMDB_API_KEY) return null;
  const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  try {
    const res = await axios.get(url, { timeout: 8000 });
    const results = (type === 'series') ? res.data.tv_results : res.data.movie_results;
    if (results && results.length > 0) {
      const tmdbId = results[0].id;
      console.log(`[TMDB Resolver] Resolved IMDb ID ${imdbId} to TMDB ID ${tmdbId}`);
      return tmdbId;
    }
    console.warn(`[TMDB Resolver] Could not find a TMDB ID for IMDb ID ${imdbId}`);
    return null;
  } catch (error) {
    console.error(`[TMDB Resolver] Error resolving IMDb ID ${imdbId}: ${error.message}`);
    return null;
  }
}

async function fetchMovieSeriesMetadata(type, imdbId) {
  const tmdbId = await resolveImdbToTmdbId(imdbId, type);
  // TMDB (Primary) - now uses the correct tmdbId
  if (tmdbId) {
    try {
      const tmdbType = (type === 'series') ? 'tv' : 'movie';
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) return { source: 'tmdb', data: res.data };
    } catch (error) {
      console.warn(`[TMDB] Failed for ${type} ${imdbId} (TMDB ID: ${tmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    try {
      const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') return { source: 'omdb', data: res.data };
    } catch (error) {
      console.warn(`[OMDB] Failed for ${type} ${imdbId}: ${error.message}`);
    }
  }
  return null;
}

async function fetchEpisodeMetadata(seriesImdbId, season, episode) {
  const seriesTmdbId = await resolveImdbToTmdbId(seriesImdbId, 'series');
  // TMDB (Primary) - now uses the correct seriesTmdbId
  if (seriesTmdbId) {
    try {
      const url = `https://api.themoviedb.org/3/tv/${seriesTmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=en-US`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) return { source: 'tmdb', data: res.data };
    } catch (error) {
      console.warn(`[TMDB] Failed for episode S${season}E${episode} (TMDB ID: ${seriesTmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    try {
      const url = `http://www.omdbapi.com/?i=${seriesImdbId}&Season=${season}&Episode=${episode}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') return { source: 'omdb', data: res.data };
    } catch (error) {
      console.warn(`[OMDB] Failed for episode S${season}E${episode}: ${error.message}`);
    }
  }
  return null;
}

// --- Prompt and Review Generation ---

function buildPromptFromMetadata(metadata, type, seriesInfo = {}, scrapedEpisodeTitle = null) {
  const isEpisode = type === 'series' && metadata.data.episode_number;
  const isSeries = type === 'series' && !isEpisode;
  // Normalize data from either TMDB or OMDB
  const title = metadata.data.title || metadata.data.name || metadata.data.Title;
  const year = (metadata.data.release_date || metadata.data.first_air_date || metadata.data.Released || '').split(' ').pop() || (metadata.data.release_date || metadata.data.first_air_date || '').split('-')[0];
  const overview = metadata.data.overview || metadata.data.Plot;
  
  const seriesName = seriesInfo.title || (isEpisode ? "the series" : "");

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

***Formatting Rules (Strict):***
- Each section of the review MUST begin with a round dot (•) followed by a space and a bolded heading.
- There are no sub-bullets. The content for each section follows directly after its heading.
- Example of the required format:
  • **Plot Summary:** Provide a brief overview of the story...
  • **Storytelling, Writing, and Pacing:** Assess narrative coherence, structure, dialogue, and rhythm...

Don't start with "Here is a spoiler-free review..." or something similar. Start straight with the below mentioned points.
When writing a spoiler free review, follow this order:

For movies, start with the following in separate lines:
- Name of the movie: Name of the Movie. Don't mention the release year here.
- Cast: Name top five lead actors and actresses in the movie.
- Directed by: Name of the director.
- Released on: The date and the year when it was first released.

For series' episodes, start with the following in separate lines:
- Name of the Series: Only mention the name of the series, don't mention episode name here.
- Name of the Episode: Mention the name of the episode only.
- Season and Episode: Mention the Season and Episode number in the format "Season X, Episode Y".
- Directed by: Name of the director of the episode, not the series.
- Released on: The date when the episode was first aired or released as per records available.

If in a review for a movie or series' episode, apart from the starting "Here is a spoiler-free review..." you have to mention the name of anything significant and you feel you need to use bold characters, use double quotes <""> instead.
Use the below mentioned points and bullet headings and don't use sub bullet headings. Add a spacing among the points for easier legibility.

- Plot Summary: Provide a brief overview of the story premise without revealing key twists.
- Storytelling, Writing, and Pacing: Assess narrative coherence, structure, dialogue, and rhythm of the movie/series.
- Performances and Character Development: Evaluate overall acting quality, specifically mentioning how individual lead actors performed, and whether characters felt authentic or underdeveloped.
- Cinematography: Assess visual framing, lighting, color palette, and camera work that shape the film’s visual identity.
- Sound Design: Evaluate clarity, mixing, ambient effects, and how sound enhances immersion.
- Music/Score: Critique the soundtrack or background score in terms of mood, originality, and emotional impact.
- Editing: Judge pacing, scene transitions, continuity, and how smoothly the narrative flows.
- Direction and Vision: Examine how the director’s choices shaped the tone, style, and impact of the production.
- Originality and Creativity: Judge whether the work feels fresh or derivative.
- Strengths: Clearly mention what works well and major strong points about the movie/episode.
- Weaknesses: Clearly mention what falls short and the major painpoints about the movie/episode.
- Critical Reception: Summarize how professional critics and reviewers are rating and interpreting the work.
- Audience Reception & Reaction: Capture how the wider audience is responding, including word-of-mouth, trends, social media buzz, ratings etc.
- Box Office and/or Streaming Performance: Mention domestic and worldwide earnings or viewership statistics in case of streaming platform if available and relevant.
- Who would like it: In a single sentence of no longer than twenty words tell what kind of viewer would like it.
- Who would not like it: In a single sentence of no longer than twenty words tell what kind of viewer would not like it.

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
  if (isEpisode) {
    const episodeTitle = scrapedEpisodeTitle || `Episode ${metadata.data.episode_number}`;
    finalInstruction = `Now, make a spoiler free episode review in bullet points style for the episode "${episodeTitle}" (Season ${metadata.data.season_number}, Episode ${metadata.data.episode_number}) of the series "${seriesName}".`;
  } else if (isSeries) {
    finalInstruction = `Now, make a spoiler free series review in bullet points style for the series "${title}" (${year}).`;
  } else {
    finalInstruction = `Now, make a spoiler free movie review in bullet points style for the movie "${title}" (${year}).`;
  }
  
  const overviewSection = overview ? `\n\nHere is the official overview for context: ${overview}` : '';
  return `${seedPrompt}\n\n${finalInstruction}${overviewSection}`;
}

async function generateReview(prompt) {
  if (!model) return 'Gemini API key missing — cannot generate review.';
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Gemini SDK] Starting chat session, attempt ${attempt}/${MAX_RETRIES}...`);
      const chat = model.startChat({ tools: [{ googleSearch: {} }] });
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const reviewText = response.text();
      return reviewText.trim() || 'No review generated.';
    } catch (err) {
      // Check if it's a 500 error and if we have retries left.
      if (err.status === 500 && attempt < MAX_RETRIES) {
        console.warn(`[Gemini SDK] Attempt ${attempt} failed with 500 error. Retrying in 1 second...`);
        await new Promise(res => setTimeout(res, 1000)); // Wait 1 second before retrying
      } else {
        console.error(`[Gemini SDK] Review generation failed on attempt ${attempt}:`, err);
        return 'Error generating review.'; // Fail permanently
      }
    }
  }
}

// --- Main Orchestrator with Force Refresh Logic ---
async function getReview(date, id, type, forceRefresh = false) {
  // THE FIX: Only check the cache if forceRefresh is false.
  if (!forceRefresh) {
    const cached = readReview(date, id);
    if (cached) {
      console.log(`[Cache] Cache hit for ${id}.`);
      return cached;
    }
    console.log(`[Cache] Cache miss for ${id}.`);
  } else {
    console.log(`[Cache] Force refresh requested for ${id}. Bypassing cache.`);
  }

  const idParts = String(id).split(':');
  const isEpisode = type === 'series' && idParts.length === 3;

  let metadata, prompt;
  
  if (isEpisode) {
    const [seriesId, season, episode] = idParts;
    console.log(`[Review Manager] Handling episode request: ${seriesId} S${season}E${episode}`);
    const [scrapedEpisodeTitle, episodeMetadata, seriesMetadata] = await Promise.all([
      scraper.scrapeImdbForEpisodeTitle(seriesId, season, episode),
      fetchEpisodeMetadata(seriesId, season, episode),
      fetchMovieSeriesMetadata('series', seriesId)
    ]);
    metadata = episodeMetadata;
    if (metadata && seriesMetadata) {
      const seriesInfo = { title: seriesMetadata.data.title || seriesMetadata.data.name || seriesMetadata.data.Title };
      prompt = buildPromptFromMetadata(metadata, type, seriesInfo, scrapedEpisodeTitle);
    }
  } else {
    console.log(`[Review Manager] Handling ${type} request: ${id}`);
    metadata = await fetchMovieSeriesMetadata(type, id);
    if (metadata) {
      prompt = buildPromptFromMetadata(metadata, type);
    }
  }

  if (!metadata || !prompt) {
    const fallbackText = 'Plot Summary:\n- Unable to fetch official metadata for this item. Please try again later.';
    saveReview(date, id, fallbackText);
    return fallbackText;
  }

  const review = await generateReview(prompt);
  saveReview(date, id, review);
  return review;
}

module.exports = { getReview };

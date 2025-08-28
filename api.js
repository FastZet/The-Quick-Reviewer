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
  // --- Define and apply less restrictive safety settings ---
  const safetySettings = [
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_NONE',
    },
  ];
  model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    safetySettings: safetySettings,
  });
}

// --- API Fetching Logic ---

async function resolveImdbToTmdbId(imdbId, type) {
  if (!TMDB_API_KEY) return null;
  const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  console.log(`[API/TMDB] Resolving IMDb ID ${imdbId} to a TMDB ID...`);
  try {
    const res = await axios.get(url, { timeout: 8000 });
    const results = (type === 'series') ? res.data.tv_results : res.data.movie_results;
    if (results && results.length > 0) {
      const tmdbId = results[0].id;
      console.log(`[API/TMDB] Success! Resolved IMDb ID ${imdbId} to TMDB ID ${tmdbId}`);
      return tmdbId;
    }
    console.warn(`[API/TMDB] Could not find a TMDB ID for IMDb ID ${imdbId}`);
    return null;
  } catch (error) {
    console.error(`[API/TMDB] Error resolving IMDb ID ${imdbId}: ${error.message}`);
    return null;
  }
}

async function fetchMovieSeriesMetadata(type, imdbId) {
  const tmdbId = await resolveImdbToTmdbId(imdbId, type);
  // TMDB (Primary)
  if (tmdbId) {
    try {
      const tmdbType = (type === 'series') ? 'tv' : 'movie';
      const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log(`[API/TMDB] Fetching metadata for ${type} (TMDB ID: ${tmdbId})...`);
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        console.log(`[API/TMDB] Successfully fetched metadata for ${type} (TMDB ID: ${tmdbId}).`);
        return {source: 'tmdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[API/TMDB] Failed to fetch from TMDB for ${imdbId} (TMDB ID: ${tmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    console.log(`[API/OMDB] TMDB failed or unavailable. Falling back to OMDB for ${imdbId}.`);
    try {
      const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        console.log(`[API/OMDB] Successfully fetched metadata for ${imdbId} from OMDB.`);
        return { source: 'omdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[API/OMDB] Failed to fetch from OMDB for ${imdbId}: ${error.message}`);
    }
  }
  console.error(`[API] All metadata providers failed for ${type} with ID ${imdbId}.`);
  return null;
}

async function fetchEpisodeMetadata(seriesImdbId, season, episode) {
  const seriesTmdbId = await resolveImdbToTmdbId(seriesImdbId, 'series');
  // TMDB (Primary)
  if (seriesTmdbId) {
    try {
      const url = `https://api.themoviedb.org/3/tv/${seriesTmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=en-US`;
      console.log(`[API/TMDB] Fetching episode metadata for S${season}E${episode} (Series TMDB ID: ${seriesTmdbId})...`);
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data) {
        console.log(`[API/TMDB] Successfully fetched metadata for episode S${season}E${episode}.`);
        return { source: 'tmdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[API/TMDB] Failed for episode S${season}E${episode} (Series TMDB ID: ${seriesTmdbId}): ${error.message}`);
    }
  }

  // OMDB (Fallback)
  if (OMDB_API_KEY) {
    console.log(`[API/OMDB] TMDB failed for episode. Falling back to OMDB for ${seriesImdbId}.`);
    try {
      const url = `http://www.omdbapi.com/?i=${seriesImdbId}&Season=${season}&Episode=${episode}&apikey=${OMDB_API_KEY}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && res.data.Response === 'True') {
        console.log(`[API/OMDB] Successfully fetched episode metadata for S${season}E${episode} from OMDB.`);
        return { source: 'omdb', data: res.data };
      }
    } catch (error) {
      console.warn(`[API/OMDB] Failed for episode S${season}E${episode}: ${error.message}`);
    }
  }
  console.error(`[API] All metadata providers failed for episode S${season}E${episode} of series ${seriesImdbId}.`);
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

***Formatting Rules (Strict):***
- Each section of the review, including "Name of the movie/series/episode", "Season & Episode", "Casts", "Directed by", "Genre", "Released on", MUST begin with a round dot (•) followed by a space and a bolded heading.
- There are no sub-bullets. The content for each section follows directly after its heading.
- Example of the required format:
  • **Name of the movie:** Name of the Movie...
  • **Casts:** Name top five lead actors and actresses...
  • **Directed by:** Name of the director...
  • **Genre:** Specify the movie’s primary genre(s)...
  • **Released on:** The date and the year when it was first released...
  
  • **Plot Summary:** Provide a brief overview of the story...
  • **Storytelling, Writing, and Pacing:** Assess narrative coherence, structure, dialogue, and rhythm...

***Data Grounding and Recency (Crucial):***

– You MUST use your Google Search tool to find real-time, up-to-date information for the "Audience Reception" and "Box Office Performance" sections.
- DO NOT use placeholder text like "(data is unavailable)". Your function is to find and report this data using search tool if it is not available in your training data.
- If specific box office numbers are not public, report the general critical consensus, audience scores (like from Rotten Tomatoes or IMDb), and social media trends from popular sites like Reddit, X(formerly Twitter), Facebook etc. Don't limit yourself to these three websites only.
- For details like cast and crews, director(s), writer(s) etc., scrape IMDB pages of their respective episode or movies for accurate details in addition to using Google Search tool.
- This is a strict requirement. Your response MUST be grounded in real-world data from your search tool. Don't make up stuff by yourself.

Don't start with "Here is a spoiler-free review..." or something similar. Start straight with the below mentioned points.
When writing a spoiler free review, follow this order:

For movies, start with the following in separate lines. Each section MUST begin with a round dot (•) followed by a space and a bolded heading:
- Name of the movie: Name of the Movie. Don't mention the release year here.
- Casts: Name top five lead actors and actresses in the movie. Use Google Search tool and IMDB. If IMDB page for the movie returns unsatisfactory results, fallback to other websites.
- Directed by: Name of the director.
- Genre: Specify the movie’s primary genre(s).
- Released on: The date and the year when it was first released. Mention the release medium; whether released on theaters, streaming platforms or others.

For series' episodes, start with the following in separate lines. Each section MUST begin with a round dot (•) followed by a space and a bolded heading:
- Name of the Series: Only mention the name of the series, don't mention episode name here.
- Name of the Episode: Mention the name of the episode only.
- Season & Episode: Mention the Season and Episode number in the format "Season X, Episode Y".
- Casts: Name top five lead actors and actresses in the Episode. Use Google Search tool and IMDB. If IMDB page for the episode returns unsatisfactory results, fallback to other websites.
- Directed by: Name of the director of the episode, not the series.
- Genre: Specify the series’ primary genre(s). Usually, series genre should suffice. If by any chance, the episode has a ifferent genre, mention both.
- Released on: The date when the episode was first aired or released as per records available. Mention the release medium; whether released on theaters, streaming platforms or others.

In the review for a movie or series' episode that you will generate, apart from the headings if you have to mention the name of anything significant and you feel the need to use bold characters, use double quotes instead.
Use the below mentioned points and bullet headings and don't use sub bullet headings. Add a spacing among the points for easier legibility. But don't use spacing at the introductory points like "Name of the movie/series/episode", "Season & Episode", "Casts", "Directed by", "Genre", "Released on" etc. Only start spacing from "Plot Summary" onwards.

- Plot Summary: Provide a brief overview of the story premise without revealing key twists.
- Storytelling: Evaluate the narrative coherence, clarity, structure, and emotional impact of the narrative of the movie/series.
- Writing: Assess the quality of dialogue, themes, and overall script craftsmanship of the movie/series.
- Pacing: Assess the rhythm of the movie/series and how smoothly the story progresses.
- Performances: Evaluate the overall acting quality, highlighting the strengths and weaknesses of the cast. Assess how individual lead actors performed in their roles.
- Character Development: Evaluate whether the characters felt authentic, layered, or underdeveloped.
- Cinematography: Assess visual framing, lighting, color palette, and camera work that shape the film’s visual identity.
- Sound Design: Evaluate clarity, mixing, ambient effects, and how sound enhances immersion.
- Music & Score: Critique the soundtrack or background score in terms of mood, originality, and emotional impact.
- Editing: Judge pacing, scene transitions, continuity, and how smoothly the narrative flows.
- Direction and Vision: Examine how the director’s choices shaped the tone, style, and impact of the production.
- Originality and Creativity: Judge whether the work feels fresh or derivative.
- Strengths: Clearly mention what works well and major strong points about the movie/episode.
- Weaknesses: Clearly mention what falls short and the major painpoints about the movie/episode.
- Critical Reception: Summarize how professional critics and reviewers are rating and interpreting the work.
- Audience Reception & Reaction: Capture how the wider audience is responding, including word-of-mouth, trends, social media buzz, ratings etc.
- Box Office and Viewership: Mention domestic & worldwide earnings and viewership statistics in case of streaming platform(s) if available and relevant.
- Who would like it: In a single sentence of no longer than twenty words tell what kind of viewer would like it.
- Who would not like it: In a single sentence of no longer than twenty words tell what kind of viewer would not like it.

Final Requirement:
Provide a "Overall Verdict" in more than 50 words but less than 300 words, highlighting the overall verdict in a concise, professional manner and tone.

Conclude with:
A strict rating. You can also use "0.5" ratings like 4.5/10. 8.5/10 etc. if you feel rounding off to nearest whole number is too harsh or gracious.
After the rating (e.g., "Rating: 7/10"), you MUST append this exact, empty HTML element without the double quotes: "<span id="rating-context-placeholder"></span>".
Example: Rating: 8/10<span id="rating-context-placeholder"></span>

The scale is:
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
      console.log(`[API/Gemini] Starting review generation, attempt ${attempt}/${MAX_RETRIES}...`);
      const chat = model.startChat({ tools: [{ googleSearch: {} }] });
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const reviewText = response.text();
      if (reviewText) {
        console.log(`[API/Gemini] Successfully generated review on attempt ${attempt}.`);
        return reviewText.trim();
      }
    } catch (err) {
      if (err.status === 500 && attempt < MAX_RETRIES) {
        console.warn(`[API/Gemini] Attempt ${attempt} failed with 500 error. Retrying in 1 second...`);
        await new Promise(res => setTimeout(res, 1000));
      } else {
        console.error(`[API/Gemini] Review generation failed permanently on attempt ${attempt}:`, err);
        return 'Error generating review.';
      }
    }
  }
  return 'Error generating review after all retries.';
}

// --- Main Orchestrator ---
async function getReview(id, type, forceRefresh = false) {
  console.log(`\n===== [API] New Request Start =====`);
  console.log(`[API] Received request for type: ${type}, id: ${id}, forceRefresh: ${forceRefresh}`);
  if (!forceRefresh) {
    const cached = readReview(id);
    if (cached) {
      console.log(`[Cache] Cache hit for ${id}. Returning cached review.`);
      console.log(`===== [API] Request End (Cached) =====\n`);
      return cached;
    }
    console.log(`[Cache] Cache miss for ${id}. Proceeding to generate new review.`);
  } else {
    console.log(`[Cache] Force refresh requested for ${id}. Bypassing cache.`);
  }

  const idParts = String(id).split(':');
  const isEpisode = type === 'series' && idParts.length === 3;
  let metadata, prompt;
  
  if (isEpisode) {
    const [seriesId, season, episode] = idParts;
    console.log(`[API] Handling episode: ${seriesId} S${season}E${episode}`);
    const [scrapedEpisodeTitle, episodeMetadata, seriesMetadata] = await Promise.all([
      scraper.scrapeImdbForEpisodeTitle(seriesId, season, episode),
      fetchEpisodeMetadata(seriesId, season, episode),
      fetchMovieSeriesMetadata('series', seriesId)
    ]);
    metadata = episodeMetadata;
    if (metadata && seriesMetadata) {
      console.log("[API] Successfully gathered all required metadata for episode.");
      const seriesInfo = { title: seriesMetadata.data.title || seriesMetadata.data.name || seriesMetadata.data.Title };
      prompt = buildPromptFromMetadata(metadata, type, seriesInfo, scrapedEpisodeTitle);
    }
  } else {
    console.log(`[API] Handling ${type}: ${id}`);
    metadata = await fetchMovieSeriesMetadata(type, id);
    if (metadata) {
      console.log(`[API] Successfully gathered metadata for ${type}.`);
      prompt = buildPromptFromMetadata(metadata, type);
    }
  }

  if (!metadata || !prompt) {
    console.error(`[API] Failed to get metadata or build prompt for ${id}.`);
    const fallbackText = 'Plot Summary:\n- Unable to fetch official metadata for this item. Please try again later.';
    saveReview(id, fallbackText, type);
    console.log(`===== [API] Request End (Failure) =====\n`);
    return fallbackText;
  }
  
  console.log(`[API] Generating review for ${id}...`);
  const review = await generateReview(prompt);
  console.log(`[API] Review generation finished for ${id}. Saving to cache.`);
  saveReview(id, review, type);
  console.log(`===== [API] Request End (Success) =====\n`);
  return review;
}

module.exports = { getReview, buildPromptFromMetadata };

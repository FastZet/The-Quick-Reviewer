const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- SERVER CONFIGURATION ---
const PORT = process.env.PORT || 7860;

// Read API keys from Hugging Face Environment Secrets
const TMDB_KEY = process.env.TMDB_KEY;
const OMDB_KEY = process.env.OMDB_KEY;
const AISTUDIO_KEY = process.env.AISTUDIO_KEY;

// Check if all keys are present on the server at startup
if (!TMDB_KEY || !OMDB_KEY || !AISTUDIO_KEY) {
    console.error("CRITICAL ERROR: One or more API keys are missing from the environment secrets.");
    console.error("Please add TMDB_KEY, OMDB_KEY, and AISTUDIO_KEY to your Hugging Face Space secrets.");
    process.exit(1); // Exit the process if keys are not found
}

// --- Caching Mechanism ---
const reviewCache = new Map();
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

function getFromCache(key) {
    const entry = reviewCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) { return entry.review; }
    reviewCache.delete(key);
    return null;
}

function setToCache(key, review) {
    reviewCache.set(key, { review, timestamp: Date.now() });
}

// --- MANIFEST (Zero-Config Version) ---
const manifest = {
    id: 'org.community.quickreviewer',
    version: '6.0.0', // Final Zero-Config Version
    name: 'The Quick Reviewer (TQR)',
    description: 'A zero-configuration addon that provides AI-generated reviews for movies and series.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt']
    // No behaviorHints are needed anymore.
};

const builder = new addonBuilder(manifest);

// --- STREAM HANDLER (Simplified) ---
builder.defineStreamHandler(async ({ type, id }) => {
    // The 'config' object is no longer used.
    console.log(`Request for stream: ${type}: ${id}`);

    const cacheKey = id;
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`Generating new review for ${cacheKey}.`);
    try {
        // We pass the server's keys to the generation function.
        const aiReview = await generateAiReview(type, id, { tmdb: TMDB_KEY, omdb: OMDB_KEY, aistudio: AISTUDIO_KEY });
        if (aiReview) {
            setToCache(cacheKey, aiReview);
            return Promise.resolve({ streams: [aiReview] });
        }
        throw new Error('AI review generation returned no result.');
    } catch (error) {
        console.error(`Error during review generation for ${id}:`, error.message);
        return Promise.resolve({ streams: [{ name: "Review Error", title: "An Error Occurred", description: error.message }] });
    }
});

// --- Generate AI Review Function (Unchanged logic) ---
async function generateAiReview(type, id, apiKeys) {
    const { tmdb: tmdbKey, omdb: omdbKey, aistudio: aiStudioKey } = apiKeys;
    const [imdbId, season, episode] = id.split(':');
    let itemDetails;
    try {
        if (type === 'movie') {
            const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/movie/${imdbId}?api_key=${tmdbKey}&append_to_response=credits,reviews`);
            itemDetails = { title: tmdbResponse.data.title, year: new Date(tmdbResponse.data.release_date).getFullYear(), genres: tmdbResponse.data.genres.map(g => g.name).join(', '), director: tmdbResponse.data.credits?.crew.find(c => c.job === 'Director')?.name || 'N/A' };
        } else {
            const [seriesResponse, episodeResponse] = await Promise.all([ axios.get(`https://api.themoviedb.org/3/tv/${imdbId}?api_key=${tmdbKey}&append_to_response=credits`), axios.get(`https://api.themoviedb.org/3/tv/${imdbId}/season/${season}/episode/${episode}?api_key=${tmdbKey}`) ]);
            itemDetails = { title: `${seriesResponse.data.name} - S${season}E${episode}: ${episodeResponse.data.name}`, year: new Date(seriesResponse.data.first_air_date).getFullYear(), genres: seriesResponse.data.genres.map(g => g.name).join(', '), director: episodeResponse.data.crew?.find(c => c.job === 'Director')?.name || seriesResponse.data.created_by[0]?.name || 'N/A' };
        }
        const omdbResponse = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
        itemDetails.plot = omdbResponse.data.Plot || 'N/A'; itemDetails.actors = omdbResponse.data.Actors || 'N/A'; itemDetails.criticRatings = omdbResponse.data.Ratings?.map(r => `${r.Source}: ${r.Value}`).join(', ') || 'N/A'; itemDetails.audienceRating = omdbResponse.data.imdbRating ? `IMDb: ${omdbResponse.data.imdbRating}/10` : 'N/A';
    } catch (e) { throw new Error("Could not fetch metadata from TMDB/OMDB APIs."); }
    const prompt = `Generate a spoiler-free review for the following content. Follow all constraints precisely.\n**Content Details:**\n- Title: ${itemDetails.title}\n- Director: ${itemDetails.director}\n- Year: ${itemDetails.year}\n- Genre: ${itemDetails.genres}\n- Plot: ${itemDetails.plot}\n- Actors: ${itemDetails.actors}\n- Ratings: ${itemDetails.criticRatings}, ${itemDetails.audienceRating}\n**Rules:**\n- Use Google Search to get the latest reviews.\n- Be spoiler-free.\n- Each bullet point is one sentence, max 20 words.\n- Fill every bullet point.\n- Response is ONLY the bullet points, no extra text.\n**Structure:**\n- **Introduction:**\n- **Hook:**\n- **Synopsis:**\n- **Direction:**\n- **Acting:**\n- **Writing:**\n- **Cinematography:**\n- **Editing & Pacing:**\n- **Sound & Music:**\n- **Production Design:**\n- **Themes:**\n- **Critics' Reception:**\n- **Audience' Reception:**\n- **Strengths:**\n- **Weakness:**\n- **Recommendation:**`;
    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        reviewText = await result.response.text();
    } catch (e) { throw new Error("AI Studio API failed to generate review."); }
    if (!reviewText || !reviewText.includes("Introduction:")) { return null; }
    
    return { name: "The Quick Reviewer", title: "AI-Generated Review", description: reviewText.replace(/\*/g, '') };
}

// --- EXPRESS SERVER SETUP (Simplified) ---
const app = express();
// The router no longer needs the ':config?' part
app.use(getRouter(builder.getInterface()));
app.listen(PORT, () => {
    console.log(`TQR Addon v6.0.0 (Zero-Config) listening on port ${PORT}`);
    console.log(`Installation URL: https://fatvet-tqr.hf.space/manifest.json`);
});

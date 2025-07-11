const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- SERVER CONFIGURATION ---
const PORT = process.env.PORT || 7860;
const ADDON_URL = 'https://fatvet-tqr.hf.space'; // Your public addon URL

const TMDB_KEY = process.env.TMDB_KEY;
const OMDB_KEY = process.env.OMDB_KEY;
const AISTUDIO_KEY = process.env.AISTUDIO_KEY;

if (!TMDB_KEY || !OMDB_KEY || !AISTUDIO_KEY) {
    console.error("CRITICAL ERROR: One or more API keys are missing from the environment secrets.");
    process.exit(1);
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

// --- MANIFEST ---
const manifest = {
    id: 'org.community.quickreviewer',
    version: '12.0.0', // The Final Working Version
    name: 'The Quick Reviewer (TQR)',
    description: 'Provides a link to a webpage containing an AI-generated review for any movie or series.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

// --- STREAM HANDLER ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`Request for stream: ${type}: ${id}`);
    
    let reviewText = getFromCache(id);
    if (!reviewText) {
        console.log(`No review in cache for ${id}. Generating new one.`);
        try {
            reviewText = await generateAiReviewText(type, id, { tmdb: TMDB_KEY, omdb: OMDB_KEY, aistudio: AISTUDIO_KEY });
            if (reviewText) {
                setToCache(id, reviewText);
                console.log(`Successfully generated and cached review for ${id}.`);
            } else { throw new Error('AI review generation returned no result.'); }
        } catch (error) {
            console.error(`Error during review generation for ${id}:`, error.message);
            return Promise.resolve({ streams: [] });
        }
    } else {
        console.log(`Review found in cache for ${id}.`);
    }
    
    // THIS IS THE DEFINITIVE FIX, BASED ON THE WORKING TUBE-SEARCH ADDON.
    // A simple object with only name, title, and a standard URL.
    const reviewStream = {
        name: "The Quick Reviewer",
        title: "⭐️ Click to Read AI Review",
        url: `${ADDON_URL}/review/${id}`
    };

    return Promise.resolve({ streams: [reviewStream] });
});

// --- Generate AI Review Function ---
async function generateAiReviewText(type, id, apiKeys) {
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
    const prompt = `
        Generate a spoiler-free review for the following content. Follow all constraints precisely.
        **Content Details:**
        - Title: ${itemDetails.title}
        - Director: ${itemDetails.director}
        - Year: ${itemDetails.year}
        - Genre: ${itemDetails.genres}
        - Plot: ${itemDetails.plot}
        - Actors: ${itemDetails.actors}
        - Ratings: ${itemDetails.criticRatings}, ${itemDetails.audienceRating}
        **Rules:**
        - Use your Google Search capability to understand the general consensus for the reviews.
        - Be strictly spoiler-free.
        - Each bullet point must be a single sentence, maximum 20 words.
        - You must write content for every single bullet point.
        - The response must start with "**Introduction:**" and end with "**Recommendation:**". Do not add any extra text before or after.
        - Use markdown bold for titles (e.g., "**Introduction:**").
        **Structure:**
        - **Introduction:** State the full title, director, year, and primary genre to set context.
        - **Hook:**
        - **Synopsis:**
        - **Direction:**
        - **Acting:**
        - **Writing:**
        - **Cinematography:**
        - **Editing & Pacing:**
        - **Sound & Music:**
        - **Production Design:**
        - **Themes:**
        - **Critics' Reception:**
        - **Audience' Reception:** Summarize general audience sentiment from sources like IMDb, Rotten Tomatoes audience score, and forum discussions.
        - **Strengths:**
        - **Weakness:**
        - **Recommendation:**
    `;
    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const safetySettings = [ { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" } ];
        const result = await model.generateContent(prompt, { safetySettings });
        reviewText = await result.response.text();
    } catch (e) { console.error("Google AI Error:", e.message); throw new Error("AI Studio API failed to generate review."); }
    if (!reviewText || !reviewText.includes("Introduction:")) { return null; }
    return reviewText;
}

// --- EXPRESS SERVER SETUP ---
const app = express();

app.get('/review/:id', (req, res) => {
    const reviewId = req.params.id;
    const reviewText = getFromCache(reviewId);
    if (!reviewText) {
        return res.status(404).send("<h1>Review Not Found</h1><p>This review may have expired from the cache. Please go back to Stremio and click the movie again.</p>");
    }
    const formattedReview = reviewText.replace(/\*\*(.*?)\*\*/g, '<h3>$1</h3>').replace(/\n/g, '<br>');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>AI-Generated Review</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol';background-color:#121212;color:#e0e0e0;line-height:1.6;padding:20px;}.container{max-width:800px;margin:0 auto;background-color:#1e1e1e;padding:20px 40px;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.5);}h1{color:#bb86fc;text-align:center;}h3{color:#03dac6;border-bottom:1px solid #333;padding-bottom:5px;margin-top:2em;}p,br{font-size:1.1em;}</style></head><body><div class="container"><h1>The Quick Reviewer</h1><p>${formattedReview}</p></div></body></html>`;
    res.send(html);
});

app.use(getRouter(builder.getInterface()));
app.listen(PORT, () => {
    console.log(`TQR Addon v12.0.0 (Final Working Version) listening on port ${PORT}`);
    console.log(`Installation URL: ${ADDON_URL}/manifest.json`);
});

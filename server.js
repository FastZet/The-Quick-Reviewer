const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PORT = process.env.PORT || 7860;
const ADDON_URL = 'https://fatvet-tqr.hf.space'; // Your public addon URL

// Caching Mechanism
const reviewCache = new Map();
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
function getFromCache(key) { /* ... */ }
function setToCache(key, review) { /* ... */ }

// MANIFEST
const manifest = {
    id: 'org.community.quickreviewer',
    version: '3.0.0', // The Real Final Version
    name: 'The Quick Reviewer (TQR)',
    description: 'Provides AI-generated reviews. Install, click any movie, then click the "Configure" link to set up.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: { configurable: true }
};

const builder = new addonBuilder(manifest);

// STREAM HANDLER
builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request for stream: ${type}: ${id}`);
    if (!config || !config.tmdb) {
        console.log('Keys are missing. Returning redirect link.');
        
        // THIS IS THE CORRECT METHOD
        // The URL points back to our own server's /redirect endpoint.
        const redirectUrl = `${ADDON_URL}/redirect`; 
        
        return Promise.resolve({
            streams: [{
                name: 'TQR Setup',
                title: '⚠️ Click to Configure',
                description: 'You must configure this addon with your API keys.',
                url: redirectUrl // Use the standard URL property.
            }]
        });
    }

    // ... [ The rest of the stream handler logic is unchanged ]
    const cacheKey = id;
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) { return Promise.resolve({ streams: [cachedReview] }); }
    try {
        const aiReview = await generateAiReview(type, id, config);
        if (aiReview) {
            setToCache(cacheKey, aiReview);
            return Promise.resolve({ streams: [aiReview] });
        }
        throw new Error('AI review generation returned null.');
    } catch (error) {
        return Promise.resolve({ streams: [{ name: "Review Error", title: "Error", description: error.message }] });
    }
});


// The generateAiReview function remains the same.
async function generateAiReview(type, id, apiKeys) { /* ... */ }


// EXPRESS SERVER SETUP
const app = express();

// NEW REDIRECT ENDPOINT
app.get('/redirect', (req, res) => {
    // This endpoint immediately redirects the user's browser to the real configure page.
    console.log('Redirecting user to configure page.');
    res.redirect(302, `${ADDON_URL}/configure`);
});

app.use(getRouter(builder.getInterface()));

app.get('/configure', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

app.listen(PORT, () => {
    console.log(`TQR Addon v3.0 listening on port ${PORT}`);
    console.log(`Installation URL: ${ADDON_URL}/manifest.json`);
});


// Helper functions (to keep the main code cleaner)
function getFromCache(key) { const e = reviewCache.get(key); if (e && Date.now() - e.timestamp < CACHE_EXPIRATION_MS) { return e.review; } reviewCache.delete(key); return null; }
function setToCache(key, review) { reviewCache.set(key, { review, timestamp: Date.now() }); }
async function generateAiReview(type, id, apiKeys) {
    const { tmdb: tmdbKey, omdb: omdbKey, aistudio: aiStudioKey } = apiKeys;
    const [imdbId, season, episode] = id.split(':');
    let itemDetails;
    try {
        if (type === 'movie') {
            const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/movie/${imdbId}?api_key=${tmdbKey}&append_to_response=credits,reviews`);
            itemDetails = { title: tmdbResponse.data.title, year: new Date(tmdbResponse.data.release_date).getFullYear(), genres: tmdbResponse.data.genres.map(g => g.name).join(', '), director: tmdbResponse.data.credits?.crew.find(c => c.job === 'Director')?.name || 'N/A', isEpisode: false };
        } else {
            const [seriesResponse, episodeResponse] = await Promise.all([ axios.get(`https://api.themoviedb.org/3/tv/${imdbId}?api_key=${tmdbKey}&append_to_response=credits`), axios.get(`https://api.themoviedb.org/3/tv/${imdbId}/season/${season}/episode/${episode}?api_key=${tmdbKey}`) ]);
            itemDetails = { title: `${seriesResponse.data.name} - S${season}E${episode}: ${episodeResponse.data.name}`, year: new Date(seriesResponse.data.first_air_date).getFullYear(), genres: seriesResponse.data.genres.map(g => g.name).join(', '), director: episodeResponse.data.crew?.find(c => c.job === 'Director')?.name || seriesResponse.data.created_by[0]?.name || 'N/A', isEpisode: true };
        }
        const omdbResponse = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
        itemDetails.plot = omdbResponse.data.Plot || 'A summary is not available.'; itemDetails.actors = omdbResponse.data.Actors || 'N/A'; itemDetails.criticRatings = omdbResponse.data.Ratings?.map(r => `${r.Source}: ${r.Value}`).join(', ') || 'N/A'; itemDetails.audienceRating = omdbResponse.data.imdbRating ? `IMDb: ${omdbResponse.data.imdbRating}/10` : 'N/A';
    } catch (e) { throw new Error("Could not fetch metadata. Please verify your API keys."); }
    const prompt = `Generate a spoiler-free review for the following ${itemDetails.isEpisode ? "TV episode" : "movie"}. Follow the structure and constraints precisely.\n**Content Details:**\n- **Title:** ${itemDetails.title} - **Director:** ${itemDetails.director} - **Year:** ${itemDetails.year}\n- **Genre:** ${itemDetails.genres} - **Plot Summary:** ${itemDetails.plot}\n- **Actors:** ${itemDetails.actors} - **Critics Ratings:** ${itemDetails.criticRatings} - **Audience Rating:** ${itemDetails.audienceRating}\n**Review Generation Rules:**\n- You MUST use the provided Google Search function to get the latest reviews across the web to understand recent reception.\n- The entire review MUST be spoiler-free. - Each bullet point MUST be a single sentence of maximum 20 words.\n- You MUST generate content for every single bullet point listed below. Do not skip any.\n- The response MUST be ONLY the bullet points, starting with "Introduction:" and ending with "Recommendation:". Do not add any extra text, formatting, or markdown before or after the list.\n**Review Structure:**\n- **Introduction:** - **Hook:** - **Synopsis:** - **Direction:** - **Acting:** - **Writing:** - **Cinematography:** - **Editing & Pacing:** - **Sound & Music:** - **Production Design:** - **Themes:** - **Critics' Reception:** - **Audience' Reception:** - **Strengths:** - **Weakness:** - **Recommendation:** `;
    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const safetySettings = [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }];
        const result = await model.generateContent(prompt, { safetySettings });
        reviewText = await result.response.text();
    } catch (e) { throw new Error("AI Studio API failed. Check your key or model configuration."); }
    if (!reviewText || !reviewText.includes("Introduction:")) { return null; }
    return { name: "The Quick Reviewer", title: "AI-Generated Review", description: reviewText.replace(/\*/g, '') };
}

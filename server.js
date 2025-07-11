const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PORT = process.env.PORT || 7860;

// Caching Mechanism
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

// MANIFEST - Simple and Correct
const manifest = {
    id: 'org.community.quickreviewer',
    version: '4.0.0', // Final Functional Version
    name: 'The Quick Reviewer (TQR)',
    description: 'Generates AI reviews. Install this addon via its configuration page to embed your personal API keys.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true // This is now correct because installation only happens from the configure page.
    }
};

const builder = new addonBuilder(manifest);

// STREAM HANDLER - Simple and Correct
builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request for stream: ${type}: ${id}`);

    if (!config || !config.tmdb || !config.omdb || !config.aistudio) {
        console.error("CRITICAL: Request made without config. The user must (re)install from the configure page.");
        return Promise.resolve({ streams: [] }); // Fail gracefully by returning no streams
    }

    const cacheKey = id;
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`Generating new review for ${cacheKey}.`);
    try {
        const aiReview = await generateAiReview(type, id, config);
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

// GENERATE AI REVIEW - This is the object that will be displayed
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
    const prompt = `Generate a spoiler-free review for the following ${itemDetails.isEpisode ? "TV episode" : "movie"}. Follow all constraints precisely.\n**Content Details:**\n- Title: ${itemDetails.title}\n- Director: ${itemDetails.director}\n- Year: ${itemDetails.year}\n- Genre: ${itemDetails.genres}\n- Plot: ${itemDetails.plot}\n- Actors: ${itemDetails.actors}\n- Ratings: ${itemDetails.criticRatings}, ${itemDetails.audienceRating}\n**Rules:**\n- Use Google Search to get the latest reviews.\n- Be spoiler-free.\n- Each bullet point is one sentence, max 20 words.\n- Fill every bullet point.\n- Response is ONLY the bullet points, no extra text.\n**Structure:**\n- **Introduction:**\n- **Hook:**\n- **Synopsis:**\n- **Direction:**\n- **Acting:**\n- **Writing:**\n- **Cinematography:**\n- **Editing & Pacing:**\n- **Sound & Music:**\n- **Production Design:**\n- **Themes:**\n- **Critics' Reception:**\n- **Audience' Reception:**\n- **Strengths:**\n- **Weakness:**\n- **Recommendation:**`;
    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        reviewText = await result.response.text();
    } catch (e) { throw new Error("AI Studio API failed. Check your key."); }
    if (!reviewText || !reviewText.includes("Introduction:")) { return null; }
    
    // This is a valid, display-only stream object. It has no URL.
    return {
        name: "The Quick Reviewer",
        title: "AI-Generated Review",
        description: reviewText.replace(/\*/g, '') // Clean up markdown
    };
}

// EXPRESS SERVER SETUP
const app = express();
app.get('/configure', (req, res) => { res.sendFile(__dirname + '/configure.html'); });
app.get('/:config/configure', (req, res) => { res.redirect('/configure'); }); // Handles configure button from within Stremio
app.use('/:config?', getRouter(builder.getInterface()));
app.listen(PORT, () => {
    console.log(`TQR Addon v4.0 listening on port ${PORT}`);
    console.log(`Configure page is at https://fatvet-tqr.hf.space/configure`);
});

const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PORT = process.env.PORT || 7860;

// --- Caching Mechanism ---
const reviewCache = new Map();
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

function getFromCache(key) {
    const entry = reviewCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
        return entry.review;
    }
    reviewCache.delete(key);
    return null;
}

function setToCache(key, review) {
    reviewCache.set(key, { review, timestamp: Date.now() });
}

// --- MANIFEST (Clean and Simple) ---
const manifest = {
    id: 'org.community.quickreviewer',
    version: '2.0.0', // Major version change for new method
    name: 'The Quick Reviewer (TQR)',
    description: 'Provides AI-generated, spoiler-free reviews. After installing, click on any movie and then click the "Configuration Required" link to set up your API keys.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true
    }
};

const builder = new addonBuilder(manifest);

// --- STREAM HANDLER (New Robust Logic) ---
builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request for stream: ${type}: ${id}`);
    const userConfig = config || {};

    // IF NO KEYS: Return a special link that takes the user to the configure page.
    if (!userConfig.tmdb || !userConfig.omdb || !userConfig.aistudio) {
        console.log('Configuration keys are missing. Returning configure link.');
        const configureUrl = `https://fatvet-tqr.hf.space/configure`; // CHANGE THIS if your space name is different
        return Promise.resolve({
            streams: [{
                name: 'The Quick Reviewer',
                title: '⚠️ Configuration Required',
                description: 'Click here to enter your API keys and activate the addon.',
                url: configureUrl,
                behaviorHints: {
                    // This tells Stremio to open the URL externally in a browser
                    "notWebReady": true
                }
            }]
        });
    }

    // IF KEYS EXIST: Proceed with generating the review.
    const cacheKey = id;
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`Generating new review for ${cacheKey}.`);
    try {
        const aiReview = await generateAiReview(type, id, userConfig);
        if (aiReview) {
            setToCache(cacheKey, aiReview);
            return Promise.resolve({ streams: [aiReview] });
        }
        throw new Error('AI review generation returned no result.');
    } catch (error) {
        console.error(`Error during review generation for ${id}:`, error.message);
        return Promise.resolve({ streams: [{ name: "Review Error", title: "An Unexpected Error Occurred", description: error.message }] });
    }
});


// This function remains largely the same
async function generateAiReview(type, id, apiKeys) {
    // ... [The existing generateAiReview function code has no changes]
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
    } catch (e) { throw new Error("Could not fetch metadata from TMDB or OMDB. Please verify your keys."); }
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

// --- EXPRESS SERVER SETUP ---
const app = express();
const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

// This route serves the configuration page.
app.get('/configure', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

app.listen(PORT, () => {
    console.log(`TQR Addon server v2.0 listening on port ${PORT}`);
    console.log(`Installation link: stremio://${req.headers.host || '127.0.0.1:' + PORT}/manifest.json`);
});

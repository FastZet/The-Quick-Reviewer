const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ----------------- CONFIGURATION -----------------
const PORT = process.env.PORT || 7860;

// ----------------- CACHING MECHANISM -----------------
const reviewCache = new Map();
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getFromCache(key) {
    const entry = reviewCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
        return entry.review;
    }
    reviewCache.delete(key);
    return null;
}

function setToCache(key, review) {
    const entry = { review, timestamp: Date.now() };
    reviewCache.set(key, entry);
}

// ----------------- MANIFEST DEFINITION -----------------
const manifest = {
    id: 'org.community.quickreviewer',
    version: '1.0.5', // Incremented version
    name: 'The Quick Reviewer',
    description: 'Provides AI-generated, spoiler-free reviews for movies and series.',
    resources: ['stream', 'catalog'],
    types: ['movie', 'series'],
    catalogs: [{
        type: 'movie',
        id: 'tqr-dummy-catalog',
        name: 'The Quick Reviewer'
    }],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        // FIX #1: Change 'configurationRequired' to false to ensure Install button appears
        configurationRequired: false 
    }
};

// ----------------- ADDON BUILDER -----------------
const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, config }) => {
    console.log(`Request for dummy catalog: ${type} ${id}`);
    return Promise.resolve({ metas: [] });
});

builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request received for stream: ${type}: ${id}`);

    const userConfig = config || {};
    if (!userConfig.tmdb || !userConfig.omdb || !userConfig.aistudio) {
        console.log('Configuration keys are missing from the request.');
        return Promise.resolve({ streams: [{
            name: "Configuration Missing",
            title: "API Keys Required",
            description: "Please configure the addon with your API keys by clicking the 'Configure' button next to the addon in your Stremio settings."
        }] });
    }
    
    const cacheKey = id;
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`No cache found for ${cacheKey}. Attempting to generate a new review.`);
    try {
        const aiReview = await generateAiReview(type, id, userConfig);
        if (aiReview) {
            setToCache(cacheKey, aiReview);
            console.log(`Successfully generated and cached review for ${cacheKey}.`);
            return Promise.resolve({ streams: [aiReview] });
        } else {
             console.error(`Failed to generate review for ${id}, generateAiReview returned null.`);
             return Promise.resolve({ streams: [{ name: "Review Error", title: "Could Not Generate Review", description:"Failed to fetch data or the AI model returned an empty response." }] });
        }
    } catch (error) {
        console.error(`An unexpected error occurred for ${id}:`, error.message);
        return Promise.resolve({ streams: [{ name: "Review Error", title: "An Unexpected Error Occurred", description: error.message }] });
    }
});

async function generateAiReview(type, id, apiKeys) {
    const { tmdb: tmdbKey, omdb: omdbKey, aistudio: aiStudioKey } = apiKeys;
    const [imdbId, season, episode] = id.split(':');

    let itemDetails;
    try {
        if (type === 'movie') {
            const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/movie/${imdbId}?api_key=${tmdbKey}&append_to_response=credits,reviews`);
            itemDetails = {
                title: tmdbResponse.data.title,
                year: new Date(tmdbResponse.data.release_date).getFullYear(),
                genres: tmdbResponse.data.genres.map(g => g.name).join(', '),
                director: tmdbResponse.data.credits?.crew.find(c => c.job === 'Director')?.name || 'N/A',
                isEpisode: false
            };
        } else {
            const [seriesResponse, episodeResponse] = await Promise.all([
                axios.get(`https://api.themoviedb.org/3/tv/${imdbId}?api_key=${tmdbKey}&append_to_response=credits`),
                axios.get(`https://api.themoviedb.org/3/tv/${imdbId}/season/${season}/episode/${episode}?api_key=${tmdbKey}`)
            ]);
            itemDetails = {
                title: `${seriesResponse.data.name} - S${season}E${episode}: ${episodeResponse.data.name}`,
                year: new Date(seriesResponse.data.first_air_date).getFullYear(),
                genres: seriesResponse.data.genres.map(g => g.name).join(', '),
                director: episodeResponse.data.crew?.find(c => c.job === 'Director')?.name || seriesResponse.data.created_by[0]?.name || 'N/A',
                isEpisode: true
            };
        }
        const omdbResponse = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
        itemDetails.plot = omdbResponse.data.Plot || 'A summary is not available.';
        itemDetails.actors = omdbResponse.data.Actors || 'N/A';
        itemDetails.criticRatings = omdbResponse.data.Ratings?.map(r => `${r.Source}: ${r.Value}`).join(', ') || 'N/A';
        itemDetails.audienceRating = omdbResponse.data.imdbRating ? `IMDb: ${omdbResponse.data.imdbRating}/10` : 'N/A';
    } catch (e) {
        console.error("API Fetch Error:", e.message);
        throw new Error("Could not fetch metadata from TMDB or OMDB. Please verify your keys.");
    }
    
    const prompt = `
        Generate a spoiler-free review for the following ${itemDetails.isEpisode ? "TV episode" : "movie"}. Follow the structure and constraints precisely.
        **Content Details:**
        - **Title:** ${itemDetails.title} - **Director:** ${itemDetails.director} - **Year:** ${itemDetails.year}
        - **Genre:** ${itemDetails.genres} - **Plot Summary:** ${itemDetails.plot}
        - **Actors:** ${itemDetails.actors} - **Critics Ratings:** ${itemDetails.criticRatings} - **Audience Rating:** ${itemDetails.audienceRating}
        **Review Generation Rules:**
        - You MUST use the provided Google Search function to get the latest reviews across the web to understand recent reception.
        - The entire review MUST be spoiler-free. - Each bullet point MUST be a single sentence of maximum 20 words.
        - You MUST generate content for every single bullet point listed below. Do not skip any.
        - The response MUST be ONLY the bullet points, starting with "Introduction:" and ending with "Recommendation:". Do not add any extra text, formatting, or markdown before or after the list.
        **Review Structure:**
        - **Introduction:** - **Hook:** - **Synopsis:** - **Direction:** - **Acting:** - **Writing:** - **Cinematography:** - **Editing & Pacing:** - **Sound & Music:** - **Production Design:** - **Themes:** - **Critics' Reception:** - **Audience' Reception:** - **Strengths:** - **Weakness:** - **Recommendation:** 
    `;

    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const safetySettings = [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }];
        const result = await model.generateContent(prompt, { safetySettings });
        reviewText = await result.response.text();
    } catch (e) {
        console.error("AI Generation Error:", e.message);
        throw new Error("AI Studio API failed. Check your key or model configuration.");
    }
    
    if (!reviewText || !reviewText.includes("Introduction:")) {
        console.error("AI response was empty or malformed.");
        return null;
    }

    return {
        name: "The Quick Reviewer",
        title: "AI-Generated Review",
        description: reviewText.replace(/\*/g, '')
    };
}


// ----------------- EXPRESS SERVER SETUP -----------------
const app = express();

// FIX #2: Add a route that redirects from /.../configure to the clean /configure page
app.get('/:config/configure', (req, res) => {
    res.redirect('/configure');
});

// This route serves the configuration page on a clean URL
app.get('/configure', (req, res) => {
    res.sendFile(__dirname + '/configure.html');
});

// This route handles all Stremio manifest/stream requests
app.use('/:config?', getRouter({ ...builder.getInterface(), manifest }));

// ----------------- START SERVER -----------------
app.listen(PORT, () => {
    console.log(`TQR Addon server listening on port ${PORT}`);
    console.log(`Configure page available at http://[your-space-url]/configure`);
});

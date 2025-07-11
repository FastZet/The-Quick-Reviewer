const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ----------------- CONFIGURATION -----------------
const PORT = process.env.PORT || 7000;

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
    version: '1.0.0',
    name: 'The Quick Reviewer',
    description: 'Provides AI-generated, spoiler-free reviews for movies and series.',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

// ----------------- ADDON BUILDER -----------------
const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request for ${type} stream: ${id}`);

    const userConfig = config || {};
    if (!userConfig.tmdb || !userConfig.omdb || !userConfig.aistudio) {
        return Promise.resolve({ streams: [{
            name: "Configuration Error",
            title: "API keys are missing",
            description: "Please (re)install the addon from the configure page with all API keys."
        }] });
    }
    
    // id format is "tt123456" for movie, or "tt123456:1:1" for series episode
    const imdbId = id.split(':')[0];
    const cacheKey = id; // Use the full ID for caching to distinguish episodes

    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`No cache found for ${cacheKey}. Generating new review.`);
    try {
        const aiReview = await generateAiReview(type, id, userConfig);
        if (aiReview) {
            setToCache(cacheKey, aiReview);
            return Promise.resolve({ streams: [aiReview] });
        } else {
             return Promise.resolve({ streams: [{ name: "Review Error", title: "Could not generate review", description:"Failed to fetch data or generate AI review." }] });
        }
    } catch (error) {
        console.error("Error generating review:", error.message);
        return Promise.resolve({ streams: [{ name: "Review Error", title: "An unexpected error occurred", description: error.message }] });
    }
});

async function generateAiReview(type, id, apiKeys) {
    const { tmdb: tmdbKey, omdb: omdbKey, aistudio: aiStudioKey } = apiKeys;
    const [imdbId, season, episode] = id.split(':');

    // 1. Fetch data from TMDB and OMDB
    let tmdbData, omdbData, itemDetails;
    try {
        if (type === 'movie') {
            tmdbData = await axios.get(`https://api.themoviedb.org/3/movie/${imdbId}?api_key=${tmdbKey}&append_to_response=credits,reviews`);
            itemDetails = {
                title: tmdbData.data.title,
                year: new Date(tmdbData.data.release_date).getFullYear(),
                genres: tmdbData.data.genres.map(g => g.name).join(', '),
                director: tmdbData.data.credits?.crew.find(c => c.job === 'Director')?.name || 'N/A'
            };
        } else { // type is 'series'
            const seriesData = await axios.get(`https://api.themoviedb.org/3/tv/${imdbId}?api_key=${tmdbKey}&append_to_response=credits`);
            const episodeData = await axios.get(`https://api.themoviedb.org/3/tv/${imdbId}/season/${season}/episode/${episode}?api_key=${tmdbKey}`);
            itemDetails = {
                title: `${seriesData.data.name} - S${season}E${episode}: ${episodeData.data.name}`,
                year: new Date(seriesData.data.first_air_date).getFullYear(),
                genres: seriesData.data.genres.map(g => g.name).join(', '),
                director: episodeData.data.crew?.find(c => c.job === 'Director')?.name || seriesData.data.created_by[0]?.name || 'N/A'
            };
        }
        omdbData = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
    } catch (e) {
        console.error("Failed to fetch data from movie APIs:", e.message);
        return null;
    }
    
    // 2. Construct the prompt for the AI
    const prompt = `
        Generate a spoiler-free review for the following ${type}. Follow the structure and constraints precisely.

        **Content Details:**
        - **Title:** ${itemDetails.title}
        - **Director:** ${itemDetails.director}
        - **Year:** ${itemDetails.year}
        - **Genre:** ${itemDetails.genres}
        - **Plot Summary:** ${omdbData.data.Plot || 'A summary is not available.'}
        - **Actors:** ${omdbData.data.Actors || 'N/A'}
        - **Critics Ratings (e.g., Rotten Tomatoes, Metacritic):** ${omdbData.data.Ratings?.map(r => `${r.Source}: ${r.Value}`).join(', ') || 'N/A'}
        - **Audience Rating (e.g., IMDb):** ${omdbData.data.imdbRating ? `IMDb: ${omdbData.data.imdbRating}/10` : 'N/A'}

        **Review Generation Rules:**
        - You MUST use the provided Google Search function to get the latest reviews across the web to understand recent reception.
        - The entire review MUST be spoiler-free.
        - Each bullet point MUST be a single sentence of maximum 20 words.
        - You MUST generate content for every single bullet point listed below. Do not skip any.
        - The response MUST be ONLY the bullet points, starting with "Introduction:" and ending with "Recommendation:". Do not add any extra text before or after the list.

        **Review Structure:**
        - **Introduction:** 
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
        - **Audience' Reception:** 
        - **Strengths:** 
        - **Weakness:** 
        - **Recommendation:** 
    `;

    // 3. Call Google AI Studio API
    let reviewText;
    try {
        const genAI = new GoogleGenerativeAI(aiStudioKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" }); // Or your preferred model
        
        // Adjust safety settings as requested
        const safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ];
        
        const result = await model.generateContent(prompt, { safetySettings });
        const response = await result.response;
        reviewText = response.text();
    } catch (e) {
        console.error("Failed to generate AI review:", e.message);
        return { name: "AI Error", title: "Could not contact AI", description: "The AI Studio API failed to respond. Check your key or try again later." };
    }
    
    // 4. Format the review into a Stremio stream object
    // The 'description' field in Stremio supports multiline text.
    return {
        name: "The Quick Reviewer",
        title: "AI-Generated Review",
        description: reviewText
    };
}


// ----------------- EXPRESS SERVER SETUP -----------------
const app = express();
app.get('/configure', (req, res) => res.sendFile(__dirname + '/configure.html'));
app.use('/:config?', getRouter({ ...builder.getInterface(), manifest }));

// ----------------- START SERVER -----------------
app.listen(PORT, () => {
    console.log(`TQR Addon server listening on port ${PORT}`);
    console.log(`Configure page available at http://127.0.0.1:${PORT}/configure`);
});

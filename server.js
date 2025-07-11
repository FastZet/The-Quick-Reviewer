const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');

// ----------------- CONFIGURATION -----------------
const PORT = process.env.PORT || 7000;

// ----------------- CACHING MECHANISM -----------------
// Simple in-memory cache to store reviews for 7 days.
const reviewCache = new Map();
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getFromCache(key) {
    const entry = reviewCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_EXPIRATION_MS) {
        return entry.review;
    }
    // Entry is either non-existent or expired, so we clear it.
    reviewCache.delete(key);
    return null;
}

function setToCache(key, review) {
    const entry = {
        review: review,
        timestamp: Date.now()
    };
    reviewCache.set(key, entry);
}


// ----------------- MANIFEST DEFINITION -----------------
// This manifest describes the addon's capabilities to Stremio.
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

// 'stream' resource handler. This is where the magic happens.
// Stremio will call this function when it needs a stream for a particular movie or episode.
builder.defineStreamHandler(async ({ type, id, config }) => {
    console.log(`Request for ${type} stream: ${id}`);

    // The 'config' object will contain the user's API keys from the installation URL.
    // Example: { tmdb: "...", omdb: "...", aistudio: "..." }
    const userConfig = config || {};
    if (!userConfig.tmdb || !userConfig.omdb || !user_config.aistudio) {
        // If keys are missing, we can't proceed.
        return Promise.resolve({ streams: [{
            name: "Configuration Error",
            title: "API keys are missing.",
            description: "Please configure the addon with your TMDB, OMDB, and AI Studio API keys."
        }] });
    }

    // Use the TMDB ID as the unique key for our cache.
    const cacheKey = id.split(':')[0]; // e.g., 'tt123456'

    // 1. Check the cache first.
    const cachedReview = getFromCache(cacheKey);
    if (cachedReview) {
        console.log(`Serving review from cache for ${cacheKey}`);
        return Promise.resolve({ streams: [cachedReview] });
    }

    console.log(`No cache found for ${cacheKey}. Generating new review.`);

    // 2. If not in cache, generate a new review.
    // We will build the full 'generateAiReview' function in the next step.
    // For now, it's a placeholder.
    const aiReview = await generateAiReview(id, userConfig);

    // 3. Store the newly generated review in the cache.
    setToCache(cacheKey, aiReview);

    // 4. Return the review as a stream object.
    return Promise.resolve({ streams: [aiReview] });
});

// Placeholder function for AI review generation.
// We will replace this with a real implementation later.
async function generateAiReview(itemId, apiKeys) {
    // In the next step, this function will:
    // 1. Fetch data from TMDB and OMDB using the provided apiKeys.
    // 2. Construct a prompt for the AI Studio API.
    // 3. Call the AI Studio API to get the review.
    // 4. Format the review into the Stremio stream object format.

    // This is a dummy response for now.
    const dummyReview = {
        name: "The Quick Reviewer",
        title: "AI Review (Generating...)",
        description: "This is a placeholder review. The real AI-powered review will be implemented in the next step."
    };

    console.log(`(Placeholder) Generating review for ${itemId}`);
    return dummyReview;
}


// ----------------- EXPRESS SERVER SETUP -----------------
const app = express();

// Serve the configuration page.
app.get('/configure', (req, res) => {
    // We will create the configure.html file in the next step.
    res.sendFile(__dirname + '/configure.html');
});

// Stremio addon router.
// This handles requests to /manifest.json and /stream/...
// It also decodes the configuration from the URL.
app.use('/:config?', getRouter({ ...builder.getInterface(), manifest }));


// ----------------- START SERVER -----------------
app.listen(PORT, () => {
    console.log(`TQR Addon server listening on port ${PORT}`);
    // This provides an example installation link in the console when the server starts.
    // Users will get their actual link from the /configure page.
    console.log('Example Install Link (replace with your keys): http://127.0.0.1:7000/tmdb=YOUR_KEY|omdb=YOUR_KEY|aistudio=YOUR_KEY/manifest.json');
});

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

// Define the manifest for "The Quick Reviewer" addon
const manifest = {
    "id": "org.therickyrath.thequickreviewer",
    "version": "1.0.0",
    "name": "The Quick Reviewer",
    "description": "Provides AI-generated, spoiler-free reviews for movies and series.",
    "resources": [
        "stream"
    ],
    "types": ["movie", "series"],
    "idPrefixes": ["tt"]
};

const builder = new addonBuilder(manifest);

// Stream provider logic
builder.defineStreamHandler(function(args) {
    if (args.type === 'movie' || args.type === 'series') {
        // We will add the review generation logic here in the next steps.
        // For now, we return a placeholder response.
        const stream = {
            title: "The Quick Reviewer",
            url: "#" // This will be a placeholder, as we are not providing a video stream.
        };
        return Promise.resolve({ streams: [stream] });
    } else {
        return Promise.resolve({ streams: [] });
    }
});

const port = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), { port: port });

console.log(`Addon running on port ${port}`);

# The Quick Reviewer — Stremio Addon

Provides spoiler-free bullet-point AI reviews for movies and series episodes as a single stream link.

## Folder Structure
```
quick-reviewer-addon/
├── index.js              # Main server & addon logic
├── api.js                # Handles metadata fetch + AI review generation
├── cache.js              # In-memory cache for reviews
├── routes.js             # Express routes for API endpoints
├── manifest.json         # Stremio addon manifest
├── package.json          # Node.js project dependencies and metadata
├── public/               # Static files served by Express
│   ├── configure.html    # Local API key configuration UI
│   └── review.html       # Review display page
```

## Features
- **AI-generated Reviews:** Uses Google Gemini API for spoiler-free, bullet-point summaries.
- **Metadata Retrieval:** Fetches details from TMDB and OMDB.
- **In-memory Caching:** Improves performance and reduces API calls.
- **Stremio Integration:** Works as a standard addon with `/manifest.json` endpoint.

## Deployment on Hugging Face Spaces
1. **Space Type:** Set to *Node.js*.
2. **Environment Variables** (Settings → Variables):
   - `TMDB_API_KEY`
   - `OMDB_API_KEY`
   - `GEMINI_API_KEY`
   - `BASE_URL` → Your deployed Space URL (e.g., `https://username-quick-reviewer.hf.space`)
3. **Start Command:** Ensure `package.json` has a `start` script:
   ```json
   "scripts": {
     "start": "node index.js"
   }
   ```
4. Commit `public/` with both HTML files.
5. Test addon manifest:
   ```
   https://<space-name>.hf.space/manifest.json
   ```

## Usage in Stremio
- Install the addon in Stremio using the manifest URL.
- For any movie or episode, you’ll see a single **Quick AI Review** stream that opens the review page.

## License
MIT

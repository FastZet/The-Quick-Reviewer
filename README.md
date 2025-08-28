# The Quick Reviewer — Stremio Addon

Provides spoiler-free, bullet-point AI reviews for movies and series episodes as a single stream link, powered by Google Gemini.

## Key Features

*   **🤖 AI-Generated Reviews:** Uses the Google Gemini API to generate high-quality, structured, and spoiler-free reviews.
*   **🔒 Optional Password Protection:** Secure your addon endpoint with a single password. Includes IP-based rate-limiting to prevent brute-force attacks.
*   **✨ Interactive UI:** A modern, collapsible accordion interface for the review page makes content easy to navigate on any device.
*   **⚙️ Admin & Debugging:** When password-protected, provides access to a page listing all currently cached reviews and their metadata.
*   **⚡ Smart Performance:**
    *   **Concurrent Request Handling:** Prevents duplicate API calls when multiple users request the same review simultaneously.
    *   **Stream Pre-generation:** The addon attempts to generate the review before Stremio even requests the page, ensuring it's ready instantly.
    *   **In-memory Caching:** Caches generated reviews to reduce API usage and provide faster subsequent loads.
*   **🌐 Reliable Metadata:** Fetches media details primarily from TMDB, with OMDB as a robust fallback.

## Folder Structure

```
The-Quick-Reviewer/
├── Dockerfile              # Docker configuration for deployment
├── server.js               # Main server, routing, and addon logic
├── api.js                  # Handles metadata fetching and AI review generation
├── cache.js                # In-memory cache management
├── routes.js               # Express routes for API endpoints
├── scraper.js              # Scrapes IMDb for supplementary metadata
├── manifest.json           # Stremio addon manifest
├── package.json            # Project dependencies and scripts
└── public/                 # Static files served to the user
    ├── index.html          # Dynamic landing page with password prompt
    ├── review.html         # The redesigned, interactive review page
    ├── cached-reviews.html # Page to display all cached reviews
    └── style.css           # Centralized stylesheet for all pages
```

## Configuration (Environment Variables)

To run the addon, you need to set the following environment variables.

| Variable             | Description                                                                                             | Required |
| -------------------- | ------------------------------------------------------------------------------------------------------- | :------: |
| `TMDB_API_KEY`       | Your API key from The Movie Database (TMDB).                                                            |   **Yes**    |
| `OMDB_API_KEY`       | Your API key from the OMDb API.                                                                         |   **Yes**    |
| `GEMINI_API_KEY`     | Your API key from Google AI Studio for the Gemini model.                                                |   **Yes**    |
| `BASE_URL`           | The public URL of your deployed addon (e.g., `https://your-space.hf.space`).                              |   **Yes**    |
| `ADDON_PASSWORD`     | An optional password to secure all addon endpoints.                                                     |    No    |
| `ADDON_TIMEOUT_MS`   | (Optional) Milliseconds to wait for review pre-generation. Defaults to `15000` (15 seconds).             |    No    |

## Deployment on Hugging Face Spaces

1.  **Create a Space:** In Hugging Face, create a new Space using the **Docker** template and make it public.
2.  **Add Environment Variables:** In your Space's **Settings**, go to **Variables and Secrets** and add the required variables listed above (`TMDB_API_KEY`, `OMDB_API_KEY`, `GEMINI_API_KEY`, `BASE_URL`, and `ADDON_PASSWORD` if desired).
3.  **Push the Code:** Clone the repository and push the code to your Hugging Face Space. The `Dockerfile` will handle the rest.
4.  Wait for the Space to build and start.

## Usage in Stremio

The installation method depends on whether you have set a password.

#### **If No Password is Set (Unsecured):**

1.  Find your addon's manifest URL: `https://<your-space-url>/manifest.json`
2.  Copy this URL and paste it into the search bar in Stremio to install the addon.

#### **If a Password is Set (Secured):**

1.  Navigate to the root URL of your addon in a web browser: `https://<your-space-url>/`
2.  Enter the password you set in the `ADDON_PASSWORD` variable.
3.  Upon successful validation, you will be presented with two links:
    *   **Install Addon:** Click this to install the addon in Stremio.
    *   **View Cached Reviews:** This opens the admin page to see all cached items.

Once installed, a "⚡ Quick AI Review" stream will appear for any movie or series episode, which will open the review page when clicked.

## License

MIT

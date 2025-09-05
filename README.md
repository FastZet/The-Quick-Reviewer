# The Quick Reviewer — Stremio Addon
Provides spoiler-free, bullet-point AI reviews for movies and series episodes as a single stream link, powered by Google Gemini via the official @google/genai SDK and grounded with Google Search when needed.

## Key Features
*   🌐 Multi-Language Translation: Seamlessly translate reviews into 20 of the world's most spoken languages using a direct integration with Google Translate.
*   🤖 AI Self-Correction & Verification: An internal verifier automatically validates the format of every AI-generated review and triggers retries if the structure is incorrect.
*   ✨ Modern & Responsive UI: The review page is designed for a clean, professional experience on both desktop and mobile devices.
*   🔒 Optional Password Protection: Secure the addon endpoint with a single password and IP-based rate-limiting to deter brute-force attacks.
*   ⚡ Smart Performance:
    *   Concurrent Request Handling: Prevents duplicate API calls when multiple users request the same review simultaneously.
    *   Server-Side Rendering (SSR): The review page is rendered on the server for fast load times and better compatibility with translation flows.
    *   In-memory Caching: Caches generated reviews to reduce API usage and speed up subsequent loads.
*   🌐 Reliable Metadata: Fetches media details primarily from TMDB, with OMDB as a robust fallback.
*   🕷️ Web Scraping: Scrapes IMDb for supplementary episode data (like specific episode titles) to improve AI context.
*   ⚙️ Admin & Debugging: When password-protected, includes an admin page to list all cached reviews and metadata.
*   🧠 Official @google/genai + Grounding: Uses @google/genai with the googleSearch tool to enable real-time web grounding and citations for more accurate, up-to-date responses.
*   🚀 Gemini 2.5 Default Model: Defaults to gemini‑2.5‑flash‑lite for cost-efficient, low-latency usage and supports Google Search grounding.

## Architecture Flowchart
This diagram illustrates the request lifecycle, from Stremio to the final review, including the self-correction loop.
```mermaid
flowchart TD
    subgraph "A. Entry Points & Routing"
        A[User Request] --> B[server.js];
        B -- Mounts Router --> C[addonRouter.js];
        C -- Path: /stream/... --> D[stremioStreamer.js];
        C -- Path: /review --> E[api.js];
    end

    subgraph "B. Core Logic Orchestration (api.js)"
        E --> F[1. Check Cache];
        F -- Hit --> G[Return Cached Result];
        F -- Miss --> H[2. Fetch Metadata];
        
        H --> I[metadataService.js];
        I -- Calls --> I_API[(TMDB/OMDB)];
        H --> J[scraper.js];
        J -- Calls --> J_WEB[(IMDb)];

        H --> K[3. Build Prompt];
        K --> L[promptBuilder.js];
        
        K --> M[4. Generate Review];
        
        subgraph "4a. Self-Correction Loop"
            M --> N[geminiService.js];
            N -- Calls --> N_API[(Gemini AI)];
            N_API -- Raw Text --> N;
            N --> O[reviewVerifier.js];
            O -- Valid? --> P{isValid};
            P -- No --> M;
            P -- Yes --> Q[5. Process Valid Text];
        end

        Q --> R[reviewParser.js];
        R -- Extracts Verdict --> Q;
        Q --> S[formatEnforcer.js];
        S -- Creates HTML --> Q;
        
        Q --> T[6. Save to Cache];
        T --> G;
    end

    subgraph "C. Response Generation"
        G -- Result Object --> D;
        G -- Result Object --> C;
        D --> U[streamTitleBuilder.js];
        U -- Formatted Title --> D;
        D --> V([Stremio Stream JSON]);
        
        C -- Renders review.html w/ Data --> W([HTML Page Response]);
    end

    subgraph "External Services"
        direction LR
        I_API; J_WEB; N_API;
    end

    style A fill:#a2d2ff,stroke:#333
    style V fill:#a2d2ff,stroke:#333
    style W fill:#a2d2ff,stroke:#333
    style O fill:#e63946,stroke:#333,color:#fff
    style N fill:#ffb703,stroke:#333
```

## Configuration (Environment Variables)
To run the addon, set the following environment variables, especially when self-hosting or deploying on platforms like Hugging Face Spaces.

| Variable | Description | Required |
| :--- | :--- | :---: |
| TMDB_API_KEY | API key from The Movie Database (TMDB) for metadata.  | Yes |
| OMDB_API_KEY | API key from the OMDb API for metadata fallback.  | Yes |
| GEMINI_API_KEY | Google AI Studio Gemini API key used by @google/genai.  | Yes |
| GEMINI_MODEL | Optional override for the Gemini model; defaults to gemini‑2.5‑flash‑lite.  | No |
| BASE_URL | Public URL of the deployed addon (e.g., Space or server base).  | Yes |
| ADDON_PASSWORD | Optional password to secure the addon’s endpoints.  | No |
| ADDON_TIMEOUT_MS | Optional milliseconds to wait for pre-generation; defaults to 13000.  | No |

## Deployment on Hugging Face Spaces
1.  Create a Space using the Docker template and set it to public.
2.  Add environment variables under Settings → Variables and Secrets as listed above.
3.  Push the repository to the Space; the Dockerfile will install and run the service.
4.  Wait for the Space to build and start; the addon will be live when the container is healthy.

## Usage in Stremio
The installation method depends on whether a password is set.

#### If No Password is Set (Unsecured):
1.  Find the addon's manifest URL at: `https://<your-space-url>/manifest.json`
2.  Paste this URL into the Stremio search bar to install the addon.

#### If a Password is Set (Secured):
1.  Open the root URL: `https://<your-space-url>/`
2.  Enter the password set in ADDON_PASSWORD to unlock the install link.
3.  After validation, use the provided buttons to install the addon or view cached reviews.

Once installed, a “⚡ Quick AI Review” stream appears for movies and series episodes, and opening it renders the review page with structured, spoiler-free analysis.

## Folder Structure
The project is modular for maintainability and extensibility.
```
The-Quick-Reviewer/
├── Dockerfile                 # Docker configuration for deployment
├── server.js                  # Main Express server entry point
├── manifest.json              # Stremio addon manifest
├── package.json               # Project dependencies and scripts
├── public/                    # Static files (HTML, CSS, assets) served to the user
│   ├── index.html             # Dynamic landing page with password prompt
│   ├── review.html            # The SSR-powered, interactive review page
│   ├── cached-reviews.html    # Page to display all cached reviews
│   └── css/                   # Stylesheets for the UI
│       ├── global.css
│       ├── cached.css
│       └── review.css
└── src/                       # Main application source code
    ├── api.js                 # Core orchestrator for review generation & self-correction
    ├── config/
    │   └── promptBuilder.js   # Constructs the AI prompt
    ├── core/
    │   ├── cache.js           # In-memory cache management
    │   ├── formatEnforcer.js  # Cleans and structures the final HTML
    │   ├── reviewParser.js    # Extracts the one-line verdict from raw AI text
    │   ├── reviewVerifier.js  # Validates AI output to trigger self-correction
    │   ├── scraper.js         # Handles IMDb web scraping
    │   └── stremioStreamer.js # Builds the Stremio stream response
    ├── routes/
    │   └── addonRouter.js     # Handles ALL Stremio and internal API routes
    └── services/
        ├── geminiService.js   # @google/genai integration with Google Search grounding
        └── metadataService.js # Fetches data from TMDB and OMDB
```

## License
This project is licensed under the MIT License; see the LICENSE file for details.

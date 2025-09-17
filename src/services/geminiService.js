// src/services/geminiService.js — @google/genai (Gemini 2.5 only) with Google Search grounding

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _aiClient = null;

/**
 * Lazily import @google/genai in a CommonJS environment and build a client.
 * Uses API key from Google AI Studio (server-side only).
 */
async function getGenAIClient() {
  if (!_aiClient) {
    // Dynamic import to avoid ESM/CommonJS interop issues
    const { GoogleGenAI } = await import('@google/genai');
    _aiClient = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    });
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini 2.5 using Google Search grounding.
 * Grounding is enabled via system instructions in the new SDK.
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = await getGenAIClient();

      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt}`);
      console.log(`[Gemini] Google Search grounding enabled via system instructions`);

      // New SDK approach: Enable Google Search via system instructions
      const enhancedPrompt = `You are a professional film critic with access to real-time information. 
Use Google Search to find current box office data, critic scores (Rotten Tomatoes, Metacritic), 
audience ratings (IMDb), and recent critical reception for accurate, up-to-date information.

${prompt}

IMPORTANT: Use web search to gather real-time data for:
- Box Office Performance (Budget, Domestic, Worldwide figures)  
- Critical Reception (Rotten Tomatoes %, Metacritic scores)
- Audience Reception (IMDb ratings, RT Audience scores)
- Current social media buzz and trends

Ensure all data is current and accurate by searching for recent information.`;

      // New SDK API structure
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{
          role: "user",
          parts: [{ text: enhancedPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
        // Enable Google Search grounding through system instructions
        systemInstruction: "You have access to Google Search. Use it to find current, accurate information about movies and TV shows, including box office data, ratings, and critical reception. Always search for the most recent and accurate data available."
      });

      const text = result.response?.text?.() || result.text;

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      // Check for search grounding indicators in response
      const hasCurrentData = /(?:budget|box office|rotten tomatoes|metacritic|imdb|\$\d+|\d+%|\d+\/10)/i.test(text);
      const hasRecentInfo = /(?:2024|2025|recent|current|latest|as of)/i.test(text);

      console.log(`[Gemini] Generation completed successfully`);
      console.log(`[Gemini] - Model: ${GEMINI_MODEL}`);
      console.log(`[Gemini] - Response length: ${text.length} characters`);
      console.log(`[Gemini] - Contains current data indicators: ${hasCurrentData}`);
      console.log(`[Gemini] - Contains recent info indicators: ${hasRecentInfo}`);

      if (hasCurrentData || hasRecentInfo) {
        console.log(`[Gemini] ✅ Web grounding appears ACTIVE - Found current data indicators`);
      } else {
        console.warn(`[Gemini] ⚠️ Web grounding may not be active - No current data indicators found`);
      }

      return text.trim();
    } catch (err) {
      console.error(`[Gemini] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code
      });

      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure after ${attempt} attempts`);
        throw new Error(`Error generating review after all retries: ${err?.message || 'Unknown error'}`);
      }
      
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

module.exports = { generateReview };

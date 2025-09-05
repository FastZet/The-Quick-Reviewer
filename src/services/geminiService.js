// src/services/geminiService.js — migrated to @google/genai with Google Search grounding

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
    const mod = await import('@google/genai');
    const { GoogleGenAI } = mod;
    _aiClient = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    });
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err && err.status ? err.status : 0;
  const name = err && err.name ? err.name : '';
  const retryable =
    name === 'ApiError' ||
    status === 429 ||
    (status >= 500 && status < 600);
  return retryable && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini, with Google Search grounding enabled.
 * - For Gemini 2.x models, uses tools: [{ googleSearch: {} }] (recommended).
 * - For Gemini 1.5 models, falls back to tools: [{ googleSearchRetrieval: { dynamicRetrievalConfig } }] (legacy).
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  const useLegacyGrounding = /^gemini-1\\.5/i.test(GEMINI_MODEL);
  const tools = useLegacyGrounding
    ? [
        {
          googleSearchRetrieval: {
            // Legacy fallback for Gemini 1.5
            dynamicRetrievalConfig: {
              mode: "MODE_DYNAMIC",
              dynamicThreshold: 0.7
            }
          }
        }
      ]
    : [
        {
          // Recommended grounding for Gemini 2.x
          googleSearch: {}
        }
      ];

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = await getGenAIClient();

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          tools,
          temperature: 0.7
        }
      });

      const text = response && typeof response.text === 'string' ? response.text.trim() : '';
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      // Optional: log whether response is grounded (has citations)
      const candidate = response.candidates && response.candidates;
      const grounded = !!(candidate && candidate.groundingMetadata);
      console.log(`[Gemini] Generated review. Grounded=${grounded}, Model=${GEMINI_MODEL}`);

      return text;
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        const name = err && err.name ? err.name : 'UnknownError';
        const status = err && err.status ? err.status : 'n/a';
        console.error(`[Gemini] Permanent failure on attempt ${attempt}: ${name} (status: ${status}) - ${err.message}`);
        throw new Error("Error generating review after all retries.");
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

module.exports = { generateReview };

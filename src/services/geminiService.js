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
 * Grounding is enabled via the `googleSearch` tool (no legacy fallbacks).
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  // Recommended grounding path for Gemini 2.x
  const tools = [{ googleSearch: {} }];

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = await getGenAIClient();

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          tools,
          temperature: 0.7,
        },
      });

      const text = typeof response?.text === 'string' ? response.text.trim() : '';
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      // Log whether the response included grounding/citations
      const grounded = !!response?.candidates?.?.groundingMetadata;
      console.log(`[Gemini] Generated review. Grounded=${grounded}, Model=${GEMINI_MODEL}`);

      return text;
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err?.message || err);
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

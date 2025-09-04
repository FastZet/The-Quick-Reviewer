// src/services/geminiService.js — using @google/genai (current SDK)

const MAX_RETRIES = 2;
// Allow model override via environment variable
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

let _genaiModule = null;  // Cached SDK module
let _aiClient = null;     // Cached client instance

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Dynamically import the ESM-only SDK in CommonJS context
async function loadGenAI() {
  if (_genaiModule) return _genaiModule;
  _genaiModule = await import('@google/genai');
  return _genaiModule;
}

// Retrieve or instantiate the AI client
async function getClient() {
  if (_aiClient) return _aiClient;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  }
  const { GoogleGenAI } = await loadGenAI();
  _aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY, apiVersion: 'v1' });
  return _aiClient;
}

// Determine if the error is retryable (rate limit, server error, etc.)
function shouldRetry(err, attempt) {
  const httpStatus = err?.status;
  if ((httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600)) && attempt < MAX_RETRIES) {
    return true;
  }
  const name = err?.name;
  if ((name === 'ApiError' || name === 'FetchError') && attempt < MAX_RETRIES) {
    return true;
  }
  return false;
}

/**
 * Generates a review via Gemini AI with Google Search grounding.
 * Retries up to MAX_RETRIES on transient failure, with exponential backoff.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function generateReview(prompt) {
  const ai = await getClient();
  const { HarmCategory, HarmBlockThreshold } = await loadGenAI();

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const generationConfig = {
    safetySettings,
    tools: [{ googleSearch: {} }],
  };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES}: generating review...`);

      const chat = await ai.chats.create({
        model: GEMINI_MODEL,
        config: generationConfig,
      });

      const response = await chat.sendMessage({ message: prompt });
      const text = response?.text?.() ?? '';

      console.log(`[Gemini] Review generated successfully.`);
      return text.trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err);
        throw new Error('Error generating review after all retries.');
      }
      const backoffMs = 250 * Math.pow(2, attempt - 1); // 250ms, then 500ms
      console.warn(`[Gemini] Retryable error on attempt ${attempt}, retrying in ${backoffMs}ms...`);
      await delay(backoffMs);
    }
  }

  throw new Error('Reached maximum retry attempts without success.');
}

module.exports = { generateReview };

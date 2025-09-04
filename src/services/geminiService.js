// src/services/geminiService.js — Updated to use only GOOGLE_GENERATIVE_AI_API_KEY

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || null;

let _genaiModule;
let _client;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadGenAI() {
  if (_genaiModule) return _genaiModule;
  _genaiModule = await import("@google/genai");
  return _genaiModule;
}

async function getClient() {
  if (_client) return _client;
  if (!GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  }
  const { GoogleGenAI } = await loadGenAI();
  _client = new GoogleGenAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY, apiVersion: "v1" });
  return _client;
}

function shouldRetry(err, attempt) {
  const status = err?.status;
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) return true;
  if ((err?.name === "ApiError" || err?.name === "FetchError") && attempt < MAX_RETRIES) return true;
  return false;
}

/**
 * Generate a review with Gemini, grounded with Google Search.
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

  // Config must contain `tools`
  const generationConfig = {
    safetySettings,
    tools: [{ googleSearch: {} }],
  };

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES}: generating review...`);

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: generationConfig,
      });

      const text = response?.text || "";
      console.log("[Gemini] Review generated successfully.");
      return text.trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err);
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

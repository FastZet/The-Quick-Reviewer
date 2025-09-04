// src/services/geminiService.js — using @google/genai (current SDK)

const MAX_RETRIES = 2;
// Allow model to be overridden by env var, defaulting to the latest flash model.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
// Support both new and legacy environment variable names for the API key.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

let _genai; // cached module exports
let _ai;    // cached client instance

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Dynamically import the ESM-only @google/genai package in our CommonJS project.
async function loadSdk() {
  if (_genai) return _genai;
  _genai = await import('@google/genai');
  return _genai;
}

// Get a memoized client instance.
async function getClient() {
  if (_ai) return _ai;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  }
  const { GoogleGenAI } = await loadSdk();
  _ai = new GoogleGenAI(GEMINI_API_KEY);
  return _ai;
}

// Determine if an error is transient and worth retrying.
function shouldRetry(err, attempt) {
  const status = err?.status;
  if (status === 429 || (status >= 500 && status < 600)) return attempt < MAX_RETRIES;
  if ((err?.name === 'ApiError' || err?.name === 'FetchError') && attempt < MAX_RETRIES) return true;
  return false;
}

/**
 * Generates a review by sending a prompt to the Gemini AI model.
 * @param {string} prompt - The fully constructed prompt for the AI.
 * @returns {Promise<string>} The generated review text.
 */
async function generateReview(prompt) {
  const ai = await getClient();
  const { HarmCategory, HarmBlockThreshold } = await loadSdk();

  // Replicate the original "BLOCK_NONE" safety setting from the legacy code.
  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_NONE },
  ];
  
  const model = ai.getGenerativeModel({ 
    model: GEMINI_MODEL,
    safetySettings,
    tools: [{ googleSearch: {} }],
  });

  let attempt = 0;
  while (true) {
    try {
      console.log(`[Gemini] Starting review generation, attempt ${attempt + 1}/${MAX_RETRIES}...`);
      const chat = model.startChat();
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const reviewText = response.text();
      
      console.log(`[Gemini] Successfully generated review on attempt ${attempt + 1}.`);
      return reviewText.trim();

    } catch (err) {
      attempt += 1;
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Review generation failed permanently on attempt ${attempt}:`, err);
        throw new Error('Error generating review after all retries.');
      }
      const backoff = 250 * Math.pow(2, attempt - 1); // 250ms, 500ms
      console.warn(`[Gemini] Attempt ${attempt} failed. Retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }
}

module.exports = { generateReview };

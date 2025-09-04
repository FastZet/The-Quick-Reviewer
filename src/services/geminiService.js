// src/services/geminiService.js — using @google/genai (GA SDK)

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

let _genaiModule, _aiClient;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadGenAI() {
  if (_genaiModule) return _genaiModule;
  _genaiModule = await import('@google/genai');
  return _genaiModule;
}

async function getClient() {
  if (_aiClient) return _aiClient;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  }
  const { GoogleGenAI } = await loadGenAI();
  _aiClient = new GoogleGenAI(GEMINI_API_KEY);
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status;
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) return true;
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
  const { HarmCategory, HarmBlockThreshold } = await loadGenAI();

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const tools = [{ googleSearch: {} }];

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES} generating review…`);

      // CORRECTED: Use ai.chats.create() to start a new chat session with all configuration.
      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        config: { safetySettings },
        tools: tools,
      });

      // CORRECTED: Pass the prompt as a message object.
      const result = await chat.sendMessage({ message: prompt });
      
      // CORRECTED: Access the response text as a property.
      const responseText = result.response?.text;

      if (!responseText) {
          throw new Error("Received an empty or invalid response from the AI.");
      }

      console.log('[Gemini] Review successfully generated.');
      return responseText.trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err);
        throw err;
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retry in ${backoff}ms…`);
      await delay(backoff);
    }
  }

  throw new Error('Failed generating review after maximum retries.');
}

module.exports = { generateReview };

// src/services/geminiService.js — using @google/genai (GA SDK)

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

let _genaiModule, _client;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadGenAI() {
  if (_genaiModule) return _genaiModule;
  _genaiModule = await import('@google/genai');
  return _genaiModule;
}

async function getClient() {
  if (_client) return _client;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  }
  // CORRECTED: The class to import and instantiate is 'GoogleGenAI'.
  const { GoogleGenAI } = await loadGenAI();
  _client = new GoogleGenAI(GEMINI_API_KEY);
  return _client;
}

function shouldRetry(err, attempt) {
  const status = err?.status;
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) return true;
  if ((err?.name === 'ApiError' || err?.name === 'FetchError') && attempt < MAX_RETRIES) return true;
  return false;
}

async function generateReview(prompt) {
  const ai = await getClient(); // This now correctly returns an instance of GoogleGenAI.
  const { HarmCategory, HarmBlockThreshold } = await loadGenAI();

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  // This is the correct flow: get a 'model' instance from the 'ai' client.
  const model = ai.getGenerativeModel({
    model: GEMINI_MODEL,
    safetySettings,
    tools: [{ googleSearch: {} }],
  });

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES} generating review…`);
      
      // Now 'model.startChat()' will work because 'model' is a valid GenerativeModel instance.
      const chat = model.startChat();
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const reviewText = response.text();

      console.log('[Gemini] Review successfully generated.');
      return reviewText.trim();

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

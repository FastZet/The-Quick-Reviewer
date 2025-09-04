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
  const { Client } = await loadGenAI();
  _client = new Client({ apiKey: GEMINI_API_KEY, apiVersion: 'v1' });
  return _client;
}

function shouldRetry(err, attempt) {
  const status = err?.status;
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) return true;
  if ((err?.name === 'ApiError' || err?.name === 'FetchError') && attempt < MAX_RETRIES) return true;
  return false;
}

async function generateReview(prompt) {
  const client = await getClient();
  const { types } = await loadGenAI();
  const { SafetySetting, Tool, GenerateContentConfig } = types;

  const safetySettings = [
    new SafetySetting({
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_NONE',
    }),
    new SafetySetting({
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_NONE',
    }),
    new SafetySetting({
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_NONE',
    }),
    new SafetySetting({
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_NONE',
    }),
  ];

  const tools = [
    new Tool({ google_search: {} }), // Note: This is still snake_case inside Tool
  ];

  const config = new GenerateContentConfig({
    safetySettings,
    tools,
  });

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES} generating review…`);
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config,
      });
      console.log('[Gemini] Review successfully generated.');
      return response.text;
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

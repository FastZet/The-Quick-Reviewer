// src/services/geminiService.js — @google/genai with CORRECT current API

const { GoogleGenAI } = require('@google/genai');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _aiClient = null;

/**
 * Initialize GoogleGenAI client with proper error handling
 */
function getGenAIClient() {
  if (!_aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
    }
    try {
      _aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      console.log('[Gemini] Client initialized successfully');
    } catch (error) {
      console.error('[Gemini] Failed to initialize client:', error);
      throw new Error(`Failed to initialize GoogleGenAI client: ${error.message}`);
    }
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini using the CURRENT @google/genai API
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const client = getGenAIClient();
      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt}`);
      console.log(`[Gemini] Using @google/genai SDK`);

      // CORRECT usage: get model, then call model.generateContent(...)
      const model = client.getGenerativeModel({ model: GEMINI_MODEL });

      const response = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      });

      // Extract text from response
      let text;
      if (response?.response?.text) {
        text = typeof response.response.text === 'function' ? response.response.text() : response.response.text;
      } else if (response?.text) {
        text = typeof response.text === 'function' ? response.text() : response.text;
      } else {
        throw new Error('No text content in response');
      }

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      console.log(`[Gemini] Generation completed successfully`);
      console.log(`[Gemini] - Model: ${GEMINI_MODEL}`);
      console.log(`[Gemini] - Response length: ${text.length} characters`);
      console.log(`[Gemini] ✅ Generation successful`);

      return text.trim();

    } catch (err) {
      console.error(`[Gemini] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code,
        name: err?.name,
        stack: err?.stack ? err.stack.split('\n').slice(0, 3).join('\n') : 'No stack trace'
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

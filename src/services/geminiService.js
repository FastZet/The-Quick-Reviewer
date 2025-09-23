// src/services/geminiService.js — Manages a pool of @google/genai clients with the correct, modern API syntax.

const { GoogleGenAI } = require('@google/genai');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- CLIENT INITIALIZATION FROM A SINGLE, COMMA-SEPARATED ENV VAR ---
const clients = [];
const allKeys = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);

if (allKeys.length > 0) {
  allKeys.forEach((key, index) => {
    try {
      // Correct constructor for @google/genai
      const genAI = new GoogleGenAI(key);
      clients.push(genAI);
      console.log(`[Gemini] Client #${index + 1} initialized successfully.`);
    } catch (error) {
      console.error(`[Gemini] Failed to initialize client #${index + 1}:`, error);
    }
  });
} else {
  console.warn('[Gemini] Warning: GEMINI_API_KEY is not set. The addon will not function.');
}

let clientIndex = 0;
// Round-robin function to get the next available client
function getClient() {
  if (clients.length === 0) return null;
  const client = clients[clientIndex];
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}
// --- END CLIENT INITIALIZATION ---


function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  // Do not retry on 4xx errors (like quota exhausted), only on server-side 5xx errors.
  return (status >= 500 && status < 600) && attempt < MAX_RETRIES;
}

/**
 * generateReview now uses the correct API call syntax for @google/genai.
 * @param {string} prompt The prompt to send to the AI.
 * @returns {Promise<string|null>} The generated text or null on failure.
 */
async function generateReview(prompt) {
  // Each call gets the next client from the pool.
  const genAI = getClient();
  const clientNum = clients.indexOf(genAI) + 1;

  if (!genAI) {
    console.error('[Gemini] Generation failed: No valid AI clients are available.');
    return null;
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt} using client #${clientNum}`);
      
      // --- START: DEFINITIVE CORRECT API CALL for @google/genai ---
      const model = genAI.getGenerativeModel({ 
        model: GEMINI_MODEL,
        tools: [{ googleSearch: {} }],
      });
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      // --- END: DEFINITIVE CORRECT API CALL ---
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      console.log(`[Gemini] ✅ Generation successful using client #${clientNum}.`);
      return text.trim();

    } catch (err) {
      // Log the actual error object for better debugging.
      console.error(`[Gemini] Error on attempt ${attempt} (using client #${clientNum}):`, err);

      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure after ${attempt} attempts.`);
        break; 
      }

      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

module.exports = { generateReview };

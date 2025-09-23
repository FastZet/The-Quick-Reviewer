// src/services/geminiService.js — Manages a pool of @google/genai clients from a single, comma-separated ENV var.

const { GoogleGenAI } = require('@google/genai');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- CLIENT INITIALIZATION FROM A SINGLE, COMMA-SEPARATED ENV VAR ---
const clients = [];
const allKeys = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean); // Removes any empty strings from trailing commas, etc.

if (allKeys.length > 0) {
  allKeys.forEach((key, index) => {
    try {
      const client = new GoogleGenAI(key);
      clients.push(client);
      console.log(`[Gemini] Client #${index + 1} initialized successfully.`);
    } catch (error) {
      console.error(`[Gemini] Failed to initialize client #${index + 1}:`, error);
    }
  });
} else {
  console.warn('[Gemini] Warning: GEMINI_API_KEY is not set. The addon will not function.');
}

let clientIndex = 0;
// --- Round-robin function to get the next available client ---
function getClient() {
  if (clients.length === 0) return null;
  const client = clients[clientIndex];
  // Increment index for the next call, wrapping around if needed
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}
// --- END CLIENT INITIALIZATION ---


function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  // Gemini free tier 429 errors are not retryable in the short term, so we don't retry on those.
  return (status >= 500 && status < 600) && attempt < MAX_RETRIES;
}

/**
 * CHANGED: generateReview no longer needs a client passed to it.
 * It automatically gets the next available client from the internal pool.
 * @param {string} prompt The prompt to send to the AI.
 * @returns {Promise<string|null>} The generated text or null on failure.
 */
async function generateReview(prompt) {
  const client = getClient();
  const clientNum = clients.indexOf(client) + 1;

  if (!client) {
    console.error('[Gemini] Generation failed: No valid AI clients are available.');
    return null;
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt} using client #${clientNum}`);
      const model = client.getGenerativeModel({ model: GEMINI_MODEL });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      console.log(`[Gemini] ✅ Generation successful using client #${clientNum}.`);
      return text.trim();

    } catch (err) {
      console.error(`[Gemini] Error on attempt ${attempt} (using client #${clientNum}):`, {
        message: err?.message,
        status: err?.status,
      });

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

// Export only the unified generation function
module.exports = { generateReview };

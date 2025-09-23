// src/services/geminiService.js
// Google GenAI (Gemini) integration using the current "@google/genai" SDK and models.generateContent API.

'use strict';

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_RETRIES = 2;

// Simple jittered backoff
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Maintain a tiny client pool so logs can reflect “Client #1/#2”
let clients = [null, null];

function getClient(index) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY is not set.');
  }
  if (!clients[index]) {
    clients[index] = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log(`[Gemini] Client #${index + 1} initialized successfully.`);
  }
  return clients[index];
}

function shouldRetry(err, attempt) {
  const status = Number(err?.status || 0);
  // Retry on rate limit or transient 5xx; cap attempts
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

function coerceText(res) {
  if (!res) return null;
  try {
    // The SDK exposes .text as a property in Node examples; guard for callable just in case
    return typeof res.text === 'function' ? res.text() : res.text || null;
  } catch {
    return null;
  }
}

async function generateOnce(prompt, model, clientIndex, attempt) {
  const ai = getClient(clientIndex);
  console.log(`[Gemini] Starting generation with model: ${model}, attempt: ${attempt} using client #${clientIndex + 1}`);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    // Optional tuning knobs; keep conservative
    config: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  });
  const text = await coerceText(response);
  if (!text || !String(text).trim()) {
    throw new Error('Empty response from Gemini');
  }
  return String(text).trim();
}

/**
 * Public entry: generate raw review/summary text for a given prompt.
 * Tries client #1 then #2 per attempt, with bounded retries for transient errors.
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY is not set.');
  }

  const model = GEMINI_MODEL;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Try both clients for this attempt
    for (let clientIdx = 0; clientIdx < 2; clientIdx++) {
      try {
        const out = await generateOnce(prompt, model, clientIdx, attempt);
        console.log('[Gemini] Generation completed successfully.');
        return out;
      } catch (err) {
        console.error(
          `[Gemini] Error on attempt ${attempt} (using client #${clientIdx + 1}):`,
          err?.message || err
        );
        // Mirror original logs for clarity
        console.error(`[Gemini] Permanent failure after 1 attempts.`);
        lastErr = err;
      }
    }

    if (shouldRetry(lastErr, attempt)) {
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
      continue;
    } else {
      break;
    }
  }

  throw new Error('Failed generating review after maximum retries.');
}

module.exports = { generateReview };

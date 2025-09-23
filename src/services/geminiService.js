// src/services/geminiService.js
'use strict';

const { GoogleGenAI } = require('@google/genai');

const MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
const MAX_ATTEMPTS = 2;
const INITIAL_BACKOFF_MS = 250;

// Require exactly two distinct keys; no fallbacks or combined strings
const KEY_ALPHA = (process.env.GEMINI_API_KEY_ALPHA || '').trim();
const KEY_BETA  = (process.env.GEMINI_API_KEY_BETA  || '').trim();

if (!KEY_ALPHA || !KEY_BETA) {
  // Defer throwing until first call so the server can still boot and serve static/health
  console.warn('[Gemini] Missing GEMINI_API_KEY_ALPHA and/or GEMINI_API_KEY_BETA. Generation will fail until both are set.');
}

// Build a fixed client pool in the provided order (Alpha, then Beta)
const CLIENTS = [];
if (KEY_ALPHA) {
  try {
    CLIENTS.push(new GoogleGenAI({ apiKey: KEY_ALPHA }));
    console.log('[Gemini] Client #1 initialized successfully.');
  } catch (e) {
    console.error('[Gemini] Failed to init Client #1 (ALPHA):', e?.message || e);
  }
}
if (KEY_BETA) {
  try {
    CLIENTS.push(new GoogleGenAI({ apiKey: KEY_BETA }));
    console.log('[Gemini] Client #2 initialized successfully.');
  } catch (e) {
    console.error('[Gemini] Failed to init Client #2 (BETA):', e?.message || e);
  }
}

// Global round-robin pointer so concurrent calls (review + summary) split across keys
let rr = 0;
function nextIndex() {
  const idx = rr % CLIENTS.length;
  rr = (rr + 1) % Number.MAX_SAFE_INTEGER;
  return idx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const code = Number(err?.status || err?.error?.code || 0);
  return code === 429 || (code >= 500 && code < 600);
}

function coerceText(res) {
  if (!res) return null;
  try {
    // SDK exposes a .text accessor; support both property and callable styles
    return typeof res.text === 'function' ? res.text() : res.text || null;
  } catch {
    return null;
  }
}

async function callWithClient(prompt, clientIndex, attempt) {
  const client = CLIENTS[clientIndex];
  if (!client) throw new Error('Gemini clients are not initialized.');

  console.log(`[Gemini] Starting generation with model: ${MODEL}, attempt: ${attempt} using client #${clientIndex + 1}`);

  // Use the current Google GenAI API: models.generateContent with string input
  const response = await client.models.generateContent({
    model: MODEL,
    input: prompt,
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

async function generateReview(prompt) {
  if (CLIENTS.length !== 2) {
    throw new Error('Both GEMINI_API_KEY_ALPHA and GEMINI_API_KEY_BETA must be set to use generation.');
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // For each attempt, prefer a different starting key via round-robin
    const first = nextIndex();
    const second = (first + 1) % CLIENTS.length;

    // Try first chosen key
    try {
      const out = await callWithClient(prompt, first, attempt);
      console.log('[Gemini] Generation completed successfully.');
      return out;
    } catch (err1) {
      console.error(`[Gemini] Error on attempt ${attempt} (using client #${first + 1}):`, typeof err1 === 'string' ? err1 : JSON.stringify(err1, null, 2));
      console.error('[Gemini] Permanent failure after 1 attempts.');
      lastErr = err1;

      // If retryable, immediately try the other key in the same attempt
      if (isRetryable(err1)) {
        try {
          const out = await callWithClient(prompt, second, attempt);
          console.log('[Gemini] Generation completed successfully (fallback key).');
          return out;
        } catch (err2) {
          console.error(`[Gemini] Error on attempt ${attempt} (using client #${second + 1}):`, typeof err2 === 'string' ? err2 : JSON.stringify(err2, null, 2));
          console.error('[Gemini] Permanent failure after 1 attempts.');
          lastErr = err2;
        }
      }
    }

    // Backoff between attempts if we will retry
    if (attempt < MAX_ATTEMPTS && isRetryable(lastErr)) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await sleep(backoff);
    } else {
      break;
    }
  }

  throw new Error('Failed generating review after maximum retries.');
}

module.exports = { generateReview };

// src/services/geminiService.js
'use strict';

const { GoogleGenAI } = require('@google/genai');

const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
const MAX_RETRIES = 2;

// Parse keys: support comma- or space-separated lists in GEMINI_API_KEY (preferred) or GOOGLE_API_KEY (fallback)
function parseKeys() {
  const primary = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
  const fallback = !primary && process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim();
  const raw = primary || fallback || '';
  const parts = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  return parts;
}

const KEYS = parseKeys();
if (!KEYS.length) {
  // Defer throwing until first call so the app can start and expose health/static routes
  console.warn('[Gemini] No API key found in GEMINI_API_KEY/GOOGLE_API_KEY (Google AI Studio key required).');
}

// Jittered backoff
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Client pool (one per key)
const clients = [];
for (let i = 0; i < KEYS.length; i++) {
  try {
    clients[i] = new GoogleGenAI({ apiKey: KEYS[i] });
    console.log(`[Gemini] Client #${i + 1} initialized successfully.`);
  } catch (e) {
    console.error(`[Gemini] Failed to init client #${i + 1}: ${e?.message || e}`);
  }
}

// Round-robin index
let rr = 0;
function pickClientIndex() {
  if (!clients.length) throw new Error('Gemini API key missing. Set GEMINI_API_KEY or GOOGLE_API_KEY.');
  const idx = rr % clients.length;
  rr = (rr + 1) % Number.MAX_SAFE_INTEGER;
  return idx;
}

function shouldRetry(err, attempt) {
  // Retry only on 429 or 5xx
  const code = Number(err?.status || err?.error?.code || 0);
  return (code === 429 || (code >= 500 && code < 600)) && attempt < MAX_RETRIES;
}

function isKeyInvalid(err) {
  const code = Number(err?.status || err?.error?.code || 0);
  const msg = (err?.error?.message || err?.message || '').toLowerCase();
  const reason =
    Array.isArray(err?.error?.details)
      ? (err.error.details.find(d => d?.reason)?.reason || '').toLowerCase()
      : '';
  return code === 400 && (msg.includes('api key not valid') || reason.includes('api_key_invalid'));
}

function coerceText(res) {
  if (!res) return null;
  try {
    return typeof res.text === 'function' ? res.text() : res.text || null;
  } catch {
    return null;
  }
}

async function generateOnce(prompt, model, clientIndex, attempt) {
  const ai = clients[clientIndex];
  if (!ai) throw new Error('Gemini client not initialized');

  console.log(`[Gemini] Starting generation with model: ${model}, attempt: ${attempt} using client #${clientIndex + 1}`);

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
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
 * Public API: generate raw text for a review/summary.
 * - Rotates across all configured keys for each attempt.
 * - Skips keys that return API_KEY_INVALID for the duration of the process.
 */
async function generateReview(prompt) {
  if (!clients.length) {
    throw new Error('Gemini API key missing. Set GEMINI_API_KEY or GOOGLE_API_KEY (Google AI Studio key).');
  }

  const model = GEMINI_MODEL;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Try up to N clients this attempt
    const tried = new Set();
    for (let tries = 0; tries < clients.length; tries++) {
      const idx = pickClientIndex();
      if (tried.has(idx)) continue;
      tried.add(idx);

      try {
        const out = await generateOnce(prompt, model, idx, attempt);
        console.log('[Gemini] Generation completed successfully.');
        return out;
      } catch (err) {
        // If this key is invalid, remove it from rotation
        if (isKeyInvalid(err)) {
          console.error(`[Gemini] Key for client #${idx + 1} is invalid; removing from pool.`);
          clients.splice(idx, 1);
          // Adjust round-robin pointer after removal
          rr = rr % Math.max(clients.length, 1);
          if (!clients.length) {
            throw new Error('All provided Gemini API keys are invalid.');
          }
        } else {
          console.error(
            `[Gemini] Error on attempt ${attempt} (using client #${idx + 1}):`,
            typeof err === 'string' ? err : JSON.stringify(err, null, 2)
          );
          console.error('[Gemini] Permanent failure after 1 attempts.');
          lastErr = err;
        }
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

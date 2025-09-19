// src/services/geminiService.js — @google/genai (Gemini 2.5)

'use strict';

// google-generative-ai (Gemini 2.5)
const MAX_RETRIES = parseInt(process.env.AI_RETRIES || '2', 10);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const DEBUG_PROMPT = String(process.env.DEBUG_PROMPT || 'false').toLowerCase() === 'true';
const DEBUG_RESPONSE = String(process.env.DEBUG_RESPONSE || 'false').toLowerCase() === 'true';

let aiClient = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'function') return `Function(${value.name || 'anonymous'})`;
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    },
    2
  );
}

async function getGenAIClient() {
  if (aiClient) return aiClient;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
  const { GoogleGenerativeAI } = await import('google-generative-ai');
  aiClient = new GoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
  return aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES);
}

async function generateReview(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const ai = await getGenAIClient();

      const enhancedPrompt = [
        'You are a professional film critic with access to current information when needed.',
        'Follow the user’s formatting rules exactly and keep results spoiler-free.',
        '',
        prompt,
      ].join('\n');

      if (DEBUG_PROMPT) {
        console.log('Gemini BEGIN FULL PROMPT (model:', GEMINI_MODEL, ')');
        console.log(enhancedPrompt);
        console.log('Gemini END FULL PROMPT', enhancedPrompt.length, 'chars');
      }

      const model = ai.getGenerativeModel({ model: GEMINI_MODEL });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: enhancedPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        systemInstruction: 'Use up-to-date knowledge when helpful (box office, critic/audience scores) and obey the exact output format required.',
      });

      const text = result?.response?.text?.() ?? result?.text?.();
      if (!text || !String(text).trim()) throw new Error('Empty response from Gemini');

      if (DEBUG_RESPONSE) {
        const raw = result?.response ?? result;
        console.log('Gemini BEGIN RAW RESPONSE');
        try { console.log(safeStringify(raw)); } catch (e) { console.log('Gemini stringify failed:', e?.message || 'unknown error'); }
        console.log('Gemini END RAW RESPONSE');
        const candidate = raw?.candidates?.[0];
        const grounding = candidate?.groundingMetadata;
        if (grounding) {
          console.log('Gemini Grounding metadata present');
          try { console.log(JSON.stringify(grounding, null, 2)); } catch {}
        }
      }

      return String(text).trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) throw new Error(`Gemini error: ${err?.message || 'unknown'}`);
      const backoff = 250 * Math.pow(2, attempt - 1);
      if (DEBUG_RESPONSE) console.warn('Gemini retryable error on attempt', attempt, 'retrying in', backoff, 'ms...');
      await delay(backoff);
    }
  }
  throw new Error('Failed generating review after maximum retries.');
}

module.exports = generateReview;

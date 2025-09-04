// src/services/geminiService.js — using @google/genai

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

let _genai;
let _ai;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function loadSdk() {
  if (_genai) return _genai;
  _genai = await import('@google/genai');
  return _genai;
}

async function getClient() {
  if (_ai) return _ai;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.');
  }
  const { GoogleGenAI } = await loadSdk();
  _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY, apiVersion: 'v1' });
  return _ai;
}

function shouldRetry(err, attempt) {
  const status = err?.status;
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) {
    return true;
  }
  const name = err?.name;
  if ((name === 'ApiError' || name === 'FetchError') && attempt < MAX_RETRIES) {
    return true;
  }
  return false;
}

/**
 * Generates a review by sending a prompt to the Gemini AI model.
 * Replicates legacy behavior: new chat per prompt, enabling Google Search tool,
 * with retry on transient errors.
 */
async function generateReview(prompt) {
  const ai = await getClient();
  const { HarmCategory, HarmBlockThreshold } = await loadSdk();

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const baseConfig = {
    safetySettings,
    tools: [{ googleSearch: {} }],
  };

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES}: sending prompt...`);

      const chat = await ai.chats.create({
        model: GEMINI_MODEL,
        config: baseConfig,
      });

      const response = await chat.sendMessage({ message: prompt });
      const text = response?.text ?? response?.response?.text?.() ?? '';
      
      console.log(`[Gemini] Review generated successfully.`);
      return text.trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err);
        throw new Error('Error generating review after all retries.');
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}, retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }
}

module.exports = { generateReview };

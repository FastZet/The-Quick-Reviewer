// src/services/geminiService.js — @google/genai with correct API usage

const { GoogleGenAI } = require('@google/genai');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _aiClient = null;

function getGenAIClient() {
  if (!_aiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
    }
    
    // Correct @google/genai initialization
    _aiClient = new GoogleGenAI({ 
      apiKey: GEMINI_API_KEY 
    });
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini 2.5 using Google Search grounding.
 * Uses the NEW @google/genai SDK API pattern.
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = getGenAIClient();

      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt}`);
      console.log(`[Gemini] Using @google/genai SDK with Google Search grounding`);

      // NEW @google/genai API pattern - direct ai.models.generateContent()
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }], // Enable Google Search grounding
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        }
      });

      if (!response.text || response.text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      // Enhanced logging to verify grounding usage
      const grounded = !!(response.groundingMetadata || response.citationMetadata);
      const searchCalls = response.toolCalls?.filter(call => call.name === 'googleSearch')?.length || 0;

      console.log(`[Gemini] Generation completed successfully`);
      console.log(`[Gemini] - Model: ${GEMINI_MODEL}`);
      console.log(`[Gemini] - Grounded: ${grounded}`);
      console.log(`[Gemini] - Google Search calls made: ${searchCalls}`);
      console.log(`[Gemini] - Response length: ${response.text.length} characters`);

      if (searchCalls > 0 || grounded) {
        console.log(`[Gemini] ✅ Web grounding ACTIVE - Search functionality enabled`);
      } else {
        console.warn(`[Gemini] ⚠️ Web grounding NOT USED - Model used existing knowledge`);
      }

      return response.text.trim();
    } catch (err) {
      console.error(`[Gemini] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code,
        stack: err?.stack?.split('\n')[0] // First line of stack trace
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

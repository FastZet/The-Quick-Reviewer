// src/services/geminiService.js — @google/genai (Gemini 2.5 only) with Google Search grounding

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _aiClient = null;

/**
 * Lazily import @google/genai in a CommonJS environment and build a client.
 * Uses API key from Google AI Studio (server-side only).
 */
async function getGenAIClient() {
  if (!_aiClient) {
    // Dynamic import to avoid ESM/CommonJS interop issues
    const { GoogleGenAI, createUserContent } = await import('@google/genai');
    _aiClient = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    });
    // Expose helper for usage
    _aiClient.createUserContent = createUserContent;
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini 2.5 using Google Search grounding.
 * Grounding is enabled via the `googleSearch` tool.
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  // Enable Google Search grounding tool
  const tools = [{ googleSearch: {} }];

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = await getGenAIClient();

      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt}`);
      console.log(`[Gemini] Google Search tool enabled: ${JSON.stringify(tools)}`);

      // New SDK API: Use ai.models.generateContent directly
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: ai.createUserContent([prompt]),
        config: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          tools: tools,
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: ["googleSearch"]
            }
          }
        }
      });

      // New SDK response structure: result.text (not response.text())
      const text = result.text;

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      // Enhanced logging to verify grounding usage
      const candidates = result.candidates || [];
      const candidate = candidates[0] || {};
      const grounded = !!(
        candidate.groundingMetadata ||
        candidate.citationMetadata ||
        (candidate.content && candidate.content.parts && 
         candidate.content.parts.some(part => part.functionCall))
      );

      // Check if function calls were made
      const functionCalls = (candidate.content?.parts || []).filter(part => part.functionCall) || [];
      const searchCalls = functionCalls.filter(call => call.functionCall?.name === 'googleSearch').length;

      console.log(`[Gemini] Generation completed successfully`);
      console.log(`[Gemini] - Model: ${GEMINI_MODEL}`);
      console.log(`[Gemini] - Grounded: ${grounded}`);
      console.log(`[Gemini] - Google Search calls made: ${searchCalls}`);
      console.log(`[Gemini] - Response length: ${text.length} characters`);

      if (searchCalls > 0) {
        console.log(`[Gemini] ✅ Web grounding ACTIVE - Made ${searchCalls} search calls`);
      } else {
        console.warn(`[Gemini] ⚠️ Web grounding NOT USED - No search calls detected`);
        console.warn(`[Gemini] This may indicate the model didn't need external data or there's a configuration issue`);
      }

      return text.trim();
    } catch (err) {
      console.error(`[Gemini] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code
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

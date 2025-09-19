// src/services/geminiService.js — @google/genai (Gemini 2.5) with full prompt + grounding metadata logging

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _aiClient = null;

/**
 * Lazily import @google/genai in a CommonJS environment and build a client.
 */
async function getGenAIClient() {
  if (!_aiClient) {
    const { GoogleGenAI } = await import('@google/genai');
    _aiClient = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    });
  }
  return _aiClient;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini 2.5.
 * Logs the exact full prompt sent and grounding metadata returned by the model.
 */
async function generateReview(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const ai = await getGenAIClient();

      // Final prompt the model receives: seed prompt + strong instructions for recency/data usage.
      const enhancedPrompt = `You are a professional film critic with access to current information.
Use Google Search to gather recent data where relevant (box office, critic scores, audience ratings, social buzz) and keep results up to date.

${prompt}

IMPORTANT:
- If box office/ratings are available, include concrete figures where possible.
- Prefer recent, accurate information.
- Keep the structure and formatting exactly as requested in the prompt.
`;

      // Print the full prompt in logs for external A/B testing (e.g., ChatGPT vs Gemini).
      console.log(`[Gemini] === BEGIN FULL PROMPT (model: ${GEMINI_MODEL}) ===`);
      console.log(enhancedPrompt);
      console.log(`[Gemini] === END FULL PROMPT (${enhancedPrompt.length} chars) ===`);

      console.log(`[Gemini] Starting generation with model: ${GEMINI_MODEL}, attempt: ${attempt}`);

      // New SDK API shape
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: enhancedPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192
        },
        // Guidance for real-time/useful retrieval as system instruction
        systemInstruction:
          "Use web knowledge to keep data current when helpful (box office, critic/audience scores, recency cues). Obey the user's formatting rules strictly."
      });

      // Prefer new SDK shape, but fall back to response.* if present
      const text = result?.text || result?.response?.text?.();

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      // Grounding metadata logging (authoritative signal of Google Search grounding)
      // Cover both possible shapes: result.candidates vs result.response.candidates
      const candidate = result?.candidates?.[0] || result?.response?.candidates?.[0];
      if (candidate?.groundingMetadata) {
        console.log('[Gemini] Grounding metadata present');
        try {
          console.log(JSON.stringify(candidate.groundingMetadata, null, 2));
        } catch {
          console.log('[Gemini] (Could not stringify groundingMetadata safely)');
        }
      } else {
        console.log('[Gemini] No grounding metadata (response not grounded)');
      }

      console.log(`[Gemini] Generation completed successfully (length: ${text.length} chars)`);
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

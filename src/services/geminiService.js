// src/services/geminiService.js — Complete replacement using Vercel AI SDK with Google Search and disabled safety settings

const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;

// Cache the configured model to avoid recreating it on every request
let _configuredModel = null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getConfiguredModel() {
  if (_configuredModel) return _configuredModel;
  
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.");
  }

  // Configure the model with API key and disabled safety settings
  _configuredModel = google(GEMINI_MODEL, {
    apiKey: GEMINI_API_KEY,
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH', 
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
    ],
  });

  return _configuredModel;
}

function shouldRetry(err, attempt) {
  // Handle different error types that might come from Vercel AI SDK
  const status = err?.status || err?.response?.status;
  
  // Retry on rate limiting (429) or server errors (5xx)
  if ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES) {
    return true;
  }
  
  // Retry on network errors
  if ((err?.name === "ApiError" || err?.name === "FetchError" || err?.code === 'ECONNRESET') && attempt < MAX_RETRIES) {
    return true;
  }
  
  // Retry on timeout errors
  if ((err?.message?.includes('timeout') || err?.code === 'ETIMEDOUT') && attempt < MAX_RETRIES) {
    return true;
  }
  
  return false;
}

/**
 * Generate a review with Gemini, grounded with Google Search and safety settings disabled.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function generateReview(prompt) {
  const model = getConfiguredModel();
  
  let attempt = 0;
  let lastError = null;

  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES}: generating review with Google Search and disabled safety settings...`);

      const result = await generateText({
        model: model,
        prompt: prompt,
        tools: {
          // Enable Google Search for real-time data grounding
          google_search: google.tools.googleSearch({}),
        },
        // Additional configuration options
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        frequencyPenalty: 0,
        presencePenalty: 0,
      });

      // Extract the generated text
      const text = result.text || "";
      
      // Log search usage for debugging
      if (result.toolResults && result.toolResults.length > 0) {
        const searchResults = result.toolResults.filter(tool => tool.toolName === 'google_search');
        if (searchResults.length > 0) {
          console.log(`[Gemini] Used ${searchResults.length} Google Search queries for real-time data grounding`);
        }
      }

      // Log if we have sources (alternative way Vercel AI SDK might provide search info)
      if (result.sources && result.sources.length > 0) {
        console.log(`[Gemini] Used ${result.sources.length} search sources for real-time data`);
      }

      console.log("[Gemini] Review generated successfully with Google Search grounding and disabled safety settings.");
      return text.trim();

    } catch (err) {
      lastError = err;
      console.error(`[Gemini] Error on attempt ${attempt}:`, err.message);
      
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err);
        break;
      }

      // Calculate exponential backoff delay
      const backoffDelay = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoffDelay}ms...`);
      
      await delay(backoffDelay);
    }
  }

  // If we've exhausted all retries, throw a descriptive error
  const errorMessage = lastError?.message || 'Unknown error occurred';
  throw new Error(`Error generating review after ${MAX_RETRIES} retries: ${errorMessage}`);
}

// Export for testing or debugging purposes
function getModelInfo() {
  return {
    model: GEMINI_MODEL,
    hasApiKey: !!GEMINI_API_KEY,
    maxRetries: MAX_RETRIES
  };
}

module.exports = { 
  generateReview,
  getModelInfo // Optional: for debugging
};

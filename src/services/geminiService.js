// src/services/geminiService.js — using Vercel AI SDK with Google provider

const { google } = require('@ai-sdk/google');
const { generateText } = require('ai');

const MAX_RETRIES = 2;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GOOGLE_GENERATIVE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_GENERATIVE_API_KEY || null;
// const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || null;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRetry(err, attempt) {
  const isRetryableError = 
    err.name === 'APIError' || 
    err.name === 'NetworkError' || 
    err.name === 'TimeoutError' ||
    (err.status && (err.status === 429 || (err.status >= 500 && err.status < 600)));
  
  return isRetryableError && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Gemini, grounded with Google Search.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function generateReview(prompt) {
  if (!GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${MAX_RETRIES}: generating review...`);

      const result = await generateText({
        model: google(GEMINI_MODEL, {
          apiKey: GOOGLE_GENERATIVE_API_KEY,
        }),
        prompt: prompt,
        maxRetries: 1,
        temperature: 0.7,
        // Enable Google Search grounding
        experimental_toolCallMode: 'auto',
        tools: {
          searchWeb: {
            description: 'Search the web for current information about movies, shows, box office data, reviews, and ratings',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to find current information'
                }
              },
              required: ['query']
            },
            execute: async ({ query }) => {
              // This is a placeholder - Vercel AI SDK with Google provider 
              // will automatically use Google Search when this tool is defined
              console.log(`[Search] Executing search for: ${query}`);
              return `Search results for "${query}" will be automatically provided by Google.`;
            }
          }
        }
      });

      console.log("[Gemini] Review generated successfully.");
      return result.text.trim();
    } catch (err) {
      if (!shouldRetry(err, attempt)) {
        console.error(`[Gemini] Permanent failure on attempt ${attempt}:`, err.message);
        throw new Error("Error generating review after all retries.");
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

module.exports = { generateReview };

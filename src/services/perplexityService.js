// src/services/perplexityService.js — Perplexity AI with web grounding

const MAX_RETRIES = 2;
const PERPLEXITY_MODEL = process.env.AI_MODEL || "sonar-pro";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || null;
const DEBUG_PROMPT = process.env.DEBUG_PROMPT === "false";
const DEBUG_RESPONSE = process.env.DEBUG_RESPONSE === "false";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _client = null;

/**
 * Initialize OpenAI-compatible client for Perplexity API
 */
async function getPerplexityClient() {
  if (!_client) {
    const { OpenAI } = await import('openai');
    _client = new OpenAI({
      apiKey: PERPLEXITY_API_KEY,
      baseURL: "https://api.perplexity.ai"
    });
  }
  return _client;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with Perplexity AI using real-time web search
 */
async function generateReview(prompt) {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is not set.");
  }

  // Map AI_MODEL to Perplexity models if needed
  const modelMap = {
    'auto': 'sonar-pro',
    'best': 'sonar-pro',
    'fast': 'sonar',
    'research': 'sonar-deep-research'
  };
  
  const actualModel = modelMap[PERPLEXITY_MODEL] || PERPLEXITY_MODEL;

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const client = await getPerplexityClient();

      // Enhanced prompt with web search instructions
      const enhancedPrompt = `You are a professional film critic with access to current information.
Use real-time web search to gather recent data for box office figures, critic scores, audience ratings, and social media buzz.

${prompt}

IMPORTANT:
- Search for current box office data, ratings, and reviews
- Include concrete figures and recent information where available
- Keep the structure and formatting exactly as requested in the prompt
- Verify cast, director, and release details through web search`;

      if (DEBUG_PROMPT) {
        console.log(`[Perplexity] === BEGIN FULL PROMPT (model: ${actualModel}) ===`);
        console.log(enhancedPrompt);
        console.log(`[Perplexity] === END FULL PROMPT (${enhancedPrompt.length} chars) ===`);
      }

      console.log(`[Perplexity] Starting generation with model: ${actualModel}, attempt: ${attempt}`);

      const response = await client.chat.completions.create({
        model: actualModel,
        messages: [
          {
            role: "system",
            content: "You are a professional film critic. Use web search to find accurate, current information about movies and TV shows. Always verify facts and provide real data when available."
          },
          {
            role: "user", 
            content: enhancedPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 8192,
        // Perplexity-specific parameters for enhanced search
        return_related_questions: false,
        return_images: false,
        search_recency_filter: "month" // Prioritize recent information
      });

      if (DEBUG_RESPONSE) {
        console.log('[Perplexity] === BEGIN RAW RESPONSE ===');
        try {
          console.log(JSON.stringify(response, null, 2));
        } catch (e) {
          console.log(`[Perplexity] (Raw response stringify failed: ${e?.message || 'unknown error'})`);
        }
        console.log('[Perplexity] === END RAW RESPONSE ===');
      }

      const text = response.choices[0]?.message?.content;

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Perplexity');
      }

      // Log citations and sources if available
      const citations = response.citations || [];
      if (citations.length > 0) {
        console.log(`[Perplexity] ✅ Web search ACTIVE - Found ${citations.length} citations`);
        console.log(`[Perplexity] Sources: ${citations.slice(0, 3).map(c => c.url).join(', ')}`);
      } else {
        console.log(`[Perplexity] ⚠️ No citations found - response may not be grounded`);
      }

      console.log(`[Perplexity] Generation completed successfully (length: ${text.length} chars)`);
      return text.trim();

    } catch (err) {
      console.error(`[Perplexity] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code
      });

      if (!shouldRetry(err, attempt)) {
        console.error(`[Perplexity] Permanent failure after ${attempt} attempts`);
        throw new Error(`Error generating review after all retries: ${err?.message || 'Unknown error'}`);
      }

      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[Perplexity] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

module.exports = { generateReview };

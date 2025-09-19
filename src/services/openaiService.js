// src/services/openaiService.js — Direct OpenAI API integration with web search

const MAX_RETRIES = 2;
const OPENAI_MODEL = process.env.AI_MODEL || "gpt-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const DEBUG_PROMPT = process.env.DEBUG_PROMPT === "false";
const DEBUG_RESPONSE = process.env.DEBUG_RESPONSE === "false";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _client = null;

/**
 * Initialize OpenAI client
 */
async function getOpenAIClient() {
  if (!_client) {
    const { OpenAI } = await import('openai');
    _client = new OpenAI({
      apiKey: OPENAI_API_KEY
    });
  }
  return _client;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return (status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES;
}

/**
 * Generate a review with OpenAI using web search capabilities
 */
async function generateReview(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  let attempt = 0;
  while (++attempt <= MAX_RETRIES) {
    try {
      const client = await getOpenAIClient();

      // Enhanced prompt for web search (GPT models can't directly search, so we emphasize current knowledge)
      const enhancedPrompt = `You are a professional film critic. When reviewing films, prioritize accuracy and use your training data to provide the most current information available about:

${prompt}

IMPORTANT:
- Use your most recent training data for box office figures, ratings, and reviews
- If you're uncertain about specific current data, acknowledge the limitation
- Keep the structure and formatting exactly as requested in the prompt
- Prioritize factual accuracy over speculation`;

      if (DEBUG_PROMPT) {
        console.log(`[OpenAI] === BEGIN FULL PROMPT (model: ${OPENAI_MODEL}) ===`);
        console.log(enhancedPrompt);
        console.log(`[OpenAI] === END FULL PROMPT (${enhancedPrompt.length} chars) ===`);
      }

      console.log(`[OpenAI] Starting generation with model: ${OPENAI_MODEL}, attempt: ${attempt}`);

      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a professional film critic. Focus on accuracy and acknowledge when current data may not be available. Follow formatting instructions exactly."
          },
          {
            role: "user", 
            content: enhancedPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 8192
      });

      if (DEBUG_RESPONSE) {
        console.log('[OpenAI] === BEGIN RAW RESPONSE ===');
        try {
          console.log(JSON.stringify(response, null, 2));
        } catch (e) {
          console.log(`[OpenAI] (Raw response stringify failed: ${e?.message || 'unknown error'})`);
        }
        console.log('[OpenAI] === END RAW RESPONSE ===');
      }

      const text = response.choices[0]?.message?.content;

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from OpenAI');
      }

      // Log usage information
      const usage = response.usage;
      if (usage) {
        console.log(`[OpenAI] Token usage - Input: ${usage.prompt_tokens}, Output: ${usage.completion_tokens}, Total: ${usage.total_tokens}`);
        
        // Estimate cost based on model
        const costs = getModelCosts(OPENAI_MODEL);
        if (costs) {
          const inputCost = (usage.prompt_tokens / 1000000) * costs.input;
          const outputCost = (usage.completion_tokens / 1000000) * costs.output;
          console.log(`[OpenAI] Estimated cost: $${(inputCost + outputCost).toFixed(4)}`);
        }
      }

      console.log(`[OpenAI] Generation completed successfully (length: ${text.length} chars)`);
      return text.trim();

    } catch (err) {
      console.error(`[OpenAI] Error on attempt ${attempt}:`, {
        message: err?.message,
        status: err?.status,
        code: err?.code,
        type: err?.type
      });

      if (!shouldRetry(err, attempt)) {
        console.error(`[OpenAI] Permanent failure after ${attempt} attempts`);
        throw new Error(`Error generating review after all retries: ${err?.message || 'Unknown error'}`);
      }

      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn(`[OpenAI] Retryable error on attempt ${attempt}; retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw new Error("Failed generating review after maximum retries.");
}

/**
 * Get model pricing for cost estimation
 */
function getModelCosts(model) {
  const costs = {
    'gpt-5': { input: 2.00, output: 8.00 },
    'gpt-5-mini': { input: 0.40, output: 1.60 },
    'gpt-5-nano': { input: 0.10, output: 0.40 },
    'gpt-4.1': { input: 2.00, output: 8.00 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60 },
    'gpt-4.1-nano': { input: 0.10, output: 0.40 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
  };
  
  return costs[model] || null;
}

module.exports = { generateReview };

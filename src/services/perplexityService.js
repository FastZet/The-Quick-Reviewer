// src/services/perplexityService.js — Perplexity AI with web grounding

'use strict';

const MAX_RETRIES = 2;
const MODEL_FROM_ENV = process.env.AI_MODEL || 'sonar-pro';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || null;
const DEBUG_PROMPT = String(process.env.DEBUG_PROMPT || 'false').toLowerCase() === 'true';
const DEBUG_RESPONSE = String(process.env.DEBUG_RESPONSE || 'false').toLowerCase() === 'true';

let client = null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPerplexityClient() {
  if (!client) {
    const OpenAI = (await import('openai')).default;
    client = new OpenAI({ apiKey: PERPLEXITY_API_KEY, baseURL: 'https://api.perplexity.ai' });
  }
  return client;
}

function shouldRetry(err, attempt) {
  const status = err?.status ?? 0;
  return ((status === 429 || (status >= 500 && status < 600)) && attempt < MAX_RETRIES);
}

async function generateReview(prompt) {
  if (!PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY is not set.');
  const modelMap = {
    auto: 'sonar-pro',
    best: 'sonar-pro',
    fast: 'sonar',
    research: 'sonar-deep-research',
  };
  const actualModel = modelMap[MODEL_FROM_ENV] || MODEL_FROM_ENV;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const api = await getPerplexityClient();
      const enhancedPrompt = [
        'You are a professional film critic with access to current information.',
        'Use real-time web search to gather recent data for box office figures, critic scores, audience ratings, and social media buzz.',
        prompt,
        'IMPORTANT:',
        '- Search for current box office data, ratings, and reviews',
        '- Include concrete figures and recent information where available',
        '- Keep the structure and formatting exactly as requested in the prompt',
        '- Verify cast, director, and release details through web search',
      ].join('\n');

      if (DEBUG_PROMPT) {
        console.log('Perplexity BEGIN FULL PROMPT (model:', actualModel, ')');
        console.log(enhancedPrompt);
        console.log('Perplexity END FULL PROMPT', enhancedPrompt.length, 'chars');
      }

      const response = await api.chat.completions.create({
        model: actualModel,
        messages: [
          { role: 'system', content: 'You are a professional film critic. Use web search to find accurate, current information about movies and TV shows. Always verify facts and provide real data when available.' },
          { role: 'user', content: enhancedPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        // Perplexity-specific extensions
        search_recency_filter: 'month',
        return_related_questions: false,
        return_images: false,
      });

      if (DEBUG_RESPONSE) {
        console.log('Perplexity BEGIN RAW RESPONSE');
        try { console.log(JSON.stringify(response, null, 2)); } catch (e) { console.log('Perplexity stringify failed:', e?.message || 'unknown'); }
        console.log('Perplexity END RAW RESPONSE');
      }

      const text = response?.choices?.[0]?.message?.content;
      if (!text || !String(text).trim().length) throw new Error('Empty response from Perplexity');
      console.log('Perplexity Generation completed successfully, length', String(text).length, 'chars');
      return String(text).trim();
    } catch (err) {
      console.error('Perplexity Error on attempt', attempt, 'message', err?.message, 'status', err?.status, 'code', err?.code);
      if (!shouldRetry(err, attempt)) {
        console.error('Perplexity Permanent failure after', attempt, 'attempts');
        throw new Error(`Error generating review after all retries: ${err?.message || 'Unknown error'}`);
      }
      const backoff = 250 * Math.pow(2, attempt - 1);
      console.warn('Perplexity retrying in', backoff, 'ms...');
      await delay(backoff);
    }
  }
  throw new Error('Failed generating review after maximum retries.');
}

module.exports = generateReview;

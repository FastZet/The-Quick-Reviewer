// src/services/aiService.js — Multi-provider AI service router

'use strict';

/**
 * Multi-provider AI router.
 * - Selects provider strictly from env: AI_PROVIDER or AIPROVIDER (fallback).
 * - Selects model from env: AI_MODEL or AIMODEL (passed through to providers via their own env handling).
 * - Uses dynamic import so only the chosen provider module is loaded and executed.
 * - Optional router debug via DEBUG_AI_ROUTER=true.
 */

const PROVIDER_RAW =
  process.env.AI_PROVIDER ||
  process.env.AIPROVIDER ||
  'perplexity';

const MODEL_RAW =
  process.env.AI_MODEL ||
  process.env.AIMODEL ||
  'auto';

const PROVIDER = String(PROVIDER_RAW).trim().toLowerCase();
const MODEL = String(MODEL_RAW).trim();

const DEBUG_ROUTER =
  String(process.env.DEBUG_AI_ROUTER || 'false').toLowerCase() === 'true';

function rlog(...args) {
  if (DEBUG_ROUTER) console.log('[AI Router]', ...args);
}

async function loadProviderModule(name) {
  switch (name) {
    case 'perplexity': {
      // Only load Perplexity implementation when selected
      const mod = await import('./perplexityService.js');
      return mod.default || mod.generateReview;
    }
    case 'openai': {
      // Only load OpenAI implementation when selected
      const mod = await import('./openaiService.js');
      return mod.default || mod.generateReview;
    }
    case 'gemini': {
      // Only load Gemini implementation when selected
      const mod = await import('./geminiService.js');
      return mod.default || mod.generateReview;
    }
    default:
      throw new Error(
        `Unsupported AI provider: ${name}. Use one of: perplexity | openai | gemini`
      );
  }
}

/**
 * Router entry: delegates to selected provider.
 * @param {string} prompt - Fully constructed prompt text
 * @returns {Promise<string>} - Raw provider response text
 */
async function generateReview(prompt) {
  rlog(`Using provider="${PROVIDER}", model="${MODEL}"`);
  const impl = await loadProviderModule(PROVIDER);
  if (typeof impl !== 'function') {
    throw new Error(`Provider "${PROVIDER}" did not export a generate function`);
  }
  // Delegate without logging prompt here; provider modules control prompt/response logging via their own DEBUG flags
  return impl(prompt);
}

module.exports = generateReview;

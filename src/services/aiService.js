// src/services/aiService.js

'use strict';

const PROVIDER_RAW = process.env.AI_PROVIDER || 'perplexity';
const MODEL_RAW = process.env.AI_MODEL || 'auto';
const PROVIDER = String(PROVIDER_RAW).trim().toLowerCase();
const MODEL = String(MODEL_RAW).trim();
const DEBUG_ROUTER = String(process.env.DEBUG_AI_ROUTER || 'false').toLowerCase() === 'true';

function rlog(...args) {
  if (DEBUG_ROUTER) console.log('AI Router:', ...args);
}

// Extract a callable from various module shapes
function pickGenerateFn(mod) {
  if (typeof mod === 'function') return mod;
  if (typeof mod?.default === 'function') return mod.default;
  if (typeof mod?.default?.generateReview === 'function') return mod.default.generateReview;
  if (typeof mod?.generateReview === 'function') return mod.generateReview;
  return null;
}

async function loadProviderModule(name) {
  switch (name) {
    case 'perplexity': {
      const mod = await import('./perplexityService.js');
      return pickGenerateFn(mod);
    }
    case 'openai': {
      const mod = await import('./openaiService.js');
      return pickGenerateFn(mod);
    }
    case 'gemini': {
      const mod = await import('./geminiService.js');
      return pickGenerateFn(mod);
    }
    default:
      throw new Error('Unsupported AI provider name. Use one of: perplexity | openai | gemini');
  }
}

async function generateReview(prompt) {
  rlog('Using provider', PROVIDER, 'model', MODEL);
  const impl = await loadProviderModule(PROVIDER);
  if (typeof impl !== 'function') {
    throw new Error(`Provider ${PROVIDER} did not expose a callable generate function`);
  }
  return impl(prompt);
}

module.exports = generateReview;
module.exports.generateReview = generateReview;

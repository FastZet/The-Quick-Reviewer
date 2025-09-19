// src/services/aiService.js
// Multi-provider AI service router with robust interop for CJS/ESM providers.
// - Selects provider strictly from env AIPROVIDER (perplexity|openai|gemini), default: perplexity
// - Model name is passed-through via provider-specific envs; this file does not enforce a schema
// - Dynamic import ensures only the chosen provider is loaded
// - Exports BOTH default function and named { generateReview } for compatibility

'use strict';

const PROVIDER_RAW = process.env.AIPROVIDER || process.env.AI_PROVIDER || 'perplexity';
const MODEL_RAW = process.env.AIMODEL || process.env.AI_MODEL || 'auto';
const PROVIDER = String(PROVIDER_RAW).trim().toLowerCase();
const MODEL = String(MODEL_RAW).trim();

const DEBUG_ROUTER = String(process.env.DEBUG_AI_ROUTER || process.env.DEBUGAIROUTER || 'false').toLowerCase() === 'true';

function rlog(...args) {
  if (DEBUG_ROUTER) console.log('[AI Router]', ...args);
}

// Safely extract a callable generate() function from arbitrary module shapes
// Supports:
//   - module.exports = function
//   - module.exports = { generateReview }
//   - ESM default export function
//   - ESM/CJS default object with { generateReview }
function pickGenerateFn(mod) {
  // Direct function export
  if (typeof mod === 'function') return mod;

  // ESM default -> function
  if (typeof mod?.default === 'function') return mod.default;

  // ESM default -> object with generateReview
  if (typeof mod?.default?.generateReview === 'function') return mod.default.generateReview;

  // CJS named export on root
  if (typeof mod?.generateReview === 'function') return mod.generateReview;

  return null;
}

async function loadProviderModule(name) {
  switch (name) {
    case 'perplexity': {
      // Only load when selected
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
      throw new Error(`Unsupported AI provider "${name}". Use one of: perplexity | openai | gemini`);
  }
}

/**
 * Generate a review using the selected provider.
 * @param {string} prompt - Fully constructed prompt text.
 * @returns {Promise<string>} Raw provider response text.
 */
async function generateReview(prompt) {
  rlog(`Using provider=${PROVIDER}, model=${MODEL}`);
  const impl = await loadProviderModule(PROVIDER);
  if (typeof impl !== 'function') {
    throw new Error(`Provider "${PROVIDER}" did not expose a callable generate function`);
  }
  // Delegate to provider implementation (providers handle their own logging)
  return impl(prompt);
}

// Compatibility exports:
// - Default export: function (old usage: const generateReview = require('./services/aiService'))
// - Named export: { generateReview } (new usage: const { generateReview } = require('./services/aiService'))
module.exports = generateReview;
module.exports.generateReview = generateReview;

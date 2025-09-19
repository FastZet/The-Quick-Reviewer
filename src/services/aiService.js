// src/services/aiService.js — Multi-provider AI service router

const AI_PROVIDER = process.env.AI_PROVIDER || "perplexity";
const AI_MODEL = process.env.AI_MODEL || "auto";

/**
 * Route to appropriate AI service based on provider configuration
 */
async function generateReview(prompt) {
  console.log(`[AI Router] Using provider: ${AI_PROVIDER}, model: ${AI_MODEL}`);

  switch (AI_PROVIDER.toLowerCase()) {
    case "perplexity":
      const { generateReview: perplexityReview } = await import('./perplexityService.js');
      return await perplexityReview(prompt);
    
    case "openai":
      const { generateReview: openaiReview } = await import('./openaiService.js');
      return await openaiReview(prompt);
    
    case "gemini":
      const { generateReview: geminiReview } = await import('./geminiService.js');
      return await geminiReview(prompt);
    
    default:
      throw new Error(`Unsupported AI provider: ${AI_PROVIDER}`);
  }
}

module.exports = { generateReview };

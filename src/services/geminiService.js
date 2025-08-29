// src/services/geminiService.js — Handles all interactions with the Google Gemini AI.

const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const MAX_RETRIES = 2;

let model;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY, { apiVersion: 'v1' });
  const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ];
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL, safetySettings: safetySettings });
}

/**
 * Generates a review by sending a prompt to the Gemini AI model.
 * @param {string} prompt - The fully constructed prompt for the AI.
 * @returns {Promise<string>} The generated review text.
 */
async function generateReview(prompt) {
  if (!model) return 'Gemini API key missing — cannot generate review.';
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Gemini] Starting review generation, attempt ${attempt}/${MAX_RETRIES}...`);
      const chat = model.startChat({ tools: [{ googleSearch: {} }] });
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const reviewText = response.text();
      if (reviewText) {
        console.log(`[Gemini] Successfully generated review on attempt ${attempt}.`);
        return reviewText.trim();
      }
    } catch (err) {
      if (err.status === 500 && attempt < MAX_RETRIES) {
        console.warn(`[Gemini] Attempt ${attempt} failed with 500 error. Retrying in 1 second...`);
        await new Promise(res => setTimeout(res, 1000));
      } else {
        console.error(`[Gemini] Review generation failed permanently on attempt ${attempt}:`, err);
        return 'Error generating review.';
      }
    }
  }
  return 'Error generating review after all retries.';
}

module.exports = { generateReview };

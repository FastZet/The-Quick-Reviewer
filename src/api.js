// src/api.js
// The main orchestrator for review generation with parallel summary production.

const { readReview, saveReview } = require("./core/storage");
const scrapeImdbForEpisodeTitle = require("./core/scraper");
const enforceReviewStructure = require("./core/formatEnforcer");
const { fetchMovieSeriesMetadata, fetchEpisodeMetadata } = require("./services/metadataService");
const buildPromptFromMetadata = require("./config/promptBuilder");
const { buildSummaryPromptFromMetadata } = require("./config/summaryPromptBuilder");
const generateReview = require("./services/geminiService");
const { parseVerdictFromReview } = require("./core/reviewParser");
const verifyReviewFormat = require("./core/reviewVerifier");

const pendingReviews = new Map();
const MAX_GENERATION_ATTEMPTS = 2;

// Utility: Normalize and enforce exactly 8 distinctive lines, <= 25 chars each, no prefixes/suffixes.
function normalizeEightBullets(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Split by line, remove numbering/bullets, trim, drop empties
  let lines = raw
    .split(/\r?\n+/)
    .map(l => l.replace(/^\s*(?:[-*•]\s*|\d+\.\s*)?/, "").trim())
    .filter(Boolean);

  // De-duplicate while preserving order
  const seen = new Set();
  lines = lines.filter(l => {
    const key = l.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Enforce max 25 chars including spaces; no extra decoration
  lines = lines.map(l => (l.length <= 25 ? l : l.slice(0, 25).trim()));

  // Ensure exactly 8 lines:
  // - If more than 8, take the most informative first 8
  // - If fewer than 8, fail gracefully by returning null (caller can skip summary stream)
  if (lines.length >= 8) return lines.slice(0, 8);
  return null;
}

async function getReview(id, type, forceRefresh = false) {
  console.log("API New Request Start");
  console.log("API Received request for type:", type, "id:", id, "forceRefresh:", forceRefresh);

  // Serve cached if available and not forced
  if (!forceRefresh) {
    const cached = await readReview(id).catch(() => null);
    if (cached) {
      console.log("Cache hit for", id, ". Returning cached review+summary.");
      // Backfill safety: ensure legacy cache without summary returns with summary8 null
      if (!Object.prototype.hasOwnProperty.call(cached, "summary8")) {
        cached.summary8 = null;
      }
      return cached;
    }
  }

  // Deduplicate concurrent generation
  if (pendingReviews.has(id)) {
    console.log("API Generation for", id, "is already in progress. Awaiting result...");
    return await pendingReviews.get(id);
  }

  console.log("Cache miss for", id, ". Proceeding to generate new review and summary.");
  const generationPromise = (async () => {
    try {
      let metadata = null;
      let prompt = null;
      let summaryPrompt = null;
      let rawReview = null;
      let rawSummary = null;
      let isValid = false;

      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        console.log(`API Generation attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} for ${id}...`);

        // Episode handling
        const idParts = String(id).split(":");
        const isEpisode = type === "series" && idParts.length === 3;
        const isSeries = type === "series" && !isEpisode;

        if (isEpisode) {
          const [seriesImdbId, seasonRaw, episodeRaw] = idParts;
          const season = seasonRaw?.replace(/^S/i, "");
          const episode = episodeRaw?.replace(/^E/i, "");
          console.log("API Handling episode", seriesImdbId, `S${season}E${episode}`);

          // In parallel: IMDb scrape for episode title + episode metadata + parent series metadata
          const [scrapedEpisodeTitle, episodeMetadata, seriesMetadata] = await Promise.all([
            scrapeImdbForEpisodeTitle(seriesImdbId, season, episode).catch(() => null),
            fetchEpisodeMetadata(seriesImdbId, season, episode).catch(() => null),
            fetchMovieSeriesMetadata("series", seriesImdbId).catch(() => null),
          ]);

          metadata = episodeMetadata || null;
          if (metadata && seriesMetadata) {
            const seriesInfo = {
              title:
                seriesMetadata?.data?.title ||
                seriesMetadata?.data?.name ||
                seriesMetadata?.data?.Title ||
                null,
              languages: seriesMetadata?.languages || [],
              source: seriesMetadata?.source || null,
            };
            prompt = buildPromptFromMetadata(metadata, type, seriesInfo, scrapedEpisodeTitle);
            summaryPrompt = buildSummaryPromptFromMetadata(
              metadata,
              type,
              seriesInfo,
              scrapedEpisodeTitle
            );
          } else if (metadata) {
            // Fallback if parent series metadata failed
            prompt = buildPromptFromMetadata(metadata, type, null, scrapedEpisodeTitle);
            summaryPrompt = buildSummaryPromptFromMetadata(
              metadata,
              type,
              null,
              scrapedEpisodeTitle
            );
          }
        } else {
          // Movie or whole-series flow
          metadata = await fetchMovieSeriesMetadata(type, id).catch(() => null);
          if (metadata) {
            prompt = buildPromptFromMetadata(metadata, type);
            summaryPrompt = buildSummaryPromptFromMetadata(metadata, type);
          }
        }

        if (!metadata || !prompt || !summaryPrompt) {
          console.error("API Missing metadata or prompt(s) for", id);
          continue;
        }

        // Run both generations in parallel
        const [reviewOut, summaryOut] = await Promise.all([
          generateReview(prompt).catch(err => {
            console.warn("API review generation failed on attempt", attempt, err?.message);
            return null;
          }),
          generateReview(summaryPrompt).catch(err => {
            console.warn("API summary generation failed on attempt", attempt, err?.message);
            return null;
          }),
        ]);

        rawReview = reviewOut;
        rawSummary = summaryOut;

        // Validate review format (summary is format-free with its own enforcement)
        isValid = !!rawReview && verifyReviewFormat(rawReview, type);
        if (isValid) {
          console.log("API Review for", id, "passed verification on attempt", attempt, ".");
          break;
        } else {
          console.warn(
            "API Review for",
            id,
            "failed verification on attempt",
            attempt,
            ". Retrying..."
          );
        }
      }

      if (!isValid) {
        console.error(
          "API Review for",
          id,
          "failed verification after all",
          MAX_GENERATION_ATTEMPTS,
          "attempts."
        );
        throw new Error("AI failed to generate a review with the correct format.");
      }

      // Build HTML, parse verdict
      const finalReviewHtml = enforceReviewStructure(rawReview);
      const verdict = parseVerdictFromReview(rawReview);

      // Enforce exactly 8 lines for summary; if it fails, keep null so the caller may skip the stream
      const summary8 = normalizeEightBullets(rawSummary);

      const result = {
        review: finalReviewHtml,
        verdict: verdict || null,
        summary8: summary8 || null,
      };

      // Persist
      await saveReview(id, result, type).catch(() => null);
      console.log("API Request End Success");
      return result;
    } catch (error) {
      console.error("API An error occurred during review+summary generation for", id, error);
      return { review: "Error: Review generation failed.", verdict: null, summary8: null };
    } finally {
      pendingReviews.delete(id);
    }
  })();

  pendingReviews.set(id, generationPromise);
  return await generationPromise;
}

module.exports = getReview;

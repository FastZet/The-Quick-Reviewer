// src/core/stremioStreamer.js
// Builds Stremio stream objects. Now returns two streams:
// 1) Summary stream: title is exactly 8 lines (the 8 bullets), nothing else.
// 2) Review stream: multi-line title with the one-line verdict (existing behavior).

const manifest = require("../../manifest.json");
const getReview = require("../api.js");
const buildStreamTitle = require("./streamTitleBuilder.js");

const BASE_URL = process.env.BASE_URL || process.env.HF_SPACE_URL || process.env.BASEURL || process.env.HFSPACE_URL || null;
const ADDON_PASSWORD = process.env.ADDON_PASSWORD || process.env.ADDONPASSWORD || null;
const ADDON_TIMEOUT_MS = parseInt(process.env.ADDON_TIMEOUT_MS || process.env.ADDONTIMEOUTMS || "13000", 10);

// Builds the absolute base (scheme + host) from request if BASE_URL isn't set.
function resolveBaseUrl(req) {
  if (BASE_URL) return BASE_URL.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

// Build review page URL (used as externalUrl)
function buildReviewUrl(base, type, id) {
  const pathPrefix = ADDON_PASSWORD ? `/${ADDON_PASSWORD}` : "";
  return `${base}${pathPrefix}/review?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

// Ensure summary is exactly 8 lines (already normalized upstream); join without prefixes or suffixes.
function joinSummaryLines(summary8) {
  if (!Array.isArray(summary8) || summary8.length !== 8) return null;
  // Lines are already <= 25 chars and distinct; do not add bullets or extra lines.
  return summary8.join("\n");
}

async function buildStreamResponse(req) {
  const { type, id } = req.params;
  const base = resolveBaseUrl(req);
  const reviewUrl = buildReviewUrl(base, String(type).trim(), String(id).trim());

  // Base stream fields
  const baseStream = {
    name: "The Quick Reviewer",
    poster: manifest.icon || undefined,
    behaviorHints: { notWebReady: true },
  };

  try {
    // Pre-gen race for responsiveness
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ADDON_TIMEOUT_MS)
    );

    const reviewData = await Promise.race([
      getReview(String(id).trim(), String(type).trim(), false),
      timeoutPromise,
    ]);

    // Streams to return
    const streams = [];

    // 1) Summary stream: only if summary8 exists and has exactly 8 lines
    const summaryTitle = joinSummaryLines(reviewData?.summary8 || null);
    if (summaryTitle) {
      streams.push({
        id: `quick-reviewer-summary-${type}-${id}`,
        title: summaryTitle, // exactly 8 lines, no header/footer
        externalUrl: reviewUrl, // optional: clicking still opens full review page
        ...baseStream,
      });
    }

    // 2) Review stream (existing behavior)
    const verdict = reviewData?.verdict || null;
    streams.push({
      id: `quick-reviewer-${type}-${id}`,
      title: buildStreamTitle(verdict),
      externalUrl: reviewUrl,
      ...baseStream,
    });

    return { streams };
  } catch (error) {
    // On timeout or unexpected error: return only the fallback review stream
    const timedOut = error && error.message === "Timeout";

    return {
      streams: [
        {
          id: `quick-reviewer-${type}-${id}`,
          title: buildStreamTitle(null, { timedOut }),
          externalUrl: reviewUrl,
          ...baseStream,
        },
      ],
    };
  }
}

module.exports = buildStreamResponse;

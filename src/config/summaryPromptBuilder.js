// src/config/summaryPromptBuilder.js
// Builds a strict 8-bullet, spoiler-free summary prompt with max 25 chars per bullet.
// Mirrors metadata normalization logic of the main prompt builder to keep signatures consistent.

function buildSummaryPromptFromMetadata(metadata, type, seriesInfo = null, scrapedEpisodeTitle = null) {
  const isEpisode = type === 'series' && !!(metadata?.data?.episode_number);
  const isSeries = type === 'series' && !isEpisode;

  // Normalize common fields from TMDB/OMDb payloads
  const title =
    metadata?.data?.title ||
    metadata?.data?.name ||
    metadata?.data?.Title ||
    'Unknown Title';

  const year =
    (metadata?.data?.release_date ||
      metadata?.data?.first_air_date ||
      metadata?.data?.Released ||
      '')
      .toString()
      .split('-')[0] || '';

  const overview =
    metadata?.data?.overview ||
    metadata?.data?.Plot ||
    '';

  const seriesName = seriesInfo?.title ? seriesInfo.title : (isSeries ? title : null);
  const episodeTitle = isEpisode
    ? (scrapedEpisodeTitle ||
       metadata?.data?.name ||
       metadata?.data?.Title ||
       `Episode ${metadata?.data?.episode_number || ''}`.trim())
    : null;

  // Reviewer persona and task
  const seed = `
You are a professional, neutral, spoiler‑averse film/TV critic writing the most decision‑useful ultra‑concise summary possible.
Your output MUST help a viewer quickly decide whether to watch, focusing on signal over fluff.
`;

  // Hard formatting constraints
  const constraints = `
Output EXACTLY 8 lines. Each line is ONE bullet point ONLY.
HARD LIMIT: each line MUST be <= 25 characters INCLUDING spaces.
Do NOT number bullets. Do NOT add emojis. Do NOT add quotes. Do NOT add headings. Do NOT add extra commentary.
Each bullet MUST be DISTINCT from the others. NO overlap or rephrasing of the same idea.
Be spoiler‑free. Use simple, high‑information phrasing (e.g., "Gritty crime tone", "Strong lead acting", "Thin script", "Great sound mix").
Prioritize factors that influence a watch/no‑watch decision: tone, pacing, originality, performances, writing quality, visuals, music/sound, genre fit, audience/critic signal, runtime feel, content intensity.
If a factor is unknown, omit it rather than guess—still keep exactly 8 distinct bullets.
`;

  // Context building
  let task;
  if (isEpisode) {
    const sNum = metadata?.data?.season_number;
    const eNum = metadata?.data?.episode_number;
    const seriesLabel = seriesName ? ` of the series "${seriesName}"` : '';
    task = `
Make a spoiler‑free 8‑bullet mini‑summary for the episode "${episodeTitle}" (Season ${sNum}, Episode ${eNum})${seriesLabel}.
Title: ${title}
Year: ${year}
`;
  } else if (isSeries) {
    task = `
Make a spoiler‑free 8‑bullet mini‑summary for the series "${title}" (${year}).
`;
  } else {
    task = `
Make a spoiler‑free 8‑bullet mini‑summary for the movie "${title}" (${year}).
`;
  }

  const context = overview
    ? `Official overview (for context only, do not copy): ${overview}`
    : '';

  // Final instruction: 8 clean lines, nothing else
  const outputFormat = `
Return ONLY the 8 lines—each line is a bullet text by itself. No prefixes like "-" or "•". No extra lines before/after.
`;

  // Combine
  const prompt = `
${seed}

${constraints}

${task}

${context}

${outputFormat}
`.trim();

  return prompt;
}

module.exports = { buildSummaryPromptFromMetadata };

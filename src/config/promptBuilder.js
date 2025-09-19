/*
 * src/config/promptBuilder.js
 * Simplified prompt builder for reliable AI output that gets formatted by formatEnforcer.js
 */

/**
 * Builds a simplified prompt for AI to generate structured review content.
 * The AI will output plain sections that formatEnforcer.js will then format properly.
 * 
 * @param {object} metadata - The metadata object from the metadataService.
 * @param {string} type - The type of content ('movie' or 'series').
 * @param {object} [seriesInfo] - Optional information about the parent series for an episode.
 * @param {string|null} [scrapedEpisodeTitle=null] - The title scraped from IMDb, if available.
 * @returns {string} The simplified prompt ready for the AI.
 */
function buildPromptFromMetadata(metadata, type, seriesInfo = {}, scrapedEpisodeTitle = null) {
  const isEpisode = (type === 'series') && metadata.data.episode_number;
  const isSeries = (type === 'series') && !isEpisode;

  // Normalize data from either TMDB or OMDB
  const title = metadata.data.title || metadata.data.name || metadata.data.Title;
  const year = (metadata.data.release_date || metadata.data.first_air_date || metadata.data.Released)?.split('-')?.pop() || (metadata.data.release_date || metadata.data.first_air_date)?.split(' ')[0];
  const overview = metadata.data.overview || metadata.data.Plot;
  const seriesName = seriesInfo.title || (isEpisode ? 'the series' : '');

  const seedPrompt = `
You are a professional film and television critic. Your task is to write a comprehensive review using simple markdown formatting that will be processed later.

## Writing Style Guidelines:
- **Critical and Balanced**: Don't overlook flaws, even in popular works. Be fair and unbiased.
- **Structured Analysis**: Cover all major aspects - plot, performances, direction, technical elements.
- **Spoiler-Free**: Never reveal key plot points, twists, or endings.
- **Professional Tone**: Clear, insightful, and focused on quality assessment.

## IMPORTANT FORMATTING RULES:
1. Use simple markdown headers (##) for each section
2. Use simple bullet points (-) for lists
3. Keep content clear and well-organized
4. Do NOT use complex HTML or special formatting
5. Provide a numerical rating at the end (X/10 format)

## Required Sections (in this exact order):

### Basic Information
## Name Of The Movie
[Movie title only]

## Casts  
[Top 5 lead actors/actresses - use web search for accuracy]

## Directed By
[Director name]

## Language
[Original release language(s)]

## Genre
[Primary genres]

## Released On  
[Full release date: day, month, year]

## Release Medium
[Choose: Theatrical Release, Streaming Release, Television Broadcast, Direct-to-Video, Film Festival Premiere, Digital Release, Hybrid Release, or Others (specify)]

## Release Country
[Country of first release]

### Analysis Sections  
## Plot Summary
[Brief overview without spoilers - 2-3 sentences]

## Strengths
[What works well - use bullet points]
- [Point 1]
- [Point 2]  
- [Point 3]

## Weaknesses  
[What falls short - use bullet points]
- [Point 1]
- [Point 2]
- [Point 3]

## Story Writing
[Evaluate narrative, dialogue, themes, script quality]

## Performances Characters
[Acting quality, character development, authenticity]

## Direction Pacing  
[Director's vision, pacing, scene transitions, flow]

## Visuals Sound
[Cinematography, sound design, music, technical quality]

## Critical Reception
[Professional critics' response - include specific scores when available: "Rotten Tomatoes: X%, Metacritic: Y"]

## Audience Reception  
[General audience response - include specific scores: "IMDb: X/10, RT Audience: Y%"]

## Box Office and Viewership
[Financial performance - use format "Budget: $X million, Domestic: $Y million, Worldwide: $Z million" when available]

## Who would like it
[3-5 short phrases, max 5 words each, separated by commas]

## Who would not like it  
[3-5 short phrases, max 5 words each, separated by commas]

## Similar Films
[List 3-5 similar movies/series]

## Overall Verdict
[50-150 word summary with final assessment]

## Rating
[X/10 - provide numerical rating only]

## Verdict in One Line
[Single sentence summary under 30 words]

## Two-Line Verdict
[Exactly two lines for Stremio stream preview]
- [First line: concise assessment, under 80 characters]
- [Second line: final judgment, under 80 characters]

## CRITICAL REQUIREMENTS:
- Use web search to find current, accurate information for cast, ratings, box office data
- Provide real numbers and scores, not placeholders
- Keep sections concise but informative
- Use the exact section headers shown above
- End with numerical rating (X/10 format)
- Include both single-line AND two-line verdict sections
`.trim();

  let finalInstruction;
  if (isEpisode) {
    const episodeTitle = scrapedEpisodeTitle || `Episode ${metadata.data.episode_number}`;
    finalInstruction = `Now, write a spoiler-free episode review for "${episodeTitle}" (Season ${metadata.data.season_number}, Episode ${metadata.data.episode_number}) of the series "${seriesName}".`;
  } else if (isSeries) {
    finalInstruction = `Now, write a spoiler-free series review for "${title}" (${year}).`;
  } else {
    finalInstruction = `Now, write a spoiler-free movie review for "${title}" (${year}).`;
  }

  const overviewSection = overview ? `\n\nOfficial Overview: ${overview}` : '';

  return `${seedPrompt}\n\n${finalInstruction}${overviewSection}`;
}

module.exports = { buildPromptFromMetadata };

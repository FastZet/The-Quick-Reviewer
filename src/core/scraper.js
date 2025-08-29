// scraper.js — Handles all web scraping logic for the addon.

const axios = require('axios');
const cheerio = require('cheerio');

// Scrapes IMDb's episode page for a specific episode title.
async function scrapeImdbForEpisodeTitle(imdbId, season, episode) {
  const url = `https://www.imdb.com/title/${imdbId}/episodes/?season=${season}`;
  // A standard User-Agent to mimic a real browser.
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
  console.log(`[Scraper] Starting IMDb scrape for ${imdbId}, S${season}E${episode}...`);
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en-US,en;q=0.5' },
      timeout: 8000, // 8-second timeout for the request.
    });
    const $ = cheerio.load(response.data);
    let foundTitle = null;

    // Iterate through each episode item on the page.
    $('article.episode-item-wrapper').each((i, el) => {
        const titleElement = $(el).find('.ipc-title__text');
        const titleText = titleElement.text().trim();
        
        // Match the "S1.E1" pattern at the start of the title.
        const match = titleText.match(/^S(\d+)\.E(\d+)/);
        if (match) {
            const scrapedSeason = parseInt(match[1], 10);
            const scrapedEpisode = parseInt(match[2], 10);

            // If season and episode numbers match our target, extract the title.
            if (scrapedSeason === parseInt(season, 10) && scrapedEpisode === parseInt(episode, 10)) {
                const parts = titleText.split('∙'); // The title is after the '∙' character.
                if (parts.length > 1) {
                    foundTitle = parts[1].trim();
                    return false; // This stops the .each() loop since we found our match.
                }
            }
        }
    });
    
    if (foundTitle) {
      console.log(`[Scraper] Success! Found episode title: "${foundTitle}"`);
    } else {
      console.warn(`[Scraper] Scrape completed, but no title match found for S${season}E${episode}.`);
    }
    return foundTitle;
  } catch (error) {
    console.error(`[Scraper] Failed to fetch or parse IMDb page for ${imdbId}: ${error.message}`);
    return null; // Return null on failure so the process can continue gracefully.
  }
};

// Export the function to make it available to other files.
module.exports = {
  scrapeImdbForEpisodeTitle,
};

// src/core/formatEnforcerV2.js — Builds structured HTML for the v2 review pages.

function clean(text) {
    return text ? text.trim().replace(/^[*_]+|[*_]+$/g, '').trim() : '';
}

function parseRawReview(rawReviewText) {
    const sections = [ 
        'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 
        'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country', 
        'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 
        'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 
        'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 
        'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 
        'Who would not like it', 'Similar Films', 'Overall Verdict', 'Rating', 'Verdict in One Line' 
    ];
    const contentMap = new Map();

    for (const header of sections) {
        // Enhanced regex pattern to better capture content after bullet points and headers
        const regex = new RegExp(`[•*\\s]*\\*\\*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|\\n\\s*Rating:|\\n\\s*Verdict in One Line:|$)`, 'i');
        const match = rawReviewText.match(regex);
        if (match && match[1]) {
            contentMap.set(header.replace('Directed by', 'Directed By'), clean(match[1]));
        }
    }

    // Special handling for Rating extraction with improved pattern
    const ratingMatch = rawReviewText.match(/Rating:\s*(\d+(?:\.\d+)?\/10)/i);
    if (ratingMatch) {
        contentMap.set('Rating', ratingMatch[1]);
    }

    // Special handling for Verdict in One Line
    const verdictMatch = rawReviewText.match(/Verdict in One Line[:\s]*([^\n]+)/i);
    if (verdictMatch) {
        contentMap.set('Verdict in One Line', clean(verdictMatch[1]));
    }

    return contentMap;
}

function extractRatingScore(ratingText) {
    if (!ratingText) return 'N/A';
    const match = ratingText.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    return match ? match[1] : 'N/A';
}

function getRatingLabel(score) {
    const numScore = parseFloat(score);
    if (isNaN(numScore)) return 'Not Rated';
    if (numScore >= 9) return 'Exceptional';
    if (numScore >= 7) return 'Excellent';
    if (numScore >= 5) return 'Good';
    if (numScore >= 3) return 'Fair';
    return 'Poor';
}

function formatMetaItems(data) {
    const items = [];
    
    // Director
    if (data.has('Directed By')) {
        items.push(`<div class="meta-item"><span>🎬</span><span>${data.get('Directed By')}</span></div>`);
    }
    
    // Year from Released On
    const releasedOn = data.get('Released On');
    if (releasedOn) {
        const year = releasedOn.split(',').pop().trim() || releasedOn.split(' ').pop();
        items.push(`<div class="meta-item"><span>📅</span><span>${year}</span></div>`);
    }
    
    // Genre
    if (data.has('Genre')) {
        items.push(`<div class="meta-item"><span>🎭</span><span>${data.get('Genre')}</span></div>`);
    }
    
    // Cast (first 3 names only for meta)
    if (data.has('Casts')) {
        const cast = data.get('Casts').split(',').slice(0, 3).map(name => name.trim()).join(', ');
        items.push(`<div class="meta-item"><span>👥</span><span>${cast}</span></div>`);
    }
    
    // Language
    if (data.has('Language')) {
        items.push(`<div class="meta-item"><span>🗣️</span><span>${data.get('Language')}</span></div>`);
    }
    
    // Release Country
    if (data.has('Release Country')) {
        items.push(`<div class="meta-item"><span>🌍</span><span>${data.get('Release Country')}</span></div>`);
    }
    
    // Release Medium
    if (data.has('Release Medium')) {
        items.push(`<div class="meta-item"><span>📺</span><span>${data.get('Release Medium')}</span></div>`);
    }
    
    return items.join('');
}

function buildSidebarStats(data) {
    const stats = [];
    
    // Box Office
    const boxOffice = data.get('Box Office and Viewership');
    if (boxOffice) {
        const boxOfficeMatch = boxOffice.match(/\$[\d.,]+[MBK]?/i);
        if (boxOfficeMatch) {
            stats.push(`<div class="stat-item"><span class="stat-label">Box Office</span><span class="stat-value">${boxOfficeMatch[0]}</span></div>`);
        }
    }
    
    // Critical Reception
    const criticalReception = data.get('Critical Reception');
    if (criticalReception) {
        const criticsMatch = criticalReception.match(/(\d+)%/);
        if (criticsMatch) {
            stats.push(`<div class="stat-item"><span class="stat-label">Critics Score</span><span class="stat-value">${criticsMatch[0]}</span></div>`);
        }
    }
    
    // Audience Reception
    const audienceReception = data.get('Audience Reception & Reaction');
    if (audienceReception) {
        const audienceMatch = audienceReception.match(/(\d+)%/);
        if (audienceMatch) {
            stats.push(`<div class="stat-item"><span class="stat-label">Audience Score</span><span class="stat-value">${audienceMatch[0]}</span></div>`);
        }
    }
    
    return stats.join('');
}

function buildRecommendationTags(text, isPositive = true) {
    if (!text) return '';
    
    // Split by common separators and filter out empty items
    const tags = text.split(/[,.]/).filter(tag => tag.trim().length > 0);
    const className = isPositive ? 'positive' : 'negative';
    
    return tags.map(tag => 
        `<span class="recommendation-tag ${className}">${tag.trim()}</span>`
    ).join('');
}

function buildReviewContent(rawReviewText) {
    const data = parseRawReview(rawReviewText);
    const title = data.get('Name Of The Movie') || data.get('Name Of The Series') || 'Review';
    const episodeName = data.get('Name Of The Episode');
    const seasonEpisode = data.get('Season & Episode');
    
    // Build full title for series episodes
    let fullTitle = title;
    if (episodeName && seasonEpisode) {
        fullTitle = `${title}: ${episodeName}`;
    }
    
    const ratingText = data.get('Rating') || '';
    const ratingScore = extractRatingScore(ratingText);
    const ratingLabel = getRatingLabel(ratingScore);
    
    // HERO CONTENT with enhanced metadata
    const heroHtml = `
        <h1>${fullTitle}</h1>
        ${seasonEpisode ? `<div class="episode-info">${seasonEpisode}</div>` : ''}
        <div class="movie-meta">
            ${formatMetaItems(data)}
        </div>
        <div class="rating-badge">
            <div class="rating-score">${ratingScore}</div>
            <div class="rating-details">
                <div class="verdict-text">${data.get('Verdict in One Line') || 'See full review below'}</div>
                <div class="rating-label">${ratingLabel}</div>
            </div>
        </div>
        <div class="hero-actions">
            <a href="{{TOGGLE_URL}}" class="control-btn">{{TOGGLE_TEXT}}</a>
            <button id="force-refresh" class="control-btn secondary">🔄 Force New Review</button>
        </div>
    `;

    // SIDEBAR CONTENT with enhanced stats
    const statsHtml = buildSidebarStats(data);
    const positiveTagsHtml = buildRecommendationTags(data.get('Who would like it'), true);
    const negativeTagsHtml = buildRecommendationTags(data.get('Who would not like it'), false);
    const similarFilms = data.get('Similar Films');
    
    const sidebarHtml = `
        ${statsHtml ? `
        <div class="sidebar-card">
            <h4>🎯 Quick Stats</h4>
            ${statsHtml}
        </div>` : ''}
        
        ${positiveTagsHtml ? `
        <div class="sidebar-card">
            <h4>👍 Who Will Love It</h4>
            <div class="recommendation-tags">
                ${positiveTagsHtml}
            </div>
        </div>` : ''}
        
        ${negativeTagsHtml ? `
        <div class="sidebar-card">
            <h4>👎 Who Might Not</h4>
            <div class="recommendation-tags">
                ${negativeTagsHtml}
            </div>
        </div>` : ''}
        
        ${similarFilms ? `
        <div class="sidebar-card">
            <h4>🎬 Similar Films</h4>
            <div class="similar-films-list">${similarFilms.replace(/•/g, '•<br>')}</div>
        </div>` : ''}
    `;

    // MAIN REVIEW CARDS (for full review page) with icons
    const mainContentSections = [
        { key: 'Plot Summary', icon: '📖' },
        { key: 'Storytelling', icon: '✍️' },
        { key: 'Writing', icon: '📝' },
        { key: 'Pacing', icon: '⚡' },
        { key: 'Performances', icon: '🎭' },
        { key: 'Character Development', icon: '📈' },
        { key: 'Cinematography', icon: '📸' },
        { key: 'Sound Design', icon: '🔊' },
        { key: 'Music & Score', icon: '🎵' },
        { key: 'Editing', icon: '✂️' },
        { key: 'Direction and Vision', icon: '🎬' },
        { key: 'Originality and Creativity', icon: '💫' },
        { key: 'Strengths', icon: '💪' },
        { key: 'Weaknesses', icon: '⚠️' },
        { key: 'Critical Reception', icon: '📰' },
        { key: 'Audience Reception & Reaction', icon: '👥' },
        { key: 'Box Office and Viewership', icon: '💰' },
        { key: 'Overall Verdict', icon: '🏆' }
    ];

    const mainCardsHtml = mainContentSections
        .filter(section => data.has(section.key))
        .map(section => `
            <div class="review-card">
                <h3>
                    <span class="icon">${section.icon}</span>
                    ${section.key}
                </h3>
                <p class="review-text">${data.get(section.key)}</p>
            </div>
        `).join('');

    return {
        posterContent: `🎬<br><small>${title}</small>`,
        heroContent: heroHtml,
        sidebarContent: sidebarHtml,
        plotSummary: data.get('Plot Summary') || 'Plot summary not available.',
        overallVerdict: data.get('Overall Verdict') || 'Overall verdict not available.',
        mainReviewCards: mainCardsHtml
    };
}

module.exports = { buildReviewContent };

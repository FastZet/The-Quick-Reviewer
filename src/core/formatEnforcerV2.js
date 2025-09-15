// src/core/formatEnforcerV2.js — Builds structured HTML for the v2 review pages.

function clean(text) {
    return text ? text.trim().replace(/^[*_]+|[*_]+$/g, '').trim() : '';
}

function parseRawReview(rawReviewText) {
    const sections = [ 'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Genre', 'Released On', 'Release Medium', 'Release Country', 'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Similar Films', 'Overall Verdict', 'Rating', 'Verdict in One Line' ];
    const contentMap = new Map();

    for (const header of sections) {
        const regex = new RegExp(`[•*\\s]*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|Rating:|Verdict in One Line:|$)`, 'i');
        const match = rawReviewText.match(regex);
        if (match && match[1]) {
            contentMap.set(header.replace('Directed by', 'Directed By'), clean(match[1]));
        }
    }
    return contentMap;
}

function buildReviewContent(rawReviewText) {
    const data = parseRawReview(rawReviewText);
    const title = data.get('Name Of The Movie') || data.get('Name Of The Series');
    const year = (data.get('Released On') || '').split(',').pop().trim();

    // HERO CONTENT
    const heroHtml = `
        <h1>${title || 'Review'}</h1>
        <div class="movie-meta">
            ${year ? `<div class="meta-item"><span>📅</span><span>${year}</span></div>` : ''}
            ${data.has('Genre') ? `<div class="meta-item"><span>🎭</span><span>${data.get('Genre')}</span></div>` : ''}
            ${data.has('Directed By') ? `<div class="meta-item"><span>🎬</span><span>${data.get('Directed By')}</span></div>` : ''}
        </div>
        <div class="rating-badge">
            <div class="rating-score">${(data.get('Rating') || 'N/A').split('/')[0]}</div>
            <div>
                <div class="verdict-text">${data.get('Verdict in One Line') || 'See verdict below.'}</div>
            </div>
        </div>
        <br><a href="{{TOGGLE_URL}}" class="control-btn">View {{TOGGLE_MODE}} Review</a>
    `;

    // SIDEBAR CONTENT
    const sidebarHtml = `
        <div class="sidebar-card">
            <h4>🎯 Quick Stats</h4>
            ${data.has('Box Office and Viewership') ? `<div class="stat-item"><span class="stat-label">Box Office</span><span class="stat-value">${data.get('Box Office and Viewership').split(' ')[0]}</span></div>` : ''}
            ${data.has('Critical Reception') ? `<div class="stat-item"><span class="stat-label">Critics Score</span><span class="stat-value">${data.get('Critical Reception').match(/\d+%/)?.[0] || 'N/A'}</span></div>` : ''}
            ${data.has('Audience Reception & Reaction') ? `<div class="stat-item"><span class="stat-label">Audience Score</span><span class="stat-value">${data.get('Audience Reception & Reaction').match(/\d+%/)?.[0] || 'N/A'}</span></div>` : ''}
        </div>
        <div class="sidebar-card">
            <h4>👍 Who Will Love It</h4>
            <div class="recommendation-tags">
                ${(data.get('Who would like it') || '').split(/[.,]/).filter(t => t.trim()).map(tag => `<span class="recommendation-tag positive">${tag.trim()}</span>`).join('')}
            </div>
        </div>
        <div class="sidebar-card">
            <h4>👎 Who Might Not</h4>
            <div class="recommendation-tags">
                ${(data.get('Who would not like it') || '').split(/[.,]/).filter(t => t.trim()).map(tag => `<span class="recommendation-tag negative">${tag.trim()}</span>`).join('')}
            </div>
        </div>
        ${data.has('Similar Films') ? `
        <div class="sidebar-card">
            <h4>🎬 Similar Films</h4>
            <div class="similar-films-list">${data.get('Similar Films').replace(/•/g, '<br>•')}</div>
        </div>` : ''}
    `;

    // MAIN REVIEW CARDS (for full review page)
    const mainContentHeaders = [ 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses' ];
    const mainCardsHtml = mainContentHeaders.map(header => {
        if (!data.has(header)) return '';
        return `<div class="review-card"><h3>${header}</h3><p class="review-text">${data.get(header)}</p></div>`;
    }).join('');

    return {
        posterContent: `🎬<br>${title || ''}`,
        heroContent: heroHtml,
        sidebarContent: sidebarHtml,
        plotSummary: data.get('Plot Summary') || 'Not available.',
        overallVerdict: data.get('Overall Verdict') || 'Not available.',
        mainReviewCards: mainCardsHtml
    };
}

module.exports = { buildReviewContent };

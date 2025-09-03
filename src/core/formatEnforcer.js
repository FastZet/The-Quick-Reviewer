// src/core/formatEnforcer.js — Cleans and builds a structured HTML review.

function cleanSectionContent(text) {
  if (!text) return '';
  return text.trim().replace(/^[*_]+|[*_]+$/g, '').trim();
}

function getRatingScaleText() {
  return "9–10: Exceptional, masterpiece • 7–8: Strong, worth watching • 5–6: Average, but forgettable • 3–4: Weak, with major flaws • 1–2: Poor, barely redeemable • 0: Unwatchable, a failure";
}

function enforceReviewStructure(rawReviewText) {
  if (!rawReviewText || typeof rawReviewText !== 'string') return '';

  const ALL_SECTIONS = [ 'Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Directed by', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country', 'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Overall Verdict', 'Rating', 'Verdict in One Line' ];
  const contentMap = new Map();

  for (const header of ALL_SECTIONS) {
    const regex = new RegExp(`[•*\\s]*${header}[*\\s]*:[*\\s]*([\\s\\S]*?)(?=\\s*•\\s*\\*\\*|Rating:|Verdict in One Line:|$)`, 'i');
    const match = rawReviewText.match(regex);
    if (match && match[1]) {
      const canonicalHeader = header === 'Directed by' ? 'Directed By' : header;
      contentMap.set(canonicalHeader, cleanSectionContent(match[1]));
    }
  }

  const formatText = (text = '') => text ? text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') : '';

  let introHtml = '<div class="review-intro">';
  const introHeaders = ['Name Of The Movie', 'Name Of The Series', 'Name Of The Episode', 'Season & Episode', 'Casts', 'Directed By', 'Language', 'Genre', 'Released On', 'Release Medium', 'Release Country'];
  introHeaders.forEach(header => {
    if (contentMap.has(header)) introHtml += `<div>• <strong>${header}:</strong> ${formatText(contentMap.get(header))}</div>`;
  });
  introHtml += '</div>';

  let accordionHtml = '<div class="accordion">';
  const mainContentHeaders = [ 'Plot Summary', 'Storytelling', 'Writing', 'Pacing', 'Performances', 'Character Development', 'Cinematography', 'Sound Design', 'Music & Score', 'Editing', 'Direction and Vision', 'Originality and Creativity', 'Strengths', 'Weaknesses', 'Critical Reception', 'Audience Reception & Reaction', 'Box Office and Viewership', 'Who would like it', 'Who would not like it', 'Overall Verdict', 'Rating', 'Verdict in One Line' ];
  
  mainContentHeaders.forEach(header => {
    if (contentMap.has(header)) {
      let accordionHeader = header;
      let accordionContent = formatText(contentMap.get(header));

      if (header === 'Rating') {
        accordionHeader = `Rating: ${contentMap.get(header).replace(/<[^>]*>/g, '')}`;
        accordionContent = getRatingScaleText();
      }

      accordionHtml += `<div class="accordion-item"><button class="accordion-header">${accordionHeader}</button><div class="accordion-content"><div class="accordion-content-inner">${accordionContent}</div></div></div>`;
    }
  });
  accordionHtml += '</div>';

  console.log('[FormatEnforcer] Review HTML structure has been successfully generated.');
  return introHtml + accordionHtml;
}

module.exports = { enforceReviewStructure };

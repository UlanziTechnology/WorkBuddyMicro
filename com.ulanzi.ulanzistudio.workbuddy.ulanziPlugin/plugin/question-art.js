"use strict";
const {sessionCard} = require("./session-card");
/** Show up to three single-line choices with an arrow on the selected row. */
function questionSvg(question, choiceId) {
  const fontSize = 17;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]);
  const ellipsize = (value, availableWidth) => {
    const chars = Array.from(String(value).replace(/\s+/g, " ").trim());
    // Reserve width for the arrow and keep the ellipsis on the same line.
    const width = char => /[^\x00-\x7f]|[MWmw@#%&]/.test(char) ? fontSize :
      /[ilI.,'!:;| ]/.test(char) ? 5 : /[A-Z]/.test(char) ? 13 : 11;
    if (chars.reduce((sum, char) => sum + width(char), 0) <= availableWidth) return chars.join("");
    let text = "", used = 0;
    for (const char of chars) {
      if (used + width(char) + 15 > availableWidth) break;
      text += char;
      used += width(char);
    }
    return text.trimEnd() + "...";
  };
  const selected = Math.max(0, question.choices.findIndex(c => c.id === choiceId));
  const start = Math.max(0, Math.min(selected - 2, question.choices.length - 3));
  const rows = question.choices.slice(start, start + 3).map((choice, i) => {
    const y = 3 + i * 40, active = choice.id === choiceId;
    const prefix = question.multiSelect && choice.kind === "option" ? (choice.selected ? "✓ " : "□ ") : "";
    const label = ellipsize(prefix + choice.label, 103);
    const highlight = active ? `<rect x="3" y="${y}" width="120" height="38" rx="9" fill="#292929"/>
      <path d="M112 ${y+19}h8m-4-4 4 4-4 4" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    return `<g opacity="${choice.disabled ? 0.45 : 1}">${highlight}<text x="8" y="${y+25}" font-size="${fontSize}" stroke="white" stroke-width=".25" paint-order="stroke">${escape(label)}</text></g>`;
  }).join("");
  return sessionCard(`<rect width="126" height="126" rx="15" fill="#010101"/><g fill="white" font-family="sans-serif" font-weight="700">${rows}</g>`);
}
module.exports = {questionSvg};

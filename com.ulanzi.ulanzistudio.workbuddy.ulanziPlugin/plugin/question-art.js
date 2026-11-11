"use strict";
const workbuddyMark = require("node:fs")
  .readFileSync(require("node:path").join(__dirname, "../assets/session/selected-workbuddy.svg"), "utf8")
  .replace(/<svg[^>]*>|<\/svg>/g, "").trim();

/** Match the approval dial's rounded panel, three rows and WorkBuddy cursor. */
function questionSvg(question, choiceId) {
  const escape = text => String(text).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]);
  const ellipsize = (value, availableWidth) => {
    const chars = Array.from(String(value).replace(/\s+/g, " ").trim());
    // Conservative widths for the 16px bold font; keep room for all three dots.
    const width = char => /[^\x00-\x7f]|[MWmw@#%&]/.test(char) ? 16 :
      /[ilI.,'!:;| ]/.test(char) ? 5 : /[A-Z]/.test(char) ? 13 : 10.5;
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
    const x = active ? 32 : 8;
    const prefix = question.multiSelect && choice.kind === "option" ? (choice.selected ? "✓ " : "□ ") : "";
    const label = ellipsize(prefix + choice.label, 118 - x);
    const cursor = active ? `<rect x="2" y="${y}" width="122" height="38" rx="8" fill="#073e34"/><g transform="translate(4 ${y + 6}) scale(0.13265)">${workbuddyMark}</g>` : "";
    return `<g opacity="${choice.disabled ? 0.45 : 1}">${cursor}<text x="${x}" y="${y + 26}" font-size="16">${escape(label)}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="252" height="252" viewBox="0 0 126 126"><rect width="126" height="126" rx="15" fill="#ff655f"/><g fill="white" font-family="sans-serif" font-weight="600">${rows}</g></svg>`;
}
module.exports = {questionSvg};

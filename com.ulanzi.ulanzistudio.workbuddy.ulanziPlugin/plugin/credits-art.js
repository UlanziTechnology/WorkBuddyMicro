"use strict";

/** All labels are drawn into the key image so host titles cannot cover the balance. */
async function drawCreditsCard(balance, language, iconData) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 196;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.roundRect(0, 0, 196, 196, 24);
  ctx.fill();
  const bytes = Uint8Array.from(atob(iconData.slice(iconData.indexOf(",") + 1)), c => c.charCodeAt(0));
  const icon = await createImageBitmap(new Blob([bytes], {type:"image/png"}));
  try {
    ctx.drawImage(icon, 56, 27, 84, 84);
  } finally { icon.close(); }
  const text = balance === null ? "—" : new Intl.NumberFormat(String(language || "en").replace("_", "-"), {maximumFractionDigits:2}).format(balance);
  ctx.fillStyle = balance === null ? "#858585" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 43;
  ctx.font = "600 " + size + "px sans-serif";
  while (ctx.measureText(text).width > 176 && size > 12) {
    ctx.font = "600 " + (--size) + "px sans-serif";
  }
  ctx.fillText(text, 98, 142, 176);
  return canvas.toDataURL("image/png");
}
/** Use the original glyph and amount positions, with the slot inline on the dial. */
function encoderCreditsSvg(prefix, amount, language) {
  const available = Number.isFinite(amount);
  const value = available
    ? new Intl.NumberFormat(language.replace("_", "-"), {maximumFractionDigits:2}).format(amount) : "—";
  const widthAtOnePixel = (prefix ? 1 : 0) + Array.from(value).reduce((width, char) =>
    width + (/\d/.test(char) ? .64 : char === "—" ? 1 : .34), 0);
  const size = Math.min(43, Math.floor(176 / widthAtOnePixel));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196">
    <rect width="196" height="196" rx="24" fill="#000"/>
    <image x="56" y="27" width="84" height="84" xlink:href="${creditGlyphData}" opacity="${available ? 1 : .5}"/>
    <text x="98" y="${142 + size*.34}" font-family="sans-serif" font-weight="600"
      text-anchor="middle" font-size="${size}" fill="${available ? "#fff" : "#858585"}">${prefix}${value}</text>
  </svg>`;
}
const creditGlyphData = "data:image/png;base64," + require("node:fs")
  .readFileSync(require("node:path").join(__dirname, "../assets/composer/credits-glyph.png")).toString("base64");
module.exports = {drawCreditsCard, creditGlyphData, encoderCreditsSvg};

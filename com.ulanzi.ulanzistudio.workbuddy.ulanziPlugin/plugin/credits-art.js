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
  const text = balance === null ? "—" : new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {maximumFractionDigits:2}).format(balance);
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
const creditGlyphData = "data:image/png;base64," + require("node:fs")
  .readFileSync(require("node:path").join(__dirname, "../assets/composer/credits-glyph.png")).toString("base64");
module.exports = {drawCreditsCard, creditGlyphData};

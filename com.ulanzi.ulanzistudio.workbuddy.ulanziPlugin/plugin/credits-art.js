"use strict";

/** All labels are drawn into the key image so host titles cannot cover the balance. */
function drawCreditsCard(balance, language, encoder = false, iconOnly = false) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 196;
  const ctx = canvas.getContext("2d");
  const background = ctx.createLinearGradient(0, 0, 196, 196);
  background.addColorStop(0, "#0ec8a7");
  background.addColorStop(0.5, "#36cc92");
  background.addColorStop(1, "#51d07b");
  ctx.fillStyle = balance === null && !iconOnly ? "#939393" : background;
  if (encoder) {
    ctx.beginPath();
    ctx.roundRect(0, 0, 196, 196, 24);
    ctx.fill();
  } else ctx.fillRect(0, 0, 196, 196);
  // The same white outline and spacing as the existing action glyphs.
  ctx.save();
  ctx.translate(iconOnly ? 30 : 74, iconOnly ? 42 : 19);
  const scale = iconOnly ? 1 : 0.36;
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 9;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(68, 19, 59, 19, 0, 0, Math.PI * 2);
  ctx.moveTo(9, 19);
  ctx.lineTo(9, 83);
  ctx.ellipse(68, 83, 59, 19, 0, Math.PI, 0, true);
  ctx.lineTo(127, 19);
  ctx.moveTo(9, 40);
  ctx.ellipse(68, 40, 59, 19, 0, Math.PI, 0, true);
  ctx.moveTo(9, 62);
  ctx.ellipse(68, 62, 59, 19, 0, Math.PI, 0, true);
  ctx.stroke();
  ctx.restore();
  if (iconOnly) return canvas.toDataURL("image/png");
  const text = balance === null ? "—" : new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", {maximumFractionDigits:2}).format(balance);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 43;
  ctx.font = "600 " + size + "px sans-serif";
  while (ctx.measureText(text).width > 176 && size > 12) {
    ctx.font = "600 " + (--size) + "px sans-serif";
  }
  ctx.fillText(text, 98, 110, 176);
  ctx.font = "500 22px sans-serif";
  ctx.fillText(language === "zh" ? "积分余额" : "Credits", 98, 161);
  return canvas.toDataURL("image/png");
}
module.exports = {drawCreditsCard};

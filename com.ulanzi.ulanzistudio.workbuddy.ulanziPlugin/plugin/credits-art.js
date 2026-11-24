"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {MODEL_CARD} = require("./model-art");
const [, , dialWidth, dialHeight] = require("../layouts/credits-encoder.json").items[0].rect;
const scopes = ["all", "1", "2", "3", "4", "5"];
const icons = scopes.map(scope => `assets/balance/${scope}.png`);
const readIcon = file => "data:image/png;base64," +
  fs.readFileSync(path.join(__dirname, "..", file)).toString("base64");
const iconData = icons.map(readIcon);
const dialIconData = scopes.map(scope => readIcon(`assets/balance/dial/${scope}.png`));

function creditsIcon(slot) {
  return icons[slot] || icons[0];
}

function amountLabel(amount, language, maxWidth, maxSize) {
  const available = Number.isFinite(amount);
  const value = available
    ? new Intl.NumberFormat(language.replace("_", "-"), {maximumFractionDigits:2}).format(amount) : "—";
  const widthAtOnePixel = Array.from(value).reduce((width, char) =>
    width + (/\d/.test(char) ? .64 : char === "—" ? 1 : .34), 0);
  const size = Math.min(maxSize, Math.floor(maxWidth / widthAtOnePixel));
  return {value, size, color: available ? "#fff" : "#858585"};
}

/** The keypad artwork already contains the scope marker. Only overlay the amount. */
function creditsSvg(slot, amount, language) {
  const {value, size, color} = amountLabel(amount, language, 176, 43);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196">
    <defs><clipPath id="card"><rect width="196" height="196" rx="24"/></clipPath></defs>
    <image width="196" height="196" xlink:href="${iconData[slot] || iconData[0]}" clip-path="url(#card)"/>
    <text x="98" y="${154 + size * .34}" font-family="sans-serif" font-weight="600"
      text-anchor="middle" font-size="${size}" fill="${color}">${value}</text>
  </svg>`;
}

function creditsDialSvg(slot, amount, language) {
  // Match the model dial's icon area and title center on the full 126 × 140 canvas.
  const {iconRegion, titleRegion} = MODEL_CARD;
  const {value, size, color} = amountLabel(amount, language, dialWidth - 10, 24);
  const label = amount === undefined ? "" : `<text x="${dialWidth / 2}" y="${titleRegion.centerY + size * .34}"
      font-family="sans-serif" font-weight="600" text-anchor="middle" font-size="${size}" fill="${color}">${value}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${dialWidth}" height="${dialHeight}">
    <image x="${iconRegion.x}" y="${iconRegion.y}" width="${iconRegion.width}" height="${iconRegion.height}"
      xlink:href="${dialIconData[slot] || dialIconData[0]}"/>
    ${label}
  </svg>`;
}

module.exports = {creditsIcon, creditsSvg, creditsDialSvg};

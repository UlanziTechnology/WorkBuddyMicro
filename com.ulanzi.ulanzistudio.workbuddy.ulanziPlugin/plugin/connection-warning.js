"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {Resvg} = require("../libs/vendor/resvg");
const {svgFonts} = require("./svg-fonts");
const {MODEL_CARD} = require("./model-art");

const assets = path.join(__dirname, "../assets");
const symbol = fs.readFileSync(path.join(__dirname, "../assets/actions/connection-warning.png")).toString("base64");
const escape = text => text.replace(/[&<>]/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;"})[char]);

function textWidth(text) {
  return Array.from(text).reduce((width, char) =>
    width + (/[^\x00-\x7f]/.test(char) ? 1 : /[iIl. ]/.test(char) ? .3 : /[MWmw]/.test(char) ? .92 : .63), 0);
}

function pngData(svg, font) {
  const renderer = new Resvg(svg, {font});
  let image;
  try {
    image = renderer.render();
    return "data:image/png;base64," + Buffer.from(image.asPng()).toString("base64");
  } finally {
    image?.free();
    renderer.free();
  }
}

async function imageData(icon, font) {
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(icon)) return icon;
  if (/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(icon)) {
    const svg = Buffer.from(icon.split(",")[1], "base64");
    return pngData(svg, font);
  }
  if (/^assets\/[\w/.-]+\.png$/.test(icon) && !icon.split("/").includes("..")) {
    const png = await fs.promises.readFile(path.join(assets, icon.slice("assets/".length))).catch(() => null);
    if (png) return "data:image/png;base64," + png.toString("base64");
  }
  return "";
}

async function connectionWarningPicture(label, {dial, fullDialIcon, icon, defaultIcon}) {
  const font = await svgFonts();
  const original = await imageData(icon, font) || await imageData(defaultIcon, font);
  const width = dial ? MODEL_CARD.width : 196;
  const height = dial ? MODEL_CARD.height : 196;
  const maxWidth = dial ? width - 10 : 172;
  const words = label.split(/\s+/);
  let lines = [label];
  const minimumOneLineSize = dial ? 16 : 17;
  if (textWidth(label) * minimumOneLineSize > maxWidth && words.length > 1) {
    let best = Infinity;
    for (let split = 1; split < words.length; split++) {
      const first = words.slice(0, split).join(" ");
      const second = words.slice(split).join(" ");
      const width = Math.max(textWidth(first), textWidth(second));
      if (width < best) {
        best = width;
        lines = [first, second];
      }
    }
  }

  // Only dials reserve a separate caption area. Keypads paint over the full icon.
  const iconHeight = dial ? MODEL_CARD.iconRegion.height : height;
  const backgroundX = dial ? MODEL_CARD.iconRegion.x : 0;
  const backgroundWidth = dial ? MODEL_CARD.iconRegion.width : width;
  const iconSize = dial && !fullDialIcon ? iconHeight : width;
  const imageHeight = dial && !fullDialIcon ? iconHeight : height;
  const warningSize = dial ? 55 : 86;
  const maxSize = dial ? (lines.length === 1 ? MODEL_CARD.titleRegion.fontSize : 16) : 22;
  const size = Math.min(maxSize, Math.floor(maxWidth / Math.max(1, ...lines.map(textWidth))));
  const {centerY, lineHeight} = MODEL_CARD.titleRegion;
  const keyBaseline = height - (lines.length === 1 ? 14 : 40);
  const caption = lines.map((line, index) => {
    const baseline = dial
      ? centerY + (index - (lines.length - 1) / 2) * lineHeight + size * .34
      : keyBaseline + index * (size + 5);
    return `<text x="${width / 2}" y="${baseline}">${escape(line)}</text>`;
  }).join("");
  const radius = dial ? 15 : 23;
  const captionStyle = dial
    ? ` transform="translate(0 ${centerY}) scale(1 .86) translate(0 -${centerY})"`
    : ' stroke="#000" stroke-width="2.5" paint-order="stroke"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><clipPath id="icon"><rect x="${backgroundX}" width="${backgroundWidth}" height="${iconHeight}" rx="${radius}"/></clipPath></defs>
    <rect x="${backgroundX}" width="${backgroundWidth}" height="${iconHeight}" rx="${radius}" fill="#000"/>
    <g${dial ? ' clip-path="url(#icon)"' : ""}>
      ${original ? `<image x="${(width - iconSize) / 2}" width="${iconSize}" height="${imageHeight}" opacity="${dial ? ".76" : "1"}" xlink:href="${original}"/>` : ""}
      <image x="${(width - warningSize) / 2}" y="${(iconHeight - warningSize) / 2}" width="${warningSize}" height="${warningSize}" xlink:href="data:image/png;base64,${symbol}"/>
    </g>
    <g fill="#fff" font-family="sans-serif" font-weight="700" font-size="${size}" text-anchor="middle"${captionStyle}>${caption}</g>
  </svg>`;
  return pngData(svg, font);
}

module.exports = {connectionWarningPicture};

"use strict";

const [, , width, height] = require("../layouts/model-encoder.json").items[0].rect;

// D200X $UA1 uses a 126 × 140 canvas, a 100 × 100 icon slot and a title at y=105.
const MODEL_CARD = {
  width, height,
  iconRegion:{x:13, y:0, width:100, height:100, tileSize:70},
  titleRegion:{width, centerY:125, fontSize:20, lineHeight:13.5}
};

function modelSvg(label, measure, connected = true, picture) {
  const {width, height, iconRegion, titleRegion} = MODEL_CARD;
  const escape = text => text.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
  const measureText = measure || ((text, size) => ({
    width: Array.from(text).reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 1 : /[MWmw]/.test(c) ? .9 :
      /[ilI. ]/.test(c) ? .32 : .59), 0) * size,
    actualBoundingBoxAscent: size * (/[^\x00-\x7f]/.test(text) ? 0.93 : 0.78),
    actualBoundingBoxDescent: size * (/[^\x00-\x7f]|[gjpqy]/.test(text) ? 0.23 : 0.04)
  }));
  const textWidthAt = (text, size) => measureText(text, size).width;
  const name = String(label).replace(/\s+/g, " ").trim();
  const textWidth = titleRegion.width - 10;
  const textX = titleRegion.width / 2;
  const {centerY, lineHeight} = titleRegion;
  let size = titleRegion.fontSize;
  let lines = [name];
  while (size > 13 && textWidthAt(name, size) > textWidth) size--;

  if (textWidthAt(name, size) > textWidth) {
    const segmenter = new Intl.Segmenter(undefined, {granularity:"grapheme"});
    const chars = Array.from(segmenter.segment(name), part => part.segment);
    const words = new Intl.Segmenter(undefined, {granularity:"word"});
    const boundaries = new Set(Array.from(words.segment(name), part => part.index));
    let fallback;
    // Fit two lines around the title center within the existing feedback image.
    for (size = 16; size >= 10; size--) {
      let bestScore = Infinity;
      let bestLines;
      let offset = 0;
      for (let split = 1; split < chars.length; split++) {
        offset += chars[split - 1].length;
        const left = chars.slice(0, split).join("").trimEnd();
        const right = chars.slice(split).join("").trimStart();
        const a = textWidthAt(left, size);
        if (a > textWidth) break;
        const b = textWidthAt(right, size);
        const score = Math.abs(a - b) + (boundaries.has(offset) ? 0 : textWidth);
        if (b <= textWidth && score < bestScore) {
          bestScore = score;
          bestLines = [left, right];
        }
      }
      if (bestScore < textWidth) {
        lines = bestLines;
        break;
      }
      if (bestLines && !fallback) fallback = {lines:bestLines, size};
    }
    if (lines.length === 1 && fallback) ({lines, size} = fallback);
    if (lines.length === 1) {
      size = 14;
      let split = 0;
      while (split < chars.length && textWidthAt(chars.slice(0, split + 1).join(""), size) <= textWidth) split++;
      const tail = chars.slice(split);
      while (tail.length && textWidthAt(tail.join("").trimEnd() + "…", size) > textWidth) tail.pop();
      lines = [chars.slice(0, split).join("").trimEnd(), tail.join("").trim() + "…"];
    }
  }

  const singleLine = lines.length === 1;
  if (singleLine) {
    const {actualBoundingBoxAscent:ascent, actualBoundingBoxDescent:descent} = measureText(lines[0], size);
    const halfHeight = Math.min(height - centerY, centerY - iconRegion.y - iconRegion.height) - 2;
    const inkHeight = ascent + descent;
    // Single-line glyphs can use the full title area without changing their proportions.
    if (inkHeight > 2 * halfHeight) size = Math.max(1, Math.floor(size * 2 * halfHeight / inkHeight));
  }

  const text = lines.map((line, i) => {
    const {actualBoundingBoxAscent:ascent, actualBoundingBoxDescent:descent} = measureText(line, size);
    const maxInkHeight = lineHeight - 0.8;
    const inkHeight = ascent + descent;
    const scaleY = !singleLine && inkHeight > maxInkHeight ? maxInkHeight / inkHeight : 1;
    const rowCenter = centerY + (i - (lines.length - 1) / 2) * lineHeight;
    const baseline = (ascent - descent) / 2;
    return `<g transform="translate(0 ${rowCenter}) scale(1 ${scaleY})"><text x="${textX}" y="${baseline}" font-size="${size}">${escape(line)}</text></g>`;
  }).join("");
  const cx = iconRegion.x + iconRegion.width / 2;
  const cy = iconRegion.y + iconRegion.height / 2;
  const {tileSize} = iconRegion;
  const tile = `x="${cx - tileSize / 2}" y="${cy - tileSize / 2}" width="${tileSize}" height="${tileSize}" rx="8"`;
  const left = iconRegion.x / 2;
  const right = width - left;
  const cachedIcon = !connected && typeof picture === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(picture)
    ? `<defs><clipPath id="model-icon"><rect ${tile}/></clipPath></defs><image xlink:href="${picture}" width="${width}" height="${height}" clip-path="url(#model-icon)"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width * 2}" height="${height * 2}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${iconRegion.y + iconRegion.height}" rx="15" fill="${connected ? "#010101" : "#7a7a7a"}"/>
    <path d="M${left + 2.5} ${cy - 6}l-5 6 5 6M${right - 2.5} ${cy - 6}l5 6-5 6" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect ${tile} fill="#f6fffc"/>
    <g font-family="sans-serif" font-weight="600" text-anchor="middle" fill="#ffffff">
      <text x="${cx}" y="${cy + 13}" font-size="38" fill="#083e34">${escape(Array.from(name)[0] || "M")}</text>
      ${text}
    </g>
    ${cachedIcon}
  </svg>`;
}

async function drawModelCard(label, icon) {
  const canvas = document.createElement("canvas");
  const {width, height, iconRegion} = MODEL_CARD;
  const cx = iconRegion.x + iconRegion.width / 2;
  const cy = iconRegion.y + iconRegion.height / 2;
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  const svg = modelSvg(label, (text, size) => {
    ctx.font = "600 " + size + "px sans-serif";
    return ctx.measureText(text);
  });
  const base = new Image();
  base.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await base.decode();
  ctx.drawImage(base, 0, 0, width, height);
  if (icon) {
    try {
      let source;
      if (icon.localName === "svg") {
        const copy = icon.cloneNode(true);
        copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        if (!copy.hasAttribute("viewBox")) copy.setAttribute("viewBox", "0 0 16 16");
        copy.setAttribute("color", "#193b34");
        source = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
      } else {
        const url = new URL(icon.currentSrc || icon.src);
        const assets = new URL("assets/", location.href).href;
        const local = url.href.startsWith(assets);
        const official = url.origin === "https://download.codebuddy.cn" && url.pathname.startsWith("/codebuddy/ide/model-icons/");
        if (!local && !official) throw Error("Missing client asset");
        const response = await fetch(url, {cache:"force-cache", credentials:"omit", signal:AbortSignal.timeout(1000)});
        if (!response.ok) throw Error("Missing icon");
        source = URL.createObjectURL(await response.blob());
      }
      const image = new Image();
      image.src = source;
      try { await image.decode(); } finally { if (source.startsWith("blob:")) URL.revokeObjectURL(source); }
      ctx.fillStyle = "#f6fffc";
      const logoSize = iconRegion.tileSize - 16;
      ctx.fillRect(cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      const scale = logoSize / Math.max(image.naturalWidth, image.naturalHeight, 1);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
    } catch { /* A missing client icon still gets an identifiable model card. */ }
  }
  return canvas.toDataURL("image/png");
}
module.exports = { MODEL_CARD, drawModelCard, modelSvg };

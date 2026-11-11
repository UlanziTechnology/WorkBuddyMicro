"use strict";

// The renderer and offline fallback share the same square artwork. Choose line
// breaks by measured width, preferring word boundaries for model/version names.
function modelSvg(label, measure) {
  const escape = text => text.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
  const width = measure || ((text, size) => Array.from(text).reduce((n,c) => n + (/[^\x00-\x7f]/.test(c) ? 1 : 0.65), 0) * size);
  const name = String(label).trim();
  let lines, size;
  for (size = 20; size >= 9; size--) {
    lines = [];
    let rest = name;
    while (rest && lines.length < 3) {
      const chars = Array.from(rest);
      let end = 0, boundary = 0;
      while (end < chars.length && width(chars.slice(0,end+1).join(""), size) <= 114) {
        if (/[-\s]/.test(chars[end])) boundary = end + 1;
        end++;
      }
      if (end < chars.length && boundary) end = boundary;
      end = Math.max(end,1);
      lines.push(chars.slice(0,end).join("").trim());
      rest = chars.slice(end).join("").trimStart();
    }
    if (!rest && lines.length * (size + 1) <= 50) break;
    if (size === 9) { if (rest) lines[2] = lines[2].slice(0,-1) + "…"; break; }
  }
  if (lines.length === 2) {
    let best = Infinity;
    for (let i = 1; i < name.length; i++) {
      if (!/[\s-]/.test(name[i])) continue;
      const left = name.slice(0,i).trim(), right = name.slice(i).replace(/^[-\s]+/, "");
      const a = width(left,size), b = width(right,size);
      if (left && right && Math.max(a,b) <= 114 && Math.abs(a-b) < best) {
        best = Math.abs(a-b);
        lines = [left,right];
      }
    }
  }
  const text = lines.map((line,i) => {
    const y = 99 + (i - (lines.length - 1)/2) * (size+1) + size*0.34;
    return `<text x="63" y="${y}" font-size="${size}">${escape(line)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="252" height="252" viewBox="0 0 126 126"><rect width="126" height="126" rx="15" fill="#19cea5"/><path d="m13 36-6 7 6 7m100-14 6 7-6 7" fill="none" stroke="#0b4439" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="31" y="6" width="64" height="64" rx="15" fill="#f6fffc"/><g font-family="sans-serif" font-weight="600" text-anchor="middle" fill="#083e34"><text x="63" y="51" font-size="37">${escape(Array.from(name)[0] || "M")}</text>${text}</g></svg>`;
}

async function drawModelCard(label, icon) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 252;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  const svg = modelSvg(label, (text, size) => {
    ctx.font = "600 " + size + "px sans-serif";
    return ctx.measureText(text).width;
  });
  const base = new Image();
  base.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await base.decode();
  ctx.drawImage(base, 0, 0, 126, 126);
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
      ctx.fillRect(40, 17, 46, 42);
      const scale = 56 / Math.max(image.naturalWidth, image.naturalHeight, 1);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, 63 - w/2, 38 - h/2, w, h);
    } catch { /* A missing client icon still gets an identifiable model card. */ }
  }
  return canvas.toDataURL("image/png");
}
module.exports = { drawModelCard, modelSvg };

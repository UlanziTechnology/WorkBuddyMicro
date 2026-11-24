"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {parentPort}=require("node:worker_threads");
const {Resvg}=require("../libs/vendor/resvg");
const {svgFonts}=require("./svg-fonts");
const {sessionCard}=require("./session-card");
const {GifReader,GifWriter} = require("../libs/vendor/omggif");
const assets = path.join(__dirname, "../assets/task-cards");
const SIZE = 192;
const PNG_SIZE = 196;
const CORNER_RADIUS = 23;
const TITLE_BOTTOM = 90;
const TITLE_SIZE=28;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]);
function width(text,size){
  return Array.from(text).reduce((n,c)=>n+(/[^\x00-\x7f]/.test(c)?size:/[MWmw@#%&]/.test(c)?size*.9:/[ilI.,'!:;| ]/.test(c)?size*.3:size*.6),0);
}
function titleLines(title) {
  const text = String(title).replace(/\s+/g, " ").trim();
  const segmenter = new Intl.Segmenter(undefined, {granularity:"grapheme"});
  const chars = Array.from(segmenter.segment(text), item => item.segment);
  const lines = [];
  let start = 0;
  for (let row = 0; row < 2 && start < chars.length; row++) {
    let end = start;
    let lastSpace = -1;
    while (end < chars.length && width(chars.slice(start,end+1).join(""), TITLE_SIZE) <= 172) {
      if (chars[end] === " ") lastSpace = end;
      end++;
    }
    if (row === 0 && end < chars.length && lastSpace > start && chars[end] !== " ") end = lastSpace;
    end = Math.max(end, start+1);
    while (chars[end] === " ") end++;
    const truncated = row === 1 && end < chars.length;
    if (truncated) {
      while (end > start && width(chars.slice(start,end).join("").trimEnd()+"…", TITLE_SIZE) > 172) end--;
    }
    lines.push(chars.slice(start,end).join("").trimEnd() + (truncated ? "…" : ""));
    start = end;
  }
  return lines;
}
function titleSvg(title) {
  const lines = titleLines(title);
  return `<clipPath id="title"><rect width="${SIZE}" height="${TITLE_BOTTOM}"/></clipPath>
    <g clip-path="url(#title)" font-size="${TITLE_SIZE}" stroke="white" stroke-width=".5" paint-order="stroke">
      ${lines.map((line,i) => `<text x="${SIZE/2}" y="${37+i*34}">${escape(line)}</text>`).join("")}
    </g>`;
}

function svg(size, background, overlay, dial = false) {
  const content = `<clipPath id="card"><rect width="${SIZE}" height="${SIZE}" rx="${CORNER_RADIUS}"/></clipPath>
    <g clip-path="url(#card)">${background}<g fill="white" font-family="sans-serif" font-weight="700" text-anchor="middle">${overlay}</g></g>`;
  return dial ? sessionCard(content, SIZE) :
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SIZE} ${SIZE}">${content}</svg>`;
}

async function staticArtwork(card) {
  const title = titleSvg(card.title);
  if (card.state === "empty") {
    return svg(PNG_SIZE, `<rect width="${SIZE}" height="${SIZE}" fill="black"/>`, title, card.dial);
  }
  const frame = card.frame ?? (card.state === "running" ? 0 : undefined);
  const extension = frame !== undefined || card.state === "idle" ? "png" : "jpg";
  const filename = frame !== undefined ? `running-${frame}.png` : `${card.state}.${extension}`;
  const image = await fs.readFile(path.join(assets, filename));
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";
  const source = `data:${mimeType};base64,${image.toString("base64")}`;
  const background = `<image href="${source}" width="${SIZE}" height="${SIZE}"/>`;
  return svg(PNG_SIZE, background, title, card.dial);
}

let loadingTemplate;
async function loadAnimation() {
  const bytes = await fs.readFile(path.join(assets, "running.gif"));
  const reader = new GifReader(bytes);
  const first = reader.frameInfo(0);
  if (reader.width !== SIZE || reader.height !== SIZE || first.x || first.y ||
      first.width !== SIZE || first.height !== SIZE || first.palette_size > 128) {
    throw Error("Unexpected loading GIF canvas");
  }
  // The first frame covers the canvas. Every following patch stays clear of
  // the title, so the original frames, delays and loop can be kept byte-for-byte.
  for (let i = 0; i < reader.numFrames(); i++) {
    const frame = reader.frameInfo(i);
    if (frame.disposal > 1 || (i > 0 && frame.y < TITLE_BOTTOM &&
        (frame.x !== 0 || frame.y !== 0 || frame.width !== 1 || frame.height !== 1))) {
      throw Error("Loading GIF patches overlap the title");
    }
  }

  const palette = Array.from({length:first.palette_size}, (_, i) => bytes.readUIntBE(first.palette_offset + 3*i, 3));
  const colors = new Map(palette.map((rgb, i) => [rgb, i]).filter(([, i]) => i !== first.transparent_index));
  const source = new Uint8Array(SIZE * SIZE * 4);
  const indices = new Uint8Array(SIZE * SIZE);
  reader.decodeAndBlitFrameRGBA(0, source);
  for (let i = 0; i < indices.length; i++) {
    const j = i * 4;
    const rgb = (source[j] << 16) | (source[j+1] << 8) | source[j+2];
    const x = i % SIZE + .5, y = Math.floor(i / SIZE) + .5;
    const cornerX = Math.max(CORNER_RADIUS - Math.min(x, SIZE-x), 0);
    const cornerY = Math.max(CORNER_RADIUS - Math.min(y, SIZE-y), 0);
    const roundedCorner = first.transparent_index !== null && Math.hypot(cornerX, cornerY) > CORNER_RADIUS;
    indices[i] = roundedCorner || !source[j+3] ? first.transparent_index : colors.get(rgb);
    if (i < SIZE * TITLE_BOTTOM && i > 0 && (rgb !== 0 || source[j+3] !== 255)) {
      throw Error("Loading GIF title area must be black");
    }
  }
  return {bytes, first, palette, indices};
}

async function runningGif(pixels) {
  loadingTemplate ||= loadAnimation();
  const {bytes, first, palette, indices} = await loadingTemplate;

  // The initial frame gets a local palette for the antialiased title.
  // The original global palette still applies to the remaining animation.
  const localPalette = [...palette];
  const shades = 256 - palette.length;
  for (let i = 0; i < shades; i++) {
    const gray = Math.round(255 * i / (shades-1));
    localPalette.push(gray * 0x010101);
  }
  const titled = Uint8Array.from(indices);
  for (let i = 0; i < SIZE * TITLE_BOTTOM; i++) {
    const alpha = pixels[i*4+3];
    if (alpha) titled[i] = palette.length + Math.round(alpha * (shades-1) / 255);
  }

  const buffer = Buffer.alloc(titled.length * 2 + 1024);
  const writer = new GifWriter(buffer, SIZE, SIZE);
  const end = writer.addFrame(0, 0, SIZE, SIZE, titled, {palette:localPalette});
  const descriptor = first.data_offset - 10 - (first.has_local_palette ? 3*first.palette_size : 0);
  if (bytes[descriptor] !== 0x2c) throw Error("Invalid loading GIF descriptor");
  // Strip the temporary GIF header and retain the source control extension.
  return Buffer.concat([bytes.subarray(0, descriptor), buffer.subarray(13, end),
    bytes.subarray(first.data_offset + first.data_length)]);
}

async function render(card,file) {
  const font = await svgFonts();
  const animated = card.animated;
  const markup = animated ? svg(SIZE, "", titleSvg(card.title)) : await staticArtwork(card);
  const renderer = new Resvg(markup, {font});
  let image;
  try {
    image = renderer.render();
    const bytes = animated ? await runningGif(image.pixels) : image.asPng();
    const temporary = file + "." + process.pid + ".tmp";
    try {
      await fs.writeFile(temporary, bytes, {mode:0o600});
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  } finally {
    image?.free();
    renderer.free();
  }
}
let queue=Promise.resolve();
parentPort.on("message",({id,card,file})=>{queue=queue.then(async()=>{
  try{await render(card,file);parentPort.postMessage({id});}
  catch(error){parentPort.postMessage({id,error:error.message});}
});});

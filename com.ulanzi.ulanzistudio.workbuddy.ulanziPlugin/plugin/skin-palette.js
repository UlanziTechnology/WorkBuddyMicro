"use strict";
async function samplePalette(image) {
  // Decode bytes independently of the window's paint cycle; WorkBuddy is often
  // in the background when the hardware key is pressed.
  const bytes = Uint8Array.from(atob(image.slice(image.indexOf(",")+1)), c => c.charCodeAt(0));
  const picture = await createImageBitmap(new Blob([bytes],{type:"image/jpeg"}));
  const sampler = document.createElement("canvas");
  sampler.width = sampler.height = 32;
  const ctx = sampler.getContext("2d");
  try { ctx.drawImage(picture, 0, 0, 32, 32); } finally { picture.close(); }
  const pixels = ctx.getImageData(0, 0, 32, 32).data;
  const bins = Array.from({length:24}, () => ({weight:0, r:0, g:0, b:0}));
  let brightness = 0;
  for (let i=0; i<pixels.length; i+=4) {
    const [r,g,b] = pixels.subarray(i,i+3);
    brightness += .2126*r + .7152*g + .0722*b;
    const max = Math.max(r,g,b), delta = max-Math.min(r,g,b);
    if (delta < 15) continue;
    const sector = max===r ? (g-b)/delta : max===g ? (b-r)/delta+2 : (r-g)/delta+4;
    const bin = bins[Math.round((sector+6)*4)%24];
    bin.weight += delta;
    bin.r += delta*r; bin.g += delta*g; bin.b += delta*b;
  }
  const dark = brightness/(pixels.length/4) < 135;
  const dominant = bins.reduce((a,b) => a.weight>b.weight?a:b);
  const rgb = dominant.weight ? [dominant.r,dominant.g,dominant.b].map(v=>Math.round(v/dominant.weight)) : [128,128,128];
  const tint = (neutral, amount) => "#" + rgb.map(c=>Math.round(neutral+(c-neutral)*amount).toString(16).padStart(2,"0")).join("");
  const surface = tint(dark?20:254,.11);
  const ink = tint(dark?253:16,.07);
  const muted = tint(dark?215:63,.09);
  const accent = tint(dark?255:0,dark?.36:.46);
  const selected = tint(dark?28:245,.29);
  return {surface,ink,muted,accent,selected,bubble:selected,border:tint(dark?125:153,.19)};
}
if (typeof module !== "undefined") module.exports = {samplePalette};

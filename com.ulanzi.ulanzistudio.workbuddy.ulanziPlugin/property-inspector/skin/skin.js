"use strict";
WorkBuddyPI.ready.then(() => {
const picker = document.getElementById("image"), preview = document.getElementById("preview"), note = document.getElementById("result");
const t = WorkBuddyPI.t;
const chooseImageButton = document.getElementById("choose-image");
chooseImageButton.onclick = () => picker.click();
function display(data) { preview.hidden = !data; if(data)preview.src = data; }
const group = document.getElementById("palette");
group.querySelector("legend").textContent = t("themeColors");
const labels = ["ink","muted","surface","bubble","accent","selected","border"];
let overrides = {}, defaults = {}, lastImage;
function refresh() {
  for (const key of labels) document.getElementById(key).value = overrides[key] || defaults[key] || "#808080";
}
async function showPalette(image) {
  if (image === lastImage) return;
  lastImage = image;
  defaults = {};
  if (image) {
    const colors = await samplePalette(image);
    if (lastImage === image) defaults = colors;
  }
  refresh();
}
for (const key of labels) {
  const row=document.createElement("label"), input=document.createElement("input");
  row.style.cssText="display:flex;align-items:center;justify-content:space-between;margin:5px 0";
  input.type="color";input.id=key;row.append(t("color_"+key),input);group.append(row);
  input.onchange=()=>{overrides={...overrides,[key]:input.value};WorkBuddyPI.saveFields({palette:overrides});note.textContent=t("applyColors");};
}
const reset=document.createElement("button");reset.type="button";reset.textContent=t("resetColors");group.append(reset);
reset.onclick=()=>{overrides={};WorkBuddyPI.saveFields({palette:{}});refresh();note.textContent=t("applyAutoColors");};
WorkBuddyPI.setFormFilledHook(s => {display(s.thumbnail);overrides=s.palette||{};refresh();showPalette(s.image).catch(e=>{note.textContent=t(e.message);});});
picker.onchange = async () => {
  const file = picker.files[0]; if (!file) return;
  picker.disabled = true;
  chooseImageButton.disabled = true;
  let bitmap;
  try {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 20*1024*1024) throw Error(t("imageFormat"));
    bitmap = await createImageBitmap(file);
    function encode(size, square) {
      const c = document.createElement("canvas"), w = bitmap.width, h = bitmap.height;
      const ratio = Math.min(1,size/Math.max(w,h));
      c.width = square ? size : Math.max(1,Math.round(w*ratio)); c.height = square ? size : Math.max(1,Math.round(h*ratio));
      const g=c.getContext("2d"); g.fillStyle="#242424";g.fillRect(0,0,c.width,c.height);
      const side=Math.min(w,h);
      if(square)g.drawImage(bitmap,(w-side)/2,(h-side)/2,side,side,0,0,size,size);
      else g.drawImage(bitmap,0,0,c.width,c.height);
      return c.toDataURL("image/jpeg",0.78);
    }
    let size=1600, image=encode(size,false);
    while(image.length>350000){size=Math.floor(size*0.75);image=encode(size,false);}
    const thumbnail=encode(96,true);
    WorkBuddyPI.saveFields({image,thumbnail}); display(thumbnail); await showPalette(image);
    note.textContent=t("imageSelected");
  } catch(e) { note.textContent=t(e.message); }
  finally { bitmap?.close(); picker.disabled=false; chooseImageButton.disabled=false; picker.value=""; }
};

const restoreButton = document.getElementById("restore-theme");
restoreButton.textContent = t("restoreTheme");
restoreButton.onclick = () => WorkBuddyPI.restoreTheme();

const toggleHelp = document.createElement("p");
toggleHelp.className = "help";
toggleHelp.textContent = t("themeToggleHelp");
chooseImageButton.before(toggleHelp);

});

"use strict";
const picker = document.getElementById("image"), preview = document.getElementById("preview"), note = document.getElementById("result");
const zh = (new URLSearchParams(location.search).get("language") || "").toLowerCase().startsWith("zh");
function display(data) { preview.hidden = !data; if(data)preview.src = data; }
const group = document.getElementById("palette");
group.querySelector("legend").textContent = zh ? "主题配色" : "Theme colors";
const labels = {ink:["正文","Text"],muted:["辅助文字","Secondary text"],surface:["面板与输入框","Panels and input"],bubble:["用户消息背景","User message"],accent:["链接与强调色","Accent"],selected:["选中背景","Selection"],border:["边框","Borders"]};
let overrides = {}, defaults = {}, lastImage;
function refresh() {
  for (const key of Object.keys(labels)) document.getElementById(key).value = overrides[key] || defaults[key] || "#808080";
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
for (const [key,label] of Object.entries(labels)) {
  const row=document.createElement("label"), input=document.createElement("input");
  row.style.cssText="display:flex;align-items:center;justify-content:space-between;margin:5px 0";
  input.type="color";input.id=key;row.append(label[zh?0:1],input);group.append(row);
  input.onchange=()=>{overrides={...overrides,[key]:input.value};WorkBuddyPI.saveFields({palette:overrides});note.textContent=zh?"按主题键应用配色":"Press the theme key to apply.";};
}
const reset=document.createElement("button");reset.type="button";reset.textContent=zh?"恢复图片取色":"Reset to image colors";group.append(reset);
reset.onclick=()=>{overrides={};WorkBuddyPI.saveFields({palette:{}});refresh();note.textContent=zh?"按主题键应用自动配色":"Press the theme key to apply automatic colors.";};
WorkBuddyPI.setFormFilledHook(s => {display(s.thumbnail);overrides=s.palette||{};refresh();showPalette(s.image).catch(e=>{note.textContent=e.message;});});
picker.onchange = async () => {
  const file = picker.files[0]; if (!file) return;
  picker.disabled = true;
  let bitmap;
  try {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 20*1024*1024) throw Error(zh?"请选择 20 MB 以内的 PNG、JPEG 或 WebP":"Choose PNG, JPEG or WebP under 20 MB.");
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
    note.textContent=zh?"图片已选择，按设备键应用":"Image selected. Press the device key to apply.";
  } catch(e) { note.textContent=e.message; }
  finally { bitmap?.close(); picker.disabled=false; picker.value=""; }
};

const restoreButton = document.getElementById("restore-theme");
restoreButton.textContent = zh ? "恢复 WorkBuddy 原生主题" : "Restore native WorkBuddy theme";
restoreButton.onclick = () => WorkBuddyPI.restoreTheme();

const toggleHelp = document.createElement("p");
toggleHelp.className = "help";
toggleHelp.textContent = zh ? "按一次主题键应用本键主题，再按一次恢复 WorkBuddy 默认主题。修改图片或配色后，按键会应用新主题。" : "Press the theme key to apply this theme. Press again to restore the default. After changing the image or colors, press to apply the updated theme.";
picker.before(toggleHelp);

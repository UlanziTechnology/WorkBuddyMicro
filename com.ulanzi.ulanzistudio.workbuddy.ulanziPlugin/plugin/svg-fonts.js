"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {initWasm} = require("../libs/vendor/resvg");

let ready;
function svgFonts() {
  return ready ||= initialize();
}

async function initialize() {
  await initWasm(await fs.readFile(path.join(__dirname,"../libs/vendor/resvg/index_bg.wasm")));
  const windows=path.join(process.env.SystemRoot||"C:\\Windows","Fonts");
  const candidates=process.platform==="win32" ? [
    [path.join(windows,"msyhbd.ttc"),"Microsoft YaHei"],[path.join(windows,"msyh.ttc"),"Microsoft YaHei"],
    [path.join(windows,"malgun.ttf"),"Malgun Gothic"],[path.join(windows,"arialbd.ttf"),"Arial"]
  ] : [["/System/Library/Fonts/Supplemental/Arial Unicode.ttf","Arial Unicode MS"],
       ["/System/Library/Fonts/STHeiti Medium.ttc","Heiti SC"],["/System/Library/Fonts/Supplemental/Arial.ttf","Arial"]];
  for(const [file,family] of candidates){
    try{return {fontBuffers:[await fs.readFile(file)],defaultFontFamily:family,sansSerifFamily:family};}catch{}
  }
  throw Error("No readable system font for task cards");
}

module.exports = {svgFonts};

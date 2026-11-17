"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createHash} = require("node:crypto");
const {GifReader, GifWriter} = require("../libs/vendor/omggif");
const size = 196;
const digits = {"0":["111","101","101","101","111"],"1":["010","110","010","010","111"],"2":["111","001","111","100","111"],"3":["111","001","111","001","111"],"4":["101","101","111","001","001"],"5":["111","100","111","001","111"],"6":["111","100","111","101","111"],"7":["111","001","010","010","010"],"8":["111","101","111","101","111"],"9":["111","101","111","001","111"],".":["000","000","000","000","010"],"-":["000","000","111","000","000"],"+":["000","010","111","010","000"],"k":["100","101","110","101","101"],"M":["101","111","111","101","101"]};
function labelFor(credits) {
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) return "-";
  if (credits >= 1e9) return "999M+";
  const suffix = credits >= 1e6 ? "M" : credits >= 1e4 ? "k" : "";
  const n = credits / (suffix === "M" ? 1e6 : suffix === "k" ? 1000 : 1);
  return (n >= 1000 && suffix ? Math.round(n).toString() : n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")) + suffix;
}

/** Local GIF artwork module. render(artwork, credits) returns a stable absolute path.
 * Scheme one: robot at 86%, bottom aligned; a pixel label centered above its ears.
 * Files are content-addressed and atomically published; unchanged labels reuse the file.
 */
class TaskGif {
  constructor({assets = path.join(__dirname,"../assets/states"), cache = path.join(os.tmpdir(),"ulanzi-workbuddy-task-gifs-v1")} = {}) {
    this.assets = assets;
    this.cache = cache;
    this.sources = new Map();
    this.pending = new Map();
    this.recent = new Map();
  }
  /** @param {string} artwork @param {number|null} credits @returns {Promise<string>} */
  async render(artwork, credits) {
    if (!["idle","running","approval","done","error"].includes(artwork)) throw Error("Unsupported task artwork");
    let source = this.sources.get(artwork);
    if (!source) {
      const bytes = await fs.readFile(path.join(this.assets,artwork+".gif"));
      source = {reader:new GifReader(bytes), hash:createHash("sha256").update(bytes).digest("hex")};
      this.sources.set(artwork,source);
    }
    // Old artwork stays usable until Studio reloads it; bound only this module's private cache.
    this.initialized ||= this.prepareCache();
    await this.initialized;
    const label = labelFor(credits);
    const name = createHash("sha256").update(source.hash+":"+label).digest("hex")+".gif";
    const file = path.join(this.cache,name);
    if (!this.pending.has(file)) this.pending.set(file, this.write(source.reader,label,file).finally(() => this.pending.delete(file)));
    await this.pending.get(file);
    this.recent.delete(file);this.recent.set(file,true);
    while (this.recent.size > 128) {
      const oldest = this.recent.keys().next().value;this.recent.delete(oldest);
      await fs.unlink(oldest).catch(()=>{});
    }
    return file;
  }
  async prepareCache() {
    await fs.mkdir(this.cache,{recursive:true,mode:0o700});
    const files = [];
    for (const name of await fs.readdir(this.cache)) {
      if (!/^[a-f0-9]{64}\.gif$/.test(name)) continue;
      const file = path.join(this.cache,name), stat = await fs.stat(file).catch(()=>null);
      if (stat?.isFile()) files.push({file,mtime:stat.mtimeMs});
    }
    files.sort((a,b) => a.mtime-b.mtime);
    for (const {file} of files) this.recent.set(file,true);
  }
  async write(reader, label, file) {
    try { await fs.access(file); return; } catch { /* First use of this status/amount. */ }
    const output = Buffer.alloc((size*size*2+1024)*reader.numFrames()+2048);
    const writer = new GifWriter(output,size,size,{loop:reader.loopCount() ?? 0});
    let canvas = Buffer.alloc(reader.width*reader.height*4), previous, saved;
    for (let i=0;i<reader.numFrames();i++) {
      const info = reader.frameInfo(i);
      if (previous?.disposal === 2) {
        for (let y=previous.y;y<previous.y+previous.height;y++) for (let x=previous.x;x<previous.x+previous.width;x++) canvas.fill(0,(y*reader.width+x)*4,(y*reader.width+x+1)*4);
      } else if (previous?.disposal === 3 && saved) canvas = saved;
      saved = info.disposal === 3 ? Buffer.from(canvas) : null;
      const layer = Buffer.alloc(canvas.length);reader.decodeAndBlitFrameRGBA(i,layer);
      for (let p=0;p<layer.length;p+=4) if (layer[p+3]) layer.copy(canvas,p,p,p+4);
      const background = [canvas[0],canvas[1],canvas[2]];
      const pixels = new Uint32Array(size*size);pixels.fill((background[0]<<16)|(background[1]<<8)|background[2]);
      const edge = 168, left = 14, top = size-edge;
      for (let y=0;y<edge;y++) for (let x=0;x<edge;x++) {
        const p=(Math.floor(y*reader.height/edge)*reader.width+Math.floor(x*reader.width/edge))*4;
        if (canvas[p+3]) pixels[(top+y)*size+left+x]=(canvas[p]<<16)|(canvas[p+1]<<8)|canvas[p+2];
      }
      const scale = label.length > 8 ? 3 : 4, width = (label.length*4-1)*scale;
      const x0=Math.floor((size-width)/2),y0=5;
      for(let y=y0-3;y<y0+5*scale+3;y++)for(let x=x0-5;x<x0+width+5;x++)pixels[y*size+x]=0x16282e;
      for(let c=0;c<label.length;c++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(digits[label[c]]?.[y][x]==="1"){
        for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++)pixels[(y0+y*scale+dy)*size+x0+(c*4+x)*scale+dx]=(background[0]<<16)|(background[1]<<8)|background[2];
      }
      const palette=[0],colors=new Map(),indexed=Buffer.alloc(size*size);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        // Rounded corners match the encoder's static fallbacks.
        const cx=x<23?23:x>172?172:x,cy=y<23?23:y>172?172:y;
        if((x-cx)**2+(y-cy)**2>23**2){indexed[y*size+x]=0;continue;}
        const color=pixels[y*size+x];
        if(!colors.has(color)){if(palette.length===256)throw Error("Task GIF palette exceeds 256 colors");colors.set(color,palette.length);palette.push(color);}
        indexed[y*size+x]=colors.get(color);
      }
      while(palette.length & (palette.length-1))palette.push(0);
      writer.addFrame(0,0,size,size,indexed,{palette,delay:info.delay,disposal:2,transparent:0});previous=info;
    }
    const bytes=output.subarray(0,writer.end());
    const temporary=file+"."+process.pid+".tmp";
    try { await fs.writeFile(temporary,bytes,{mode:0o600});await fs.rename(temporary,file); }
    finally { await fs.unlink(temporary).catch(()=>{}); }
  }
}
module.exports={TaskGif};

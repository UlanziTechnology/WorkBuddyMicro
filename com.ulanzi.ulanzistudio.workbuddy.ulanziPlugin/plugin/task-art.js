"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {Worker}=require("node:worker_threads");
const {createHash}=require("node:crypto");
const DIAL_FRAME_COUNT = 12;
const workerFile=path.join(__dirname,"task-art-worker.js");

/** All key pixels, including titles and status, are owned by this module.
 * render({state,title,frame?}) -> {path,animated}; stop() releases its worker.
 * Font rasterization and GIF encoding stay off the voice/status event loop.
 */
class TaskArtwork {
  constructor({cache=path.join(os.tmpdir(),"ulanzi-workbuddy-task-cards-v2")}={}){
    this.cache=cache;this.recent=new Map();this.requests=new Map();this.pending=new Map();this.sequence=0;
    const version = createHash("sha256").update(fs.readFileSync(workerFile));
    const frames = Array.from({length:DIAL_FRAME_COUNT}, (_, i) => `running-${i}.png`);
    for (const name of ["done.jpg","approval.jpg","error.jpg","offline.jpg","running.gif",...frames]) {
      // Missing assets still let the plugin start and fall back to its packaged icons.
      try { version.update(fs.readFileSync(path.join(__dirname, "../assets/task-cards", name))); }
      catch { version.update(name); }
    }
    this.version = version.digest("hex");
  }
  /** @param {{state:string,title:string,frame?:number}} snapshot
   * @returns {Promise<{path:string,animated:boolean}>} */
  render(snapshot){
    if(this.stopped)return Promise.reject(Error("Task artwork stopped"));
    const state=["idle","running","approval","done","error","offline","empty"].includes(snapshot.state)?snapshot.state:"offline";
    const frame = state === "running" && Number.isInteger(snapshot.frame) &&
      snapshot.frame >= 0 && snapshot.frame < DIAL_FRAME_COUNT ? snapshot.frame : undefined;
    const animated = state === "running" && frame === undefined;
    const card = {state, animated, frame, title:Array.from(String(snapshot.title || "")).slice(0,240).join("")};
    const name=createHash("sha256").update(JSON.stringify([this.version,card])).digest("hex")+(animated?".gif":".png"),file=path.join(this.cache,name);
    if(!this.requests.has(file))this.requests.set(file,this.produce(card,file,animated).finally(()=>this.requests.delete(file)));
    return this.requests.get(file);
  }
  async prepare(){
    await fs.promises.mkdir(this.cache,{recursive:true,mode:0o700});const files=[];
    for(const name of await fs.promises.readdir(this.cache)){
      if(!/^[a-f0-9]{64}\.(png|gif)$/.test(name))continue;
      const file=path.join(this.cache,name),stat=await fs.promises.stat(file).catch(()=>null);
      if(stat?.isFile())files.push({file,mtime:stat.mtimeMs});
    }
    files.sort((a,b)=>a.mtime-b.mtime);for(const {file} of files)this.recent.set(file,true);
  }
  async produce(card,file,animated){
    this.initialized ||= this.prepare();await this.initialized;
    try{await fs.promises.access(file);}catch{await this.draw(card,file);}
    this.recent.delete(file);this.recent.set(file,true);
    while(this.recent.size>128){const oldest=this.recent.keys().next().value;this.recent.delete(oldest);await fs.promises.unlink(oldest).catch(()=>{});}
    return {path:file,animated};
  }
  draw(card,file){
    if(this.stopped)return Promise.reject(Error("Task artwork stopped"));
    if(!this.worker){
      const worker=new Worker(workerFile);this.worker=worker;
      worker.on("message",({id,error})=>{const item=this.pending.get(id);if(!item)return;this.pending.delete(id);clearTimeout(item.timer);if(!this.pending.size)worker.unref();error?item.reject(Error(error)):item.resolve();});
      const fail=error=>{if(this.worker!==worker)return;this.worker=null;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();};
      worker.on("error",fail);worker.on("exit",()=>fail(Error("Task artwork worker exited")));
      worker.unref();
    }
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);if(!this.pending.size)this.worker?.unref();reject(Error("Task artwork timed out"));},15000);timer.unref();
      this.pending.set(id,{resolve,reject,timer});this.worker.ref();this.worker.postMessage({id,card,file});
    });
  }
  stop(){
    this.stopped=true;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error("Task artwork stopped"));}this.pending.clear();this.worker?.terminate();this.worker=null;
  }
}
module.exports={TaskArtwork,DIAL_FRAME_COUNT};

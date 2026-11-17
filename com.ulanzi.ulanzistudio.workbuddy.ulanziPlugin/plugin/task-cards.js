"use strict";
const {statusArtwork} = require("./workbuddy-status");
const REFRESH_MS = 60000;

/** Deep task-display module: owns minute reads, state-change reads, GIF composition and stale-result guards.
 * Interface: update(action, snapshot), remove(actionid), stop(). Only visible, enabled tasks consume I/O.
 * State changes and periodic credit reads are coalesced across all five slots into one file read batch.
 */
class TaskCards {
  constructor({usage, artwork, send}) {
    this.usage = usage;
    this.artwork = artwork;
    this.send = send;
    this.views = new Map();
    this.credits = new Map();
    this.pending = new Set();
  }
  /** @param {{actionid:string, uuid:string, key:string, active:boolean}} action
   * @param {{session:string|null, state:string, text:string, showCredits:boolean}} snapshot */
  update(action, snapshot) {
    if (!action.active || this.stopped) { this.remove(action.actionid); return; }
    const previous = this.views.get(action.actionid);
    const signature = JSON.stringify(snapshot);
    if (previous?.action === action && previous.signature === signature) return;
    const view = {action, snapshot, signature};
    this.views.set(action.actionid,view);
    if (!this.enabled(view)) this.paint(view);
    else if (previous && previous.snapshot.session === snapshot.session && previous.snapshot.state === snapshot.state && this.enabled(previous)) this.paint(view);
    else this.request(snapshot.session);
    this.schedule();
  }
  enabled(view) { return view.snapshot.showCredits && view.snapshot.session && !["offline","empty"].includes(view.snapshot.state); }
  request(session) {
    if (this.stopped) return;
    this.pending.add(session);
    if (!this.queued && !this.loading) {
      this.queued = setTimeout(() => { this.queued = null; this.refresh(); },0);
      this.queued.unref?.();
    }
  }
  schedule() {
    const enabled = [...this.views.values()].some(view => this.enabled(view));
    if (!enabled) { clearInterval(this.timer); this.timer = null; }
    else if (!this.timer) {
      this.timer = setInterval(() => {
        for (const view of this.views.values()) if (this.enabled(view)) this.request(view.snapshot.session);
      },REFRESH_MS);
      this.timer.unref?.();
    }
  }
  async refresh() {
    if (this.loading || this.stopped) return;
    const sessions = [...this.pending].filter(id => [...this.views.values()].some(view => this.enabled(view) && view.snapshot.session === id));
    this.pending.clear();
    if (!sessions.length) return;
    this.loading = true;
    try {
      const values = await this.usage.read(sessions);
      for (const id of sessions) if (values.has(id)) this.credits.set(id,values.get(id));
      for (const view of this.views.values()) {
        if (this.enabled(view) && sessions.includes(view.snapshot.session) && !this.pending.has(view.snapshot.session)) await this.paint(view);
      }
    } catch {
      // Transient file errors keep the last measured amount; an unmeasured session gets a dash.
      for (const view of this.views.values()) if (this.enabled(view) && sessions.includes(view.snapshot.session) && !this.pending.has(view.snapshot.session)) await this.paint(view);
    } finally {
      this.loading = false;
      if (this.pending.size) this.request(this.pending.values().next().value);
      const visible = new Set([...this.views.values()].map(view => view.snapshot.session));
      for (const id of this.credits.keys()) if (!visible.has(id)) this.credits.delete(id);
    }
  }
  async paint(view) {
    const {action, snapshot} = view;
    const artwork = statusArtwork(snapshot.state);
    const icon = {uuid:action.uuid,actionid:action.actionid,key:action.key,
      showtext:Boolean(snapshot.text),textdata:snapshot.text || ""};
    if (["offline","empty"].includes(artwork)) Object.assign(icon,{type:2,path:"assets/states/"+artwork+".png"});
    else {
      let file = "assets/states/"+artwork+".gif";
      if (this.enabled(view)) {
        try { file = await this.artwork.render(artwork,this.credits.get(snapshot.session) ?? null); }
        catch { /* A rendering error falls back to the original animation, never hides state. */ }
      }
      Object.assign(icon,{type:4,gifpath:file});
    }
    // Navigation/settings/state may change while the file or GIF is being read.
    if (!this.stopped && action.active && this.views.get(action.actionid) === view) this.send({cmd:"state",param:{statelist:[icon]}});
  }
  remove(actionid) { this.views.delete(actionid); this.schedule(); }
  stop() {
    this.stopped = true;
    clearTimeout(this.queued);clearInterval(this.timer);
    this.views.clear();this.pending.clear();this.credits.clear();
  }
}
module.exports={TaskCards};

"use strict";
const cdp = require("./workbuddy-cdp");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
class WorkBuddyStatus extends EventEmitter {
  constructor(hasVisibleVoiceKey = () => false) {
    super();
    this.hasVisibleVoiceKey = hasVisibleVoiceKey;
    this.voiceRevision = 0;
    this.state = "offline";
  }
  taskSlots() { return this.cdpTasks ?? []; }
  snapshot() {
    return {connected:Boolean(this.cdpState), installed:Boolean(this.installed || this.cdpState), state:this.state, tasks:this.taskSlots()};
  }
  publish() {
    this.state = this.cdpState || "offline";
    this.emit("change", this.snapshot());
  }
  async start() {
    if (process.platform === "darwin") {
      this.installed = ["/Applications", path.join(require("os").homedir(), "Applications")].some(dir =>
        ["WorkBuddy.app", "WorkBuddy AI.app"].some(name => fs.existsSync(path.join(dir, name))));
    } else if (process.platform === "win32") {
      const {schemeExists} = require("./deeplink");
      this.installed = await schemeExists("workbuddy://") || await schemeExists("workbuddy-ai://");
    }
    const poll = async () => {
      if (this.polling || this.stopped) return;
      this.polling = true;
      try {

        const revision = this.voiceRevision;
        const observed = await cdp.command("observe").catch(() => null);
        if (this.stopped) return;
        const state = ["idle","notification","working"].includes(observed?.state) ? observed.state : null;
        const tasks = observed?.tasks ?? null;
        const approval = observed?.approval ?? null;
        const voice = revision !== this.voiceRevision && observed && observed.session === this.session ? this.voice : observed?.voice ?? "unavailable";
        const send = observed?.send ?? "unavailable";
        const changed = voice !== this.voice || send !== this.send || JSON.stringify(approval) !== JSON.stringify(this.approval) || JSON.stringify(tasks) !== JSON.stringify(this.cdpTasks) || state !== this.cdpState || observed?.model !== this.model || observed?.session !== this.session;
        this.voice = voice;
        this.send = send;
        this.approval = approval;
        this.cdpTasks = tasks;
        this.model = observed?.model;
        this.session = observed?.session;
        this.cdpState = state;
        if (changed) this.publish();
      } finally { this.polling = false; }
    };
    this.refresh = async () => {
      if (this.polling || this.stopped) return;
      clearTimeout(this.timer);
      await poll();
      if (this.stopped) return;
      let delay = 2000;
      if (this.cdpState) {
        delay = 500;
        if (this.hasVisibleVoiceKey()) this.watchVoice();
        if (Date.now() < this.fastVoiceUntil) delay = 40;
      }
      this.timer = setTimeout(this.refresh, delay);
    };
    await this.refresh();
  }
  async watchVoice() {
    if (this.watchingVoice) return;
    this.watchingVoice = true;
    try {
      while (!this.stopped && this.cdpState && this.hasVisibleVoiceKey()) {
        const session = this.session, voice = this.voice;
        const value = await cdp.command("watchVoice", {session, voice});
        // Let the full snapshot own navigation and disconnects.
        if (!value || this.stopped || !this.cdpState || session !== this.session || value.session !== session) break;
        if (this.voice === voice && value.voice !== voice) {
          this.voiceRevision++;
          this.voice = value.voice;
          this.publish();
        }
      }
    } catch (_) { /* The next regular snapshot retries the subscription. */ }
    finally { this.watchingVoice = false; }
  }
  // Read back the actual mic state immediately and through the async permission
  // or transcription transition. All reads share the regular polling loop.
  refreshVoice() {
    this.fastVoiceUntil = Date.now() + 1500;
    this.refresh?.();
  }
  async stop() {
    this.stopped = true; clearTimeout(this.timer);
  }
}
module.exports = { WorkBuddyStatus };

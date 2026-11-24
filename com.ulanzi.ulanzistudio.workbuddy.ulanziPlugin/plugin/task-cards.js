"use strict";
const {statusArtwork} = require("./workbuddy-status");
const {DIAL_FRAME_COUNT} = require("./task-art");
const {sessionCard} = require("./session-card");
const fs = require("node:fs/promises");
const path = require("node:path");
const defaultSessionIcon = require("../layouts/session-encoder.json").items[0].value;
const DIAL_FRAME_MS = 200;
// Track the current view so a slow render cannot repaint a changed or removed key.
class TaskCards {
  constructor({artwork, send}) {
    this.artwork = artwork;
    this.send = send;
    this.views = new Map();
  }

  /** @param {{actionid:string, uuid:string, key:string, active:boolean}} action
   * @param {{session:string|null, state:string, text:string}} snapshot */
  update(action, snapshot) {
    if (this.stopped || !action.active) {
      this.remove(action.actionid);
      return;
    }
    const previous = this.views.get(action.actionid);
    const signature = JSON.stringify(snapshot);
    if (previous?.action === action && previous.signature === signature) return;

    this.remove(action.actionid);
    const state = statusArtwork(snapshot.state);
    const view = {action, snapshot, signature, state};
    this.views.set(action.actionid, view);
    this.paint(view, action.controller === "Encoder" && state === "running" ? 0 : undefined);
  }

  async paint(view, frame, sendAt = 0) {
    const {action, snapshot, state} = view;
    if (this.views.get(action.actionid) !== view || !action.active) return;
    const dial = action.controller === "Encoder";
    let image;
    try {
      image = await this.artwork.render({state, title:snapshot.text, frame, dial});
    } catch {
      const animated = state === "running" && frame === undefined;
      const filename = frame === undefined ? state + (animated ? ".gif" : ".png") : `running-${frame}.png`;
      image = {path:"assets/task-cards/" + filename, animated};
      if (dial) {
        const png = await fs.readFile(path.join(__dirname, "..", image.path)).catch(() => null);
        if (png) {
          const svg = sessionCard(`<image width="126" height="126" xlink:href="data:image/png;base64,${png.toString("base64")}"/>`);
          image.data = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
        } else {
          image.path = defaultSessionIcon;
        }
      }
    }
    if (this.views.get(action.actionid) !== view || !action.active) return;

    const imageData = image.data ? {type:1, data:image.data}
      : image.animated ? {type:4, gifpath:image.path} : {type:2, path:image.path};
    const icon = {uuid:action.uuid, actionid:action.actionid, key:action.key,
      showtext:false, textdata:"", ...imageData};
    const sendFrame = () => {
      if (this.views.get(action.actionid) !== view || !action.active) return;
      const sent = this.send({cmd:"state", param:{statelist:[icon]}});
      // Prepare one frame ahead so rendering stays within the 200 ms cadence.
      if (frame !== undefined && sent !== false) {
        this.paint(view, (frame + 1) % DIAL_FRAME_COUNT, performance.now() + DIAL_FRAME_MS);
      }
    };
    const delay = Math.ceil(sendAt - performance.now());
    if (delay > 0) {
      view.timer = setTimeout(sendFrame, delay);
      view.timer.unref();
    } else {
      sendFrame();
    }
  }

  remove(actionid) {
    clearTimeout(this.views.get(actionid)?.timer);
    this.views.delete(actionid);
  }

  stop() {
    this.stopped = true;
    for (const id of this.views.keys()) this.remove(id);
    this.artwork.stop();
  }
}

module.exports = {TaskCards};

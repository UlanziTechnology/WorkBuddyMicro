"use strict";

/**
 * WorkBuddy plugin main service (Ulanzi Studio JS Plugin Protocol V3.0.0).
 *
 * Startup args: node app.js <address> <port> <language> [version]
 * The main service keeps a persistent WebSocket connection even when no
 * Property Inspector is visible.
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { WebSocketClient } = require("../libs/ws-client");
const { createAction } = require("./actions");
const { WorkBuddyStatus } = require("./workbuddy-status");
const deeplink = require("./deeplink");

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.workbuddy";
const DOWNLOAD_URL = "https://www.workbuddy.cn/";

// One physical press produces `keydown` + `run` a few ms apart.
const RUN_DEDUPE_MS = 250;
// A key held longer than this is treated as a fresh press even without `keyup`.
const STALE_PRESS_MS = 5000;

// ---------------------------------------------------------------------------
// Localization (main service side, keyed by host language arg)

const STRINGS = {
  zh: {
    notInstalled: "未检测到 WorkBuddy，请先安装 WorkBuddy 桌面客户端",
    launchFailed: "唤起 WorkBuddy 失败，请检查客户端与协议注册",
    promptTruncated: "任务描述超过 8000 字符，已截断",
    taskPrefilled: "已在 WorkBuddy 预填任务草稿，确认后发送",
    modelSelected: "已请求预选模型（若未生效请检查模型 ID）：",
    noModels: "未配置模型",
    configureModels: "请先在插件属性中配置模型列表",
    skillFieldsRequired: "请先填写 Skill 名称和 HTTPS 下载地址",
    schemeMissing: "协议未注册，请在插件属性中检查 scheme 设置",
  },
  en: {
    notInstalled:
      "WorkBuddy not detected. Please install the WorkBuddy desktop client first",
    launchFailed: "Failed to launch WorkBuddy. Check the client and scheme registration",
    promptTruncated: "Prompt exceeds 8000 characters and was truncated",
    taskPrefilled: "Task draft prefilled in WorkBuddy. Review and send",
    modelSelected: "Model preselection requested (check model ID if ignored): ",
    noModels: "No models configured",
    configureModels: "Configure the model list in the property inspector first",
    skillFieldsRequired:
      "Fill in the skill name and an HTTPS download URL first",
    schemeMissing: "Scheme not registered. Check the scheme setting in the plugin properties",
  },
};

// ---------------------------------------------------------------------------

class PluginApp {
  constructor() {
    const argv = process.argv.slice(2);
    this.address = argv[0] || "127.0.0.1";
    this.port = Number(argv[1] || 3906);
    const lang = String(argv[2] || "en-US");
    this.lang = lang.toLowerCase().startsWith("zh") ? "zh" : "en";
    this.version = argv[3] || "";

    this.ws = null;
    this.actions = new Map(); // actionid -> action instance
    this.displayCache = new Map();
    this.sessionModelCards = new Map(); // Shared by model dials when Studio recreates an instance.
    this.globalSettings = { scheme: "workbuddy://" };
    this.status = new WorkBuddyStatus(() => {
      for (const action of this.actions.values()) {
        if (action.active && action.uuid === "com.ulanzi.ulanzistudio.workbuddy.voice") return true;
      }
      return false;
    });
    this.status.on("change", snapshot => {
      if (this.lastAgentState !== snapshot.state) {
        this.lastAgentState = snapshot.state;
        this.log("info", "WorkBuddy status: " + snapshot.state);
      }
      for (const action of this.actions.values()) action.onStatus?.();
      this.sendStatus();
    });
    this.t = this.t.bind(this);
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.debugLogPath = path.join(__dirname, "..", "debug.log");
    this.log(
      "info",
      `plugin starting: pid=${process.pid} argv=${JSON.stringify(argv)} ` +
        `platform=${process.platform} node=${process.version}`
    );
  }

  t(key) {
    return (STRINGS[this.lang] && STRINGS[this.lang][key]) || STRINGS.en[key] || key;
  }

  connect() {
    this.ws = new WebSocketClient(`ws://${this.address}:${this.port}`);
    this.ws.on("open", () => {
      this.displayCache.clear();
      this.lastInspectorStatus = null;
      this.reconnectDelay = 1000;
      this.send({
        code: 0,
        cmd: "connected",
        uuid: PLUGIN_UUID,
      });
      // Global settings (scheme) are plugin-wide; request after connect.
      this.requestGlobalSettings();
      for (const action of this.actions.values()) if (action.active) action.onActivated();
    });
    this.ws.on("message", (text) => this.onMessage(text));
    this.ws.on("close", () => this.scheduleReconnect());
    this.ws.on("error", (err) => {
      // Connection errors are expected while the host restarts. The plugin MUST
      // retry, otherwise a handshake timeout (host not yet listening on 3906)
      // kills the plugin permanently and every key press is then dead.
      this.log("warn", `websocket error: ${err && err.message}`);
      this.scheduleReconnect();
    });
    this.ws.connect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(Math.round(this.reconnectDelay * 1.5), 10000);
  }

  send(obj) {
    if (!this.ws) return false;
    if (obj.cmd === "state" && Array.isArray(obj.param?.statelist)) {
      // Every action uses this boundary, including direct GIF and bitmap updates.
      // Re-sending unchanged GIFs can make the host reload an animation.
      const changed = obj.param.statelist.filter(icon =>
        this.displayCache.get(icon.actionid)?.state !== JSON.stringify(icon));
      if (!changed.length) return true;
      const sent = this.ws.sendJson({...obj, param:{...obj.param, statelist:changed}});
      if (sent) for (const icon of changed) {
        const cached = this.displayCache.get(icon.actionid) || {};
        cached.state = JSON.stringify(icon);
        this.displayCache.set(icon.actionid, cached);
      }
      return sent;
    }
    if (obj.cmd === "setFeedback") {
      const signature = JSON.stringify(obj);
      const cached = this.displayCache.get(obj.actionid) || {};
      if (cached.feedback === signature) return true;
      const sent = this.ws.sendJson(obj);
      if (sent) {
        cached.feedback = signature;
        this.displayCache.set(obj.actionid, cached);
      }
      return sent;
    }
    const sent = this.ws.sendJson(obj);
    if (sent && obj.cmd === "setFeedbackLayout") {
      const cached = this.displayCache.get(obj.actionid);
      if (cached) delete cached.feedback;
    }
    return sent;
  }

  onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      this.log("warn", `invalid json message: ${text.slice(0, 200)}`);
      return;
    }
    if (!msg || typeof msg !== "object") return;

    // Lifecycle trace to the file log: key press diagnostics rely on this.
    if (
      msg.cmd === "keydown" ||
      msg.cmd === "keyup" ||
      msg.cmd === "run" ||
      msg.cmd === "dialdown" ||
      msg.cmd === "dialrotate" ||
      msg.cmd === "add" ||
      msg.cmd === "clear"
    ) {
      this.log(
        "info",
        `event: ${msg.cmd} actionid=${msg.actionid} uuid=${msg.uuid} ` +
          `key=${msg.key || ""} controller=${msg.controller || ""}`
      );
    }

    switch (msg.cmd) {
      case "add":
        this.onAdd(msg);
        break;
      case "setactive":
        this.onSetActive(msg);
        break;
      case "clear":
        this.onClear(msg);
        break;
      case "keydown":
        this.onInvoke(msg, "keydown");
        break;
      case "run":
        this.onInvoke(msg, "run");
        break;
      case "keyup":
        this.onKeyUp(msg);
        break;
      case "dialrotate":
        this.onDialRotate(msg);
        break;
      case "dialdown":
        this.onDialDown(msg);
        break;
      case "paramfromapp":
      case "didReceiveSettings":
        this.onSettingsUpdate(msg);
        break;
      case "didReceiveGlobalSettings":
        if (msg.settings && typeof msg.settings === "object") {
          this.globalSettings = Object.assign({}, this.globalSettings, msg.settings);
        }
        break;
      case "sendToPlugin":
        this.onInspectorMessage(msg);
        break;
      default:
        break;
    }
  }

  // -- instance lifecycle ---------------------------------------------------

  onAdd(msg) {
    this.displayCache.delete(msg.actionid);
    const existing = this.actions.get(msg.actionid);
    if (existing) {
      existing.key = msg.key || existing.key;
      existing.updateSettings(msg.param || {});
      existing.setActive(true);
      return;
    }
    const action = createAction(this, msg);
    if (!action) {
      this.log("warn", `unknown action uuid: ${msg.uuid}`);
      return;
    }
    this.actions.set(msg.actionid, action);
    action.onActivated();
    if (!this.globalSettingsRequested) {
      this.globalSettingsRequested = true;
      this.requestGlobalSettings();
    }
  }

  onSetActive(msg) {
    const action = this.actions.get(msg.actionid);
    if (action) {
      this.displayCache.delete(msg.actionid);
      if (msg.param) action.updateSettings(msg.param);
      action.setActive(msg.active);
    }
  }

  onClear(msg) {
    const items = Array.isArray(msg.param) ? msg.param : [];
    items.forEach((item) => {
      const action = this.actions.get(item.actionid);
      if (action) {
        action.destroy();
        this.actions.delete(item.actionid);
        this.displayCache.delete(item.actionid);
      }
    });
  }

  /**
   * Key invocation with de-duplication.
   *
   * Observed on real devices: one physical press delivers BOTH `keydown` and
   * `run` (milliseconds apart), and holding the key repeats `keydown`. Both
   * would launch the deeplink several times, so:
   * - a `run` right after a `keydown` of the same instance is swallowed;
   * - a `keydown` while the key is still held down (no `keyup` yet) is swallowed,
   *   with a stale-state escape hatch in case `keyup` was lost.
   */
  onInvoke(msg, source) {
    const action = this.actions.get(msg.actionid);
    if (!action || typeof action.invoke !== "function") return;
    const now = Date.now();
    const state = action._pressState || (action._pressState = { lastAt: 0, held: false });

    if (source === "keydown") {
      const stillHeld = state.held && now - state.lastAt < STALE_PRESS_MS;
      if (stillHeld) {
        state.lastAt = now;
        this.log("debug", `keydown ignored (auto-repeat) actionid=${msg.actionid}`);
        return;
      }
      state.held = true;
      state.lastAt = now;
      this.invokeSafely(action);
      return;
    }

    // source === "run": duplicates the keydown that preceded it.
    if (now - state.lastAt < RUN_DEDUPE_MS) {
      this.log("debug", `run ignored (duplicate of keydown) actionid=${msg.actionid}`);
      return;
    }
    state.lastAt = now;
    this.invokeSafely(action);
  }

  onKeyUp(msg) {
    const action = this.actions.get(msg.actionid);
    if (action && action._pressState) action._pressState.held = false;
  }

  onDialRotate(msg) {
    const action = this.actions.get(msg.actionid);
    if (action && typeof action.handleDialRotate === "function") {
      action.handleDialRotate(msg.rotateEvent);
    }
  }

  onDialDown(msg) {
    const action = this.actions.get(msg.actionid);
    if (action && typeof action.handleDialDown === "function") {
      Promise.resolve().then(() => action.handleDialDown()).catch(e => this.actionError(action, e));
    }
  }

  onSettingsUpdate(msg) {
    const action = this.actions.get(msg.actionid);
    const settings = msg.settings || msg.param;
    if (action && settings && typeof settings === "object") {
      action.updateSettings(settings);
    }
  }

  // -- host commands ----------------------------------------------------------

  invokeSafely(action) { Promise.resolve().then(() => action.invoke()).catch(e => this.actionError(action, e)); }
  actionError(action, error) { this.toast(error.message); this.showAlert(action); }

  async onInspectorMessage(msg) {
    const request = msg.payload || {};
    const action = this.actions.get(msg.actionid);
    if (!action) return;
    try {
      if (request.type === "restoreTheme" && action.uuid.endsWith(".skin")) {
        const restored = await require("./workbuddy-cdp").command("restoreTheme").catch(() => false);
        this.toast(restored ? (this.lang === "zh" ? "已恢复 WorkBuddy 原生主题" : "Restored the WorkBuddy theme.")
          : (this.lang === "zh" ? "请先连接 WorkBuddy CDP" : "Connect WorkBuddy CDP first."));
        return;
      }
      if (request.type === "enableCdp") {
        if (this.cdpRestarting) return;
        this.cdpRestarting=true; this.cdpRestartError=""; this.sendStatus();
        try { await require("./enable-cdp").enableCdp(this.globalSettings.scheme); }
        catch (e) { this.cdpRestartError=e.message; this.toast(e.message); }
        finally { this.cdpRestarting=false; }
      }
      if (request.type === "openGuide") this.send({ cmd: "openurl", url: "./usage-guide/index.html", local: true, param: { language: this.lang } });
      this.sendStatus(action);
    } catch (e) {
      this.sendStatus(action); this.toast(e.message);
    }
  }

  sendStatus(action) {
    const payload = {type:"status", cdpRestarting:Boolean(this.cdpRestarting),
      cdpRestartError:this.cdpRestartError || "", ...this.status.snapshot()};
    const signature = JSON.stringify(payload);
    // Voice and model changes do not change the setup panel's snapshot.
    // Explicit inspector requests still receive a reply even when unchanged.
    if (!action && signature === this.lastInspectorStatus) return;
    let sent = false;
    for (const item of action ? [action] : this.actions.values()) {
      // Editing an off-page instance still needs a reply; broadcasts stay page-scoped.
      if (action || item.active) {
        sent = this.send({cmd:"sendToPropertyInspector", uuid:item.uuid,
          actionid:item.actionid, key:item.key, payload}) || sent;
      }
    }
    if (!action && sent) this.lastInspectorStatus = signature;
  }

  setStatusIcon(action, state, text) {
    if (!action.active) return;
    const animation = ["thinking", "working", "sweeping"].includes(state) ? "running" : ["attention", "notification", "error"].includes(state) ? "review" : ["idle", "sleeping"].includes(state) ? "spare" : null;
    const icon = { uuid: action.uuid, actionid: action.actionid, key: action.key, type: animation ? 4 : 2, showtext: Boolean(text), ...(text ? {textdata:text} : {}) };
    if (animation) icon.gifpath = "assets/states/" + animation + ".gif";
    else icon.path = "assets/states/offline.png";
    this.send({ cmd: "state", param: { statelist: [icon] } });
  }

  setActionIcon(action, iconPath) {
    if (action.active) this.send({cmd:"state",param:{statelist:[{uuid:action.uuid,actionid:action.actionid,key:action.key,type:2,path:iconPath,showtext:false}]}});
  }

  requestGlobalSettings() {
    // Use the first known action context; the host replies with
    // didReceiveGlobalSettings regardless of which context was used.
    const first = this.actions.values().next();
    const ctx = first.done ? {} : first.value;
    this.send({
      cmd: "getGlobalSettings",
      uuid: PLUGIN_UUID,
      actionid: ctx.actionid,
      key: ctx.key || "",
    });
  }

  toast(msgText) {
    this.send({ cmd: "toast", msg: msgText });
  }

  showAlert(action) {
    this.send({
      cmd: "showAlert",
      uuid: action.uuid,
      actionid: action.actionid,
      key: action.key,
    });
  }

  setFeedback(action, layout) {
    this.send({
      cmd: "setFeedback",
      uuid: action.uuid,
      actionid: action.actionid,
      key: action.key,
      layout,
    });
  }

  setSettings(action, partial) {
    // Merge into the instance settings and persist through the host.
    action.settings = Object.assign({}, action.settings, partial);
    this.send({
      cmd: "setSettings",
      uuid: action.uuid,
      actionid: action.actionid,
      key: action.key,
      settings: action.settings,
    });
  }

  openDownloadPage() {
    this.send({ cmd: "openurl", url: DOWNLOAD_URL, local: false });
  }

  log(level, message) {
    // Mirror to a local file: Ulanzi Studio's own logs are xlog (binary),
    // so debug.log next to the plugin is the reliable diagnostic source.
    try {
      try {
        const stat = fs.statSync(this.debugLogPath);
        if (stat.size > 512 * 1024) fs.unlinkSync(this.debugLogPath);
      } catch (err) {
        /* file absent is fine */
      }
      fs.appendFileSync(
        this.debugLogPath,
        `[${new Date().toISOString()}] [${level}] ${message}\n`
      );
    } catch (err) {
      /* logging must never break the plugin */
    }
    this.send({
      cmd: "logMessage",
      uuid: PLUGIN_UUID,
      message,
      level,
    });
  }

  // -- clipboard (for the {clipboard} placeholder) ----------------------------

  getClipboardText() {
    return new Promise((resolve) => {
      const cmdLine = process.platform === "win32"
        ? { file: "powershell", args: ["-NoProfile", "-Command", "Get-Clipboard"] }
        : { file: "pbpaste", args: [] };
      let child;
      try {
        child = spawn(cmdLine.file, cmdLine.args, { windowsHide: true });
      } catch (err) {
        resolve(undefined);
        return;
      }
      let out = "";
      const timer = setTimeout(() => {
        child.kill();
        this.toast(this.lang === "zh" ? "剪贴板读取超时，保留占位符" : "Clipboard timed out; placeholder kept");
        resolve(undefined);
      }, 1500);
      child.stdout && child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) this.toast(this.lang === "zh" ? "无法读取剪贴板，保留占位符" : "Cannot read clipboard; placeholder kept");
        resolve(code === 0 ? out : undefined);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }
}

if (require.main === module) {
  const app = new PluginApp();
  try { require("./migrate-settings").removeLegacyEntries(); }
  catch (e) { app.log("error", "WorkBuddy settings migration: " + e.message); }
  app.status.start().catch(e => { app.log("error", "Status startup: " + e.message); });
  app.connect();
  const stop = async () => { await app.status.stop(); process.exit(0); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
module.exports = { PluginApp };

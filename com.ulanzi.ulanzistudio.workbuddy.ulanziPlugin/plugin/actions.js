"use strict";

/**
 * Action implementations for the WorkBuddy plugin.
 * One class per action; instances are cached by actionid in app.js.
 */

const deeplink = require("./deeplink");
const { modelSvg } = require("./model-art");

class BaseAction {
  constructor(app, event) {
    this.app = app;
    this.uuid = event.uuid;
    this.actionid = event.actionid;
    this.key = event.key || "";
    this.controller = event.controller || "Keypad";
    this.device = event.device || "";
    this.active = true;
    this.settings = {};
    this.updateSettings(event.param || {});
  }

  /** Persisted settings from add / paramfromapp / didReceiveSettings. */
  updateSettings(param) {
    this.settings = Object.assign({}, this.settings, param || {});
    this.onSettings();
  }

  onSettings() {}

  setActive(active) {
    this.active = active !== false;
    if (this.active) this.onActivated();
  }

  onActivated() {}

  destroy() {}

  get scheme() {
    return deeplink.normalizeScheme(this.app.globalSettings.scheme);
  }

  /** Launch a deeplink with install-detection and localized feedback. */
  async launch(url, successMsg) {
    const t = this.app.t;
    try {
      const exists = await deeplink.schemeExists(this.scheme);
      if (!exists) {
        this.app.toast(t("notInstalled"));
        this.app.showAlert(this);
        this.app.openDownloadPage();
        return;
      }
      await deeplink.launchDeepLink(url);
      this.app.log("info", `launched: ${new URL(url).host}`);
      if (successMsg) this.app.toast(successMsg);
    } catch (err) {
      this.app.log("error", `launch failed: ${err && err.message}`);
      const notInstalled = err?.code === "SCHEME_NOT_REGISTERED";
      this.app.toast(t(notInstalled ? "notInstalled" : "launchFailed"));
      this.app.showAlert(this);
      if (notInstalled) this.app.openDownloadPage();
    }
  }
}

/** P0-1 Wake WorkBuddy (workbuddy://home, or a direct page). */
class WakeAction extends BaseAction {
  onActivated() { this.onStatus(); }
  onStatus() { this.app.setStatusIcon(this, this.app.status.state); }
  async invoke() {
    const target = String(this.settings.target || "home");
    const url =
      target === "home"
        ? deeplink.buildHomeUrl(this.scheme)
        : deeplink.buildPageUrl(this.scheme, target, this.settings.taskId);
    this.app.setStatusIcon(this, "thinking");
    try { await this.launch(url); }
    finally { this.onStatus(); }
  }
}

/** P0-2 New Task with prefilled draft (never auto-sent). */
class NewTaskAction extends BaseAction {
  async invoke() {
    const prompt = await deeplink.resolvePlaceholders(
      this.settings.promptTemplate || this.settings.prompt,
      () => this.app.getClipboardText()
    );
    const url = deeplink.buildTaskUrl(this.scheme, this.settings, prompt);
    const clamped = deeplink.clampPrompt(prompt);
    const msg = clamped.truncated
      ? this.app.t("promptTruncated")
      : prompt
        ? this.app.t("taskPrefilled")
        : undefined;
    return this.launch(url, msg);
  }
}

/** P0-3 Open Page (page-direct deeplinks). */
class OpenPageAction extends BaseAction {
  onSettings() { this.onActivated(); }
  onActivated() {
    const icons = {home:"首页",chat:"按ID打开任务",projects:"项目",experts:"专家",skills:"技能",connectors:"连接器",automation:"定时任务",claw:"本地助理",discover:"灵感社区","tencent-docs":"腾讯文档","my-files":"本地文件",ima:"ima",lexiang:"乐享知识库","agent-mail":"我的邮箱"};
    this.app.setActionIcon(this, "assets/pages/" + (icons[this.settings.page || "home"] || "打开页面") + ".png");
  }
  invoke() {
    const url = deeplink.buildPageUrl(
      this.scheme,
      this.settings.page || "home",
      this.settings.taskId
    );
    return this.launch(url);
  }
}

/** P1-4 Model Switch on the encoder: rotate to select, push to confirm. */
class ModelSwitchAction extends BaseAction {
  constructor(app, event) {
    super(app, event);
    this.index = this.index || 0;
  }

  onSettings() {
    this.models = this.parseModels(this.settings.models);
    if (!Number.isInteger(this.index) || this.index >= this.models.length) this.index = 0;
    const last = Number(this.settings.lastIndex);
    if (Number.isInteger(last) && last >= 0 && last < this.models.length) {
      this.index = last;
    }
    this.pushFeedback();
  }

  parseModels(raw) {
    if (!raw) return [];
    return String(raw)
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        const id = (parts[0] || "").trim();
        const name = (parts[1] || "").trim() || id;
        return { id, name };
      })
      .filter((item) => item.id)
      .filter((item, index, all) => all.findIndex((m) => m.id === item.id) === index)
      .slice(0, deeplink.MAX_ARRAY_ITEMS);
  }

  onActivated() {
    // An existing encoder instance may still carry the geometry of an older layout.
    this.app.send({ cmd:"setFeedbackLayout", uuid:this.uuid, actionid:this.actionid, key:this.key,
      layout:"layouts/model-encoder.json" });
    this.onStatus();
    this.pushFeedback();
  }
  onStatus() {
    const {model, session, cdpState} = this.app.status;
    if (this.observedModel === model && this.observedSession === session && this.wasConnected === Boolean(cdpState)) return;
    this.observedModel = model;
    this.observedSession = session;
    this.wasConnected = Boolean(cdpState);
    this.syncGeneration = (this.syncGeneration || 0) + 1;
    const switched = this.live && this.live.session !== session;
    if (switched || !cdpState || !model) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }
    if (!switched && this.applyTimer && cdpState && model) return;
    this.live = null;
    // Approval panels can temporarily hide both the composer and the selected row.
    const cached = session ? this.app.sessionModelCards.get(session) : this.currentCard;
    this.currentCard = cached && (!model || cached.name === model) ? cached : null;
    this.currentLabel = model || this.currentCard?.name;
    if (model && !this.currentCard) this.rememberCard({session, name:model});
    this.pushFeedback();
    if (model && cdpState) this.syncLabel();
  }
  async syncLabel() {
    if (!this.active || !this.app.status.cdpState) return;
    const generation = this.syncGeneration;
    const card = await cdp.command("currentCard").catch(() => null);
    if (!card?.name || !this.active || generation !== this.syncGeneration || this.live ||
        card.session !== this.app.status.session || (this.app.status.model && card.name !== this.app.status.model)) return;
    this.rememberCard(card);
    this.pushFeedback();
  }

  rememberCard(card) {
    this.currentLabel = card.name;
    this.currentCard = card;
    if (!card.session) return;
    const cards = this.app.sessionModelCards;
    cards.delete(card.session);
    cards.set(card.session, card);
    if (cards.size > 16) cards.delete(cards.keys().next().value);
  }

  current() {
    return this.models[this.index] || null;
  }

  pushFeedback() {
    if (!this.active) return;
    const model = this.current();
    const name = this.live?.names[this.liveIndex] || this.currentLabel || model?.name || (this.app.lang === "zh" ? "模型" : "Models");
    let picture = this.live?.pictures?.[name];
    if (!picture && this.currentCard?.name === name) picture = this.currentCard.picture;
    if (!picture) picture = "data:image/svg+xml;base64," + Buffer.from(modelSvg(name)).toString("base64");
    this.app.setFeedback(this, {icon:{value:picture}});
  }

  // Serialize fast turns with the following press, so it applies the displayed candidate.
  enqueue(fn) {
    this.queue=(this.queue || Promise.resolve()).then(fn).catch(e=>this.app.actionError(this,e));
    return this.queue;
  }
  async loadLive() {
    const session = this.app.status.session;
    const result = await cdp.command("models").catch(() => cdp.command("models")).catch(() => null);
    if(!result?.names?.length)throw Error(this.app.lang==="zh"?"请在 WorkBuddy 打开任务输入页并启用 CDP":"Open the WorkBuddy composer and enable CDP.");
    if (!this.active || this.app.status.session !== session || (session && result.session !== session)) throw Error(this.app.lang === "zh" ? "会话已切换，请重新选择模型" : "Chat changed. Select the model again.");
    this.live=result; this.liveIndex=Math.max(0,result.names.indexOf(result.selected)); this.liveAt=Date.now();
  }
  handleDialRotate(rotateEvent) {
    if(this.app.status.cdpState || !this.models.length) return this.enqueue(async()=>{
      if(!this.live || Date.now()-this.liveAt>15000)await this.loadLive();
      const n=this.live.names.length;
      this.liveIndex=(this.liveIndex+(/left$/.test(rotateEvent)?-1:1)+n)%n;this.liveAt=Date.now();this.pushFeedback();
      this.scheduleApply();
    });
    this.live=null;
    if (!this.models.length) {
      this.pushFeedback();
      return;
    }
    const dir = rotateEvent === "left" || rotateEvent === "hold-left" ? -1 : 1;
    this.index = (this.index + dir + this.models.length) % this.models.length;
    this.pushFeedback();
    this.app.setSettings(this, { lastIndex: this.index });
    this.scheduleApply();
  }

  scheduleApply() {
    clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      if (this.active) this.handleDialDown()?.catch?.(e => this.app.actionError(this,e));
    }, 220);
  }

  setActive(active) {
    if (active === false) { clearTimeout(this.applyTimer); this.applyTimer = null; }
    super.setActive(active);
  }

  destroy() {
    this.active = false;
    clearTimeout(this.applyTimer);
  }

  handleDialDown() {
    clearTimeout(this.applyTimer);
    this.applyTimer = null;
    if(this.live || this.app.status.cdpState || !this.models.length) return this.enqueue(async()=>{
      clearTimeout(this.applyTimer);
      if (!this.active) return;
      if(!this.live)await this.loadLive();
      const menu = this.live;
      const name=menu.names[this.liveIndex];
      try {
        if (!await cdp.command("selectModel",name,menu.session)) throw Error("Model selection failed");
        if (menu.session === this.app.status.session) this.rememberCard({session:menu.session, name, picture:menu.pictures?.[name]});
      } catch {
        this.live = null;
        await this.syncLabel();
        throw Error(this.app.lang === "zh" ? "模型未切换，请检查 WorkBuddy 的任务输入页" : "Model not switched. Check the WorkBuddy composer.");
      } finally {
        this.pushFeedback();
      }
    });
    const model = this.current();
    if (!model) {
      this.app.toast(this.app.t("configureModels"));
      return;
    }
    // Remember selection across reconnects (non-active instances are not saved,
    // the push happens right after dial events which imply an active instance).
    this.app.setSettings(this, { lastIndex: this.index });
    const url = deeplink.buildSwitchModelUrl(this.scheme, model.id);
    return this.launch(url, `${this.app.t("modelSelected")}${model.name}`);
  }
}

/** P2-5 Skill Install (client-side confirmation still required). */
class SkillInstallAction extends BaseAction {
  invoke() {
    let url;
    try { url = deeplink.buildSkillInstallUrl(this.scheme, this.settings); }
    catch (_) {
      this.app.toast(this.app.t("skillFieldsRequired"));
      this.app.showAlert(this);
      return;
    }
    return this.launch(url);
  }
}

class CreditsAction extends BaseAction {
  onActivated() {
    this.revision = this.revision || 0;
    this.connected = false;
    if (this.controller === "Encoder") this.app.send({cmd:"setFeedbackLayout",
      uuid:this.uuid, actionid:this.actionid, key:this.key, layout:"layouts/credits-encoder.json"});
    // A layout or page activation can reset the host's image while a balance
    // request is failing. Repaint the last confirmed balance on activation.
    if (this.app.status.cdpState && this.balancePicture) this.drawBalance(this.balancePicture);
    this.onStatus();
  }
  onStatus() {
    if (!this.active) { this.destroy(); return; }
    const connected = Boolean(this.app.status.cdpState);
    if (!connected) {
      this.connected = false;
      this.balancePicture = null;
      clearTimeout(this.timer);
      this.revision++;
      this.drawBalance();
    } else if (!this.connected) {
      this.connected = true;
      this.refreshCredits();
    }
  }
  async refreshCredits() {
    if (!this.active || this.busy) return;
    clearTimeout(this.timer);
    this.busy = true;
    const revision = this.revision;
    let refreshed = false;
    try {
      const result = await cdp.command("credits", {language:this.app.lang, encoder:this.controller === "Encoder"});
      if (!this.active || revision !== this.revision || !this.app.status.cdpState) return;
      if (result?.picture) {
        this.balancePicture = result.picture;
        this.drawBalance(this.balancePicture);
        refreshed = true;
      } else if (!this.balancePicture) this.drawBalance();
    } catch (_) {
      if (this.active && revision === this.revision && !this.balancePicture) this.drawBalance();
    } finally {
      this.busy = false;
      // CDP can connect before the account adapter is ready; do not wait a full refresh cycle.
      if (this.active && this.app.status.cdpState) this.timer = setTimeout(() => this.refreshCredits(), revision === this.revision ? (refreshed ? 30000 : 1000) : 0);
    }
  }
  drawBalance(picture) {
    if (this.controller === "Encoder") {
      this.app.setFeedback(this, {icon:{value:picture || "assets/actions/credits-dial.png"}});
    } else if (picture) {
      this.app.send({cmd:"state", param:{statelist:[{uuid:this.uuid, actionid:this.actionid,
        key:this.key, type:1, data:picture, showtext:false}]}});
    } else this.app.setActionIcon(this, "assets/actions/credits-unavailable.png");
  }
  handleDialDown() { return this.invoke(); }
  invoke() {
    if (!this.app.status.cdpState) throw Error(this.app.lang === "zh" ? "请在属性栏点击「重启 WorkBuddy」连接 CDP" : "Choose Restart WorkBuddy in setup to connect CDP.");
    return this.refreshCredits();
  }
  destroy() {
    this.active = false;
    clearTimeout(this.timer);
    this.revision = (this.revision || 0) + 1;
  }
}

class LaunchAction extends BaseAction {
  async invoke() {
    await require("./enable-cdp").enableCdp(this.scheme);
    await this.app.status.refresh?.();
  }
}

class StatusAction extends BaseAction {
  onActivated() { this.onStatus(); }
  onSettings() { this.onStatus(); }
  onStatus() { this.app.setStatusIcon(this, this.app.status.state); }
  invoke() { return this.launch(deeplink.buildHomeUrl(this.scheme)); }
}

class CurrentSessionAction extends BaseAction {
  onActivated() {
    this.app.send({cmd:"setFeedbackLayout", uuid:this.uuid, actionid:this.actionid, key:this.key, layout:"layouts/session-encoder.json"});
    this.onStatus();
  }
  onStatus() {
    if (!this.active) return;
    const {approval, cdpState, session, cdpTasks} = this.app.status;
    if (this.token !== approval?.token) {
      this.token = approval?.token;
      this.choice = approval?.choices[0];
    }
    if (approval && !approval.choices.includes(this.choice)) this.choice = approval.choices[0];
    const task = cdpTasks?.find(row => row.session === session);
    const state = cdpState === "idle" ? (task?.state || "idle") : cdpState;
    let picture;
    if (approval && this.choice) {
      const language = this.app.lang === "zh" ? "zh" : "en";
      const order = ["allow_once", "allow_session", "deny"];
      const mask = order.reduce((bits, choice, index) => approval.choices.includes(choice) ? bits | (1 << index) : bits, 0);
      const variant = mask === 7 ? "" : "-" + mask;
      picture = "assets/session/" + language + "-" + this.choice + variant + ".png";
    } else {
      const icon = !cdpState ? "offline" : ["working","thinking"].includes(state) ? "running" :
        ["attention","notification","error"].includes(state) ? "review" : "spare";
      picture = "assets/session/" + icon + ".png";
    }
    this.app.setFeedback(this, {icon:{value:picture}});
  }
  handleDialRotate(direction) {
    const prompt = this.app.status.approval;
    if (!this.active || this.busy || !prompt || this.token !== prompt.token || !["left","right"].includes(direction)) return;
    const next = prompt.choices.indexOf(this.choice) + (direction === "left" ? -1 : 1);
    this.choice = prompt.choices[Math.max(0, Math.min(prompt.choices.length - 1, next))];
    this.onStatus();
  }
  async handleDialDown() {
    if (!this.active || this.busy || !this.token || this.token !== this.app.status.approval?.token) return;
    this.busy = true;
    try {
      if (!await cdp.command("decide", this.choice, this.token)) {
        throw Error(this.app.lang === "zh" ? "审批已变化，请查看当前会话" : "Approval changed. Check the current chat.");
      }
    } finally { this.busy = false; }
  }
}

/** Capture exactly what was drawn before awaiting OS launch; never reselect after an async refresh. */
class TaskAction extends BaseAction {
  onActivated() { this.onStatus(); }
  onSettings() { this.onStatus(); }
  onStatus() {
    if (!this.active) return;
    this.slot = Number(this.uuid.slice(-1));
    this.displayedTask = this.app.status.taskSlots()[this.slot-1] || null;
    const task = this.displayedTask;
    const label = (this.app.lang === "zh" ? "任务 " : "Task ") + this.slot;
    const title = task?.title ? Array.from(task.title) : [];
    const subtitle = title.length ? title.slice(0,12).join("") + (title.length>12 ? "…" : "") : task?.session.slice(0,8);
    this.app.setStatusIcon(this, !this.app.status.cdpState ? "offline" : task?.state || "idle", task ? `${label}\n${subtitle}` : label);
  }
  invoke() {
    const task = this.displayedTask;
    if (!task || !this.app.status.cdpState) {
      this.app.toast(this.app.lang === "zh" ? "此任务位暂无会话，请在 WorkBuddy 发送消息后再试" : "No session in this slot. Send a message in WorkBuddy first.");
      return;
    }
    return this.launch(deeplink.buildPageUrl(this.scheme,"chat",task.session));
  }
}

const cdp = require("./workbuddy-cdp");
class ComposerAction extends BaseAction {
  get kind() { return this.uuid.split(".").pop(); }
  onActivated() {
    this.drawn = null;
    this.onStatus();
    if (this.kind === "voice") this.app.status.watchVoice();
  }
  onStatus() {
    if (!this.active) return;
    const state = this.app.status[this.kind] || "unavailable";
    const session = this.app.status.session;
    this.session = session;
    this.draw(state);
  }
  draw(state) {
    if (this.drawn === state) return;
    this.drawn = state;
    if (this.kind === "voice" && state === "recording") {
      this.app.send({cmd:"state", param:{statelist:[{uuid:this.uuid, actionid:this.actionid,
        key:this.key, type:4, gifpath:"assets/composer/voice-recording.gif", showtext:false}]}});
    } else {
      this.app.setActionIcon(this, "assets/composer/" + this.kind + "-" + state + ".png");
    }
  }
  async invoke() {
    if (!this.active || this.busy || !["ready","recording"].includes(this.drawn)) return;
    this.busy = true;
    try {
      const expected = {session:this.session ?? "", state:this.drawn};
      const done = await cdp.command(this.kind, expected);
      if (this.kind === "voice") this.app.status.refreshVoice();
      if (!done) this.app.showAlert(this);
    } finally { this.busy = false; }
  }
}

class CdpAction extends BaseAction {
  async invoke() {
    if (this.busy) return;
    this.busy = true;
    const op = this.uuid.split(".").pop(), zh = this.app.lang === "zh";
    try {
      if (op === "skin" && !cdp.jpeg(this.settings.image)) throw Error(zh ? "请先在按键设置中选择图片" : "Choose an image in key settings first.");
      const result = await cdp.command(op === "skin" ? "toggleTheme" : op, op === "skin" ? this.settings.image : undefined, this.settings.palette).catch(() => null);
      if (result === null) throw Error(zh ? "未连接 WorkBuddy CDP（127.0.0.1:9223）" : "WorkBuddy CDP unavailable (127.0.0.1:9223).");
      if (!result) throw Error(zh ? "未找到唯一可操作的审批，请在 WorkBuddy 中查看" : "No unique actionable approval. Check WorkBuddy.");
    } finally { this.busy = false; }
  }
}
class SkinAction extends CdpAction {
  onSettings() { this.onActivated(); }
  onActivated() {
    if (this.active && cdp.jpeg(this.settings.thumbnail) && this.settings.thumbnail.length < 24000)
      this.app.send({cmd:"state",param:{statelist:[{uuid:this.uuid,actionid:this.actionid,key:this.key,type:1,data:this.settings.thumbnail,showtext:false}]}});
  }
}
const ACTION_CLASSES = {
  "com.ulanzi.ulanzistudio.workbuddy.credits": CreditsAction,
  "com.ulanzi.ulanzistudio.workbuddy.launch": LaunchAction,
  "com.ulanzi.ulanzistudio.workbuddy.voice": ComposerAction,
  "com.ulanzi.ulanzistudio.workbuddy.send": ComposerAction,
  "com.ulanzi.ulanzistudio.workbuddy.skin": SkinAction,
  "com.ulanzi.ulanzistudio.workbuddy.currentsession": CurrentSessionAction,
  "com.ulanzi.ulanzistudio.workbuddy.wake": WakeAction,
  "com.ulanzi.ulanzistudio.workbuddy.newtask": NewTaskAction,
  "com.ulanzi.ulanzistudio.workbuddy.openpage": OpenPageAction,
  "com.ulanzi.ulanzistudio.workbuddy.modelswitch": ModelSwitchAction,
  "com.ulanzi.ulanzistudio.workbuddy.skillinstall": SkillInstallAction,
  "com.ulanzi.ulanzistudio.workbuddy.status": StatusAction,
};
for (let i=1;i<=5;i++) ACTION_CLASSES[`com.ulanzi.ulanzistudio.workbuddy.task${i}`] = TaskAction;

function createAction(app, event) {
  const Cls = ACTION_CLASSES[event.uuid];
  if (!Cls) return null;
  return new Cls(app, event);
}

module.exports = { createAction, ACTION_CLASSES };

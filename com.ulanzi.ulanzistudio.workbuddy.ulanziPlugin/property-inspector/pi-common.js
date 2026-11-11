/**
 * Shared Property Inspector runtime for the WorkBuddy plugin.
 * Handles: WebSocket lifecycle, persisted settings sync (setSettings /
 * didReceiveSettings), global scheme setting, and label localization
 * from en.json / zh_CN.json.
 */
(function () {
  "use strict";

  const qs = new URLSearchParams(window.location.search);
  const ADDRESS = qs.get("address") || "127.0.0.1";
  const PORT = qs.get("port") || "3906";
  const ACTIONID = qs.get("actionid") || "";
  const KEY = qs.get("key") || "";
  const UUID = qs.get("uuid") || "com.ulanzi.ulanzistudio.workbuddy";
  const LANG = (qs.get("language") || "en").toLowerCase().startsWith("zh")
    ? "zh_CN"
    : "en";

  let ws = null;
  let form = null;
  let settings = {};
  let reconnectTimer = null;
  let statusTimer;
  const zh = LANG === "zh_CN";
  const stateLabels = zh ? {offline:"未启动",idle:"待机",thinking:"思考中",working:"执行中",attention:"已完成 · 待查看",notification:"等待确认",error:"异常",sweeping:"整理上下文",sleeping:"休眠"} : {offline:"Not running",idle:"Idle",thinking:"Thinking",working:"Working",attention:"Done · review",notification:"Needs confirmation",error:"Error",sweeping:"Compacting",sleeping:"Sleeping"};
  const message = payload => send({cmd:"sendToPlugin", uuid:UUID, actionid:ACTIONID, key:KEY, payload});

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  function getFormValue(root) {
    const values = {};
    root.querySelectorAll("[name]").forEach((el) => {
      values[el.name] = el.value;
    });
    return values;
  }

  function setFormValue(values, root) {
    root.querySelectorAll("[name]").forEach((el) => {
      if (Object.prototype.hasOwnProperty.call(values, el.name)) {
        el.value = values[el.name] == null ? "" : String(values[el.name]);
      }
    });
    onFormFilled && onFormFilled(values);
  }

  // Per-page hook (e.g. conditional fields), set by page scripts.
  let onFormFilled = null;
  window.WorkBuddyPI = { restoreTheme() { message({type:"restoreTheme"}); }, saveFields(fields) { if (!ws || ws.readyState !== WebSocket.OPEN) throw Error("Studio disconnected"); settings = Object.assign({},settings,fields); send({cmd:"setSettings",uuid:UUID,actionid:ACTIONID,key:KEY,settings}); }, setFormFilledHook(fn) { onFormFilled = fn; } };

  function saveSettings() {
    if (!form) return;
    const values = getFormValue(form);
    for (const name of ["skills", "connectorIds", "models"]) {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) continue;
      const items = [...new Set(field.value.split(name === "models" ? /\n/ : /[,\n]/).map(s => (name === "models" ? s.split("|")[0] : s).trim()).filter(Boolean))];
      field.setCustomValidity(items.length > 20 ? (zh ? "最多 20 项" : "At most 20 items") : "");
      if (!field.reportValidity()) return;
    }
    settings = Object.assign({}, settings, values);
    send({
      cmd: "setSettings",
      uuid: UUID,
      actionid: ACTIONID,
      key: KEY,
      settings,
    });
  }

  const saveSettingsDebounced = debounce(saveSettings, 350);

  function connect() {
    ws = new WebSocket(`ws://${ADDRESS}:${PORT}`);
    ws.onopen = () => {
      send({ code: 0, cmd: "connected", uuid: UUID, actionid: ACTIONID, key: KEY });
      send({ cmd: "getSettings", uuid: UUID, actionid: ACTIONID, key: KEY });
      send({ cmd: "getGlobalSettings", uuid: UUID, actionid: ACTIONID, key: KEY });
      message({type:"getStatus"});
      clearInterval(statusTimer); statusTimer = setInterval(() => message({type:"getStatus"}), 2000);
    };
    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (err) {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      switch (msg.cmd) {
        case "add":
        case "paramfromapp":
          if (msg.param && typeof msg.param === "object") {
            settings = Object.assign({}, settings, msg.param);
            setFormValue(settings, form);
          }
          break;
        case "didReceiveSettings":
          if (msg.settings && typeof msg.settings === "object") {
            settings = Object.assign({}, settings, msg.settings);
            setFormValue(settings, form);
          }
          break;
        case "didReceiveGlobalSettings":
          if (msg.settings && msg.settings.scheme) {
            const schemeEl = document.getElementById("scheme");
            if (schemeEl && document.activeElement !== schemeEl) {
              schemeEl.value = msg.settings.scheme;
            }
          }
          break;
        case "sendToPropertyInspector": {
          if (msg.payload?.type === "status") window.WorkBuddySetup.render(msg.payload);
          if (msg.payload?.type === "status" && /\.task[1-5]$/.test(UUID)) {
            const n=Number(UUID.slice(-1)), task=msg.payload.tasks?.[n-1];
            document.getElementById("task-name").textContent=(zh?"任务 ":"Task ")+n;
            document.getElementById("task-state").textContent=task ? `${task.title || task.session} · ${stateLabels[task.state] || task.state}` : (zh?"暂无会话":"No session yet");
          }
          break;
        }
        default:
          break;
      }
    };
    ws.onclose = () => {
      clearInterval(statusTimer); window.WorkBuddySetup.disconnected();
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    };
    ws.onerror = () => {};
  }

  function bindGlobalScheme() {
    const schemeEl = document.getElementById("scheme");
    if (!schemeEl) return;
    schemeEl.addEventListener("change", () => {
      send({
        cmd: "setGlobalSettings",
        uuid: UUID,
        actionid: ACTIONID,
        key: KEY,
        settings: { scheme: schemeEl.value },
      });
    });
  }

  function applyLocalization() {
    fetch(`../../${LANG}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json || !json.Localization) return;
        const dict = json.Localization;
        document.querySelectorAll("[data-i18n]").forEach((el) => {
          const keyName = el.getAttribute("data-i18n");
          if (dict[keyName]) el.textContent = dict[keyName];
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
          const keyName = el.getAttribute("data-i18n-placeholder");
          if (dict[keyName]) el.setAttribute("placeholder", dict[keyName]);
        });
        document.querySelectorAll("option[data-page-key]").forEach((el) => {
          const keyName = el.getAttribute("data-page-key");
          if (dict[keyName]) el.textContent = dict[keyName];
        });
      })
      .catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", () => {
    form = document.getElementById("property-inspector");
    if (form) {
      for (const row of form.querySelectorAll(".sdpi-item")) {
        const label = row.querySelector("label"), field = row.querySelector("input,select,textarea");
        if (label && field) { field.id ||= "field-" + field.name; label.htmlFor = field.id; }
      }
      form.addEventListener("input", saveSettingsDebounced);
      form.addEventListener("change", saveSettingsDebounced);
    }
    bindGlobalScheme();
    if (/\.(wake|status|modelswitch|launch|credits|skin|currentsession|voice|send|task[1-5])$/.test(UUID)) window.WorkBuddySetup.init({ zh, message, stateLabels, mode: UUID.endsWith(".wake") ? "optional" : "full" });
    else {
      const help = document.createElement("button"); help.type="button"; help.className="guide-link"; help.textContent=zh?"使用说明":"Usage guide";
      help.addEventListener("click",()=>message({type:"openGuide"})); document.body.append(help);
    }
    connect();
    if (/\.task[1-5]$/.test(UUID)) document.getElementById("task-help").textContent=zh?"按 WorkBuddy 最近活动顺序显示已加载的五个任务，按键打开对应会话。":"Show the five most recent loaded WorkBuddy tasks. Press to open the displayed chat.";
    applyLocalization();
  });
})();

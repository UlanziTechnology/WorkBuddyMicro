/**
 * Shared Property Inspector runtime for the WorkBuddy plugin.
 * Handles: WebSocket lifecycle, persisted settings sync (setSettings /
 * didReceiveSettings), global scheme setting, and label localization
 * from official locale JSON files.
 */
(function () {
  "use strict";

  const qs = new URLSearchParams(window.location.search);
  const ADDRESS = qs.get("address") || "127.0.0.1";
  const PORT = qs.get("port") || "3906";
  const ACTIONID = qs.get("actionid") || "";
  const KEY = qs.get("key") || "";
  const UUID = qs.get("uuid") || "com.ulanzi.ulanzistudio.workbuddy";
  const LANG = WorkBuddyI18n.normalize(qs.get("language"));
  let localization;
  const ready = WorkBuddyI18n.load(LANG, new URL("../../",location.href)).then(value => {
    localization=value;document.documentElement.lang=WorkBuddyI18n.tag(LANG);return value;
  });
  const t = (key,values) => localization ? localization.t(key,values) : key;

  let ws = null;
  let form = null;
  let settings = {};
  let reconnectTimer = null;
  let statusTimer;
  const stateLabels = {};
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
  window.WorkBuddyPI = { ready, t, restoreTheme() { message({type:"restoreTheme"}); }, saveFields(fields) { if (!ws || ws.readyState !== WebSocket.OPEN) throw Error(t("studioDisconnected")); settings = Object.assign({},settings,fields); send({cmd:"setSettings",uuid:UUID,actionid:ACTIONID,key:KEY,settings}); }, setFormFilledHook(fn) { onFormFilled = fn; } };

  function saveSettings() {
    if (!form) return;
    const values = getFormValue(form);
    for (const name of ["skills", "connectorIds", "models"]) {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) continue;
      const items = [...new Set(field.value.split(name === "models" ? /\n/ : /[,\n]/).map(s => (name === "models" ? s.split("|")[0] : s).trim()).filter(Boolean))];
      field.setCustomValidity(items.length > 20 ? (t("limitItems")) : "");
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
            document.getElementById("task-name").textContent=t("taskLabel",{n});
            document.getElementById("task-state").textContent=task ? `${task.title || task.session} · ${stateLabels[task.state] || task.state}` : (t("noSessionYet"));
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
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent=t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.setAttribute("placeholder",t(el.getAttribute("data-i18n-placeholder"))); });
    document.querySelectorAll("option[data-page-key]").forEach(el => { el.textContent=t(el.getAttribute("data-page-key")); });
    const titleKey="action_"+UUID.split(".").pop();
    if(t(titleKey)!==titleKey)document.title=t(titleKey);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await ready;
    for(const state of ["offline","idle","thinking","working","attention","notification","error","sweeping","sleeping"])stateLabels[state]=t("state_"+state);
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
    if (/\.(modelswitch|launch|credits|skin|currentsession|voice|send|task[1-5])$/.test(UUID)) window.WorkBuddySetup.init({ t, message, stateLabels });
    else {
      const help = document.createElement("button"); help.type="button"; help.className="guide-link"; help.textContent=t("guide");
      help.addEventListener("click",()=>message({type:"openGuide"})); document.body.append(help);
    }
    connect();
    if (/\.task[1-5]$/.test(UUID)) document.getElementById("task-help").textContent=t("taskHelp");
    if (/\.task[1-5]$/.test(UUID)) document.getElementById("task-name").textContent=t("taskLabel",{n:Number(UUID.slice(-1))});
    applyLocalization();
  });
})();

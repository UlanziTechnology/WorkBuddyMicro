"use strict";
const { WebSocketClient } = require("../libs/ws-client");

// Only connect to the WorkBuddy renderer on Skin Studio's fixed loopback port.
const { drawModelCard, modelSvg } = require("./model-art");
const { drawCreditsCard, creditGlyphData } = require("./credits-art");
const { samplePalette } = require("./skin-palette");
const { readQuestionPanel } = require("./question-panel");
const { applyTheme } = require("./skin-theme");
const endpoint = "http://127.0.0.1:9223";
const renderer = /^file:\/\/\/[^?#]*(?:\/WorkBuddy(?:%20AI| AI)?\.app\/Contents\/Resources|\/WorkBuddy(?:%20AI| AI)?\/resources)\/app\.asar\/renderer\/index\.html(?:[?#]|$)/i;
async function target() {
  const response = await fetch(endpoint + "/json/list", {redirect:"error",signal:AbortSignal.timeout(900)});
  if (!response.ok) throw Error("CDP unavailable");
  const pages = (await response.json()).filter(p => p.type === "page" && renderer.test(p.url));
  if (pages.length !== 1) throw Error("No unique WorkBuddy renderer");
  const ws = new URL(pages[0].webSocketDebuggerUrl);
  if (ws.origin !== "ws://127.0.0.1:9223" || ws.pathname !== "/devtools/page/" + pages[0].id) throw Error("Unexpected CDP target");
  return ws.href;
}

// Runs inside the verified renderer. Query only known controls; never match chat text.
async function renderCommand(op, image, drawCard, applySkin, palette, sampler, questionPanel) {
  if (!document.getElementById("root")) return null;
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
  const session = () => document.querySelector('.cb-agent-card[data-conversation-id][data-selected="true"],.cb-agent-card[data-conversation-id][class*="_selected_"],.conversation-item [aria-selected=true][data-conversation-id]')?.dataset.conversationId || "";
  if (op === "credits") {
    // Read the same adapter as WorkBuddy's account menu. Do not confuse turn
    // consumption labels with the account's remaining credit balance.
    const element = document.getElementById("root").firstElementChild;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    let adapter;
    for (let fiber = element?.[fiberKey]; fiber; fiber = fiber.return) {
      const value = fiber.memoizedProps?.value;
      if (typeof value?.getAccountUsage === "function") { adapter = value; break; }
    }
    if (!adapter) return null;
    const account = await adapter.getAccountUsage();
    const raw = account?.usageLeft;
    const balance = (typeof raw === "number" || (typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw))) ? Number(raw) : NaN;
    if (!Number.isFinite(balance) || balance < 0) return null;
    return {balance, picture:await drawCard(balance, image?.language === "zh" ? "zh" : "en")};
  }
  if (op === "currentModel" || op === "currentCard") {
    const labels=[...document.querySelectorAll(".cr-model-selector__trigger-label")].filter(visible);
    if (labels.length !== 1) return null;
    const name = labels[0].textContent.trim();
    if (op === "currentModel") return name;
    const icon = labels[0].closest("button")?.querySelector(".cr-model-selector__trigger-icon :is(img,svg)");
    return {name, session: session(), picture: await drawCard(name, icon)};
  }
  if (op === "models" || op === "selectModel") {
    const triggers=[...document.querySelectorAll("button.cr-model-selector__trigger")].filter(visible);
    if(triggers.length!==1)return null;
    const trigger=triggers[0], menu=()=>[...document.querySelectorAll(".cr-model-selector__menu")].find(visible);
    const sourceSession = session();
    const opened=!menu(); if(opened) trigger.click();
    // Background Electron windows throttle page timers. Observe the menu commit directly.
    function waitFor(test) {
      if (test()) return Promise.resolve(true);
      return new Promise(resolve => {
        const finish = result => {
          observer.disconnect();
          clearTimeout(deadline);
          resolve(result);
        };
        const observer = new MutationObserver(() => { if (test()) finish(true); });
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
        const deadline = setTimeout(() => finish(Boolean(test())),1200);
      });
    }
    try {
      if (!await waitFor(() => menu()?.querySelector(".cr-model-selector__item"))) return null;
      const items=[...(menu()?.querySelectorAll(".cr-model-selector__item")||[])].filter(el=>!el.matches("[aria-disabled=true],.cr-model-selector__item--disabled"));
      const name=el=>el.querySelector(".cr-model-selector__item-name")?.textContent.trim()||"";
      const current=()=>[...document.querySelectorAll(".cr-model-selector__trigger-label")].find(visible)?.textContent.trim();
      if (op === "models") {
        const names = [...new Set(items.map(name).filter(Boolean))];
        // Minimized Electron windows can suspend image decoding. Selection
        // needs only the list and session. Warm the preview cache independently.
        const cacheKey = Symbol.for("ulanzi.workbuddy.modelPreviews.v3");
        const cache = window[cacheKey] ||= new Map();
        for (const label of cache.keys()) if (!names.includes(label)) cache.delete(label);
        const pictures = {};
        for (const item of items) {
          const label = name(item);
          if (!label) continue;
          if (!cache.has(label)) {
            const icon = item.querySelector(".cr-model-selector__item-icon :is(img,svg)")?.cloneNode(true);
            const entry = {};
            cache.set(label, entry);
            drawCard(label, icon).then(picture => { entry.picture = picture; },
              () => { if (cache.get(label) === entry) cache.delete(label); });
          }
          if (cache.get(label).picture) pictures[label] = cache.get(label).picture;
        }
        return {session:sourceSession, names, pictures, selected:current()};
      }
      const match=items.filter(el=>name(el)===image); if(match.length!==1)return false;
      if (typeof palette === "string" && palette !== session()) return false;
      match[0].click();
      return await waitFor(() => current() === image);
    } finally { if(opened && trigger.matches(".cr-model-selector__trigger--open"))trigger.click(); }
  }
  function composerControl(kind) {
    const selector = kind === "voice" ? ".cr-voice-trigger" : "button.cr-send-button,button.conversation-input__stop-button";
    const controls = [...document.querySelectorAll(selector)].filter(visible);
    if (controls.length !== 1) return {state:"unavailable"};
    const button = controls[0];
    if (kind === "voice" && button.matches(".cr-voice-trigger--loading")) return {state:"busy"};
    // WorkBuddy reuses the send button for stopping a running turn.
    if (kind === "send") {
      const label = (button.getAttribute("aria-label") || "").trim().toLowerCase();
      if (button.matches(".cr-send-button--stop,.conversation-input__stop-button") ||
          (button.matches(".cr-send-button--custom") && /^(stop( generating| generation| response)?|停止(生成|回复|回覆|响应|回應)?)$/.test(label))) {
        return button.matches(":disabled,[aria-disabled=true]") ? {state:"unavailable"} : {button, state:"stop"};
      }
      if (button.matches(".cr-send-button--sending")) return {state:"busy"};
    }
    if (!button.matches("button") || button.matches(":disabled,[aria-disabled=true]")) return {state:"unavailable"};
    if (kind === "send" && button.matches(".cr-send-button--custom") &&
        !["send","发送","發送"].includes((button.getAttribute("aria-label") || "").toLowerCase())) return {state:"unavailable"};
    return {button, state:button.matches(".cr-voice-trigger--recording") ? "recording" : "ready"};
  }
  if (op === "watchStatus") {
    // Wake a full snapshot only for controls that can change session state.
    // Streaming message text and voice-level style changes are excluded.
    const selectors = ".cb-agent-card,.conversation-list,.pending-sandbox-panel,.cr-send-button,.conversation-input__stop-button,.cr-voice-trigger,.cr-model-selector__trigger-label,.cb-task-loading-text,.cb-task-approval-buttons,.execute-command-compact__actions,.command-approval-floating-wrapper,[class*=optionList],[class*=_questionFloating_]";
    const relevant = node => node.nodeType === 1 && (node.matches(selectors) || node.querySelector(selectors));
    const cacheKey = Symbol.for("ulanzi.workbuddy.statusWatcher");
    window[cacheKey]?.();
    return await new Promise(resolve => {
      const finish = changed => {
        observer.disconnect();
        clearTimeout(timer);
        if (window[cacheKey] === cancel) delete window[cacheKey];
        resolve(changed);
      };
      const cancel = () => finish(false);
      const observer = new MutationObserver(records => {
        if (records.some(record => record.target.closest?.(selectors) ||
            [...record.addedNodes, ...record.removedNodes].some(relevant))) finish(true);
      });
      const timer = setTimeout(() => finish(false), 1500);
      window[cacheKey] = cancel;
      observer.observe(document.body, {subtree:true, childList:true, attributes:true,
        attributeFilter:["class","disabled","aria-disabled","aria-label","aria-selected","data-selected"]});
    });
  }
  if (op === "watchVoice") {
    const read = () => ({session:session(), voice:composerControl("voice").state});
    const changed = value => value.session !== image.session || value.voice !== image.voice;
    const first = read();
    if (changed(first)) return first;
    // WorkBuddy can replace the microphone node when the composer changes.
    return await new Promise(resolve => {
      const finish = value => { observer.disconnect(); clearTimeout(timer); resolve(value); };
      const observer = new MutationObserver(records => {
        if (!records.some(r => r.type === "childList" || r.target.matches(".cr-voice-trigger"))) return;
        const value = read();
        if (changed(value)) finish(value);
      });
      const timer = setTimeout(() => finish(read()), 1500);
      observer.observe(document.body, {subtree:true,childList:true,attributes:true,
        attributeFilter:["class","disabled","aria-disabled","data-selected"]});
    });
  }
  if (op === "voice" || op === "send") {
    const control = composerControl(op);
    if (!control.button || session() !== image.session || control.state !== image.state) return false;
    control.button.click();
    return true;
  }
  const groups = Array.from(document.querySelectorAll(".cb-task-approval-buttons,.execute-command-compact__actions,.command-approval-floating-wrapper")).filter(el => visible(el) && (el.matches(".command-approval-floating-wrapper") || el.querySelector(".cb-task-icon-accept,.execute-command-compact__btn--allow,.execute-command-compact__btn--deny")));
  const fiberOf = node => node[Object.keys(node).find(k => k.startsWith("__reactFiber$"))];
  const question = questionPanel(visible, fiberOf, session);
  if (op === "answerQuestion") {
    if (!question || question.request.submitted || question.request.token !== palette) return false;
    const control = question.controls.get(image);
    if (!control || control.element.matches(':disabled,[aria-disabled="true"]')) return false;
    if (control.kind === "input") control.element.focus();
    else {
      question.request.submitted = true;
      control.element.click();
    }
    return true;
  }
  // Some tool approval cards share their option-list layout with ordinary
  // questions. Require WorkBuddy's pending tool record before treating it as approval.
  const toolLists = [...document.querySelectorAll('[class*="optionList"]')].filter(list => {
    if (!visible(list) || list.closest(".pending-sandbox-panel")) return false;
    for (let f = fiberOf(list); f; f = f.return) {
      const pending = f.memoizedProps?.pending;
      if (pending?.id) return pending.category === "tool";
    }
    return false;
  });
  // Read only controls belonging to one visible approval. React option keys are
  // locale-independent; a permanent grant is never a session-only choice.
  function approvalControls() {
    const panels = [...new Set([...groups, ...toolLists, ...document.querySelectorAll(".pending-sandbox-panel")])].filter(visible);
    const roots = panels.filter(p => !panels.some(other => other !== p && other.contains(p)));
    if (roots.length !== 1) return null;
    const root = roots[0], controls = new Map();
    const sandbox = root.matches(".pending-sandbox-panel");
    let requestId = "";
    let sessionScope = true;
    for (let f = fiberOf(root); f; f = f.return) {
      const props = f.memoizedProps;
      const intercept = props?.pending?.metadata?.sandbox;
      if (intercept?.fileApprovalScope || intercept?.interceptType === "sensitive-protection") sessionScope = false;
      const id = props?.pending?.id || props?.pendingId;
      if (typeof id === "string") { requestId = id; break; }
    }
    for (const button of root.querySelectorAll('button,.cb-task-icon-accept,.cb-task-icon-reject')) {
      if (!visible(button) || button.closest(':disabled,[aria-disabled="true"]')) continue;
      const item = button.closest('[class*="optionItem"]');
      const key = item && fiberOf(item)?.key;
      let choice;
      if (sandbox || (item && toolLists.some(list => list.contains(item)))) {
        if (!item || !(button === item || button.matches('[class*="optionHitArea"]'))) continue;
        if (["allow_once","allow_session","deny"].includes(key)) choice = key;
        else if (!sandbox && key === "allow") choice = "allow_once";
        else if (!sandbox && ["reject","reject_once","__reject_pending__"].includes(key)) choice = "deny";
      } else {
        const label = button.innerText?.replace(/^\s*\d+\s*/, "").trim();
        if (button.matches(".cb-task-icon-accept,.execute-command-compact__btn--allow") || ["Allow","允许","允许一次","本次允许"].includes(label)) choice = "allow_once";
        else if (["Always allow this kind of command for this session","Allow for this session","本次会话允许","本次对话始终允许"].includes(label)) choice = "allow_session";
        else if (button.matches(".cb-task-icon-reject,.execute-command-compact__btn--deny") || ["Deny","Reject","拒绝"].includes(label)) choice = "deny";
      }
      if (!choice || (choice === "allow_session" && !sessionScope)) continue;
      const target = button.closest("button") || button;
      if (controls.has(choice) && controls.get(choice) !== target) return null;
      controls.set(choice, target);
    }
    if (!controls.size) return null;
    // Remounts, replaced requests and changes in the prompt invalidate old presses.
    const signature = JSON.stringify([requestId,session(),root.textContent]);
    const cacheKey = Symbol.for("ulanzi.workbuddy.approval");
    if (root[cacheKey]?.signature !== signature) root[cacheKey] = {signature, token:crypto.randomUUID(), submitted:false};
    return {request:root[cacheKey], controls};
  }
  if (op === "decide") {
    const approval = approvalControls();
    if (!approval || approval.request.submitted || approval.request.token !== palette) return false;
    const button = approval.controls.get(image);
    if (!button) return false;
    approval.request.submitted = true;
    button.click();
    return true;
  }
  if (op === "state" || op === "observe") {
    // Sandbox risk prompts have a separate panel from command approvals.
    const sandboxPending = [...document.querySelectorAll(".pending-sandbox-panel")].some(visible);
    const questionPending = [...document.querySelectorAll('[class*="_questionFloating_"]')].some(visible);
    const state = groups.length || sandboxPending || toolLists.length || questionPending ? "notification" : Array.from(document.querySelectorAll(".conversation-input__stop-button,.cr-send-button--stop,.cb-task-loading-text")).some(visible) ? "working" : "idle";
    if (op === "state") return state;
    const labels = [...document.querySelectorAll(".cr-model-selector__trigger-label")].filter(visible);
    // The sidebar groups pinned and project tasks. Its loaded conversation list
    // carries sortAt across groups; DOM order alone is not recency order.
    const anchor = document.querySelector(".cb-agent-card[data-conversation-id]") || document.querySelector(".conversation-list");
    let tasks = null;
    if (anchor) {
      let fiber = anchor[Object.keys(anchor).find(key => key.startsWith("__reactFiber$"))];
      let root = fiber;
      while (root?.return) root = root.return;
      if (root && root.stateNode?.current !== root && fiber.alternate) fiber = fiber.alternate;
      for (; fiber; fiber = fiber.return) {
        const list = fiber.memoizedProps?.allConversations;
        if (!Array.isArray(list)) continue;
        const valid = list.filter(row => typeof row?.id === "string" && row.id && Number.isFinite(row.sortAt) && row.lifecycle !== "archived");
        if (list.length && !valid.length) break;
        const selected = session();
        const active = new Set(["planning", "working", "running"]);
        const cards = [...document.querySelectorAll(".cb-agent-card[data-conversation-id]")];
        const seen = new Set();
        tasks = [];
        for (const row of valid.sort((a,b) => b.sortAt-a.sortAt || a.id.localeCompare(b.id))) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const status = String(row.status || "").toLowerCase();
          const matches = cards.filter(card => card.dataset.conversationId === row.id);
          let taskState = "idle";
          if (status === "pending" || status === "waiting_for_approval" || (row.id === selected && state === "notification")) {
            taskState = "notification";
          } else if (active.has(status) || (row.id === selected && state === "working") ||
                     matches.some(card => card.querySelector('[class*="statusIconSpin"], [class*="trailingStatus"] [class*="spin" i]'))) {
            taskState = "working";
          } else if (["failed", "error", "terminated"].includes(status)) {
            taskState = "error";
          } else if (status === "completed") {
            // Mounted cards reflect the sidebar's final display decision. Collapsed
            // groups expose the same unread flag via their conversation record.
            const unread = matches.length
              ? matches.some(card => card.querySelector('[class*="unreadDot"]'))
              : row.unread === true;
            if (unread) taskState = "attention";
          }
          tasks.push({session:row.id, title:String(row.title || row.taskTitle || "").slice(0,120), state:taskState});
          if (tasks.length === 5) break;
        }
        break;
      }
    }
    const approval = state === "notification" ? approvalControls() : null;
    const prompt = approval && !approval.request.submitted ? {token:approval.request.token,
      choices:["allow_once","allow_session","deny"].filter(choice => approval.controls.has(choice))} : null;
    return {state, tasks, voice:composerControl("voice").state, send:composerControl("send").state, approval:prompt, question:question?.snapshot || null, session:session(), model:labels.length === 1 ? labels[0].textContent.trim() : ""};
  }
  if (op === "restoreTheme") {
    document.querySelector("style#ulanzi-workbuddy-background")?.remove();
    return true;
  }
  if (op === "skin" || op === "toggleTheme") return applySkin(image, palette, sampler, op === "toggleTheme");
  return false;
}
const jpeg = value => typeof value === "string" && value.length <= 360000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value);
async function command(op, image, palette) {
  const composerStates = op === "voice" ? ["ready","recording"] : ["ready","stop"];
  if (!["credits","foreground","state","observe","watchStatus","watchVoice","voice","send","decide","answerQuestion","skin","toggleTheme","restoreTheme","models","selectModel","currentModel","currentCard"].includes(op) || (["voice","send"].includes(op) && (typeof image?.session !== "string" || !composerStates.includes(image?.state))) || (op === "answerQuestion" && (typeof image !== "string" || image.length > 80 || typeof palette !== "string")) || (op === "decide" && (!["allow_once","allow_session","deny"].includes(image) || typeof palette !== "string")) || (op==="selectModel" && (typeof image!=="string" || !image.length || image.length>160)) || (["skin","toggleTheme"].includes(op) && !jpeg(image))) throw Error("Invalid WorkBuddy action");
  const ws = new WebSocketClient(await target());
  const expression = '(' + renderer.toString() + ').test(location.href) ? (' + renderCommand.toString() + ')(' + JSON.stringify(op) + ',' + (image ? JSON.stringify(image) : 'null') + ',' + (op === 'credits' ? '(balance, language) => (' + drawCreditsCard.toString() + ')(balance, language, ' + JSON.stringify(creditGlyphData) + ')' : op === 'models' || op === 'currentCard' ? '(() => { const modelSvg = ' + modelSvg.toString() + '; return ' + drawModelCard.toString() + '; })()' : 'null' ) + ',' + ((op === 'skin' || op === 'toggleTheme') ? applyTheme.toString() : 'null') + ',' + ((op === 'skin' || op === 'toggleTheme') ? JSON.stringify(palette || {}) + ',' + samplePalette.toString() : (op === 'selectModel' || op === 'decide' || op === 'answerQuestion') ? JSON.stringify(palette ?? null) + ',null' : 'null,null') + ',' + readQuestionPanel.toString() + ') : null';
  return new Promise((resolve,reject) => {
    let done = false;
    const finish = (err,val) => { if(done)return; done=true; clearTimeout(timer); ws.close(); err ? reject(err) : resolve(val); };
    const modelMenu = op === "models" || op === "selectModel";
    const timer = setTimeout(()=>finish(Error("CDP timeout")), (op === "skin" || op === "toggleTheme") ? 8000 : modelMenu || op === "watchVoice" || op === "watchStatus" ? 5000 : 1800);
    ws.once("open",()=>{if(done){ws.close();return;} ws.sendJson(op === "foreground" ? {id:1, method:"Page.bringToFront"} : {id:1,method:"Runtime.evaluate",params:{expression,awaitPromise:true,returnByValue:true}});});
    ws.on("error",e=>finish(e)); ws.once("close",()=>finish(Error("CDP disconnected")));
    ws.on("message",raw=>{try{const m=JSON.parse(raw); if(m.id===1) finish(m.error || m.result?.exceptionDetails ? Error("WorkBuddy renderer unavailable") : null,m.result?.result?.value);}catch(e){finish(e);}});
    ws.connect();
  });
}
module.exports = { command, jpeg };

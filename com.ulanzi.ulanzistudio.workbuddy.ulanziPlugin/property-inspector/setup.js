/* Only status sync needs setup; ordinary deep-link actions remain direct. */
window.WorkBuddySetup = (() => {
  let options, t, panel, note, pending = false;
  const dictionaries = {
    zh: {title:"CDP 连接",intro:"点击「重启 WorkBuddy」，插件将以 CDP 模式启动 WorkBuddy，以便连接并同步会话状态。",app:"客户端",task:"会话状态",installed:"已安装",missing:"未检测到",refresh:"重新检测",guide:"使用说明",checking:"正在检测…",lost:"插件连接已断开",busy:"正在连接…",ready:"已连接",offline:"未连接",restart:"重启 WorkBuddy",restarting:"正在重启…"},
    en: {title:"CDP connection",intro:"Click Restart WorkBuddy to start WorkBuddy in CDP mode and connect to sync chat status.",app:"Client",task:"Chat status",installed:"Installed",missing:"Not detected",refresh:"Check again",guide:"Usage guide",checking:"Checking…",lost:"Plugin disconnected",busy:"Connecting…",ready:"Connected",offline:"Disconnected",restart:"Restart WorkBuddy",restarting:"Restarting…"},
  };
  const el = (tag, text, cls) => { const node=document.createElement(tag); if(text)node.textContent=text;if(cls)node.className=cls;return node; };
  function init(config) {
    options=config;t=dictionaries[config.zh?"zh":"en"];
    panel=el("section",null,"wb-setup");panel.append(el("h2",t.title),el("p",t.intro,"help"));
    const rows=el("div",null,"wb-panel");
    for(const [key,label] of [["app",t.app],["connection","CDP"],["task",t.task]]) {
      const row=el("div",null,"wb-row");row.append(el("span",label));const value=el("span",t.checking,"wb-value");value.id="wb-"+key;row.append(value);rows.append(row);
    }
    panel.append(rows);note=el("p",t.checking,"help");note.setAttribute("role","status");panel.append(note);
    const actions=el("div",null,"wb-actions");
    for(const [type,label,cls] of [["getStatus",t.refresh,""],["openGuide",t.guide,""]]) {
      const button=el("button",label,cls);button.type="button";
      button.addEventListener("click",()=>{pending=true;note.textContent=t.busy;actions.querySelectorAll("button").forEach(b=>b.disabled=true);options.message({type});setTimeout(()=>{if(pending)disconnected();},5000);});actions.append(button);
    }
    const enable = el("button",t.restart); enable.type="button"; enable.id="wb-enable-cdp";
    enable.onclick=()=>{
      enable.disabled=true;
      enable.textContent=t.restarting;
      options.message({type:"enableCdp"});
      note.textContent=t.busy;
    };
    actions.prepend(enable);panel.append(actions);
    if(config.mode === "optional") {
      const optional=el("details",null,"wb-optional");optional.append(el("summary",config.zh?"状态同步设置（可选）":"Status sync settings (optional)"),panel);document.body.append(optional);
    } else document.body.prepend(panel);
  }
  function value(id,text,level) { const node=document.getElementById("wb-"+id);node.textContent=text;node.className="wb-value "+level; }
  function render(status) {
    if(!panel)return;pending=false;panel.querySelectorAll("button").forEach(b=>b.disabled=false);
    const enable = document.getElementById("wb-enable-cdp");
    enable.textContent = status.cdpRestarting ? t.restarting : status.connected ? t.ready : t.restart;
    enable.disabled = status.connected || status.cdpRestarting;
    value("app",status.installed?t.installed:t.missing,status.installed?"good":"warn");
    value("connection",status.connected?t.ready:t.offline,status.connected?"good":"warn");
    value("task",status.connected?(options.stateLabels[status.state] || status.state):"—","");
    note.textContent=status.cdpRestarting?t.busy:status.connected?"":status.cdpRestartError || "";

  }
  function disconnected(){if(!note)return;pending=false;note.textContent=t.lost;panel.querySelectorAll("button").forEach(b=>b.disabled=false);document.getElementById("wb-enable-cdp").textContent=t.restart;}
  return {init,render,disconnected};
})();

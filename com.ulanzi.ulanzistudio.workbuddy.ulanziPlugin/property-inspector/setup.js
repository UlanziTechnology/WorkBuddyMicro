/* Only status sync needs setup; ordinary deep-link actions remain direct. */
window.WorkBuddySetup = (() => {
  let options, t, panel, note, pending = false, statusTimeout;
  const el = (tag, text, cls) => { const node=document.createElement(tag); if(text)node.textContent=text;if(cls)node.className=cls;return node; };
  function waitForStatus(timeout = 5000) {
    pending=true;
    clearTimeout(statusTimeout);
    statusTimeout=setTimeout(()=>{if(pending)disconnected();},timeout);
  }
  function init(config) {
    options=config;t=config.t;
    panel=el("section",null,"wb-setup");panel.append(el("h2",t("setupTitle")),el("p",t("setupIntro"),"help"));
    if (/Win/i.test(navigator.platform || navigator.userAgent)) {
      panel.append(el("p",t("windowsRestartWarning"),"help"));
    }
    const rows=el("div",null,"wb-panel");
    for(const [key,label] of [["app",t("client")],["connection","CDP"]]) {
      const row=el("div",null,"wb-row");row.append(el("span",label));const value=el("span",t("checking"),"wb-value");value.id="wb-"+key;row.append(value);rows.append(row);
    }
    panel.append(rows);note=el("p",t("checking"),"help");note.setAttribute("role","status");panel.append(note);
    const actions=el("div",null,"wb-actions");
    for(const [type,label,cls] of [["getStatus",t("checkAgain"),""],["openGuide",t("guide"),""]]) {
      const button=el("button",label,cls);button.type="button";
      button.addEventListener("click",()=>{waitForStatus();note.textContent=t("connecting");actions.querySelectorAll("button").forEach(b=>b.disabled=true);options.message({type});});actions.append(button);
    }
    const enable = el("button",t("restart")); enable.type="button"; enable.id="wb-enable-cdp";
    enable.onclick=()=>{
      enable.disabled=true;
      enable.textContent=t("restarting");
      waitForStatus(60000);
      options.message({type:"enableCdp"});
      note.textContent=t("connecting");
    };
    actions.prepend(enable);panel.append(actions);
    document.body.prepend(panel);
    waitForStatus();
  }
  function value(id,text,level) { const node=document.getElementById("wb-"+id);node.textContent=text;node.className="wb-value "+level; }
  function render(status) {
    if(!panel)return;pending=false;clearTimeout(statusTimeout);panel.querySelectorAll("button").forEach(b=>b.disabled=false);
    const enable = document.getElementById("wb-enable-cdp");
    enable.textContent = status.cdpRestarting ? t("restarting") : status.connected ? t("connected") : t("restart");
    enable.disabled = status.connected || status.cdpRestarting;
    value("app",status.installed?t("installed"):t("missing"),status.installed?"good":"warn");
    value("connection",status.connected?t("connected"):t("disconnected"),status.connected?"good":"warn");
    note.textContent=status.cdpRestarting?t("connecting"):status.connected?"":status.cdpRestartError || "";
    if(status.cdpRestarting)waitForStatus(60000);

  }
  function disconnected(){
    if(!note)return;pending=false;clearTimeout(statusTimeout);
    note.textContent=t("noStatus");
    for(const id of ["app","connection"])value(id,"—","warn");
    panel.querySelectorAll("button").forEach(b=>b.disabled=false);
    document.getElementById("wb-enable-cdp").textContent=t("restart");
  }
  return {init,render,disconnected};
})();

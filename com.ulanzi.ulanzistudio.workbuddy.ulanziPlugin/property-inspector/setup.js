/* Only status sync needs setup; ordinary deep-link actions remain direct. */
window.WorkBuddySetup = (() => {
  let options, t, panel, note, refresh, enable, download, pending = false, statusTimeout;
  let wasConnected = false;
  const el = (tag, text, cls) => { const node=document.createElement(tag); if(text)node.textContent=text;if(cls)node.className=cls;return node; };
  function waitForStatus(timeout = 5000) {
    pending=true;refresh.disabled=true;refresh.setAttribute("aria-busy","true");
    clearTimeout(statusTimeout);
    statusTimeout=setTimeout(()=>{if(pending)disconnected();},timeout);
  }
  function value(id,text,level) { const node=document.getElementById("wb-"+id);node.textContent=text;node.className="wb-value "+level; }
  function showNote(text) { note.textContent=text;note.hidden=!text; }
  function init(config) {
    options=config;t=config.t;
    wasConnected = false;
    panel=el("details",null,"wb-setup");panel.open=true;
    const summary=el("summary",null,"wb-setup-summary"), state=el("span",null,"wb-summary-state");
    const connection=el("span",t("checking"),"wb-value");connection.id="wb-summary";
    refresh=el("button",null,"wb-refresh");refresh.type="button";refresh.id="wb-refresh";
    refresh.title=t("checkAgain");refresh.setAttribute("aria-label",t("checkAgain"));
    refresh.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 6a5.2 5.2 0 1 0 .1 3M13 2v4H9"/></svg>';
    refresh.addEventListener("click",event=>{
      // Refresh is inside the summary; it must not toggle the disclosure.
      event.preventDefault();event.stopPropagation();
      if(pending)return;
      waitForStatus();value("summary",t("checking"),"");options.message({type:"getStatus"});
    });
    state.append(connection,refresh);summary.append(el("span",t("setupTitle")),state);
    const intro=el("p",t("setupIntro"),"help"), guide=el("a",t("guide"),"wb-inline-link");
    guide.href="../../usage-guide/index.html";guide.id="wb-guide";
    guide.addEventListener("click",event=>{event.preventDefault();options.message({type:"openGuide"});});
    intro.append(" ",guide);panel.append(summary,intro);
    if (/Win/i.test(navigator.platform || navigator.userAgent)) panel.append(el("p",t("windowsRestartWarning"),"help"));
    const rows=el("div",null,"wb-panel");
    for(const [key,label] of [["app",t("client")],["connection","CDP"]]) {
      const row=el("div",null,"wb-row"), actions=el("span",null,"wb-row-actions");row.append(el("span",label));
      const status=el("span",t("checking"),"wb-value");status.id="wb-"+key;actions.append(status);
      if(key==="app") {
        download=el("button",t("workbuddyWebsite"),"wb-inline-action");download.type="button";download.id="wb-download";download.hidden=true;
        download.addEventListener("click",()=>options.message({type:"openDownload"}));actions.append(download);
      } else {
        enable=el("button",t("restart"),"wb-inline-action");enable.type="button";enable.id="wb-enable-cdp";enable.hidden=true;
        enable.addEventListener("click",()=>{
          if(enable.disabled)return;
          enable.disabled=true;enable.textContent=t("restarting");waitForStatus(60000);
          showNote(t("connecting"));options.message({type:"enableCdp"});
        });actions.append(enable);
      }
      row.append(actions);rows.append(row);
    }
    panel.append(rows);note=el("p",null,"help");note.setAttribute("role","status");note.hidden=true;panel.append(note);
    document.body.prepend(panel);waitForStatus();
  }
  function render(status) {
    if(!panel)return;pending=false;clearTimeout(statusTimeout);refresh.disabled=false;refresh.setAttribute("aria-busy","false");
    const installed=Boolean(status.installed || status.connected), connected=Boolean(status.connected), restarting=Boolean(status.cdpRestarting);
    value("app",installed?t("installed"):t("missing"),installed?"good":"warn");
    document.getElementById("wb-app").hidden=!installed;download.hidden=installed;
    value("connection",connected?t("connected"):t("disconnected"),connected?"good":"warn");
    enable.hidden=!installed || connected;enable.disabled=restarting;enable.textContent=restarting?t("restarting"):t("restart");
    document.getElementById("wb-connection").hidden=!enable.hidden;
    value("summary",restarting?t("restarting"):connected?t("connected"):t("disconnected"),connected?"good":"warn");
    showNote(restarting?t("connecting"):connected?"":status.cdpRestartError || "");
    // Collapse on the connection transition so polling respects a manual expansion.
    const ready = connected && !restarting;
    if (ready && !wasConnected) panel.open = false;
    wasConnected = ready;
    if(restarting)waitForStatus(60000);
  }
  function disconnected(){
    if(!note)return;pending=false;clearTimeout(statusTimeout);refresh.disabled=false;refresh.setAttribute("aria-busy","false");
    wasConnected = false;
    showNote(t("noStatus"));
    for(const id of ["app","connection"]){value(id,"—","warn");document.getElementById("wb-"+id).hidden=false;}
    value("summary",t("disconnected"),"warn");download.hidden=true;enable.hidden=true;enable.disabled=false;
  }
  return {init,render,disconnected};
})();

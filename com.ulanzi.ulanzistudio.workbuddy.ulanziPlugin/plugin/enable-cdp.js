"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const exec = require("node:util").promisify(require("node:child_process").execFile);
const cdp = require("./workbuddy-cdp");
const { launchDeepLink } = require("./deeplink");
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const flags = ["--remote-debugging-address=127.0.0.1","--remote-debugging-port=9223"];
const ready = () => cdp.command("state").then(s => ["idle","working","notification"].includes(s),()=>false);
// A file argument preserves Unicode install paths and keeps PowerShell quoting at the boundary.
/** @param {"WorkBuddy"|"WorkBuddy AI"} brand @returns {Promise<void>} */
async function windowsWorkBuddy(brand) {
  try {
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "windows-workbuddy.ps1"), "-Brand", brand, "-Mode", "restart"],
    {windowsHide:true, timeout:25000});
  } catch (error) {
    // execFile's default message includes the entire script/command. Keep the inspector actionable.
    const detail = String(error.stderr || "").split(/\r?\n/).map(line=>line.trim()).find(Boolean);
    throw Error(detail || "Could not run Windows CDP setup. Open WorkBuddy and retry.");
  }
}

/** @param {"WorkBuddy"|"WorkBuddy AI"} brand @returns {Promise<void>} */
async function foreground(brand) {
  // A bare deeplink restores hidden/tray windows without navigating away from the current chat.
  if (process.platform === "win32") await launchDeepLink(brand === "WorkBuddy AI" ? "workbuddy-ai://" : "workbuddy://");
  await cdp.command("foreground");
  if (process.platform === "darwin") await exec("/usr/bin/open", ["-a", brand]);
}

async function restart(brand) {
  if (await ready()) {
    await foreground(brand);
    return;
  }
  // Do not interrupt the app if another program already owns the debug port.
  await new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once("error",()=>reject(Error("127.0.0.1:9223 is in use.")));
    server.listen(9223,"127.0.0.1",()=>server.close(resolve));
  });
  if (process.platform === "darwin") {
    const app = ["/Applications",path.join(os.homedir(),"Applications")].map(dir=>path.join(dir,brand+".app")).find(fs.existsSync);
    if (!app) throw Error(brand+" not installed");
    // The sidecar and CLI workers share Electron but can outlive the GUI app.
    const running=async()=>(await exec("/usr/bin/osascript",["-e",'application "'+app+'" is running'])).stdout.trim()==="true";
    if(await running()){
      await exec("/usr/bin/osascript",["-e",'tell application "'+app+'" to quit'],{timeout:18000});
      for(let i=0;i<40 && await running();i++)await pause(250);
      if(await running()) throw Error("WorkBuddy did not quit. Save your work and retry.");
    }
    await exec("/usr/bin/open",["-a",app,"--args",...flags]);
  } else if(process.platform==="win32"){
    await windowsWorkBuddy(brand);
  } else throw Error("Unsupported platform");
  const deadline = Date.now() + 30000;
  do {
    if(await ready()) {
      if(process.platform === "win32") await foreground(brand);
      return;
    }
    await pause(400);
  } while(Date.now() < deadline);
  throw Error("WorkBuddy CDP did not connect (127.0.0.1:9223).");
}
let pending;
function enableCdp(scheme) {
  if(!pending) pending=restart(scheme==="workbuddy-ai://"?"WorkBuddy AI":"WorkBuddy").finally(()=>{pending=null;});
  return pending;
}
module.exports={enableCdp};

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const exec = require("node:util").promisify(require("node:child_process").execFile);
const cdp = require("./workbuddy-cdp");
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const flags = ["--remote-debugging-address=127.0.0.1","--remote-debugging-port=9223"];
const ready = () => cdp.command("state").then(s => ["idle","working","notification"].includes(s),()=>false);

async function restart(brand) {
  if (await ready()) {
    await cdp.command("foreground");
    // Bringing a renderer tab forward also needs native app activation.
    if (process.platform === "darwin") {
      await exec("/usr/bin/open", ["-a", brand]);
    } else if (process.platform === "win32") {
      const script = `$app = Get-Process -Name '${brand}' -ErrorAction Stop | Where-Object MainWindowHandle | Select-Object -First 1
if (!$app) {throw 'WorkBuddy window not found'}
$activated = (New-Object -ComObject WScript.Shell).AppActivate($app.Id)
if (!$activated) {throw 'Could not activate WorkBuddy'}`;
      await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide:true, timeout:5000});
    }
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
    const exe=(await exec("/usr/libexec/PlistBuddy",["-c","Print :CFBundleExecutable",path.join(app,"Contents/Info.plist")])).stdout.trim();
    const main=path.join(app,"Contents/MacOS",exe);
    const running=async()=>(await exec("/bin/ps",["-axo","command="],{maxBuffer:4194304})).stdout.split("\n").some(s=>s===main || s.startsWith(main+" "));
    if(await running()){
      await exec("/usr/bin/osascript",["-e",'tell application "'+app+'" to quit'],{timeout:18000});
      for(let i=0;i<40 && await running();i++)await pause(250);
      if(await running()) throw Error("WorkBuddy did not quit. Save your work and retry.");
    }
    await exec("/usr/bin/open",["-a",app,"--args",...flags]);
  } else if(process.platform==="win32"){
    // Resolve the executable before closing it. CloseMainWindow honors app save dialogs.
    const script = `$ErrorActionPreference='Stop'
$name='${brand}'
$all=@(Get-Process -Name $name -ErrorAction SilentlyContinue)
$exe=$all | Where-Object Path | Select-Object -First 1 -ExpandProperty Path
if (!$exe) {$exe=@("$env:LOCALAPPDATA/Programs/$name/$name.exe","$env:ProgramFiles/$name/$name.exe") | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1}
if (!$exe) {throw 'WorkBuddy not found'}
$p=@($all | Where-Object MainWindowHandle)
if($all.Count -and !$p.Count){throw 'Open WorkBuddy window and retry'}
foreach($w in $p){if(!$w.CloseMainWindow() -or !$w.WaitForExit(15000)){throw 'Save your work and retry'}}
Start-Process -FilePath $exe -ArgumentList '${flags.join(" ")}'`;
    await exec("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:25000});
  } else throw Error("Unsupported platform");
  for(let i=0;i<40;i++){if(await ready())return; await pause(400);}
  throw Error("WorkBuddy CDP did not connect (127.0.0.1:9223).");
}
let pending;
function enableCdp(scheme) {
  if(!pending) pending=restart(scheme==="workbuddy-ai://"?"WorkBuddy AI":"WorkBuddy").finally(()=>{pending=null;});
  return pending;
}
module.exports={enableCdp};

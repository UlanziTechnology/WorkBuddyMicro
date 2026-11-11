"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const OWNER = "ulanzi-workbuddy-plugin";

// Remove only entries installed by earlier releases. A clean install never writes settings.
function removeLegacyEntries(home = os.homedir()) {
  const file = path.join(home, ".workbuddy", "settings.json");
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, "utf8");
  const config = JSON.parse(before);
  let changed = false;
  for (const [event, entries] of Object.entries(config?.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(entry => entry?.name !== OWNER);
    if (kept.length === entries.length) continue;
    changed = true;
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
  if (!changed) return;
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.copyFileSync(file, file + ".workbuddy-plugin-" + Date.now() + ".bak", fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", {mode:0o600, flag:"wx"});
    if (fs.readFileSync(file, "utf8") !== before) throw Error("WorkBuddy settings changed during migration");
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, {force:true}); }
}
module.exports = {removeLegacyEntries};

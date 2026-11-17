"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const sessionId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Read-only adapter for WorkBuddy's projects/<workspace>/<session>.jsonl files.
 * Interface: read(ids) -> Map<session, credits|null>; null means unmeasured, never zero.
 * Only top-level conversation files are indexed; subagent transcripts are excluded.
 */
class SessionFiles {
  constructor(root = path.join(os.homedir(), ".workbuddy", "projects")) {
    this.root = root;
    this.cache = new Map();
  }
  /** @param {readonly string[]} sessions @returns {Promise<Map<string, number|null>>} */
  async read(sessions) {
    const ids = [...new Set(sessions.filter(id => typeof id === "string" && sessionId.test(id)))];
    const files = new Map(ids.map(id => [id, []]));
    // Enumerate names, not transcript bodies; all reads stay below the known projects root.
    const dirs = await fs.promises.readdir(this.root, {withFileTypes:true}).catch(() => []);
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      for (const id of ids) {
        const file = path.join(this.root, dir.name, id + ".jsonl");
        const stat = await fs.promises.lstat(file).catch(() => null);
        if (stat?.isFile()) files.get(id).push({file, stat});
      }
    }
    const result = new Map();
    for (const id of ids) {
      // Cwd migrations can leave a second copy. Choose one source, never add copies together.
      const source = files.get(id).sort((a,b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
      const previous = this.cache.get(id);
      if (!source) { result.set(id, previous?.credits ?? null); continue; }
      const stamp = source.file + ":" + source.stat.size + ":" + source.stat.mtimeMs;
      if (stamp === previous?.stamp) { result.set(id, previous.credits); continue; }
      let credits = null;
      try {
        const entries = new Map();
        const stream = fs.createReadStream(source.file, {encoding:"utf8"});
        const lines = readline.createInterface({input:stream, crlfDelay:Infinity});
        // readline does not forward input errors to its async iterator.
        stream.on("error", () => lines.close());
        for await (const line of lines) {
          let record;
          try { record = JSON.parse(line); } catch { continue; } // A final line may still be appending.
          if (!record || typeof record !== "object" || (record.sessionId && record.sessionId !== id)) continue;
          const value = record.providerData?.rawUsage?.credit;
          const key = record.providerData?.messageId || record.id;
          if (typeof key === "string" && typeof value === "number" && Number.isFinite(value) && value >= 0) entries.set(key, value);
        }
        if (stream.errored) throw stream.errored;
        if (entries.size) {
          const total = [...entries.values()].reduce((a,b) => a+b,0);
          if (Number.isFinite(total) && total <= Number.MAX_SAFE_INTEGER / 100) credits = Math.round(total * 100) / 100;
        }
        this.cache.set(id, {stamp, credits});
      } catch { credits = previous?.credits ?? null; }
      result.set(id, credits);
    }
    // Bound the metadata cache across page switches without retaining transcript bodies.
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
    return result;
  }
}
module.exports = {SessionFiles};

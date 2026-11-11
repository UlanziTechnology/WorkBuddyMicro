"use strict";

/**
 * WorkBuddy DeepLink builder and OS-level launcher.
 *
 * Capability source: WorkBuddy Desktop DeepLink 说明 (code verified 2026-07-21).
 * - Domestic package scheme:  workbuddy://
 * - Overseas package scheme:  workbuddy-ai://
 * - codebuddy:// is NOT a registered scheme, never use it.
 */

const { spawn } = require("child_process");
const path = require("path");

const MAX_PROMPT_LENGTH = 8000;
const MAX_ARRAY_ITEMS = 20;
const WELCOME_MODES = new Set(["coding", "working", "design"]);
const PERMISSION_MODES = new Set(["default", "fullAccess"]);
const KNOWN_SCHEMES = new Set(["workbuddy://", "workbuddy-ai://"]);

/** Percent-encode a single query value. */
function enc(value) {
  return encodeURIComponent(String(value == null ? "" : value));
}

/** Truncate prompt to the documented maximum. */
function clampPrompt(text) {
  const value = String(text == null ? "" : text);
  if (value.length <= MAX_PROMPT_LENGTH) return { text: value, truncated: false };
  const cut = value.slice(0, MAX_PROMPT_LENGTH);
  return { text: cut.replace(/[\uD800-\uDBFF]$/, ""), truncated: true };
}

/**
 * Parse a comma/newline separated list, dedupe, cap at 20 items.
 * Items must not contain unencoded commas, so splitting on commas is safe.
 */
function parseList(value) {
  if (!value) return [];
  const items = (Array.isArray(value) ? value : String(value).split(/[,\n]/))
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
  if (items.length > MAX_ARRAY_ITEMS || items.some(item => item.includes(","))) throw Error("Skills and connectors accept at most 20 IDs without embedded commas / 技能和连接器最多 20 项，单项不能含逗号");
  return items;
}

function normalizeScheme(scheme) {
  const value = String(scheme || "").trim();
  if (KNOWN_SCHEMES.has(value)) return value;
  return "workbuddy://";
}

/** Append key=value only when the value is non-empty and allowed. */
function appendParam(params, key, value, allowedSet) {
  if (value == null) return;
  const text = String(value).trim();
  if (!text) return;
  if (allowedSet && !allowedSet.has(text)) return;
  params.push(`${key}=${enc(text)}`);
}

/** workbuddy://task?action=start&... — draft only, never auto-sent. */
function buildTaskUrl(scheme, settings, resolvedPrompt) {
  if (settings.cwd && !path.posix.isAbsolute(settings.cwd) && !path.win32.isAbsolute(settings.cwd)) throw Error("Working directory must be absolute / 工作目录必须为绝对路径");
  const params = ["action=start"];
  if (resolvedPrompt) {
    const prompt = clampPrompt(resolvedPrompt);
    params.push(`prompt=${enc(prompt.text)}`);
  }
  appendParam(params, "cwd", settings.cwd);
  appendParam(params, "expertId", settings.expertId);
  const skills = parseList(settings.skills);
  if (skills.length) params.push(`skills=${enc(skills.join(","))}`);
  const connectorIds = parseList(settings.connectorIds);
  if (connectorIds.length) params.push(`connectorIds=${enc(connectorIds.join(","))}`);
  appendParam(params, "model", settings.model);
  appendParam(params, "mode", settings.mode);
  appendParam(params, "welcomeMode", settings.welcomeMode, WELCOME_MODES);
  appendParam(params, "permissionMode", settings.permissionMode, PERMISSION_MODES);
  // The task endpoint requires a body; otherwise WorkBuddy silently stays on the old conversation.
  if (!String(resolvedPrompt || "").trim()) return buildHomeUrl(scheme);
  return `${normalizeScheme(scheme)}task?${params.join("&")}`;
}

/** workbuddy://home — back to the new-task state. */
function buildHomeUrl(scheme) {
  return `${normalizeScheme(scheme)}home`;
}

/** workbuddy://switch-model?modelId=... */
function buildSwitchModelUrl(scheme, modelId) {
  return `${normalizeScheme(scheme)}switch-model?modelId=${enc(modelId)}`;
}

/** workbuddy://codebuddy-ide/skill/install?skillname=...&downloadurl=... */
function buildSkillInstallUrl(scheme, settings) {
  const download = new URL(String(settings.downloadurl || ""));
  if (download.protocol !== "https:" || !String(settings.skillname || "").trim()) throw Error("A skill name and HTTPS download URL are required");
  const params = [];
  appendParam(params, "skillname", settings.skillname);
  appendParam(params, "downloadurl", settings.downloadurl);
  appendParam(params, "channelType", settings.channelType || settings.source);
  return `${normalizeScheme(scheme)}codebuddy-ide/skill/install?${params.join("&")}`;
}

const PAGE_LINKS = {
  home: "home",
  projects: "projects",
  experts: "experts",
  skills: "skills",
  connectors: "connectors",
  automation: "automation",
  colleagues: "colleagues",
  claw: "claw",
  discover: "discover",
  "tencent-docs": "tencent-docs",
  "my-files": "my-files",
  "my-cloud-files": "my-files?tab=cloudFiles",
  ima: "ima",
  lexiang: "lexiang",
  "agent-mail": "agent-mail",
  space: "space",
  chat: "chat/{taskId}",
};

/** Page-direct links, one per entry in the PRD mapping table. */
function buildPageUrl(scheme, page, taskId) {
  if (page === "chat" && !String(taskId || "").trim()) throw Error("Enter a task ID / 请填写任务 ID");
  const path = PAGE_LINKS[page] || PAGE_LINKS.home;
  const resolved = path.replace("{taskId}", enc(String(taskId || "").trim()));
  return `${normalizeScheme(scheme)}${resolved}`;
}

/** Replace supported placeholders: {clipboard} resolved async, {date}, {time}. */
async function resolvePlaceholders(template, getClipboardText) {
  let text = String(template || "");
  if (/\{clipboard\}/.test(text) && typeof getClipboardText === "function") {
    let clipboard;
    try {
      clipboard = await getClipboardText();
    } catch (err) {
      clipboard = undefined;
    }
    // Clamp the complete prompt once, after substitution, so truncation is reported
    // and a surrogate pair cannot be split before URL encoding.
    if (typeof clipboard === "string") text = text.split("{clipboard}").join(clipboard);
  }
  const now = new Date();
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  text = text.split("{date}").join(localDate);
  text = text.split("{time}").join(now.toTimeString().slice(0, 5));
  return text;
}

function isWindows() {
  return process.platform === "win32";
}

/**
 * Best-effort check whether the scheme handler exists before launching.
 * - Windows: registry lookup under HKCR\<scheme-name>
 * - macOS: handled by `open`, which fails with a non-zero exit code.
 *
 * IMPORTANT semantics: only a POSITIVE "not registered" answer (reg.exe ran
 * fine and the key is missing) may block the launch. When detection itself
 * is impossible — reg.exe blocked by security policy (EPERM), missing from
 * PATH, or timed out — we fail-open and attempt the launch anyway, because
 * `start`/ShellExecute is the real authority on whether the scheme works.
 */
function schemeExists(scheme) {
  return new Promise((resolve) => {
    if (!isWindows()) {
      // macOS `open` reports failure via exit code, no pre-check needed.
      resolve(true);
      return;
    }
    const name = normalizeScheme(scheme).replace("://", "");
    const regExe = path.join(
      process.env.SystemRoot || process.env.windir || "C:\\Windows",
      "System32",
      "reg.exe"
    );
    let child;
    try {
      child = spawn(regExe, ["query", `HKCR\\${name}`], {
        windowsHide: true,
      });
    } catch (err) {
      // Synchronous spawn failure (EPERM/ENOENT): cannot verify, fail-open.
      resolve(true);
      return;
    }
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.on("exit", (code) => done(code === 0));
    child.on("error", () => done(true)); // async spawn failure: fail-open
    setTimeout(() => done(true), 3000).unref(); // timeout: fail-open
  });
}

/** One Windows/macOS launch strategy. Returns the spawned child. */
function makeLauncher(url, index) {
  if (!isWindows()) {
    return () => spawn("open", [url], { windowsHide: true });
  }
  switch (index) {
    case 0:
      // Pass URLs as arguments, never through a command shell (percent expansion).
      return () => spawn("explorer.exe", [url], { windowsHide: true });
    case 1:
      // explorer.exe hands the URL to the shell directly (no cmd involved).
      return () => spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
    default:
      // rundll32 FileProtocolHandler — last resort protocol activator.
      return () =>
        spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
          windowsHide: true,
        });
  }
}

const WINDOWS_LAUNCH_ATTEMPTS = 2;

/** Launch a deeplink through the OS protocol handler, with fallbacks. */
function launchDeepLink(url) {
  return new Promise((resolve, reject) => {
    const attempts = isWindows() ? WINDOWS_LAUNCH_ATTEMPTS : 1;
    const failures = [];
    let unregistered = false;
    let index = 0;

    const tryNext = () => {
      if (index >= attempts) {
        const error = new Error(`all launch methods failed: ${failures.join(" | ")}`);
        if (unregistered) error.code = "SCHEME_NOT_REGISTERED";
        reject(error);
        return;
      }
      const make = makeLauncher(url, index++);
      let child;
      try {
        child = make();
      } catch (err) {
        failures.push(err && err.message);
        tryNext();
        return;
      }
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => { child.kill(); finish(false, "launch timeout"); }, 5000);
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (ok) resolve(true);
        else {
          const detail = String(reason || "launch failed");
          if (/-10814|No application knows|Unable to find application/i.test(detail)) unregistered = true;
          failures.push(detail.split(url).join("[WorkBuddy link]"));
          tryNext();
        }
      };
      child.stderr && child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => {
        finish(false, err && err.message);
      });
      child.on("exit", (code) => {
        if (code === 0 || (isWindows() && code === 1 && !stderr.trim())) {
          finish(true);
        } else {
          finish(false, `exit=${code} ${stderr.trim()}`.trim());
        }
      });
    };
    tryNext();
  });
}

module.exports = {
  MAX_PROMPT_LENGTH,
  MAX_ARRAY_ITEMS,
  PAGE_LINKS,
  enc,
  clampPrompt,
  parseList,
  normalizeScheme,
  buildTaskUrl,
  buildHomeUrl,
  buildSwitchModelUrl,
  buildSkillInstallUrl,
  buildPageUrl,
  resolvePlaceholders,
  schemeExists,
  launchDeepLink,
};

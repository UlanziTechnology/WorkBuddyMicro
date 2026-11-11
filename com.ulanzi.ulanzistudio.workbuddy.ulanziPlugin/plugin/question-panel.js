"use strict";

/** Runs inside WorkBuddy. Returns a serializable snapshot plus local DOM controls. */
function readQuestionPanel(visible, fiberOf, session) {
  const roots = [...document.querySelectorAll('[class*="_questionFloating_"]')]
    .filter(root => visible(root) && !root.closest(".pending-sandbox-panel"));
  if (roots.length !== 1) return null;
  const root = roots[0];
  let config;
  for (let fiber = fiberOf(root); fiber; fiber = fiber.return) {
    const value = fiber.memoizedProps?.config;
    if (Array.isArray(value?.questions) && value.questions.every(q => typeof q?.id === "string" && Array.isArray(q.options))) {
      config = value;
      break;
    }
  }
  if (!config?.questions.length) return null;
  const pageText = root.querySelector('[class*="_pageInfo_"]')?.textContent.trim() || "1/1";
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(pageText);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  const current = config.questions[index];
  if (!current || Number(match[2]) !== config.questions.length) return null;
  const controls = new Map(), choices = [];
  const clean = text => String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const add = (id, element, label, kind = "button", selected = false) => {
    if (!element || !visible(element) || !label) return;
    controls.set(id, {element, kind});
    choices.push({id, label:clean(label), kind, selected,
      disabled:element.matches(':disabled,[aria-disabled="true"]')});
  };
  const options = [...root.querySelectorAll('[class*="_optionItem_"][role="button"]')];
  for (const [i, option] of options.entries()) {
    const label = option.querySelector('[class*="_optionLabel_"]') || option.querySelector('[class*="_optionText_"]');
    add("option:" + i, option, label?.textContent, "option", /(?:^|\s)_selected_/.test(option.className));
  }
  const input = root.querySelector('input[class*="_customInput_"]');
  if (input) add("input", input, input.getAttribute("placeholder") || input.getAttribute("aria-label"), "input");
  for (const [i, button] of [...root.querySelectorAll('[class*="_footerActions_"] button')].entries()) {
    add("footer:" + i, button, button.getAttribute("aria-label") || button.textContent);
  }
  for (const [i, button] of [...root.querySelectorAll('button[class*="_pageBtn_"]')].entries()) {
    add("page:" + i, button, button.getAttribute("aria-label"));
  }
  const dismiss = root.querySelector('button[class*="_skipAllBtn_"]');
  add("dismiss", dismiss, dismiss?.getAttribute("aria-label"));
  if (!choices.length) return null;
  // Page/request identity keeps the rotary selection stable across checkbox changes.
  // The separate token invalidates clicks after selection, edits or a native remount.
  const identity = JSON.stringify([session(), config.toolCallId, config.questions, index]);
  const signature = JSON.stringify([identity, choices, input?.value || ""]);
  const key = Symbol.for("ulanzi.workbuddy.question");
  const previous = root[key];
  if (previous?.signature !== signature) {
    root[key] = {identity, signature, id:previous?.identity === identity ? previous.id : crypto.randomUUID(),
      token:crypto.randomUUID(), submitted:false};
  }
  const request = root[key];
  return {request, controls, snapshot:{id:request.id, token:request.token,
    title:clean(current.question || config.title), page:pageText, multiSelect:current.multiSelect === true, choices}};
}
module.exports = {readQuestionPanel};

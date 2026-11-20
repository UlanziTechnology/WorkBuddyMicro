"use strict";
const picker = document.getElementById("language");
let revision = 0;

async function render(language) {
  const current = ++revision;
  const selected = WorkBuddyI18n.normalize(language);
  const chinese = selected === "zh_CN";
  const nodes = document.querySelectorAll("[data-i18n]");

  // Local file pages may block fetch. Chinese and English ship in the HTML.
  picker.value = selected;
  document.documentElement.lang = WorkBuddyI18n.tag(selected);
  document.title = chinese ? "WorkBuddy · 使用说明" : "WorkBuddy · Usage guide";
  nodes.forEach(node => { node.textContent = chinese ? node.dataset.zh : node.dataset.en; });
  if (chinese || selected === "en") return;

  const locale = await WorkBuddyI18n.load(selected, new URL("../", location.href));
  if (current !== revision) return;
  document.title = "WorkBuddy · " + locale.t("guide");
  nodes.forEach(node => { node.textContent = locale.t(node.getAttribute("data-i18n")); });
}

picker.onchange = () => render(picker.value).catch(console.error);
render(new URLSearchParams(location.search).get("language") || picker.value).catch(console.error);

"use strict";
const picker = document.getElementById("language");
let revision = 0;
async function render(language) {
  const current = ++revision;
  const locale = await WorkBuddyI18n.load(language, new URL("../",location.href));
  if (current !== revision) return;
  document.documentElement.lang = WorkBuddyI18n.tag(locale.locale);
  document.title = "WorkBuddy · "+locale.t("guide");
  picker.value = locale.locale;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    node.textContent = locale.t(node.getAttribute("data-i18n"));
  });
}
picker.onchange = () => render(picker.value).catch(console.error);
// Keep the bundled English text readable if local JSON access is blocked by the host.
document.querySelectorAll("[data-en]").forEach(node => {node.textContent=node.dataset.en;});
render(new URLSearchParams(location.search).get("language")).catch(console.error);

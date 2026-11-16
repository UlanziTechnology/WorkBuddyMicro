/* Shared locale boundary for Node and Property Inspectors. Official filenames stay canonical. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WorkBuddyI18n = api;
})(globalThis, function () {
  "use strict";
  const locales = {zh:"zh_CN",en:"en",ja:"ja_JP",de:"de_DE",pt:"pt_PT",es:"es_ES",ko:"ko_KR"};
  /** @returns {"zh_CN"|"en"|"ja_JP"|"de_DE"|"pt_PT"|"es_ES"|"ko_KR"} */
  function normalize(language) {
    return locales[String(language || "en").trim().toLowerCase().replace(/_/g,"-").split("-")[0]] || "en";
  }
  function tag(language) { return normalize(language).replace("_","-"); }
  function create(locale, document, fallback) {
    const entries = {...fallback.Localization,...document.Localization};
    return {locale, document, t(key, values = {}) {
      return String(entries[key] ?? key).replace(/\{(\w+)\}/g, (token, name) =>
        Object.prototype.hasOwnProperty.call(values,name) ? String(values[name]) : token);
    }};
  }
  function loadSync(language) {
    const locale = normalize(language);
    const path = require("node:path"), fs = require("node:fs");
    const read = name => JSON.parse(fs.readFileSync(path.join(__dirname,"..",name+".json"),"utf8"));
    const fallback = read("en");
    return create(locale, locale === "en" ? fallback : read(locale), fallback);
  }
  async function load(language, baseUrl) {
    const locale = normalize(language);
    const read = async name => {
      const response = await fetch(new URL(name+".json",baseUrl));
      if (!response.ok) throw Error("Locale unavailable: "+name);
      return response.json();
    };
    const fallback = await read("en");
    const document = locale === "en" ? fallback : await read(locale).catch(()=>fallback);
    return create(locale,document,fallback);
  }
  return {normalize,tag,loadSync,load};
});

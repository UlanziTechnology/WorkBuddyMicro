"use strict";

// Runs inside the renderer. Sample the already configured image so existing
// theme keys acquire their palette without needing the original file again.
async function applyTheme(image, overrides, samplePalette, toggle = false) {
  const palette = await samplePalette(image);
  for (const key of Object.keys(palette)) {
    const hex = overrides?.[key];
    if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) palette[key] = hex;
    palette[key] = palette[key].slice(1).match(/../g).map(channel=>parseInt(channel,16)).join(" ");
  }
  const {surface,ink,muted,accent,selected,bubble,border} = palette;
  const declarations = [
    [ink, "--wb-text-primary --wb-color-text-primary --wb-text-strong --cr-text-primary --cb-text-primary --cb-vscode-foreground"],
    [muted, "--wb-text-secondary --wb-color-text-secondary --wb-color-text-tertiary --wb-color-text-placeholder --wb-text-muted --cr-text-secondary --cr-text-tertiary --cr-text-placeholder-from --cr-text-placeholder-to --cb-text-secondary"],
    [surface, "--wb-sidebar-bg --wb-bg-elevated --wb-bg-card --wb-bg-modal --wb-bg-popover --wb-color-bg-input --wb-color-bg-card-default --cr-bg-elevated --cr-bg-canvas --cr-bg-input-inset --cr-bg-code --cb-panel-bg-primary"],
    [selected, "--wb-bg-item-selected --wb-bg-row-selected --wb-bg-active --wb-bg-hover --cr-item-hover-bg --cr-item-selected-bg --cr-bg-code-inline"],
    [accent, "--wb-text-link --wb-color-text-link-default --cr-text-link --cb-text-link"],
    [border, "--wb-color-border-primary --wb-color-border-secondary --cr-border-default"]
  ].flatMap(([color,names])=>names.split(" ").map(name=>`${name}:rgb(${color}) !important`)).join(";");
  const css = `
    html, body, #root, #root .cr-theme, body .cr-popover { ${declarations}; }
    #root {color:rgb(${ink}); background:linear-gradient(rgb(${surface}/.18),rgb(${surface}/.28)),url("${image}") center/cover no-repeat !important;}
    #root :is(.teams-container,.teams-grid-scroll-content,[data-view-id],[class^="_gridView_"],[class*=" _gridView_"],.teams-main-content,.main-content,.conversation-list,.sidebar-next,.wb-home-route) {background:transparent !important;}
    #root .conversation-shell {background:rgb(${surface}/.88) !important;color:rgb(${ink});}
    #root .conversation-timeline :is(.cr-markdown,.cr-user-content) {color:rgb(${ink}) !important;}
    #root .conversation-timeline .cr-user-content {background-color:rgb(${bubble}) !important;border-radius:12px;}
    #root .conversation-timeline .cr-markdown a {color:rgb(${accent}) !important;}
    #root .conversation-sidebar {background:rgb(${surface}/.57) !important;backdrop-filter:blur(12px);}
    #root :is(.cr-input-container,.cr-input-toolbar__right), body .cr-model-selector__popover {background-color:rgb(${surface}) !important;color:rgb(${ink}) !important;}
    #root :is(.wb-home-header__title,.workbuddy-topbar-title,.conversation-item .cb-agent-card,.cr-model-selector__trigger,.cr-input-container [contenteditable=true]) {color:rgb(${ink}) !important;}
    #root .wb-home-header__title {text-shadow:0 1px 3px rgb(${surface}/.9);}
    #root .collapsible-section-label {color:rgb(${muted}) !important;}
    .cr-model-selector__item--selected, #root .conversation-item :is([aria-selected=true],[class*="_selected_"]) {background-color:rgb(${selected}) !important;color:rgb(${ink}) !important;}
    #root ::selection {background:rgb(${accent});color:rgb(${surface});}
  `;
  let style = document.getElementById("ulanzi-workbuddy-background");
  // Compare the actual renderer style so reloads, multiple keys, and palette
  // edits work without a plugin-side "applied" flag becoming stale.
  if (toggle && style?.textContent === css) {
    style.remove();
    return true;
  }
  if (!style) {style=document.createElement("style");style.id="ulanzi-workbuddy-background";document.head.append(style);}
  style.textContent=css;
  return true;
}
module.exports={applyTheme};

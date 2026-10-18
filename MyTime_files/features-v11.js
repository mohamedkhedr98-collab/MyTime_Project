// My Time Architecture v11 — feature registry.
// Owns optional feature boundaries and user-intent loading. No background polling.

import {
  loadModule,
  loadScript,
  loadStyle,
} from "./kernel-v11.js";

const VERSION = "20260924-architecture-v11";
const LAST_SEEN_VERSION = "20260930-presence-event-v6";
const ADMIN_VERSION = "20261011-release-management-v1";
const SR_ADMIN_ENTRY_VERSION = "20261005-catalog-fast-start-v1";
const SUPPORT_VERSION = "20261008-mobile-support-paint-v2";
const SUGGESTIONS_VERSION = "20260930-unified-seen-v1";
const TAGS_VERSION = "20261001-tags-typography-v2";
const SUPPORT_MODULE = "../support-chat-v6-stable2.js?v=" + SUPPORT_VERSION;
const SEARCH_VERSION = "20261005-catalog-fast-start-v1";
const UI_UPGRADE_VERSION = "20261005-catalog-fast-start-v1";
const HAYA_VERSION = "20260929-hk-paint-owner-v2";
const featureLoads = new Map();

function safe(task){
  try{
    const result = task();
    if(result && typeof result.catch === "function") result.catch(()=>{});
  }catch{}
}

function once(name, loader){
  const key = String(name || "").trim();
  if(!key) return Promise.reject(new Error("Missing feature name."));
  if(!featureLoads.has(key)){
    const pending = Promise.resolve().then(loader);
    featureLoads.set(key, pending);
    pending.catch(() => {
      if(featureLoads.get(key) === pending) featureLoads.delete(key);
    });
  }
  return featureLoads.get(key);
}

function closest(event, selector){
  return event?.target?.closest ? event.target.closest(selector) : null;
}

function warm(selector, loader){
  const run = (event) => {
    if(closest(event, selector)) safe(loader);
  };
  document.addEventListener("pointerover", run, true);
  document.addEventListener("focusin", run, true);
  document.addEventListener("touchstart", run, { capture:true, passive:true });
}

function replayClick(selector, loader){
  const replaying = new WeakSet();
  document.addEventListener("click", (event) => {
    const target = closest(event, selector);
    if(!target || replaying.has(target)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    Promise.resolve()
      .then(loader)
      .then(() => {
        replaying.add(target);
        try{ target.click(); }
        finally{ queueMicrotask(() => replaying.delete(target)); }
      })
      .catch(()=>{});
  }, true);
}

function loadSearch(){
  return once("search", () =>
    loadScript("search-results-guard", "../search-results-stability-guard.js?v=" + SEARCH_VERSION)
  );
}

function loadUiUpgrade(){
  return once("ui-upgrade", () =>
    loadScript("safe-tool-upgrade", "../safe-tool-upgrade.js?v=" + UI_UPGRADE_VERSION)
  );
}

function loadHaya(){
  return once("haya", () =>
    loadScript("haya-helper", "../haya-karima-smart-helper.js?v=" + HAYA_VERSION)
  );
}

function loadCalculator(){
  return once("calculator", async () => {
    await loadScript("calculator-data", "../calculator/landline-data.js?v=" + VERSION);
    await loadScript("calculator-core", "../calculator/calculator-core.js?v=" + VERSION);
    await loadScript("calculator-landline", "../calculator/landline-calculator.js?v=" + VERSION);
    await loadScript("calculator-ui", "../calculator/landline-ui.js?v=" + VERSION);
  });
}

function loadOutage(){
  return once("outage", () =>
    loadScript("outage-by-mail", "../outage-by-mail.js?v=" + VERSION)
  );
}

function loadOutageNormal(){
  return once("outage-normal", async () => {
    await loadOutage();
    await loadScript("ocr-engine-loader", "../ocr-lazy-loader.js?v=" + VERSION);
    await loadScript("outage-normal-runtime", "../index-embedded-runtime.js?v=" + VERSION);
  });
}

function loadCallbackOcr(){
  return once("callback-ocr", async () => {
    await loadScript("ocr-engine-loader", "../ocr-lazy-loader.js?v=" + VERSION);
    await loadScript("callback-ocr", "../features/callback-ocr-v11.js?v=" + VERSION);
  });
}

function loadTags(){
  return once("tags", () =>
    loadScript("tags-overlay", "../features/tags-overlay-v11.js?v=" + TAGS_VERSION)
  ).catch((error) => {
    featureLoads.delete("tags");
    throw error;
  });
}

function loadAhly(){
  return once("ahly", () =>
    loadScript("ahly-active-tab-fix", "../index-ahly-active-tab-fix.js?v=" + VERSION)
  );
}

function loadSuggestions(){
  return once("suggestions", () =>
    loadModule("suggestions", "../suggestions.js?v=" + SUGGESTIONS_VERSION)
  );
}

async function openSuggestions(){
  await loadSuggestions();
  try{ window.__srOpenSuggestions?.(); }catch{}
}

async function openSuggestionTarget(item){
  await loadSuggestions();
  try{ await window.__srSuggestionNotificationCenterBridge?.openTarget?.(item); }catch{}
}

async function openSupport(){
  await Promise.allSettled([
    loadStyle("support-desktop", "../support-desktop-pro-v4.css?v=" + SUPPORT_VERSION),
    loadModule("realtime", "../realtime-event-bridge-v6.js?v=20261004-transfer-v1"),
    loadModule("online-users", "../online-users-count.js?v=" + VERSION),
  ]);
  await loadModule("support-chat", SUPPORT_MODULE);
  window.__srRealtimeEventBridgeState?.reconnect?.();
  try{ window.__srOpenSupportChat?.(); }catch{}

  // Presence age is event-driven. Hydrate historical timestamps only when Support is opened.
  // The live online/offline state continues to come from Supabase Presence over WebSocket.
  safe(async () => {
    await Promise.allSettled([
      loadModule(
        "presence-last-seen-v4",
        "../presence-last-seen-sidecar-v2.js?v=" + LAST_SEEN_VERSION
      ),
      loadModule(
        "support-presence-v4",
        "../support-presence-visual-v2.js?v=" + LAST_SEEN_VERSION
      ),
    ]);
    await window.__srLastSeenSidecar?.refresh?.();
  });
}

async function openSupportTarget(item){
  await openSupport();
  if(window.__srSupportNotificationBridge?.openTarget){
    return window.__srSupportNotificationBridge.openTarget(item);
  }
  return false;
}

function installAdminClickFeedbackStyle(){
  if(document.getElementById("srAdminClickFeedbackStyle")) return;
  const style = document.createElement("style");
  style.id = "srAdminClickFeedbackStyle";
  style.textContent = `
    html body #MNDO_UA07_LOGO3[data-sr-admin-click].sr-admin-click-pop::after{
      content:attr(data-sr-admin-click) !important;
      display:grid !important;
      visibility:visible !important;
      opacity:1 !important;
      position:absolute !important;
      left:50% !important;
      top:50% !important;
      width:31px !important;
      height:31px !important;
      place-items:center !important;
      border-radius:50% !important;
      font:800 16px/1 system-ui,-apple-system,"Segoe UI",sans-serif !important;
      color:#fff !important;
      -webkit-text-fill-color:#fff !important;
      background:rgba(9,19,34,.94) !important;
      border:1px solid rgba(255,255,255,.82) !important;
      box-shadow:0 5px 18px rgba(0,0,0,.40),0 0 0 1px rgba(82,167,255,.28) inset !important;
      text-shadow:0 1px 2px rgba(0,0,0,.58) !important;
      filter:none !important;
      pointer-events:none !important;
      z-index:2147483000 !important;
      transform:translate(-50%,-50%) scale(1) !important;
      animation:srAdminClickPop .48s cubic-bezier(.2,.85,.25,1) both !important;
      will-change:transform;
    }
    html body #MNDO_UA07_LOGO3[data-sr-admin-click].sr-admin-click-final::after{
      background:rgba(17,111,73,.97) !important;
      border-color:rgba(180,255,217,.96) !important;
      box-shadow:0 6px 22px rgba(0,0,0,.42),0 0 18px rgba(62,224,145,.40) !important;
    }
    @keyframes srAdminClickPop{
      0%{transform:translate(-50%,-50%) scale(.55)}
      28%{transform:translate(-50%,-50%) scale(1.12)}
      68%{transform:translate(-50%,-50%) scale(.96)}
      100%{transform:translate(-50%,-62%) scale(.88)}
    }
    @media (prefers-reduced-motion:reduce){
      html body #MNDO_UA07_LOGO3[data-sr-admin-click].sr-admin-click-pop::after{animation-duration:.18s !important}
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function showAdminClick(value){
  const shell = document.getElementById("MNDO_UA07_LOGO3");
  if(!shell) return;
  installAdminClickFeedbackStyle();
  shell.dataset.srAdminClick = String(value);
  shell.classList.remove("sr-admin-click-pop", "sr-admin-click-final");
  void shell.offsetWidth;
  shell.classList.add("sr-admin-click-pop");
  if(value === 5) shell.classList.add("sr-admin-click-final");
}

function clearAdminClickFeedback(){
  const shell = document.getElementById("MNDO_UA07_LOGO3");
  if(!shell) return;
  shell.classList.remove("sr-admin-click-pop", "sr-admin-click-final");
  delete shell.dataset.srAdminClick;
}

function adminLogoShell(node){
  return node?.closest?.("#MNDO_UA07_LOGO3") || null;
}

function isAdminLogo(node){
  if(!node?.closest) return false;
  // Controls inside the logo shell are never part of the hidden admin gesture.
  if(node.closest?.("#MNDO_WORK_HELPER_LINK, #MNDO_BREAK_ALARM_HOST, #UA07_SECRET_ENVELOPE_WRAP")) return false;
  // Keep the canonical visible-image target for themes where the real image is rendered.
  if(node.closest?.(".mndo-uwk07-logo-img")) return true;
  // Ahly/Egypt hide the image and paint the same canonical logo shell as a background.
  return !!adminLogoShell(node);
}

function warmSrAdminAccess(){
  if(window.__srAdminAccessWarm) return window.__srAdminAccessWarm;
  const pending = fetch("/api/sr-admin-access", {
    method:"POST",
    credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"status"}),
  }).then(async (response) => {
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error("SR admin prewarm failed");
    return data?.authorized ? data : null;
  });
  window.__srAdminAccessWarm = pending;
  pending.catch(() => {
    if(window.__srAdminAccessWarm === pending) window.__srAdminAccessWarm = null;
  });
  return pending;
}

async function revealSrAdminEntry(){
  await loadModule("sr-admin-entry", "../sr-admin-entry.js?v=" + SR_ADMIN_ENTRY_VERSION);
  if(typeof window.__srEnsureSrAdminEntry === "function"){
    return window.__srEnsureSrAdminEntry({force:false, showPending:true});
  }
  return false;
}

async function openAdmin(){
  await Promise.allSettled([
    // SR management access is checked only after the deliberate admin gesture,
    // never for every ordinary tool visit.
    loadModule("sr-admin-entry", "../sr-admin-entry.js?v=" + SR_ADMIN_ENTRY_VERSION),
    loadModule("admin-suggestion-replies", "../admin-suggestions-replies-control.js?v=" + VERSION),
    loadModule("admin", "../admin.js?v=" + ADMIN_VERSION),
  ]);
  try{
    if(typeof window.__srOpenAdminPanel === "function") window.__srOpenAdminPanel();
    else window.dispatchEvent(new CustomEvent("sr:open-admin"));
  }catch{}
}

function bindCalculator(){
  const isTarget = (node) =>
    !!node?.closest?.(".tablinks") &&
    String(node.closest(".tablinks").getAttribute("onclick") || "").includes("Calculate");

  const warmRun = (event) => {
    if(isTarget(event.target)) safe(loadCalculator);
  };
  document.addEventListener("pointerover", warmRun, true);
  document.addEventListener("focusin", warmRun, true);

  const replaying = new WeakSet();
  document.addEventListener("click", (event) => {
    const tab = event.target?.closest?.(".tablinks");
    if(!tab || !isTarget(tab) || replaying.has(tab)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadCalculator().then(() => {
      replaying.add(tab);
      try{ tab.click(); }
      finally{ queueMicrotask(() => replaying.delete(tab)); }
    }).catch(()=>{});
  }, true);
}

function bindCallbackOcr(){
  const isCallBackTab = (node) => {
    const tab = node?.closest?.(".tablinks");
    return !!tab && String(tab.getAttribute("onclick") || "").includes("Call Back");
  };

  const warmTab = (event) => {
    if(isCallBackTab(event.target)) safe(loadCallbackOcr);
  };
  document.addEventListener("pointerover", warmTab, true);
  document.addEventListener("focusin", warmTab, true);
  document.addEventListener("click", warmTab, true);

  warm(
    "#cbOcrPasteZone, #cbOcrPasteCatcher, #cbOcrExtractBtn, #cbOcrHqBtn, #cbOcrCopyBtn, #cbOcrClearBtn",
    loadCallbackOcr
  );
  replayClick(
    "#cbOcrExtractBtn, #cbOcrHqBtn, #cbOcrCopyBtn, #cbOcrClearBtn",
    loadCallbackOcr
  );
}

function bindSupport(){
  warm("#supportToggleBtn", () => Promise.allSettled([
    loadStyle("support-desktop", "../support-desktop-pro-v4.css?v=" + SUPPORT_VERSION),
    loadModule("support-chat", SUPPORT_MODULE),
  ]));
  document.addEventListener("click", (event) => {
    const button = closest(event, "#supportToggleBtn");
    if(!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    safe(openSupport);
  }, true);
}

function bindAdmin(){
  let clicks = 0;
  let resetTimer = 0;
  let visualTimer = 0;
  document.addEventListener("click", (event) => {
    if(!isAdminLogo(event.target)) return;
    clicks += 1;
    showAdminClick(clicks);

    if(visualTimer) clearTimeout(visualTimer);
    visualTimer = setTimeout(clearAdminClickFeedback, 520);

    if(resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      clicks = 0;
      clearAdminClickFeedback();
    }, 1800);

    if(clicks === 1) safe(warmSrAdminAccess);
    if(clicks === 2) safe(revealSrAdminEntry);
    if(clicks < 5) return;

    clicks = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
    safe(openAdmin);
  }, true);
}

function bindSuggestions(){
  warm("#suggestionsFab", loadSuggestions);
  document.addEventListener("click", (event) => {
    const button = closest(event, "#suggestionsFab");
    if(!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    safe(openSuggestions);
  }, true);
}

export function installFeatureIntents(){
  if(document.documentElement?.dataset?.srV11FeatureIntents === "1") return;
  if(document.documentElement) {
    document.documentElement.dataset.srV11FeatureIntents = "1";
    document.documentElement.dataset.srTargetedSupportLoader = "1";
  }

  warm("#searchInput", loadSearch);
  warm(
    "#arabicNumber, #arabiccNumber, #copyBtn, #copyBtn1, #mndoTTTop, #mndoSRTop, #mndoTTBottom, #mndoSRBottom, #headerResetBtn",
    loadUiUpgrade
  );
  replayClick("#headerResetBtn", loadUiUpgrade);
  warm("#arabicNumber, #arabiccNumber", loadHaya);
  bindCalculator();
  bindCallbackOcr();

  warm(
    "#outageTabMail, #outageBrasSearch, #outageBrasCheckBtn, #outageImpactedBras, #outageComplaintNo, #outageCopyBtn",
    loadOutage
  );
  replayClick("#outageTabMail, #outageBrasCheckBtn, #outageCopyBtn", loadOutage);

  warm(
    "#outageTabNormal, #modeSelect, #outageTypeUI, #complaintId, #timePaste, #timePicker, #genSimpleBtn, #resetBtn",
    loadOutageNormal
  );
  replayClick("#outageTabNormal, #genSimpleBtn, #resetBtn", loadOutageNormal);

  warm("#bat2", loadTags);
  replayClick("#bat2", loadTags);

  bindSuggestions();
  bindSupport();
  bindAdmin();
}

export function warmFeature(name){
  const key = String(name || "").trim().toLowerCase();
  if(key === "ahly") return loadAhly();
  if(key === "search") return loadSearch();
  if(key === "ui-upgrade") return loadUiUpgrade();
  if(key === "haya") return loadHaya();
  if(key === "calculator") return loadCalculator();
  if(key === "outage") return loadOutage();
  if(key === "outage-normal") return loadOutageNormal();
  if(key === "callback-ocr") return loadCallbackOcr();
  if(key === "tags") return loadTags();
  if(key === "suggestions") return loadSuggestions();
  return Promise.resolve(null);
}

export const featureRegistry = Object.freeze({
  version:VERSION,
  warm:warmFeature,
  openSuggestions,
  openSuggestionTarget,
  openSupport,
  openSupportTarget,
  openAdmin,
});

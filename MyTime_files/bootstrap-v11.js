// Runtime primitives live in kernel-v11; feature ownership lives in features-v11.

import {
  loadModule,
  loadScript,
  loadStyle,
  onIdle,
  runtime,
} from "./kernel-v11.js";
import {
  featureRegistry,
  installFeatureIntents,
  warmFeature,
} from "./features-v11.js?v=20261011-release-management-preview-v1";

const VERSION = "20261010-bell-v1";
const LAST_SEEN_VERSION = "20260930-presence-event-v6";
const POLLING_FREE_VERSION = "20260930-polling-free-v1";
const STARTUP_BUDGET_VERSION = "20261011-bell-open-read-v1";
const CATALOG_VERSION = "20261005-catalog-fast-start-v1";

function safe(task){
  try{
    const result = task();
    if(result && typeof result.catch === "function") result.catch(()=>{});
  }catch{}
}

function loadLayout(){
  return loadModule("layout", "../safe-customization-layer.js?v=20260929-header-core-v2");
}

function loadRealtime(){
  return loadModule("realtime", "../realtime-event-bridge-v6.js?v=20261015-egress-v2");
}

async function loadNotifications(){
  const module = await loadModule(
    "notification-center",
    "../suggestion-notification-center.js?v=" + STARTUP_BUDGET_VERSION
  );
  module?.installSuggestionNotificationCenter?.();
  await window.__srNotificationCenterBridge?.prime?.();
  return module;
}

async function loadAnnouncementClient(){
  await loadNotifications();
  return loadModule(
    "admin-message-client",
    "../admin-message-client.js?v=" + VERSION
  );
}

function loadPresence(){
  // Tool-wide Presence owner only. The Support visual consumer is intent-loaded
  // with Support itself by features-v11.
  return loadModule("online-users", "../online-users-count.js?v=20260929-static-header-v1");
}

function loadLastSeenSidecar(){
  // Fail-open persistence sidecar. It never owns Presence and cannot block core UI.
  return loadModule(
    "presence-last-seen-v4",
    "../presence-last-seen-sidecar-v2.js?v=" + LAST_SEEN_VERSION
  );
}

function loadRetainedUx(){
  return loadScript(
    "support-suggestions-ux",
    "../support-suggestions-pro-ux-base-v6.js?v=s1"
  );
}

function scheduleBackground(){
  // One push transport; no focus/visibility polling.
  onIdle(() => safe(loadRealtime), 1200);

  // One counts-only Worker snapshot replaces separate unread + announcement requests.
  onIdle(() => safe(loadAnnouncementClient), 1300);

  // Presence is useful, but not part of first paint.
  onIdle(() => safe(loadPresence), 2400);

  // Persisted offline recency is secondary and isolated from the live Presence owner.
  onIdle(() => safe(loadLastSeenSidecar), 3200);

  // UI upgrade remains intent-only.

  // Secondary helpers stay outside first interaction.
  onIdle(() => safe(loadRetainedUx), 5600);
  onIdle(() => {
    safe(() => loadModule("urgent-voice-selection", "../urgent-voice-selection-control.js?v=" + VERSION)
      .then(() => loadModule("urgent-voice-auto", "../urgent-voice-auto-activation.js?v=" + POLLING_FREE_VERSION)));
    safe(() => loadModule("suggestion-anchor-reactions", "../suggestion-anchor-reactions.js?v=" + VERSION));
  }, 6200);

}

function installThemeFeatureHooks(){
  const warmActive = mode => {
    if(mode === "ahly") safe(() => warmFeature("ahly"));
  };
  warmActive(document.documentElement.dataset.srVisualTheme || "");
  window.addEventListener("sr:themechange", event => warmActive(event?.detail?.mode || ""), { passive:true });
}

function boot(){
  const compatReady = window.__srCompatibilityReady = loadScript("sr-compat", "/runtime/sr-compat-v11.js?v=" + CATALOG_VERSION);
  safe(() => compatReady);
  safe(loadLayout);
  safe(() => loadStyle(
    "suggestions-rounded",
    "../suggestions-rounded-premium.css?v=" + VERSION
  ));

  installFeatureIntents();
  installThemeFeatureHooks();
  scheduleBackground();
  safe(() => compatReady.then(() => window.__srCatalog?.prewarm()));

  window.__srArchitectureV11 = Object.freeze({
    version:VERSION,
    runtime,
    features:featureRegistry,
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot, { once:true });
}else{
  boot();
}

(function () {
  "use strict";

  if (window.__safeCustomizationLayerLoaded) return;
  window.__safeCustomizationLayerLoaded = true;

  var ROOT = document.documentElement;
  var BODY = document.body;

  /**
   * Safe Customization Layer
   *
   * Purpose:
   * - Provide a stable, additive hook point for future customizations.
   * - Keep legacy SR logic, app.js behavior, and menu markup untouched.
   *
   * Protected files (do not edit unless explicitly requested):
   * - public/app.js
   * - public/index.html
   * - SR/menu data sources and menu HTML
   *
   * Safe files for future changes:
   * - public/safe-customization-layer.js
   * - public/safe-customization-layer.css
   * - future optional customization modules loaded from this layer
   */

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
      return;
    }
    fn();
  }

  function ensureCssLoaded() {
    if (document.getElementById("safeCustomizationLayerCss")) return;

    var link = document.createElement("link");
    link.id = "safeCustomizationLayerCss";
    link.rel = "stylesheet";
    link.href = "./safe-customization-layer.css?v=20260929-header-core-v1";
    document.head.appendChild(link);
  }

  function setStateClass(target, className, on) {
    if (!target) return;
    target.classList.toggle(className, !!on);
  }

  var THEME_MODES=["ivory","eid","legacy","ahly","egypt","off"];
  function detectTheme(){
    var mode="";
    try{if(window.__srThemeController&&typeof window.__srThemeController.getMode==="function")mode=window.__srThemeController.getMode();}catch(_){}
    if(THEME_MODES.indexOf(mode)<0)mode=String(ROOT.dataset.srVisualTheme||"");
    if(THEME_MODES.indexOf(mode)<0){
      if(ROOT.classList.contains("ivory-gold-theme-live"))mode="ivory";
      else if(ROOT.classList.contains("eid-theme-live"))mode="eid";
      else if(ROOT.classList.contains("ua07-legacy-theme-live"))mode="legacy";
      else if(ROOT.classList.contains("ahly-premium-theme-live"))mode="ahly";
      else if(ROOT.classList.contains("egypt-worldcup-theme-live"))mode="egypt";
      else mode="off";
    }
    return {id:mode};
  }
  function applyThemeClasses(){
    var state=detectTheme(),exact=THEME_MODES.map(function(mode){return "scl-theme-"+mode;});
    exact.concat(["scl-theme-default","scl-theme-ramadan"]).forEach(function(cls){setStateClass(ROOT,cls,false);setStateClass(BODY,cls,false);});
    setStateClass(ROOT,"scl-theme-"+state.id,true);setStateClass(BODY,"scl-theme-"+state.id,true);
    var alias=["ivory","legacy","egypt","off"].indexOf(state.id)>=0;
    setStateClass(ROOT,"scl-theme-default",alias);setStateClass(BODY,"scl-theme-default",alias);
    setStateClass(ROOT,"scl-has-eid-theme",state.id==="eid");setStateClass(BODY,"scl-has-eid-theme",state.id==="eid");
  }

  function applyUiStateClasses() {
    var tagsLink = document.getElementById("bat2");
    var searchInput = document.getElementById("searchInput");
    var hasTabs = !!document.getElementById("tabs");

    setStateClass(ROOT, "scl-has-tags-link", !!tagsLink);
    setStateClass(BODY, "scl-has-tags-link", !!tagsLink);

    setStateClass(ROOT, "scl-has-search", !!searchInput);
    setStateClass(BODY, "scl-has-search", !!searchInput);

    setStateClass(ROOT, "scl-has-tabs", hasTabs);
    setStateClass(BODY, "scl-has-tabs", hasTabs);
  }

  function createScopedStyle(id, cssText) {
    if (!id || document.getElementById(id)) return null;
    var style = document.createElement("style");
    style.id = id;
    style.type = "text/css";
    style.appendChild(document.createTextNode(String(cssText || "")));
    document.head.appendChild(style);
    return style;
  }

  function applyAllStateClasses() {
    applyThemeClasses();
    applyUiStateClasses();
  }

  function ensureUrgentTickerOverlayRoot() {
    var root = document.getElementById("sclUrgentTickerOverlayRoot");
    if (root) return root;

    root = document.createElement("div");
    root.id = "sclUrgentTickerOverlayRoot";
    root.setAttribute("aria-live", "off");
    (document.body || BODY || document.documentElement).appendChild(root);
    return root;
  }

  function moveUrgentTickerToOverlay() {
    var ticker = document.getElementById("SR_URGENT_TICKER");
    if (!ticker) return false;
    if (ticker.__sclMovedToBodyOverlay) return true;

    var overlayRoot = ensureUrgentTickerOverlayRoot();
    overlayRoot.appendChild(ticker);
    ticker.__sclMovedToBodyOverlay = true;
    return true;
  }

  function initUrgentTickerOverlayMove() {
    if (moveUrgentTickerToOverlay()) return;

    var observer = new MutationObserver(function () {
      if (!moveUrgentTickerToOverlay()) return;
      observer.disconnect();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.setTimeout(function () {
      observer.disconnect();
    }, 15000);
  }


  // The search lives above Haya Karima and must survive first paint, theme
  // restoration and browser back/forward cache. Only repair a verified failure.
  // Do not poll or overwrite the agent's search text.
  var searchResumeScheduled = false;
  var searchShellObserver = null;
  var searchShellObserved = [];

  function searchShellParts() {
    var input = document.getElementById("searchInput");
    if (!input) return null;
    var container = input.closest ? input.closest(".search-container") : null;
    var anchor = input.closest ? input.closest(".mndo-search-hk-anchor") : null;
    var row = input.closest ? input.closest(".mndo-search-logo-row") : null;
    return { input: input, container: container, anchor: anchor, row: row };
  }

  function clearStaleSearchVisibility(parts) {
    [parts && parts.row, parts && parts.anchor, parts && parts.container, parts && parts.input].forEach(function (el) {
      if (!el || !el.style) return;
      ["display", "visibility", "opacity"].forEach(function (prop) {
        try {
          var raw = el.style.getPropertyValue(prop);
          if (!raw) return;
          var value = String(raw).trim().toLowerCase();
          if (
            (prop === "display" && value === "none") ||
            (prop === "visibility" && value === "hidden") ||
            (prop === "opacity" && (value === "0" || value === "0.0"))
          ) {
            el.style.removeProperty(prop);
          }
        } catch (_) {}
      });
    });
  }

  function searchShellBroken(parts) {
    if (!parts || !parts.input || !parts.input.isConnected) return false;
    try {
      var elements = [parts.row, parts.anchor, parts.container, parts.input];
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el) continue;
        var style = window.getComputedStyle(el);
        if (!style || style.display === "none" || style.visibility === "hidden" ||
            style.visibility === "collapse" || Number(style.opacity) <= 0.01) return true;
      }
      var rect = parts.input.getBoundingClientRect();
      var width = window.innerWidth || document.documentElement.clientWidth || 1366;
      // Do not misdiagnose intentional page scrolling.
      var scrollY = Number(window.scrollY || window.pageYOffset || 0);
      var clippedTop = scrollY <= 8 && (rect.top < -4 || rect.bottom < 20);
      return rect.width < 120 || rect.height < 20 ||
        rect.right <= 8 || rect.left >= width - 8 || clippedTop;
    } catch (_) {
      return false;
    }
  }

  function repairSearchAfterTabResume() {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    // Dialogs intentionally lower the search layer: never pull the field over
    // Admin, Support or Suggestions while one of those front layers is open.
    if (document.body && document.body.classList.contains("mndo-front-dialog-open")) return;
    if (searchResumeScheduled) return;
    searchResumeScheduled = true;

    var run = function () {
      searchResumeScheduled = false;
      var parts = searchShellParts();
      if (!parts) return;

      var broken = searchShellBroken(parts);
      if (!broken) {
        ROOT.classList.remove("scl-search-recovery");
        if (document.body) document.body.classList.remove("scl-search-recovery");
        return;
      }

      clearStaleSearchVisibility(parts);
      applyUiStateClasses();
      var newlyRecovered = !ROOT.classList.contains("scl-search-recovery");
      ROOT.classList.add("scl-search-recovery");
      if (document.body) document.body.classList.add("scl-search-recovery");
      if (newlyRecovered) {
        try { window.ua07RefreshSearchResultsOverlay?.(); } catch (_) {}
      }

      window.requestAnimationFrame(function () {
        if (!searchShellBroken(searchShellParts())) {
          ROOT.classList.remove("scl-search-recovery");
          if (document.body) document.body.classList.remove("scl-search-recovery");
        }
      });
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(run);
      });
    } else {
      window.setTimeout(run, 0);
    }
  }

  function observeSearchShell() {
    if (searchShellObserver || typeof MutationObserver === "undefined") return;
    searchShellObserver = new MutationObserver(function (changes) {
      // Ignore unrelated script and metadata inserts in the head.
      var relevant = changes.some(function (change) {
        if (change.type !== "childList") return true;
        return Array.prototype.some.call(change.addedNodes || [], function (node) {
          if (!node || node.nodeType !== 1) return false;
          var tag = String(node.tagName || "").toUpperCase();
          return tag === "STYLE" || (tag === "LINK" &&
            String(node.rel || "").toLowerCase() === "stylesheet");
        });
      });
      if (relevant) repairSearchAfterTabResume();
    });
    var parts = searchShellParts();
    searchShellObserved = [ROOT, document.body,
      parts && parts.row, parts && parts.anchor,
      parts && parts.input].filter(Boolean);
    searchShellObserved.forEach(function (node) {
      try {
        searchShellObserver.observe(node, {
          attributes: true,
          attributeFilter: node === ROOT || node === document.body
            ? ["class"] : ["class", "style", "hidden"]
        });
      } catch (_) {}
    });
    // Restoring an old theme can attach stylesheets after the first paint.
    if (document.head) {
      try { searchShellObserver.observe(document.head, { childList: true }); }
      catch (_) {}
    }
  }

  function installSearchTabResumeRepair() {
    if (document.documentElement?.dataset?.sclSearchResumeRepair === "3") return;
    if (document.documentElement) document.documentElement.dataset.sclSearchResumeRepair = "3";

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) repairSearchAfterTabResume();
    }, { passive: true });
    window.addEventListener("pageshow", repairSearchAfterTabResume, { passive: true });
    window.addEventListener("focus", repairSearchAfterTabResume, { passive: true });
    window.addEventListener("load", repairSearchAfterTabResume, { passive: true, once: true });
    window.addEventListener("resize", repairSearchAfterTabResume, { passive: true });
    observeSearchShell();
    // Critical: a tab that never loses focus must still recover after a
    // cold load, theme rehydration, or an old cached stylesheet.
    repairSearchAfterTabResume();
  }

  window.SafeCustomizationLayer = Object.freeze({
    version: "1.4.0-header-core",
    applyAllStateClasses: applyAllStateClasses,
    applyThemeClasses: applyThemeClasses,
    applyUiStateClasses: applyUiStateClasses,
    createScopedStyle: createScopedStyle,
    setStateClass: setStateClass
  });

  window.addEventListener("sr:themechange",applyThemeClasses,{passive:true});

  ready(function () {
    ensureCssLoaded();
    applyAllStateClasses();
    initUrgentTickerOverlayMove();
    installSearchTabResumeRepair();
  });
})();

// Single owner for the authenticated, content-addressed SR source asset.
(function () {
  "use strict";
  if (window.__srCatalog) return;
  // Catalog-owned display aliases never change stable tab IDs or openCity routes.
  // Apply them at startup, even before the SR catalog is lazily fetched.
  function syncTopicDisplayNames() {
    document.querySelectorAll('.tabcontent[data-sr-display-name]').forEach((tab) => {
      const displayName = String(tab.getAttribute("data-sr-display-name") || "").trim();
      if (!displayName) return;
      document.querySelectorAll("#tabs button.tablinks[onclick]").forEach((button) => {
        const match = (button.getAttribute("onclick") || "")
          .match(/openCity\s*\(\s*event\s*,\s*(['"])(.*?)\1\s*\)/);
        if (match && match[2] === tab.id) button.textContent = displayName;
      });
    });
  }
  function normalizeStandaloneSrStyling(root = document) {
    // Old Admin builds marked standalone SRs with a special class, then moved
    // them to the END of the navbar. Legacy 099008001 is a plain anchor
    // BETWEEN dropdowns. Keep every node at its existing exact position and
    // strip the purely cosmetic marker without touching BSS attributes.
    root.querySelectorAll(".tabcontent a.sr-direct-action").forEach(link => {
      if (link.closest(".dropdown, .sub-dropdown")) return;
      link.classList.remove("sr-direct-action");
      if (!link.classList.length) link.removeAttribute("class");
    });
  }
  function syncTopicStructure() {
    syncTopicDisplayNames();
    normalizeStandaloneSrStyling();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncTopicStructure, { once: true });
  } else {
    syncTopicStructure();
  }
  let catalogPromise = null;
  let catalog = null;
  let scheduled = false;
  let lastError = null;
  let retryAt = 0;
  let failures = 0;
  const mounts = new Map();
  const preparedMenus = new Map();
  const revision = document.querySelector('meta[name="sr-catalog-sha256"]')?.content || "";
  const assetUrl = document.querySelector('meta[name="sr-catalog-asset"]')?.content || "";
  const appBasePath = new URL(".", location.href).pathname.replace(/\/$/, "");
  const appUrl = "https://mytime.qzz.io/";
  // Desktop menus already use opacity/visibility while closed. Avoid laying
  // out their invisible descendants when opening a whole tab. The existing
  // hover/focus/open states restore normal layout before geometry is read.
  document.documentElement.dataset.srCatalogLazy = "1";
  const style = document.createElement("style");
  style.id = "sr-catalog-deferred-layout";
  style.textContent =
    '@supports(content-visibility:hidden){@media(hover:hover) and (pointer:fine){html[data-sr-catalog-lazy="1"] .navbar .dropdown:not(:hover):not(:focus-within):not(.open):not(.active):not([data-sr-catalog-exit]) > .dropdown-content{content-visibility:hidden}}}' +
    'html[data-sr-menu-return-reset="1"] body .dropdown-content,html[data-sr-menu-return-reset="1"] body .sub-dropdown-content{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:none!important}';
  document.head.appendChild(style);
  const exitTimers = new WeakMap();
  function preserveMenuExit(event) {
    if (!window.CSS?.supports?.("content-visibility", "hidden") ||
        !window.matchMedia?.("(hover:hover) and (pointer:fine)")?.matches) return;
    for (let dropdown = event.target?.closest?.(".navbar .dropdown"); dropdown;
         dropdown = dropdown.parentElement?.closest(".navbar .dropdown")) {
      if (event.relatedTarget?.nodeType && dropdown.contains(event.relatedTarget)) continue;
      const menu = Array.from(dropdown.children).find(node => node.classList.contains("dropdown-content"));
      if (!menu) continue;
      if (exitTimers.has(dropdown)) clearTimeout(exitTimers.get(dropdown));
      dropdown.dataset.srCatalogExit = "1";
      // Keep descendants renderable until the existing opacity/visibility exit
      // transition finishes. Do not replace the theme's transition or duration.
      const computed = getComputedStyle(menu);
      const milliseconds = value => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000) || 0;
      const durations = computed.transitionDuration.split(",").map(milliseconds);
      const delays = computed.transitionDelay.split(",").map(milliseconds);
      const count = Math.max(durations.length, delays.length, computed.transitionProperty.split(",").length);
      const duration = Math.max(0, ...Array.from({ length: count }, (_, index) =>
        durations[index % durations.length] + delays[index % delays.length]));
      exitTimers.set(dropdown, setTimeout(() => {
        dropdown.removeAttribute("data-sr-catalog-exit");
        exitTimers.delete(dropdown);
      }, duration + 16));
    }
  }
  document.addEventListener("pointerout", preserveMenuExit, true);
  document.addEventListener("focusout", preserveMenuExit, true);

  // Selecting an SR opens a separate BSS tab. When the operator comes back,
  // never inherit the old menu's :hover/focus/open state. Keep menus suppressed
  // until fresh pointer/keyboard intent so a stationary cursor cannot reopen it.
  const menuReturnState = { armed: false, away: false, returned: false, armedAt: 0 };

  function dismissSrMenuState(suppress = false) {
    const active = document.activeElement;
    if (active?.closest?.(".dropdown, .sub-dropdown")) {
      try { active.blur(); } catch {}
    }

    document.querySelectorAll(".dropdown.open, .dropdown.active, .sub-dropdown.open, .sub-dropdown.active")
      .forEach(node => {
        node.classList.remove("open", "active");
        node.classList.add("sr-menu-dismissed");
        const trigger = node.matches(".dropdown")
          ? node.querySelector(":scope > button.dropbtn")
          : Array.from(node.children).find(child =>
            child.matches("a") && child.nextElementSibling?.classList.contains("sub-dropdown-content")
          );
        trigger?.setAttribute("aria-expanded", "false");
      });

    document.querySelectorAll("[data-sr-catalog-exit]").forEach(node => {
      if (exitTimers.has(node)) {
        clearTimeout(exitTimers.get(node));
        exitTimers.delete(node);
      }
      node.removeAttribute("data-sr-catalog-exit");
    });

    if (suppress) document.documentElement.dataset.srMenuReturnReset = "1";
  }

  function armSrMenuReturnReset() {
    menuReturnState.armed = true;
    menuReturnState.away = false;
    menuReturnState.returned = false;
    menuReturnState.armedAt = Date.now();
    dismissSrMenuState(true);
  }

  function markSrMenuAway() {
    if (!menuReturnState.armed) return;
    menuReturnState.away = true;
    dismissSrMenuState(true);
  }

  function markSrMenuReturned() {
    if (!menuReturnState.armed) return;
    if (menuReturnState.away) menuReturnState.returned = true;
    dismissSrMenuState(true);
  }

  function releaseSrMenuReturnReset() {
    if (!menuReturnState.armed) return;
    menuReturnState.armed = false;
    menuReturnState.away = false;
    menuReturnState.returned = false;
    menuReturnState.armedAt = 0;
    delete document.documentElement.dataset.srMenuReturnReset;
  }

  document.addEventListener("click", event => {
    const link = event.target?.closest?.('a[href*="BMEBusiness=srNewSrPage"]');
    if (!link || !link.closest?.(".dropdown-content, .sub-dropdown-content")) return;
    armSrMenuReturnReset();
  }, true);

  window.addEventListener("blur", markSrMenuAway);
  window.addEventListener("focus", markSrMenuReturned);
  document.addEventListener("visibilitychange", () => {
    if (!menuReturnState.armed) return;
    if (document.visibilityState === "hidden") markSrMenuAway();
    else markSrMenuReturned();
  });

  function releaseOnFreshMenuIntent() {
    if (!menuReturnState.armed) return;
    // If the browser kept the newly opened tab in the background, allow normal
    // interaction again after the launch gesture has clearly finished.
    if (menuReturnState.returned ||
        (!menuReturnState.away && Date.now() - menuReturnState.armedAt >= 500)) {
      releaseSrMenuReturnReset();
    }
  }
  document.addEventListener("pointermove", releaseOnFreshMenuIntent, { capture: true, passive: true });
  document.addEventListener("pointerdown", releaseOnFreshMenuIntent, true);
  document.addEventListener("keydown", releaseOnFreshMenuIntent, true);

  async function loadCatalog() {
    const expectedAssetPath = appBasePath + "/sr-catalog/" + revision + ".catalog";
    let resolvedAsset;
    try {
      resolvedAsset = new URL(assetUrl, location.href);
    } catch {}
    if (!/^[a-f0-9]{64}$/.test(revision) ||
        !resolvedAsset ||
        resolvedAsset.origin !== location.origin ||
        resolvedAsset.pathname !== expectedAssetPath) {
      throw new Error("Invalid catalog revision.");
    }
    if (location.protocol === "file:") {
      const error = new Error("The local HTML copy does not include the authenticated menu catalog.");
      error.code = "LOCAL_FILE";
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let source;
    try {
      const response = await fetch(assetUrl, { credentials: "same-origin", cache: "default", signal:controller.signal });
      if (!response.ok || response.redirected) {
        const authenticationRequired = response.status === 401 || response.status === 403 || response.redirected;
        if(authenticationRequired) window.__srAccountSessionGuard?.check();
        const error = new Error(authenticationRequired
          ? "The menu catalog requires an authenticated session."
          : "The menu catalog could not be downloaded.");
        if(authenticationRequired) error.code = "AUTH_REQUIRED";
        throw error;
      }
      source = await response.text();
    } finally { clearTimeout(timeout); }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== revision) throw new Error("Catalog revision mismatch.");
    // One parse, detached from the live UI. Search never mounts the entire catalog.
    const doc = new DOMParser().parseFromString(source, "text/html");
    catalog = { revision, source, doc,
      menus: Array.from(doc.querySelectorAll(".dropdown-content")),
      links: Array.from(doc.querySelectorAll("a")) };
    // This positional lookup is only for standalone shell actions. The complete
    // catalog/search/LIVE tree remains in doc; avoid pinning extra JS wrappers
    // for every other link in a second array. Preserve all lookup indices.
    const standaloneIndices = new Set(Array.from(document.querySelectorAll("[data-sr-catalog-link]"),
      node => Number(node.dataset.srCatalogLink)));
    catalog.links.forEach((link, index) => {
      if (!standaloneIndices.has(index)) catalog.links[index] = null;
    });
    window.dispatchEvent(new CustomEvent("sr:catalog-ready", { detail: catalog }));
    prepareMenusInIdle();
    return catalog;
  }

  function getSrCatalog() {
    if (!catalogPromise) {
      if(navigator.onLine === false || Date.now() < retryAt) {
        return Promise.reject(lastError || new Error("Catalog is offline."));
      }
      const pending = loadCatalog().then(data => {
        lastError = null; failures = 0; retryAt = 0;
        return data;
      }).catch(error => {
        lastError = error;
        retryAt = Date.now() + Math.min(10000, 500 * 2 ** Math.min(failures++, 5)) * (1 + Math.random() * .2);
        if(catalogPromise === pending) catalogPromise = null;
        throw error;
      });
      catalogPromise = pending;
    }
    return catalogPromise;
  }

  function showCatalogError(root, error) {
    if(!root || root.querySelector(':scope > [data-sr-catalog-error]')) return;
    const status = document.createElement('span');
    status.dataset.srCatalogError = '1';
    status.setAttribute('role', 'status');
    if(error?.code === "LOCAL_FILE") {
      status.textContent = 'النسخة المحلية لا تحتوي على بيانات القوائم. افتح MyTime المتصل: ';
    } else if(error?.code === "AUTH_REQUIRED") {
      status.textContent = 'تعذّر الوصول للقوائم. افتح MyTime وسجّل الدخول: ';
    } else {
      status.textContent = 'تعذّر تحميل القوائم. تحقق من الاتصال وحاول مجددًا. ';
    }
    const openApp = document.createElement('a');
    openApp.href = appUrl;
    openApp.target = '_blank';
    openApp.rel = 'noopener noreferrer';
    openApp.textContent = 'فتح MyTime';
    status.appendChild(openApp);
    if(location.protocol === "file:") {
      root.appendChild(status);
      return;
    }
    status.appendChild(document.createTextNode(' '));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.dataset.srCatalogRetry = root.id;
    retry.textContent = 'إعادة المحاولة';
    status.appendChild(retry);
    root.appendChild(status);
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-sr-catalog-retry]');
    if(!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    button.disabled = true;
    mountTab(button.dataset.srCatalogRetry).catch(() => {})
      .finally(() => { button.disabled = false; });
  }, true);
  window.addEventListener('online', () => {
    if(lastError && document.visibilityState !== 'hidden') getSrCatalog().catch(() => {});
  });

  function mountTab(tabId) {
    if (mounts.has(tabId)) return mounts.get(tabId);
    const root = document.getElementById(tabId);
    const targets = Array.from(document.querySelectorAll("[data-sr-catalog-tab]"))
      .filter(node => node.dataset.srCatalogTab === tabId);
    if (!root || !targets.length) {
      const ready = Promise.resolve(root);
      mounts.set(tabId, ready);
      return ready;
    }
    root.querySelector(':scope > [data-sr-catalog-error]')?.remove();
    const pending = getSrCatalog().then(data => {
      const fragments = [];
      targets.filter(node => node.hasAttribute("data-sr-catalog-mount")).forEach(target => {
        const index = Number(target.dataset.srCatalogMount);
        const fragment = prepareMenu(index);
        if (!fragment) throw new Error("Catalog menu was already mounted.");
        fragments.push(fragment);
        target.replaceChildren(fragment);
        // Keep the prepared marker so the idle loop never constructs it again,
        // but release the now-empty fragment wrapper after its nodes are mounted.
        preparedMenus.set(index, null);
        target.removeAttribute("data-sr-catalog-mount");
        target.removeAttribute("data-sr-catalog-tab");
      });
      const standaloneLinks = targets.filter(node => node.hasAttribute("data-sr-catalog-link"));
      standaloneLinks.forEach(target => {
        const index = Number(target.dataset.srCatalogLink);
        const link = data.links[index];
        if (!link) throw new Error("Missing catalog action.");
        Array.from(target.attributes).forEach(attr => {
          if (!link.hasAttribute(attr.name)) target.removeAttribute(attr.name);
        });
        Array.from(link.attributes).forEach(attr => target.setAttribute(attr.name, attr.value));
        target.removeAttribute("data-sr-catalog-link");
        target.removeAttribute("data-sr-catalog-tab");
        // Lazy hydration may reintroduce the old marker from the catalog
        // asset; normalize this individual link without changing its order.
        if (target.classList.contains("sr-direct-action") &&
            !target.closest(".dropdown, .sub-dropdown")) {
          target.classList.remove("sr-direct-action");
          if (!target.classList.length) target.removeAttribute("class");
        }
        data.links[index] = null;
      });
      window.dispatchEvent(new CustomEvent("sr:catalog-mounted", { detail: { root: document, fragments, standaloneLinks } }));
      return root;
    }).catch(error => {
      if(mounts.get(tabId) === pending) mounts.delete(tabId);
      showCatalogError(root, error);
      throw error;
    });
    mounts.set(tabId, pending);
    return pending;
  }

  function prepareMenu(index) {
    if (preparedMenus.has(index)) return preparedMenus.get(index);
    const menu = catalog.menus[index];
    if (!menu) throw new Error("Missing catalog menu.");
    const fragment = document.createDocumentFragment();
    menu.childNodes.forEach(child => fragment.appendChild(document.importNode(child, true)));
    window.dispatchEvent(new CustomEvent("sr:catalog-prepared", { detail: { root: fragment, sourceDocument: catalog.doc } }));
    preparedMenus.set(index, fragment);
    // The prepared cache owns this menu from now on, including its consumed
    // marker after mounting. LIVE/late guards use the intact source document.
    catalog.menus[index] = null;
    return fragment;
  }

  function prepareMenusInIdle() {
    let index = 0;
    const run = deadline => {
      // One menu is the bounded unit. Yield between menus instead of building
      // hundreds of category trees in one long task. Intent reuses any prepared
      // fragments and synchronously prepares only the missing selected menus.
      let prepared = 0;
      while (index < catalog.menus.length && (prepared === 0 ||
        (deadline && deadline.timeRemaining() > 4 && prepared < 8))) {
        prepareMenu(index++);
        prepared++;
      }
      if (index < catalog.menus.length) schedule(run);
    };
    schedule(run);
  }

  function schedule(run) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1800 });
    else setTimeout(() => run(null), 16);
  }

  function prewarm() {
    if (scheduled) return;
    scheduled = true;
    // The caller invokes this only after critical app handlers are installed.
    // Yield a paint and a task before the idle slot, including the fallback.
    requestAnimationFrame(() => setTimeout(() => {
      const run = () => { getSrCatalog().catch(() => {}); };
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1800 });
      else setTimeout(run, 500);
    }, 0));
  }

  // A standalone action can be clicked before the tab's async mount completes.
  // Replay its existing handler only after the same in-flight request resolves.
  document.addEventListener("click", event => {
    const link = event.target?.closest?.("[data-sr-catalog-link]");
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    link.setAttribute("aria-busy", "true");
    mountTab(link.dataset.srCatalogTab).then(() => link.click()).catch(() => {})
      .finally(() => link.removeAttribute("aria-busy"));
  }, true);

  // Legacy malformed HTML exposes a few dropdowns outside their tab root.
  // Keep their positions and behavior: hovering/focusing their original button
  // mounts their associated payload through the same cached tab promise.
  function onMenuIntent(event) {
    const menu = event.target?.closest?.(".dropdown")?.querySelector("[data-sr-catalog-mount]");
    if (!menu) return;
    let status = null;
    if (!catalog) {
      status = menu.querySelector("[data-sr-catalog-status]");
      if (!status) {
        status = document.createElement("span");
        status.dataset.srCatalogStatus = "1";
        status.setAttribute("role", "status");
        status.textContent = "جارٍ تحميل القوائم…";
        menu.appendChild(status);
      }
    }
    mountTab(menu.dataset.srCatalogTab).catch(() => {
      if (status?.isConnected) status.textContent = "تعذّر تحميل القوائم. استخدم إعادة المحاولة.";
    });
  }
  document.addEventListener("pointerover", onMenuIntent, true);
  document.addEventListener("focusin", onMenuIntent, true);
  document.addEventListener("touchstart", onMenuIntent, { capture: true, passive: true });

  window.__srCatalog = Object.freeze({ get: getSrCatalog, peek: () => catalog, mountTab, prewarm,
    stats: () => ({ preparedMenus: preparedMenus.size, mountedTabs: mounts.size,
      retainedFragments: Array.from(preparedMenus.values()).filter(Boolean).length }) });
})();

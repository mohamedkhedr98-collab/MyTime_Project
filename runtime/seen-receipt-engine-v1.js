// Shared seen-receipt engine for Support + Suggestions.
// Event driven only: no polling. One popover broker survives DOM rerenders.

const broker = (() => {
  let active = null;
  let frame = 0;
  let seq = 0;

  function escapeHtml(value){
    return String(value == null ? "" : value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }

  function ensureStyles(){
    if(document.getElementById("sr-seen-receipt-core-styles")) return;
    const style = document.createElement("style");
    style.id = "sr-seen-receipt-core-styles";
    style.textContent = `
      #srSeenReceiptPopover{position:fixed;z-index:2147483300;width:min(310px,calc(100vw - 16px));max-height:min(390px,calc(100vh - 18px));overflow:hidden;padding:9px;border:1px solid rgba(148,163,184,.28);border-radius:13px;background:linear-gradient(155deg,rgba(17,24,39,.995),rgba(8,13,24,.995));color:#f8fafc;box-shadow:0 22px 56px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.06);text-align:start;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
      #srSeenReceiptPopover[hidden]{display:none!important}
      #srSeenReceiptPopover .sr-seen-title{position:sticky;top:0;z-index:1;font-size:11px;font-weight:900;margin:0 0 6px;padding:2px 2px 7px;border-bottom:1px solid rgba(148,163,184,.14);background:linear-gradient(180deg,rgba(17,24,39,.99),rgba(17,24,39,.93));opacity:.96}
      #srSeenReceiptPopover .sr-seen-body{max-height:min(330px,calc(100vh - 88px));overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
      #srSeenReceiptPopover .sr-seen-reader{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:7px 4px;border-top:1px solid rgba(148,163,184,.12);font-size:11px}
      #srSeenReceiptPopover .sr-seen-reader:first-of-type{border-top:0}
      #srSeenReceiptPopover .sr-seen-reader b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
      #srSeenReceiptPopover .sr-seen-reader time{flex:0 0 auto;font-size:9px;opacity:.62}
      #srSeenReceiptPopover .sr-seen-empty,#srSeenReceiptPopover .sr-seen-loading{padding:7px 4px;font-size:10px;opacity:.7}
    `;
    document.head.appendChild(style);
  }

  function ensurePopover(){
    ensureStyles();
    let popover = document.getElementById("srSeenReceiptPopover");
    if(popover) return popover;
    popover = document.createElement("div");
    popover.id = "srSeenReceiptPopover";
    popover.hidden = true;
    popover.setAttribute("role","dialog");
    popover.setAttribute("aria-label","Seen by");
    popover.innerHTML = '<div class="sr-seen-title">Seen by</div><div class="sr-seen-body"></div>';
    document.body.appendChild(popover);
    return popover;
  }

  function currentButton(){
    if(!active) return null;
    try{ return active.getButton?.(active.item) || null; }
    catch{ return null; }
  }

  function position(){
    const popover = ensurePopover();
    if(!active || popover.hidden) return;
    if(frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if(!active || popover.hidden) return;
      const button = currentButton();
      if(!button?.isConnected) return;

      const rect = button.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const margin = 8;
      const gap = 7;
      const width = Math.min(310, Math.max(220, vw - margin * 2));

      popover.style.width = width + "px";
      popover.style.left = Math.max(margin, Math.min(vw - width - margin, rect.right - width)) + "px";

      const measuredHeight = Math.min(popover.scrollHeight || 260, Math.max(120, vh - margin * 2));
      const below = vh - rect.bottom - margin;
      const above = rect.top - margin;
      const top = below >= Math.min(measuredHeight, 260) || below >= above
        ? Math.min(vh - measuredHeight - margin, rect.bottom + gap)
        : Math.max(margin, rect.top - measuredHeight - gap);

      popover.style.top = Math.max(margin, top) + "px";
    });
  }

  function close(){
    const button = currentButton();
    button?.setAttribute?.("aria-expanded","false");
    const popover = ensurePopover();
    popover.hidden = true;
    popover.removeAttribute("data-seen-owner");
    popover.removeAttribute("data-seen-key");
    active = null;
    seq += 1;
  }

  function reanchor(owner){
    if(!active || active.owner !== owner) return;
    const button = currentButton();
    if(button?.isConnected){
      button.setAttribute("aria-expanded","true");
      position();
    }
  }

  async function open(config){
    const key = String(config?.key || "");
    const owner = String(config?.owner || "");
    if(!key || !owner) return;

    const popover = ensurePopover();
    if(active && active.owner === owner && active.key === key && !popover.hidden){
      close();
      return;
    }

    close();
    const token = ++seq;
    active = {
      owner,
      key,
      item:config.item,
      getButton:config.getButton,
    };

    const button = currentButton();
    if(!button) {
      active = null;
      return;
    }

    button.setAttribute("aria-expanded","true");
    popover.dataset.seenOwner = owner;
    popover.dataset.seenKey = key;
    popover.hidden = false;

    const title = popover.querySelector(".sr-seen-title");
    const body = popover.querySelector(".sr-seen-body");
    const initial = Math.max(0, Number(config?.count || 0));
    if(title) title.textContent = `Seen by ${initial}`;
    if(body) body.innerHTML = '<div class="sr-seen-loading">Loading…</div>';
    position();

    try{
      const result = await config.loadDetails(config.item);
      if(!active || token !== seq || active.owner !== owner || active.key !== key || popover.hidden) return;

      if(result?.available === false){
        if(body) body.innerHTML = '<div class="sr-seen-empty">Seen receipts are unavailable.</div>';
        position();
        return;
      }

      const count = Math.max(0, Math.floor(Number(result?.read_count || 0)));
      config.setCount?.(config.item, count, true);
      if(title) title.textContent = `Seen by ${count}`;

      const readers = Array.isArray(result?.readers) ? result.readers : [];
      if(body){
        body.innerHTML = readers.length
          ? readers.map((reader) => {
              let when = "";
              try{
                const date = new Date(reader?.read_at);
                if(Number.isFinite(date.getTime())) when = date.toLocaleString();
              }catch{}
              return `<div class="sr-seen-reader"><b>${escapeHtml(reader?.name || "User")}</b><time title="${escapeHtml(when)}">${escapeHtml(when)}</time></div>`;
            }).join("")
          : '<div class="sr-seen-empty">No viewers yet.</div>';
      }
      position();
    }catch{
      if(active && token === seq && active.owner === owner && active.key === key && !popover.hidden){
        if(body) body.innerHTML = '<div class="sr-seen-empty">Could not load viewers.</div>';
        position();
      }
    }
  }

  document.addEventListener("click", (event) => {
    if(event.target?.closest?.("#srSeenReceiptPopover")) return;
    if(active && !event.target?.closest?.("[data-sr-seen-button='1']")) close();
  }, true);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);

  return Object.freeze({ open, close, reanchor, position });
})();

export function createSeenReceiptEngine(config = {}){
  const owner = String(config.owner || "");
  const maxBatch = Math.max(1, Number(config.maxBatch) || 400);
  const dwellMs = Math.max(100, Number(config.dwellMs) || 650);
  const summaryMinIntervalMs = Math.max(0, Number(config.summaryMinIntervalMs) || 1500);
  const counts = new Map();
  const observed = new WeakSet();
  const timers = new WeakMap();
  const pending = new Map();

  let observer = null;
  let markTimer = 0;
  let summaryTimer = 0;
  let summaryInFlight = false;
  let summaryQueued = false;
  let lastSummaryAt = 0;
  let installed = false;

  function keyOf(item){
    try{ return String(config.keyOf?.(item) || ""); }
    catch{ return ""; }
  }

  function getState(element, item){
    const key = keyOf(item);
    if(counts.has(key)) return { known:true, count:counts.get(key) };
    try{
      const state = config.initialState?.(element, item);
      if(state?.known){
        const count = Math.max(0, Math.floor(Number(state.count || 0)));
        counts.set(key, count);
        return { known:true, count };
      }
    }catch{}
    return { known:false, count:0 };
  }

  function setCount(item, count, known = true){
    const key = keyOf(item);
    if(!key) return;
    const safe = Math.max(0, Math.floor(Number(count || 0)));
    if(known) counts.set(key, safe);
    try{ config.setCountUi?.(item, safe, known); }catch{}
  }

  function findButton(item){
    try{ return config.findButton?.(item) || null; }
    catch{ return null; }
  }

  function elements(){
    try{ return Array.from(config.elements?.() || []); }
    catch{ return []; }
  }

  function itemForElement(element){
    try{ return config.itemForElement?.(element) || null; }
    catch{ return null; }
  }

  function renderedItems(){
    const out = [];
    const seen = new Set();
    for(const element of elements()){
      const item = itemForElement(element);
      const key = keyOf(item);
      if(!item || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if(out.length >= maxBatch) break;
    }
    return out;
  }

  async function post(body){
    const response = await fetch(config.api, {
      method:"POST",
      credentials:"same-origin",
      headers:{ "content-type":"application/json", "accept":"application/json" },
      body:JSON.stringify(body || {}),
      cache:"no-store",
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(data?.error || "Seen receipts unavailable.");
    return data;
  }

  function applySummary(summary){
    if(!summary || typeof summary !== "object") return;
    try{
      const entries = config.summaryEntries?.(summary) || [];
      for(const entry of entries){
        if(!entry?.item) continue;
        setCount(entry.item, entry.count, true);
      }
    }catch{}
  }

  function queueMark(item){
    const key = keyOf(item);
    if(!key) return;
    pending.set(key, item);
    if(markTimer) return;
    markTimer = setTimeout(flushMarks, 160);
  }

  async function flushMarks(){
    if(markTimer){
      clearTimeout(markTimer);
      markTimer = 0;
    }
    const items = Array.from(pending.values()).slice(0, maxBatch);
    pending.clear();
    if(!items.length) return;

    try{
      const data = await post(config.markBody(items));
      if(data?.available === false) return;
      applySummary(data?.summary);
      config.onMarked?.(data, items);
    }catch(error){
      console.warn(owner + " seen receipt mark failed", error);
    }
  }

  function meaningful(element, entry){
    try{ return config.meaningfulVisibility?.(element, entry) === true; }
    catch{ return false; }
  }

  function installObserver(){
    if(observer || typeof IntersectionObserver !== "function") return;
    observer = new IntersectionObserver((entries) => {
      for(const entry of entries){
        const element = entry.target;
        const old = timers.get(element);
        if(old){
          clearTimeout(old);
          timers.delete(element);
        }
        if(document.visibilityState !== "visible" || !meaningful(element, entry)) continue;

        const item = itemForElement(element);
        if(!item) continue;

        const timer = setTimeout(() => {
          timers.delete(element);
          if(document.visibilityState !== "visible") return;
          try{
            if(config.canMarkNow?.(element, item) !== true) return;
          }catch{ return; }
          queueMark(item);
        }, dwellMs);
        timers.set(element, timer);
      }
    }, { threshold:[0,0.45,1] });
  }

  function scan({ hydrateSummary = false, forceSummary = false } = {}){
    for(const element of elements()){
      const item = itemForElement(element);
      if(!item) continue;
      const state = getState(element, item);
      try{ config.ensureUi?.(element, item, state); }catch{}
      if(observer && !observed.has(element)){
        observed.add(element);
        observer.observe(element);
      }
      if(state.known) setCount(item, state.count, true);
    }
    broker.reanchor(owner);
    if(hydrateSummary) scheduleSummary(40, forceSummary);
  }

  async function refreshSummary(force = false){
    const now = Date.now();
    if(!force && lastSummaryAt && (now - lastSummaryAt) < summaryMinIntervalMs) return;
    if(summaryInFlight){
      summaryQueued = true;
      return;
    }

    const items = renderedItems();
    if(!items.length) return;
    lastSummaryAt = now;
    summaryInFlight = true;

    try{
      const data = await post(config.summaryBody(items));
      if(data?.available !== false) applySummary(data?.summary);
    }catch(error){
      console.warn(owner + " seen receipt summary unavailable", error);
    }finally{
      summaryInFlight = false;
      if(summaryQueued){
        summaryQueued = false;
        scheduleSummary(120, false);
      }
    }
  }

  function scheduleSummary(delay = 100, force = false){
    if(summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      summaryTimer = 0;
      refreshSummary(force);
    }, Math.max(20, Number(delay) || 0));
  }

  async function openDetails(button){
    const item = config.itemForButton?.(button);
    const key = keyOf(item);
    if(!item || !key) return;
    const count = counts.get(key) || 0;

    await broker.open({
      owner,
      key,
      item,
      count,
      getButton:findButton,
      setCount,
      loadDetails:async (wanted) => post(config.detailsBody(wanted)),
    });
  }

  function onClick(event){
    const button = event.target?.closest?.(config.buttonSelector);
    if(!button) return;
    event.preventDefault();
    event.stopPropagation();
    openDetails(button);
  }

  function onRendered(){
    scan({ hydrateSummary:true, forceSummary:false });
  }

  function install(){
    if(installed) return;
    installed = true;
    config.installStyles?.();
    installObserver();
    document.addEventListener("click", onClick, true);
    if(config.renderEvent) window.addEventListener(config.renderEvent, onRendered);
    scan({ hydrateSummary:true, forceSummary:true });
  }

  return Object.freeze({
    install,
    scan,
    refresh:() => scan({ hydrateSummary:true, forceSummary:true }),
    setCount,
    scheduleSummary,
    close:() => broker.close(),
  });
}

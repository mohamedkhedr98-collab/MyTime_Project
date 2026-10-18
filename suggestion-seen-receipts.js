import { createSeenReceiptEngine } from "./runtime/seen-receipt-engine-v1.js";

const API = "/api/suggestion-seen-receipts";

function positiveId(value){
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function itemForElement(element){
  if(!element) return null;
  if(element.matches?.(".suggestion-item[data-id]")){
    const id = positiveId(element.getAttribute("data-id"));
    return id ? { type:"suggestion", id } : null;
  }
  if(element.matches?.(".sug-reply-item[data-reply-id]")){
    const id = positiveId(element.getAttribute("data-reply-id"));
    return id ? { type:"reply", id } : null;
  }
  return null;
}

function keyOf(item){
  const type = String(item?.type || "");
  const id = positiveId(item?.id);
  return (type === "suggestion" || type === "reply") && id ? type + ":" + id : "";
}

function findButton(item){
  const key = keyOf(item);
  if(!key) return null;
  return Array.from(document.querySelectorAll(".sr-sug-seen-btn[data-seen-key]"))
    .find((button) => String(button.dataset.seenKey || "") === key) || null;
}

function installStyles(){
  if(document.getElementById("sr-suggestion-seen-styles")) return;
  const style = document.createElement("style");
  style.id = "sr-suggestion-seen-styles";
  style.textContent = `
    .sr-sug-seen-wrap{position:relative;display:inline-flex;align-items:center;margin-inline-start:auto}
    .sr-sug-seen-btn{display:inline-flex;align-items:center;gap:4px;min-height:24px;padding:2px 7px;border:1px solid rgba(148,163,184,.22);border-radius:999px;background:rgba(15,23,42,.26);color:inherit;font:inherit;font-size:10px;font-weight:800;line-height:1;cursor:pointer;opacity:.78}
    .sr-sug-seen-btn:hover,.sr-sug-seen-btn:focus-visible{opacity:1;border-color:rgba(56,189,248,.55);background:rgba(14,165,233,.13);outline:none}
    .sr-sug-seen-eye{font-size:12px;line-height:1}
    .suggestion-meta .sr-sug-seen-wrap,.sug-reply-meta .sr-sug-seen-wrap{margin-inline-start:auto;margin-inline-end:6px}
  `;
  document.head.appendChild(style);
}

function ensureUi(element, item, state){
  const key = keyOf(item);
  if(!key || findButton(item)) return;

  const meta = item.type === "suggestion"
    ? element.querySelector(".suggestion-meta")
    : element.querySelector(".sug-reply-meta");
  if(!meta) return;

  const wrap = document.createElement("span");
  wrap.className = "sr-sug-seen-wrap";
  wrap.innerHTML = `
    <button type="button" class="sr-sug-seen-btn" data-sr-seen-button="1" data-sr-seen-owner="suggestions" data-seen-key="${key}" data-item-type="${item.type}" data-item-id="${item.id}" aria-label="${state?.known ? `Seen by ${state.count}` : "Seen count loading"}" aria-expanded="false" title="${state?.known ? (state.count ? `Seen by ${state.count} — click for names` : "No viewers yet") : "Loading viewers"}">
      <span class="sr-sug-seen-eye" aria-hidden="true">👁</span>
      <span class="sr-sug-seen-count">${state?.known ? state.count : ""}</span>
    </button>
  `;

  const when = item.type === "suggestion"
    ? meta.querySelector(".suggestion-when")
    : meta.querySelector(".sug-reply-when");
  if(when) meta.insertBefore(wrap, when);
  else meta.appendChild(wrap);
}

function setCountUi(item, count, known){
  const safe = Math.max(0, Math.floor(Number(count || 0)));
  const button = findButton(item);
  if(!button) return;
  const countEl = button.querySelector(".sr-sug-seen-count");
  if(countEl) countEl.textContent = known ? String(safe) : "";
  button.setAttribute("aria-label", known ? `Seen by ${safe}` : "Seen count loading");
  button.title = known
    ? (safe ? `Seen by ${safe} — click for names` : "No viewers yet")
    : "Loading viewers";
}

function panelOpen(){
  return !!document.getElementById("suggestionsOverlay")?.classList?.contains("is-open");
}

function meaningfulVisibility(element, entry){
  if(!panelOpen() || document.visibilityState !== "visible" || !entry?.isIntersecting) return false;
  const height = Number(entry?.boundingClientRect?.height || 0);
  const visible = Number(entry?.intersectionRect?.height || 0);
  if(height <= 0 || visible <= 0) return false;
  return Number(entry.intersectionRatio || 0) >= 0.45 || visible >= Math.min(180, height * 0.45);
}

function canMarkNow(element){
  if(!panelOpen() || document.visibilityState !== "visible") return false;
  const rect = element?.getBoundingClientRect?.();
  const overlay = document.getElementById("suggestionsOverlay");
  const panel = overlay?.querySelector?.(".suggestions-panel,.suggestions-modal");
  const rootRect = panel?.getBoundingClientRect?.();
  if(!rect || !rootRect) return false;
  return rect.bottom > rootRect.top && rect.top < rootRect.bottom;
}

function summaryEntries(summary){
  const out = [];
  for(const [key, value] of Object.entries(summary || {})){
    const [type, rawId] = String(key).split(":");
    const id = positiveId(rawId);
    if((type !== "suggestion" && type !== "reply") || !id) continue;
    out.push({ item:{ type, id }, count:value?.read_count || 0 });
  }
  return out;
}

const engine = createSeenReceiptEngine({
  owner:"suggestions",
  api:API,
  maxBatch:350,
  dwellMs:650,
  summaryMinIntervalMs:1800,
  buttonSelector:".sr-sug-seen-btn[data-sr-seen-button='1'][data-item-type][data-item-id]",
  renderEvent:"sr:suggestions-rendered",
  elements:() => document.querySelectorAll(".suggestion-item[data-id],.sug-reply-item[data-reply-id]"),
  itemForElement,
  keyOf,
  initialState:() => ({ known:false, count:0 }),
  installStyles,
  ensureUi,
  setCountUi,
  findButton,
  itemForButton:(button) => {
    const type = String(button?.dataset?.itemType || "");
    const id = positiveId(button?.dataset?.itemId);
    return (type === "suggestion" || type === "reply") && id ? { type, id } : null;
  },
  meaningfulVisibility,
  canMarkNow,
  markBody:(items) => ({ action:"mark", items }),
  summaryBody:(items) => ({ action:"summary", items }),
  detailsBody:(item) => ({ action:"details", item }),
  summaryEntries,
});

let installed = false;

export function installSuggestionSeenReceipts(){
  if(installed) return;
  installed = true;
  engine.install();
}

window.__srSuggestionSeenReceipts = Object.freeze({
  install:installSuggestionSeenReceipts,
  refresh:() => engine.refresh(),
});

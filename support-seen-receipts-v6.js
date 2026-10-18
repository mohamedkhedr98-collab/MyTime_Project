import { createSeenReceiptEngine } from "./runtime/seen-receipt-engine-v1.js";

const API = "/api/support-seen-v2";

function positiveId(value){
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function messagesRoot(){
  return document.getElementById("supportMessagesList");
}

function itemForElement(element){
  if(!element?.matches?.(".support-msg[data-support-msg-id]")) return null;
  const id = positiveId(element.getAttribute("data-support-msg-id"));
  return id ? { id } : null;
}

function keyOf(item){
  const id = positiveId(item?.id);
  return id ? "message:" + id : "";
}

function rowElement(item){
  const id = positiveId(item?.id);
  return id ? messagesRoot()?.querySelector?.(`.support-msg[data-support-msg-id="${id}"]`) || null : null;
}

function findButton(item){
  const id = positiveId(item?.id);
  return id ? messagesRoot()?.querySelector?.(`.sr-support-seen-btn[data-message-id="${id}"]`) || null : null;
}

function installStyles(){
  if(document.getElementById("sr-support-seen-clean-styles")) return;
  const style = document.createElement("style");
  style.id = "sr-support-seen-clean-styles";
  style.textContent = `
    .sr-support-seen-wrap{position:relative;display:inline-flex;align-items:center;margin-inline-start:3px}
    .sr-support-seen-btn{display:inline-flex;align-items:center;gap:4px;min-height:24px;padding:2px 7px;border:1px solid rgba(148,163,184,.22);border-radius:999px;background:rgba(15,23,42,.26);color:inherit;font:inherit;font-size:10px;font-weight:800;line-height:1;cursor:pointer;opacity:.78}
    .sr-support-seen-btn:hover,.sr-support-seen-btn:focus-visible{opacity:1;border-color:rgba(56,189,248,.55);background:rgba(14,165,233,.13);outline:none}
    .sr-support-seen-btn[data-count-known="0"] .sr-support-seen-count{display:none}
    .sr-support-seen-eye{font-size:12px;line-height:1}
  `;
  document.head.appendChild(style);
}

function initialState(element){
  const known = element?.dataset?.supportReadKnown === "1";
  const raw = Number(element?.dataset?.supportReadCount);
  return known && Number.isFinite(raw) && raw >= 0
    ? { known:true, count:Math.floor(raw) }
    : { known:false, count:0 };
}

function ensureUi(element, item, state){
  const id = positiveId(item?.id);
  if(!id) return;
  const host = element.querySelector(":scope > .support-msg-interactions");
  if(!host || findButton(item)) return;

  const wrap = document.createElement("span");
  wrap.className = "sr-support-seen-wrap";
  wrap.innerHTML = `
    <button type="button" class="sr-support-seen-btn" data-sr-seen-button="1" data-sr-seen-owner="support" data-message-id="${id}" data-count-known="${state?.known ? "1" : "0"}" aria-label="${state?.known ? `Seen by ${state.count}` : "Seen count loading"}" aria-expanded="false" title="${state?.known ? (state.count ? `Seen by ${state.count} — click for names` : "No viewers yet") : "Loading viewers"}">
      <span class="sr-support-seen-eye" aria-hidden="true">👁</span>
      <span class="sr-support-seen-count">${state?.known ? state.count : ""}</span>
    </button>
  `;
  host.appendChild(wrap);
}

function setCountUi(item, count, known){
  const safe = Math.max(0, Math.floor(Number(count || 0)));
  const row = rowElement(item);
  if(row){
    row.dataset.supportReadKnown = known ? "1" : "0";
    row.dataset.supportReadCount = String(safe);
  }

  const button = findButton(item);
  if(!button) return;
  button.dataset.countKnown = known ? "1" : "0";
  const countEl = button.querySelector(".sr-support-seen-count");
  if(countEl) countEl.textContent = known ? String(safe) : "";
  button.setAttribute("aria-label", known ? `Seen by ${safe}` : "Seen count loading");
  button.title = known
    ? (safe ? `Seen by ${safe} — click for names` : "No viewers yet")
    : "Loading viewers";
}

function panelOpen(){
  const overlay = document.getElementById("supportChatOverlay");
  if(!overlay) return false;
  if(overlay.getAttribute("aria-hidden") === "false") return true;
  const style = getComputedStyle(overlay);
  return style.display !== "none" && style.visibility !== "hidden";
}

function foreground(){
  if(document.visibilityState !== "visible") return false;
  if(typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  return true;
}

function meaningfulVisibility(element, entry){
  if(!panelOpen() || !foreground() || !entry?.isIntersecting) return false;
  const height = Number(entry?.boundingClientRect?.height || 0);
  const visible = Number(entry?.intersectionRect?.height || 0);
  if(height <= 0 || visible <= 0) return false;
  return Number(entry.intersectionRatio || 0) >= 0.45 || visible >= Math.min(180, height * 0.45);
}

function canMarkNow(element){
  if(!panelOpen() || !foreground()) return false;
  const rootRect = messagesRoot()?.getBoundingClientRect?.();
  const rect = element?.getBoundingClientRect?.();
  return !!rootRect && !!rect && rect.bottom > rootRect.top && rect.top < rootRect.bottom;
}

function summaryEntries(summary){
  return Object.entries(summary || {}).map(([rawId, value]) => ({
    item:{ id:positiveId(rawId) },
    count:value?.read_count || 0,
  })).filter((entry) => entry.item.id);
}

const engine = createSeenReceiptEngine({
  owner:"support",
  api:API,
  maxBatch:500,
  dwellMs:650,
  summaryMinIntervalMs:1800,
  buttonSelector:".sr-support-seen-btn[data-sr-seen-button='1'][data-message-id]",
  renderEvent:"sr:support-dom-changed",
  elements:() => messagesRoot()?.querySelectorAll?.(".support-msg[data-support-msg-id]") || [],
  itemForElement,
  keyOf,
  initialState,
  installStyles,
  ensureUi,
  setCountUi,
  findButton,
  itemForButton:(button) => {
    const id = positiveId(button?.dataset?.messageId);
    return id ? { id } : null;
  },
  meaningfulVisibility,
  canMarkNow,
  markBody:(items) => ({ action:"mark", message_ids:items.map((item) => positiveId(item?.id)).filter(Boolean) }),
  summaryBody:(items) => ({ action:"summary", message_ids:items.map((item) => positiveId(item?.id)).filter(Boolean) }),
  detailsBody:(item) => ({ action:"details", message_id:positiveId(item?.id) }),
  summaryEntries,
  onMarked:(data, items) => {
    const ids = Array.isArray(data?.message_ids)
      ? data.message_ids.map(positiveId).filter(Boolean)
      : items.map((item) => positiveId(item?.id)).filter(Boolean);
    try{
      window.dispatchEvent(new CustomEvent("sr:support-seen-marked", { detail:{ message_ids:ids } }));
    }catch{}
  },
});

let installed = false;

function onRealtimeSeen(event){
  const detail = event?.detail || {};
  if(String(detail?.group || "") !== "support") return;
  if(String(detail?.table || "") !== "support_message_reads") return;
  const id = positiveId(detail?.message_id);
  const count = Number(detail?.read_count);
  if(!id || !Number.isFinite(count)) return;
  engine.setCount({ id }, Math.max(0, Math.floor(count)), true);
}

export function installSupportSeenReceipts(){
  if(installed) return;
  installed = true;
  engine.install();
  window.addEventListener("sr:realtime-invalidated", onRealtimeSeen);
}

window.__srSupportSeenReceipts = Object.freeze({
  install:installSupportSeenReceipts,
  refresh:() => engine.refresh(),
});

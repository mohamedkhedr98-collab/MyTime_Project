import { supabase as sharedSupabase } from "./supabase-client.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_NAME } from "./supabase-config.js";
import { getStableUserId, aliasForUserId, getStoredUserName, requireNicknameLogin } from "./stable-user-identity.js";
import { playSoftNotification } from "./notification-sound.js";
import { createActionGate } from "./runtime/action-gate-v11.js";

const elInput = document.getElementById("suggestionInput");
const elBtn = document.getElementById("suggestionAddBtn");
const elStatus = document.getElementById("suggestionStatus");
const elList = document.getElementById("suggestionsList");

// UI controls (open/close)
const elOverlay = document.getElementById("suggestionsOverlay");
const elFab = document.getElementById("suggestionsFab");
const elClose = document.getElementById("suggestionsCloseBtn");
const badgeSuggestions = document.getElementById("badgeSuggestions");

// Targeted unread reply tracking. The database is the source of truth; the old
// local timestamp is used only once to avoid resurfacing historical items.
const LS_SUG_SEEN = "sr_suggestions_seen_at";
if(!localStorage.getItem(LS_SUG_SEEN)){
  try{ localStorage.setItem(LS_SUG_SEEN, new Date().toISOString()); }catch{}
}
const LEGACY_SUG_SEEN_AT = (() => {
  try{ return localStorage.getItem(LS_SUG_SEEN) || ""; }catch{ return ""; }
})();
function getSugSeenTs(){ const v = localStorage.getItem(LS_SUG_SEEN) || ""; return v ? Date.parse(v) : 0; }
function markSugSeen(){ try{ localStorage.setItem(LS_SUG_SEEN, new Date().toISOString()); }catch{} updateSugBadgeFromCache(); }
function setBadge(el, count){
  if(!el) return;
  const n = Number(count||0);
  if(n>0){ el.textContent = String(n); el.classList.add("is-on"); }
  else{ el.textContent = ""; el.classList.remove("is-on"); }
}

let sugCache = [];
let suggestionUnreadRows = [];
let suggestionUnreadBySuggestion = Object.create(null);
let suggestionMentionRows = [];
let suggestionMentionsBySuggestion = Object.create(null);
let suggestionNotificationsAvailable = false;
let suggestionNotificationsLoaded = false;
let mentionNotificationsAvailable = false;
let lastSuggestionUnreadCount = null;
let lastMentionUnreadCount = null;
let mentionRefreshTimer = 0;
let mentionRefreshInFlight = null;
let mentionRefreshQueued = false;
let initialHydrationPromise = null;
let suggestionEnhancementsStarted = false;

function runWhenIdle(fn, timeout = 1400){
  if(typeof requestIdleCallback === "function"){
    requestIdleCallback(fn, { timeout });
  }else{
    setTimeout(fn, Math.min(timeout, 1200));
  }
}

async function postSuggestionNotification(body){
  const res = await fetch("/api/suggestion-notifications", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "content-type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data?.error || "Could not load reply notifications.");
  return data;
}

async function postSuggestionMentions(body){
  const res = await fetch("/api/suggestion-mentions", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "content-type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data?.error || "Could not load mention notifications.");
  return data;
}

function groupMentionsBySuggestion(rows){
  const grouped = Object.create(null);
  for(const row of Array.isArray(rows) ? rows : []){
    const sid = Number(row?.suggestion_id);
    if(!Number.isSafeInteger(sid) || sid < 1) continue;
    const key = String(sid);
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}

function groupRepliesBySuggestion(rows){
  const grouped = Object.create(null);
  for(const row of Array.isArray(rows) ? rows : []){
    const sid = Number(row?.suggestion_id);
    if(!Number.isSafeInteger(sid) || sid < 1) continue;
    const key = String(sid);
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}

function applyTargetedSuggestionRealtime(detail = {}){
  const kind = String(detail?.notification_kind || "");
  if(kind === "suggestion_reply" && detail?.reply){
    const row = { ...detail.reply };
    const id = Number(row?.id);
    const sid = Number(row?.suggestion_id);
    if(!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(sid) || sid < 1) return false;

    const previous = targetedSuggestionUnreadCount();
    suggestionNotificationsAvailable = true;
    suggestionNotificationsLoaded = true;
    suggestionUnreadRows = [
      row,
      ...suggestionUnreadRows.filter((current) => Number(current?.id) !== id),
    ].slice(0, 500);
    suggestionUnreadBySuggestion = groupRepliesBySuggestion(suggestionUnreadRows);
    lastSuggestionUnreadCount = suggestionUnreadRows.length;
    updateSugBadgeFromCache();
    renderSuggestionUnreadIndicators();
    if(targetedSuggestionUnreadCount() > previous){
      try{ playSoftNotification(); }catch{}
    }
    return true;
  }

  if(kind === "suggestion_mention" && detail?.mention){
    const row = { ...detail.mention };
    const id = Number(row?.id);
    const sid = Number(row?.suggestion_id);
    if(!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(sid) || sid < 1) return false;

    const previous = targetedSuggestionUnreadCount();
    mentionNotificationsAvailable = true;
    suggestionMentionRows = [
      row,
      ...suggestionMentionRows.filter((current) => Number(current?.id) !== id),
    ].slice(0, 500);
    suggestionMentionsBySuggestion = groupMentionsBySuggestion(suggestionMentionRows);
    lastMentionUnreadCount = suggestionMentionRows.length;
    updateSugBadgeFromCache();
    renderSuggestionUnreadIndicators();
    if(targetedSuggestionUnreadCount() > previous){
      try{ playSoftNotification(); }catch{}
    }
    return true;
  }

  return false;
}

function unreadRepliesForSuggestion(suggestionId){
  const rows = suggestionUnreadBySuggestion[String(suggestionId || "")];
  return Array.isArray(rows) ? rows : [];
}

function unreadMentionsForSuggestion(suggestionId){
  const rows = suggestionMentionsBySuggestion[String(suggestionId || "")];
  return Array.isArray(rows) ? rows : [];
}

function targetedSuggestionUnreadCount(){
  const replyIds = new Set(
    suggestionUnreadRows
      .map((row) => Number(row?.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  let count = replyIds.size;

  for(const row of suggestionMentionRows){
    const replyId = Number(row?.reply_id);
    if(Number.isSafeInteger(replyId) && replyId > 0 && replyIds.has(replyId)) continue;
    count += 1;
  }
  return count;
}

function publishSuggestionUnreadState(){
  try{
    window.dispatchEvent(new CustomEvent("sr:suggestion-unread-state", {
      detail:{ count:targetedSuggestionUnreadCount() }
    }));
  }catch{}
}

function mentionIdsForInput(input){
  try{
    const ids = window.__srSuggestionMentionsLite?.getMentionUserIds?.(input);
    return Array.isArray(ids) ? ids : [];
  }catch{
    return [];
  }
}

function clearMentionsForInput(input){
  try{ window.__srSuggestionMentionsLite?.clear?.(input); }catch{}
}

function setAutoReplyMention(input, target){
  if(!input || !target) return false;
  const userId = String(target?.user_id || "").trim();
  const name = String(target?.name || "").trim();
  if(!userId || !name) return false;

  try{
    if(window.__srSuggestionMentionsLite?.setAutoMention?.(input, {
      user_id:userId,
      display_name:name,
    }) === true){
      return true;
    }
  }catch{}

  // Safe fallback if the optional mention UI module has not finished loading.
  const previousName = String(input.dataset?.srAutoMentionName || "").trim();
  let value = String(input.value || "");
  if(previousName && previousName !== name){
    const previousToken = "@" + previousName;
    if(value.startsWith(previousToken)){
      value = value.slice(previousToken.length);
      if(value.startsWith(" ")) value = value.slice(1);
    }
  }

  const token = "@" + name;
  if(!value.startsWith(token)){
    const prefix = token + " ";
    const limit = Number(input.maxLength || input.getAttribute?.("maxlength") || 0);
    if(limit > 0 && prefix.length + value.length > limit) return false;
    value = prefix + value;
  }

  input.value = value;
  input.dataset.srAutoMentionUserId = userId;
  input.dataset.srAutoMentionName = name;
  input.dispatchEvent(new Event("input", { bubbles:true }));
  try{
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }catch{}
  return true;
}

function clearAutoReplyMention(input){
  if(!input) return;
  try{
    if(window.__srSuggestionMentionsLite?.clearAutoMention?.(input) === true) return;
  }catch{}

  const name = String(input.dataset?.srAutoMentionName || "").trim();
  if(name){
    const token = "@" + name;
    let value = String(input.value || "");
    if(value.startsWith(token)){
      value = value.slice(token.length);
      if(value.startsWith(" ")) value = value.slice(1);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles:true }));
    }
  }
  try{
    delete input.dataset.srAutoMentionUserId;
    delete input.dataset.srAutoMentionName;
  }catch{}
}

function renderSuggestionUnreadIndicators(){
  const mentionedReplyIds = new Set(
    suggestionMentionRows
      .map((row) => Number(row?.reply_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );

  elList?.querySelectorAll?.(".suggestion-item[data-id]").forEach((card) => {
    const id = String(card.getAttribute("data-id") || "");
    const replyCount = unreadRepliesForSuggestion(id).length;
    const mentions = unreadMentionsForSuggestion(id);
    const mentionCount = mentions.length;
    const rootMentionCount = mentions.filter((row) => !Number(row?.reply_id)).length;
    const total = replyCount + mentionCount;

    card.classList.toggle("has-unread-reply", replyCount > 0);
    card.classList.toggle("has-unread-mention", mentionCount > 0);

    const meta = card.querySelector(".suggestion-meta");
    let mentionPill = card.querySelector(".sug-mentioned-you-pill");
    if(rootMentionCount > 0){
      if(!mentionPill && meta){
        mentionPill = document.createElement("span");
        mentionPill.className = "sug-mentioned-you-pill";
        meta.appendChild(mentionPill);
      }
      if(mentionPill) mentionPill.textContent = "Mentioned you";
    }else{
      mentionPill?.remove();
    }

    const button = card.querySelector("button.sug-replies-toggle");
    if(!button) return;
    let badge = button.querySelector(".sug-unread-replies-badge");

    if(total > 0){
      if(!badge){
        badge = document.createElement("span");
        badge.className = "sug-unread-replies-badge";
        button.appendChild(badge);
      }
      badge.textContent = mentionCount > 0
        ? (replyCount > 0 ? `@${mentionCount} +${replyCount}` : `@ you${mentionCount > 1 ? " " + mentionCount : ""}`)
        : `New ${replyCount}`;
      badge.setAttribute("aria-label", mentionCount > 0
        ? `${mentionCount} unread mention${mentionCount === 1 ? "" : "s"} for you`
        : `${replyCount} unread ${replyCount === 1 ? "reply" : "replies"}`);
    }else if(badge){
      badge.remove();
    }
  });

  elList?.querySelectorAll?.(".sug-reply-item[data-reply-id]").forEach((item) => {
    const replyId = Number(item.getAttribute("data-reply-id"));
    const mentioned = mentionedReplyIds.has(replyId);
    item.classList.toggle("has-unread-mention", mentioned);
    let pill = item.querySelector(".sug-reply-mentioned-you-pill");
    if(mentioned){
      if(!pill){
        pill = document.createElement("span");
        pill.className = "sug-reply-mentioned-you-pill";
        pill.textContent = "Mentioned you";
        item.querySelector(".sug-reply-meta")?.appendChild(pill);
      }
    }else{
      pill?.remove();
    }
  });
}

function applySuggestionNotificationPayload(data, { allowSound = true } = {}){
  if(data?.available !== true){
    suggestionNotificationsAvailable = false;
    suggestionNotificationsLoaded = true;
    updateSugBadgeFromCache();
    return;
  }
  const previous = lastSuggestionUnreadCount;
  suggestionNotificationsAvailable = true;
  suggestionNotificationsLoaded = true;
  suggestionUnreadRows = Array.isArray(data?.unread) ? data.unread : [];
  suggestionUnreadBySuggestion = data?.by_suggestion && typeof data.by_suggestion === "object"
    ? data.by_suggestion
    : Object.create(null);
  lastSuggestionUnreadCount = suggestionUnreadRows.length;
  updateSugBadgeFromCache();
  renderSuggestionUnreadIndicators();
  if(allowSound && previous != null && lastSuggestionUnreadCount > previous){
    try{ playSoftNotification(); }catch{}
  }
}

async function refreshSuggestionNotifications(options = {}){
  try{
    const data = await postSuggestionNotification({
      action:"list",
      limit:500,
      legacy_seen_at:LEGACY_SUG_SEEN_AT,
    });
    applySuggestionNotificationPayload(data, options);
  }catch(error){
    console.warn("suggestion notifications unavailable", error);
    if(!suggestionNotificationsLoaded){
      suggestionNotificationsAvailable = false;
      suggestionNotificationsLoaded = true;
      updateSugBadgeFromCache();
    }
  }
}

function applyMentionNotificationPayload(data, { allowSound = true } = {}){
  const previous = lastMentionUnreadCount;
  mentionNotificationsAvailable = data?.available === true;
  suggestionMentionRows = mentionNotificationsAvailable && Array.isArray(data?.unread) ? data.unread : [];
  suggestionMentionsBySuggestion = groupMentionsBySuggestion(suggestionMentionRows);
  lastMentionUnreadCount = suggestionMentionRows.length;
  updateSugBadgeFromCache();
  renderSuggestionUnreadIndicators();

  if(allowSound && previous != null && lastMentionUnreadCount > previous){
    try{ playSoftNotification(); }catch{}
  }
}

async function refreshSuggestionMentions(options = {}){
  if(mentionRefreshInFlight){
    mentionRefreshQueued = true;
    return mentionRefreshInFlight;
  }

  mentionRefreshInFlight = (async () => {
    try{
      const data = await postSuggestionMentions({ action:"unread" });
      applyMentionNotificationPayload(data, options);
    }catch(error){
      console.warn("suggestion mentions unavailable", error);
    }
  })();

  try{
    await mentionRefreshInFlight;
  }finally{
    mentionRefreshInFlight = null;
    if(mentionRefreshQueued){
      mentionRefreshQueued = false;
      scheduleMentionRefresh(450, { allowSound:false });
    }
  }
}

function scheduleMentionRefresh(delay = 650, options = {}){
  if(mentionRefreshTimer) clearTimeout(mentionRefreshTimer);
  mentionRefreshTimer = setTimeout(() => {
    mentionRefreshTimer = 0;
    refreshSuggestionMentions(options).catch(()=>{});
  }, Math.max(0, Number(delay) || 0));
}

async function markSuggestionMentionsRead(suggestionId){
  const key = String(suggestionId || "");
  const current = unreadMentionsForSuggestion(key);
  if(!mentionNotificationsAvailable || !current.length) return;

  const ids = current
    .map((row) => Number(row?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if(!ids.length) return;

  const previousRows = suggestionMentionRows.slice();
  suggestionMentionRows = suggestionMentionRows.filter((row) => !ids.includes(Number(row?.id)));
  suggestionMentionsBySuggestion = groupMentionsBySuggestion(suggestionMentionRows);
  lastMentionUnreadCount = suggestionMentionRows.length;
  updateSugBadgeFromCache();
  renderSuggestionUnreadIndicators();

  try{
    await postSuggestionMentions({ action:"read", mention_ids:ids });
  }catch(error){
    suggestionMentionRows = previousRows;
    suggestionMentionsBySuggestion = groupMentionsBySuggestion(previousRows);
    lastMentionUnreadCount = previousRows.length;
    updateSugBadgeFromCache();
    renderSuggestionUnreadIndicators();
    console.warn("could not mark suggestion mentions read", error);
  }
}

async function markSuggestionThreadRead(suggestionId){
  const key = String(suggestionId || "");
  const current = unreadRepliesForSuggestion(key);
  if(!suggestionNotificationsAvailable || !current.length) return;
  const previousRows = suggestionUnreadRows.slice();
  const previousGroups = suggestionUnreadBySuggestion;
  const ids = current.map((row) => Number(row?.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  suggestionUnreadRows = suggestionUnreadRows.filter((row) => !ids.includes(Number(row?.id)));
  suggestionUnreadBySuggestion = { ...suggestionUnreadBySuggestion };
  delete suggestionUnreadBySuggestion[key];
  lastSuggestionUnreadCount = suggestionUnreadRows.length;
  updateSugBadgeFromCache();
  renderSuggestionUnreadIndicators();
  try{
    await postSuggestionNotification({ action:"read", suggestion_id:Number(key), reply_ids:ids });
  }catch(error){
    suggestionUnreadRows = previousRows;
    suggestionUnreadBySuggestion = previousGroups;
    lastSuggestionUnreadCount = suggestionUnreadRows.length;
    updateSugBadgeFromCache();
    renderSuggestionUnreadIndicators();
    console.warn("could not mark suggestion replies read", error);
  }
}

function updateSugBadgeFromCache(){
  if(suggestionNotificationsAvailable || mentionNotificationsAvailable){
    const count = targetedSuggestionUnreadCount();
    setBadge(badgeSuggestions, count);
    publishSuggestionUnreadState();
    return;
  }
  const seenTs = getSugSeenTs();
  let c = 0;
  for(const r of (sugCache||[])){
    const ts = Date.parse(r.created_at||"") || 0;
    if(ts > seenTs) c += 1;
  }
  // If overlay open, treat as read
  const isOpen = elOverlay?.classList.contains("is-open");
  setBadge(badgeSuggestions, isOpen ? 0 : c);
  publishSuggestionUnreadState();
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, type = "info") {
  elStatus.textContent = message || "";
  elStatus.dataset.type = type;
}

function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_URL.startsWith("http") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_URL.includes("PASTE_") &&
    !SUPABASE_ANON_KEY.includes("PASTE_")
  );
}

let supabase = null;

// Anonymous user id (stored locally) used for admin blocks
const USER_ID = getStableUserId();
const suggestionActionGate = createActionGate();

function currentDisplayName(){
  return getStoredUserName() || aliasForUserId(USER_ID);
}
let profileNameMap = new Map();

// Per-user colors to make multi-user threads clear
function hueFromString(str = "") {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

function colorForUserId(userId = "") {
  const hue = hueFromString(userId);
  return `hsl(${hue}, 85%, 60%)`;
}

function installSuggestionNotificationStyles(){
  if(document.getElementById("sr-targeted-suggestion-notification-styles")) return;
  const style = document.createElement("style");
  style.id = "sr-targeted-suggestion-notification-styles";
  style.textContent = `
    .suggestion-item.has-unread-reply{box-shadow:0 0 0 1px rgba(255,190,62,.58),0 12px 28px rgba(0,0,0,.22)}
    .sug-unread-replies-badge{display:inline-flex;align-items:center;min-height:19px;padding:1px 7px;margin-inline-start:6px;border-radius:999px;background:#ff3b30;color:#fff;font-size:10px;font-weight:900;line-height:1.2;box-shadow:0 4px 12px rgba(255,59,48,.32)}
    .sug-reply-reference{display:block;width:100%;text-align:start;margin:0 0 7px;padding:7px 9px;border:0;border-inline-start:3px solid var(--u,#8b5cf6);border-radius:8px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer}
    .sug-reply-reference b{display:block;font-size:11px;margin-bottom:2px;color:var(--u,#c4b5fd)}
    .sug-reply-reference span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.78}
    .sug-reply-inline-actions{display:flex;justify-content:flex-end;margin-top:5px}
    .sug-reply-to-btn{border:0;border-radius:999px;padding:4px 9px;background:rgba(255,255,255,.08);color:inherit;font-size:11px;font-weight:800;cursor:pointer}
    .sug-reply-target{display:flex;align-items:center;gap:8px;margin-bottom:7px;padding:7px 9px;border-radius:10px;background:rgba(124,58,237,.14);border:1px solid rgba(167,139,250,.32)}
    .sug-reply-target[hidden]{display:none!important}
    .sug-reply-target-copy{min-width:0;flex:1}
    .sug-reply-target-copy b,.sug-reply-target-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sug-reply-target-copy b{font-size:11px;color:#c4b5fd}.sug-reply-target-copy span{font-size:11px;opacity:.75}
    .sug-reply-target-cancel{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer;padding:2px 5px}
    .suggestion-item.has-unread-mention{box-shadow:0 0 0 1px rgba(145,108,255,.58),0 12px 28px rgba(0,0,0,.22)}
    .sug-mentioned-you-pill,.sug-reply-mentioned-you-pill{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;margin-inline-start:6px;border-radius:999px;background:rgba(124,58,237,.18);border:1px solid rgba(167,139,250,.38);color:#d8c8ff;font-size:9px;font-weight:900;white-space:nowrap}
    .sug-reply-item.has-unread-mention{border-color:rgba(167,139,250,.46)!important;box-shadow:0 0 0 1px rgba(124,58,237,.12)}
  `;
  document.head.appendChild(style);
}

function installSuggestionCompactLayoutStyles(){
  const STYLE_ID = "sr-suggestions-compact-layout";
  const mount = () => {
    let style = document.getElementById(STYLE_ID);
    if(!style){
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #suggestionsOverlay .suggestions-modal{
          width:min(860px, calc(100vw - 24px)) !important;
          max-height:min(700px, calc(100dvh - 24px)) !important;
        }

        #suggestionsOverlay .suggestions-panel{
          position:relative !important;
          max-height:min(700px, calc(100dvh - 24px)) !important;
          padding:14px !important;
        }

        #suggestionsOverlay .suggestions-header{
          min-height:32px !important;
          margin:0 0 8px !important;
          padding:0 380px 8px 0 !important;
          border-bottom:1px solid rgba(255,255,255,.08) !important;
        }

        #suggestionsOverlay .suggestions-header h2{
          margin:0 !important;
          font-size:17px !important;
          line-height:1.2 !important;
        }

        #suggestionsOverlay .suggestions-subtitle,
        #suggestionsOverlay #sruxSuggestionHint,
        #suggestionsOverlay #sruxSuggestionsCount,
        #suggestionsOverlay .suggestions-form > .srux-char-counter,
        #suggestionsOverlay .suggestions-meta-row > span:not(#suggestionStatus){
          display:none !important;
        }

        #suggestionsOverlay .suggestions-form{
          display:grid !important;
          grid-template-columns:minmax(0,1fr) 150px !important;
          align-items:center !important;
          gap:8px !important;
          margin:0 !important;
          padding:0 !important;
        }

        #suggestionsOverlay #suggestionInput{
          box-sizing:border-box !important;
          width:100% !important;
          height:42px !important;
          min-height:42px !important;
          max-height:76px !important;
          margin:0 !important;
          padding:10px 12px !important;
          border-radius:11px !important;
          line-height:1.35 !important;
          resize:none !important;
          overflow-y:auto !important;
        }

        #suggestionsOverlay #suggestionAddBtn{
          box-sizing:border-box !important;
          width:150px !important;
          min-width:150px !important;
          height:42px !important;
          min-height:42px !important;
          margin:0 !important;
          padding:0 14px !important;
          border-radius:11px !important;
          white-space:nowrap !important;
        }

        #suggestionsOverlay .suggestions-meta-row{
          min-height:0 !important;
          margin:0 !important;
          padding:0 !important;
          border:0 !important;
        }

        #suggestionsOverlay #suggestionStatus:empty{
          display:none !important;
        }

        #suggestionsOverlay #suggestionStatus:not(:empty){
          display:inline-flex !important;
          align-items:center !important;
          min-height:18px !important;
          margin:4px 1px 0 !important;
          padding:0 !important;
          font-size:10px !important;
        }

        #suggestionsOverlay #sruxSuggestionsToolbar{
          position:absolute !important;
          top:12px !important;
          right:52px !important;
          z-index:4 !important;
          display:block !important;
          width:clamp(220px, 34%, 310px) !important;
          min-height:0 !important;
          margin:0 !important;
          padding:0 !important;
        }

        #suggestionsOverlay #sruxSuggestionsSearch{
          box-sizing:border-box !important;
          width:100% !important;
          height:30px !important;
          min-height:30px !important;
          margin:0 !important;
          padding:0 10px !important;
          border-radius:8px !important;
          font-size:11.5px !important;
        }

        #suggestionsOverlay #suggestionsList{
          margin-top:8px !important;
          min-height:280px !important;
          padding:10px !important;
        }

        @media (max-width:760px){
          #suggestionsOverlay .suggestions-modal,
          #suggestionsOverlay .suggestions-panel{
            max-height:calc(100dvh - 14px) !important;
          }

          #suggestionsOverlay .suggestions-panel{
            padding:10px !important;
          }

          #suggestionsOverlay .suggestions-header{
            min-height:30px !important;
            padding-right:calc(42vw + 44px) !important;
          }

          #suggestionsOverlay #sruxSuggestionsToolbar{
            top:8px !important;
            right:44px !important;
            width:min(42vw, 220px) !important;
          }

          #suggestionsOverlay #sruxSuggestionsSearch{
            height:28px !important;
            min-height:28px !important;
            font-size:10.5px !important;
          }

          #suggestionsOverlay .suggestions-form{
            grid-template-columns:minmax(0,1fr) !important;
          }

          #suggestionsOverlay #suggestionAddBtn{
            width:100% !important;
            min-width:0 !important;
          }

          #suggestionsOverlay #suggestionsList{
            min-height:200px !important;
          }
        }
      `;
    }

    // Re-append on load so this Suggestions-only contract stays after the
    // retained visual skins without touching the shared Support loader.
    try{ style.remove(); }catch{}
    (document.head || document.documentElement).appendChild(style);
  };

  mount();
  if(document.readyState !== "complete"){
    window.addEventListener("load", mount, { once:true });
  }
}

// Replies (optional)
let REPLIES_SUPPORTED = null;
async function detectRepliesTable() {
  if (REPLIES_SUPPORTED !== null) return REPLIES_SUPPORTED;
  try {
    const res = await supabase.from("suggestion_replies").select("id").limit(1);
    REPLIES_SUPPORTED = !res.error;
  } catch {
    REPLIES_SUPPORTED = false;
  }
  return REPLIES_SUPPORTED;
}

async function isBlocked() {
  if (!supabase) return null;
  const now = new Date().toISOString();
  // Preferred schema: expires_at
  let res = await supabase
    .from("blocks")
    .select("expires_at")
    .eq("user_id", USER_ID)
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1);

  // Legacy/compat schema: blocked_until
  if (res.error && (String(res.error.message || "").includes("expires_at") || String(res.error.details || "").includes("expires_at"))) {
    res = await supabase
      .from("blocks")
      .select("blocked_until")
      .eq("user_id", USER_ID)
      .gt("blocked_until", now)
      .order("blocked_until", { ascending: false })
      .limit(1);
    if (!res.error && res.data && res.data[0]) {
      return { expires_at: res.data[0].blocked_until };
    }
  }

  if (res.error) return null;
  return (res.data && res.data[0]) ? res.data[0] : null;
}



function redirectToNickname(){
  try { requireNicknameLogin(); }
  catch { location.href = "/login?nickname=1"; }
}

function displayNameForUser(userId, rowName = ""){
  const uid = String(userId || "");
  const direct = String(rowName || "").trim();
  return direct || profileNameMap.get(uid) || aliasForUserId(uid) || "User";
}

async function loadProfileNamesForRows(rows){
  profileNameMap = new Map();
  if(!supabase || !Array.isArray(rows) || rows.length === 0) return;
  const ids = Array.from(new Set(rows.map(r => String(r?.user_id || "").trim()).filter(Boolean))).slice(0, 500);
  if(!ids.length) return;
  try{
    const res = await supabase
      .from("support_public_profiles")
      .select("user_id, display_name")
      .in("user_id", ids)
      .limit(500);
    if(res.error || !Array.isArray(res.data)) return;
    for(const r of res.data){
      if(!r?.user_id) continue;
      const dn = String(r.display_name || "").trim();
      if(dn) profileNameMap.set(String(r.user_id), dn);
    }
  }catch{}
}

async function loadSuggestions() {
  if (!supabase) return;

  const { data, error } = await supabase
    .from("suggestions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    setStatus(`Something went wrong. Please contact ${ADMIN_NAME}.`, "error");
    return;
  }

  // Cache for unread badge
  sugCache = Array.isArray(data) ? data : [];
  updateSugBadgeFromCache();

  if (!Array.isArray(data) || data.length === 0) {
    elList.innerHTML = `<div class="suggestions-empty">No suggestions yet.</div>`;
    return;
  }

  const repliesOk = await detectRepliesTable().catch(()=>false);
  await loadProfileNamesForRows(data).catch(()=>{});

  // Preload reply counts so users can see them without opening each thread.
  let replyCountMap = new Map();
  if (repliesOk) {
    try {
      const ids = (Array.isArray(data) ? data : [])
        .map(r => Number(r?.id))
        .filter(n => Number.isFinite(n));

      if (ids.length) {
        const res = await supabase
          .from("suggestion_replies")
          .select("suggestion_id")
          .in("suggestion_id", ids)
          .limit(5000);
        if (!res.error && Array.isArray(res.data)) {
          for (const rr of res.data) {
            const sid = Number(rr?.suggestion_id);
            if (!Number.isFinite(sid)) continue;
            replyCountMap.set(sid, (replyCountMap.get(sid) || 0) + 1);
          }
        }
      }
    } catch (e) {
      // If anything goes wrong, just skip counts (threads will still load on click).
      replyCountMap = new Map();
    }
  }

  elList.innerHTML = data
    .map((x) => {
      const when = x?.created_at ? new Date(x.created_at).toLocaleString() : "";
      const text = escapeHtml(x?.text ?? "");
      const uid = String(x?.user_id || "");
      const name = escapeHtml(displayNameForUser(uid, x?.name));
      const col = colorForUserId(uid || name);
      const sid = String(x?.id || "");
      const rCount = repliesOk ? (replyCountMap.get(Number(x?.id)) || 0) : 0;
      const hasReplies = !!rCount;

      return `
        <div class="suggestion-item${hasReplies ? " has-replies" : ""}" style="--u:${escapeHtml(col)}" data-id="${escapeHtml(sid)}" data-user-id="${escapeHtml(uid)}">
          <div class="suggestion-meta">
            <span class="suggestion-who">
              <span class="suggestion-dot" aria-hidden="true"></span>
              <span class="suggestion-name">${name}</span>
              <span class="sr-suggest-react-anchor" data-reaction-target-type="suggestion" data-reaction-target-id="${escapeHtml(sid)}" aria-label="Suggestion reaction"></span>
            </span>
            <span class="suggestion-when">${when}</span>
          </div>
          <div class="suggestion-text">${text}</div>
          ${repliesOk ? `
            <div class="suggestion-actions">
              <button class="sug-replies-toggle${hasReplies ? " has-replies" : ""}" type="button" data-id="${escapeHtml(sid)}" data-reply-count="${escapeHtml(String(rCount))}" aria-expanded="false">
                <span class="sug-replies-icon" aria-hidden="true">↩</span>
                <span class="sug-replies-label">Replies</span>
                ${hasReplies ? `<span class="sug-replies-badge" aria-label="${escapeHtml(String(rCount))} replies">${escapeHtml(String(rCount))}</span>` : ``}
              </button>
            </div>
            <div class="suggestion-replies" id="sugReplies_${escapeHtml(sid)}" style="display:none"></div>
          ` : ``}
        </div>
      `;
    })
    .join("");

  if(repliesOk){
    elList.querySelectorAll("button.sug-replies-toggle").forEach((btn)=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.getAttribute("data-id");
        if(!id) return;
        await toggleRepliesPanel(id, btn);
      });
    });
  }
  renderSuggestionUnreadIndicators();
  window.dispatchEvent(new CustomEvent("sr:suggestions-rendered"));
}

async function addSuggestion() {
  if (!supabase) return;

  const displayName = currentDisplayName();
  if(!getStoredUserName()){
    redirectToNickname();
    return;
  }

  const text = (elInput.value || "").trim();
  if (!text) {
    setStatus("Please write a suggestion first.", "warn");
    elInput.focus();
    return;
  }

  if(!suggestionActionGate.enter("create")) return;
  elBtn.disabled = true;
  elInput.disabled = true;
  setStatus("Posting…", "info");

  try{
    const payload = {
      text,
      user_id: USER_ID,
      display_name: displayName,
      mention_user_ids:mentionIdsForInput(elInput),
    };

    const apiRes = await fetch("/api/public-suggestion", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const apiData = await apiRes.json().catch(() => ({}));

    if(apiData?.nickname_required){
      redirectToNickname();
      return;
    }
    if(!apiRes.ok || !apiData?.ok){
      throw new Error(apiData?.error || "Could not add suggestion.");
    }

    elInput.value = "";
    clearMentionsForInput(elInput);
    elInput.dispatchEvent(new Event("input", { bubbles:true }));
    setStatus("Added ✅", "success");

    const created = Array.isArray(apiData?.data) ? apiData.data[0] : null;
    if(created) applySuggestionsPublicEvent({
      table:"suggestions",
      op:"INSERT",
      row:{ ...created, display_name:displayName },
      source:"local_action",
    });
  }catch(error){
    console.error(error);
    setStatus(String(error?.message || `Could not add your suggestion. Please contact ${ADMIN_NAME}.`), "error");
  }finally{
    suggestionActionGate.leave("create");
    elBtn.disabled = false;
    elInput.disabled = false;
  }
}
// -------- Replies (optional feature) --------
const suggestionReplyTargets = new Map();

function compactReplyPreview(value, max = 140){
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function renderReplyItem(r, replyMap){
  const when = r?.created_at ? new Date(r.created_at).toLocaleString() : "";
  const uid = String(r?.user_id || "");
  const name = escapeHtml(displayNameForUser(uid, r?.name));
  const col = colorForUserId(uid || name);
  const text = escapeHtml(r?.text ?? "");
  const rid = String(r?.id || "");
  const parentId = String(r?.parent_reply_id || "");
  const parent = parentId ? replyMap.get(parentId) : null;
  const parentName = parent ? displayNameForUser(String(parent?.user_id || ""), parent?.name) : "";
  return `
    <div class="sug-reply-item" style="--u:${escapeHtml(col)}" data-reply-id="${escapeHtml(rid)}" data-user-id="${escapeHtml(uid)}">
      <div class="sug-reply-meta">
        <span class="sug-reply-dot" aria-hidden="true"></span>
        <b class="sug-reply-name">${name}</b>
        <span class="sr-suggest-react-anchor" data-reaction-target-type="reply" data-reaction-target-id="${escapeHtml(rid)}" aria-label="Reply reaction"></span>
        <span class="sug-reply-when">${when}</span>
      </div>
      ${parent ? `<button type="button" class="sug-reply-reference" data-scroll-reply-id="${escapeHtml(parentId)}"><b>Replying to ${escapeHtml(parentName || "User")}</b><span>${escapeHtml(compactReplyPreview(parent?.text || ""))}</span></button>` : ``}
      <div class="sug-reply-text">${text}</div>
      <div class="sug-reply-inline-actions"><button type="button" class="sug-reply-to-btn" data-reply-id="${escapeHtml(rid)}">↩ Reply</button></div>
    </div>
  `;
}

function renderSuggestionReplyTarget(box, suggestionId){
  const target = suggestionReplyTargets.get(String(suggestionId || "")) || null;
  const bar = box?.querySelector?.(".sug-reply-target");
  if(!bar) return;
  if(!target){
    bar.hidden = true;
    bar.querySelector(".sug-reply-target-copy")?.replaceChildren();
    return;
  }
  bar.hidden = false;
  const copy = bar.querySelector(".sug-reply-target-copy");
  if(copy){
    copy.innerHTML = `<b>Replying to ${escapeHtml(target.name || "User")}</b><span>${escapeHtml(compactReplyPreview(target.text || ""))}</span>`;
  }
}

async function toggleRepliesPanel(suggestionId, btn){
  const box = document.getElementById(`sugReplies_${suggestionId}`);
  if(!box) return;
  const open = box.style.display !== "none";
  if(open){
    box.style.display = "none";
    btn?.setAttribute("aria-expanded", "false");
    const cnt = Number(btn?.dataset?.replyCount || 0);
    btn.textContent = cnt ? `↩ Replies (${cnt})` : "↩ Replies";
    return;
  }
  box.style.display = "block";
  btn?.setAttribute("aria-expanded", "true");
  await renderRepliesPanel(suggestionId, box, btn);
}

async function renderRepliesPanel(suggestionId, box, btn){
  box.innerHTML = `<div class="sug-replies-loading">Loading…</div>`;

  const ok = await detectRepliesTable().catch(()=>false);
  if(!ok){
    box.innerHTML = `<div class="sug-replies-empty">Replies are not configured on the database yet. Please contact ${escapeHtml(ADMIN_NAME)}.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("suggestion_replies")
    .select("*")
    .eq("suggestion_id", Number(suggestionId))
    .order("created_at", { ascending: true })
    .limit(200);

  if(error){
    console.error(error);
    box.innerHTML = `<div class="sug-replies-empty">Could not load replies. Please contact ${escapeHtml(ADMIN_NAME)}.</div>`;
    return;
  }

  const replies = Array.isArray(data) ? data : [];
  const replyMap = new Map(replies.map((reply) => [String(reply?.id || ""), reply]));
  await loadProfileNamesForRows(replies).catch(()=>{});
  const count = replies.length;
  if(btn){
    btn.dataset.replyCount = String(count);
    btn.textContent = count ? `▾ Replies (${count})` : "▾ Replies";
  }

  const blocked = await isBlocked();
  const disabled = blocked ? "disabled" : "";
  const blockedText = blocked ? `You are blocked until ${new Date(blocked.expires_at).toLocaleString()}.` : "";

  box.innerHTML = `
    <div class="sug-replies-list">
      ${replies.length ? replies.map((reply) => renderReplyItem(reply, replyMap)).join("") : `<div class="sug-replies-empty">No replies yet.</div>`}
    </div>
    <div class="sug-reply-compose">
      <div class="sug-reply-target" hidden><div class="sug-reply-target-copy"></div><button class="sug-reply-target-cancel" type="button" aria-label="Cancel reply">×</button></div>
      <textarea class="sug-reply-input" rows="2" maxlength="1200" placeholder="Write a reply…" ${disabled}></textarea>
      <div class="sug-reply-actions">
        <button class="sug-reply-send" type="button" ${disabled}>Reply</button>
        <span class="sug-reply-hint">${escapeHtml(blockedText || "Enter to send • Shift+Enter for new line")}</span>
      </div>
    </div>
  `;

  const input = box.querySelector("textarea.sug-reply-input");
  const send = box.querySelector("button.sug-reply-send");
  renderSuggestionReplyTarget(box, suggestionId);

  box.querySelectorAll("button.sug-reply-to-btn[data-reply-id]").forEach((replyButton) => {
    replyButton.addEventListener("click", () => {
      const target = replyMap.get(String(replyButton.dataset.replyId || ""));
      if(!target) return;

      const targetName = displayNameForUser(String(target.user_id || ""), target.name);
      const replyTarget = {
        id:Number(target.id),
        user_id:String(target.user_id || ""),
        name:targetName,
        text:String(target.text || ""),
      };

      suggestionReplyTargets.set(String(suggestionId), replyTarget);
      renderSuggestionReplyTarget(box, suggestionId);
      setAutoReplyMention(input, replyTarget);
      input?.focus();
    });
  });
  box.querySelectorAll("button.sug-reply-reference[data-scroll-reply-id]").forEach((reference) => {
    reference.addEventListener("click", () => {
      const wantedId = String(reference.dataset.scrollReplyId || "");
      const target = Array.from(box.querySelectorAll(".sug-reply-item[data-reply-id]"))
        .find((item) => String(item.dataset.replyId || "") === wantedId);
      target?.scrollIntoView?.({ behavior:"smooth", block:"center" });
      target?.focus?.({ preventScroll:true });
    });
  });
  box.querySelector("button.sug-reply-target-cancel")?.addEventListener("click", () => {
    suggestionReplyTargets.delete(String(suggestionId));
    clearAutoReplyMention(input);
    renderSuggestionReplyTarget(box, suggestionId);
    input?.focus();
  });

  async function post(){
    if(!input) return;
    const text = (input.value || "").trim();
    if(!text) return;
    if(!getStoredUserName()){
      redirectToNickname();
      return;
    }

    const actionKey = "reply:" + String(suggestionId);
    if(!suggestionActionGate.enter(actionKey)) return;
    if(send) send.disabled = true;

    try{
      const payload = {
        suggestion_id: Number(suggestionId),
        text,
        user_id: USER_ID,
        name: currentDisplayName(),
        parent_reply_id:suggestionReplyTargets.get(String(suggestionId))?.id || null,
        mention_user_ids:mentionIdsForInput(input),
      };
      const apiRes = await fetch("/api/public-suggestion-reply", {
        method: "POST",
        credentials:"same-origin",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(payload),
      });
      const apiData = await apiRes.json().catch(() => ({}));
      if(apiData?.nickname_required){
        redirectToNickname();
        return;
      }
      if(!apiRes.ok || !apiData?.ok) throw new Error(apiData?.error || "Could not post reply.");

      input.value = "";
      clearMentionsForInput(input);
      input.dispatchEvent(new Event("input", { bubbles:true }));
      suggestionReplyTargets.delete(String(suggestionId));

      const createdReply = Array.isArray(apiData?.data) ? apiData.data[0] : null;
      if(createdReply) applySuggestionsPublicEvent({
        table:"suggestion_replies",
        op:"INSERT",
        row:createdReply,
        source:"local_action",
      });
    }catch(error){
      console.error(error);
      setStatus(String(error?.message || `Could not post reply. Please contact ${ADMIN_NAME}.`), "error");
    }finally{
      suggestionActionGate.leave(actionKey);
      if(send) send.disabled = false;
    }
  }

  send?.addEventListener("click", post);
  input?.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      post();
    }
  });
  window.dispatchEvent(new CustomEvent("sr:suggestions-rendered"));
  await markSuggestionThreadRead(suggestionId);
  await markSuggestionMentionsRead(suggestionId);
  setTimeout(()=> input?.focus(), 0);
}

let notificationHydrationPromise = null;

function applyNotificationCenterState(detail = {}){
  if(detail?.available !== true || String(detail?.mode || "") !== "list") return false;
  const rows = Array.isArray(detail?.items) ? detail.items : [];

  suggestionNotificationsAvailable = true;
  suggestionNotificationsLoaded = true;
  suggestionUnreadRows = rows
    .filter((item) => item?.kind === "reply" && !item?.read)
    .map((item) => ({
      id:Number(item?.reply_id) || null,
      suggestion_id:Number(item?.suggestion_id) || null,
      user_id:String(item?.sender_user_id || ""),
      name:String(item?.sender_name || "User"),
      text:String(item?.text || ""),
      created_at:item?.created_at || null,
      notification_target:item?.target || "suggestion",
    }))
    .filter((item) => item.id && item.suggestion_id);
  suggestionUnreadBySuggestion = groupRepliesBySuggestion(suggestionUnreadRows);
  lastSuggestionUnreadCount = suggestionUnreadRows.length;

  mentionNotificationsAvailable = detail?.mentions_available !== false;
  suggestionMentionRows = rows
    .filter((item) => item?.kind === "mention" && !item?.read)
    .map((item) => ({
      id:Number(item?.mention_id) || null,
      suggestion_id:Number(item?.suggestion_id) || null,
      reply_id:Number(item?.reply_id) || null,
      sender_user_id:String(item?.sender_user_id || ""),
      sender_name:String(item?.sender_name || "User"),
      created_at:item?.created_at || null,
      read_at:null,
    }))
    .filter((item) => item.id && item.suggestion_id);
  suggestionMentionsBySuggestion = groupMentionsBySuggestion(suggestionMentionRows);
  lastMentionUnreadCount = suggestionMentionRows.length;

  updateSugBadgeFromCache();
  renderSuggestionUnreadIndicators();
  return true;
}

function ensureNotificationHydration(){
  if(notificationHydrationPromise) return notificationHydrationPromise;

  notificationHydrationPromise = (async () => {
    const bridge = window.__srNotificationCenterBridge;
    if(bridge?.prime){
      const data = await bridge.prime().catch(() => null);
      const snapshot = bridge.getSnapshot?.() || {};
      if(data?.available === true && applyNotificationCenterState({
        ...data,
        ...snapshot,
        available:true,
      })) return;
    }

    // Compatibility fallback only if the v11 consolidated notification owner is unavailable.
    await Promise.allSettled([
      refreshSuggestionNotifications({ allowSound:false }),
      refreshSuggestionMentions({ allowSound:false }),
    ]);
  })();

  return notificationHydrationPromise;
}

function ensureInitialHydration(){
  if(initialHydrationPromise) return initialHydrationPromise;
  initialHydrationPromise = Promise.allSettled([
    ensureNotificationHydration(),
    loadSuggestions(),
  ]);
  return initialHydrationPromise;
}

function startSuggestionEnhancements(){
  if(suggestionEnhancementsStarted) return;
  suggestionEnhancementsStarted = true;

  import("./suggestion-mentions-lite.js?v=20260920-lite-v1")
    .then((module) => module?.installSuggestionMentionsLite?.())
    .catch(() => console.warn("Suggestion @mentions unavailable; core Suggestions remains active."));

  import("./suggestion-seen-receipts.js?v=20260930-unified-seen-v1")
    .then((module) => module?.installSuggestionSeenReceipts?.())
    .catch(() => console.warn("Suggestion seen receipts unavailable; core Suggestions remains active."));
}

function openPanel() {
  if (!elOverlay) return;
  ensureInitialHydration().catch(()=>{});
  startSuggestionEnhancements();
  elOverlay.classList.add("is-open");
  elOverlay.setAttribute("aria-hidden", "false");
  elFab?.setAttribute("aria-expanded", "true");
  // With the targeted system, a reply is read only when its thread is opened.
  // Keep the legacy behavior only while the database upgrade is unavailable.
  if(!suggestionNotificationsAvailable) markSugSeen();
  else updateSugBadgeFromCache();
  // Slight delay to ensure visible before focusing
  setTimeout(() => elInput?.focus(), 0);
}

function closePanel() {
  if (!elOverlay) return;
  elOverlay.classList.remove("is-open");
  elOverlay.setAttribute("aria-hidden", "true");
  elFab?.setAttribute("aria-expanded", "false");
  updateSugBadgeFromCache();
}

async function openNotificationTarget(item){
  const suggestionId = Number(item?.suggestion_id);
  if(!Number.isSafeInteger(suggestionId) || suggestionId < 1) return;

  openPanel();
  await ensureInitialHydration().catch(()=>{});
  let card = elList?.querySelector?.(`.suggestion-item[data-id="${suggestionId}"]`);
  if(!card){
    await loadSuggestions().catch(()=>{});
    card = elList?.querySelector?.(`.suggestion-item[data-id="${suggestionId}"]`);
  }
  if(!card) return;

  const replyId = Number(item?.reply_id);
  if(Number.isSafeInteger(replyId) && replyId > 0){
    const button = card.querySelector("button.sug-replies-toggle");
    const box = document.getElementById(`sugReplies_${suggestionId}`);
    if(button && box && box.style.display === "none"){
      await toggleRepliesPanel(suggestionId, button);
    }

    const target = box?.querySelector?.(`.sug-reply-item[data-reply-id="${replyId}"]`);
    if(target){
      target.scrollIntoView?.({ behavior:"smooth", block:"center" });
      target.classList.add("sr-notification-target-flash");
      setTimeout(() => target.classList.remove("sr-notification-target-flash"), 1700);
      return;
    }
  }

  card.scrollIntoView?.({ behavior:"smooth", block:"center" });
  card.classList.add("sr-notification-target-flash");
  setTimeout(() => card.classList.remove("sr-notification-target-flash"), 1700);
}

async function refreshNotificationCenterUnread(){
  await Promise.allSettled([
    refreshSuggestionNotifications({ allowSound:false }),
    refreshSuggestionMentions({ allowSound:false }),
  ]);
  updateSugBadgeFromCache();
}

function installNotificationCenterBridge(){
  window.__srSuggestionNotificationCenterBridge = Object.freeze({
    getUnreadCount:targetedSuggestionUnreadCount,
    refreshUnread:refreshNotificationCenterUnread,
    openTarget:openNotificationTarget,
  });
  publishSuggestionUnreadState();
}

function wire() {
  // Toggle UI
  elFab?.addEventListener("click", openPanel);
  elClose?.addEventListener("click", closePanel);
  elOverlay?.addEventListener("click", (e) => {
    // Close only when clicking outside the modal content
    if (e.target === elOverlay) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // Add suggestion
  elBtn?.addEventListener("click", addSuggestion);
  elInput?.addEventListener("keydown", (e) => {
    // Textarea UX: Enter posts, Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addSuggestion();
    }
  });
}

function init() {
  if (!elInput || !elBtn || !elStatus || !elList) return;

  installSuggestionNotificationStyles();
  installSuggestionCompactLayoutStyles();
  installNotificationCenterBridge();
  wire();

  if (!isConfigured()) {
    setStatus(`Configuration is missing. Please contact ${ADMIN_NAME}.`, "error");
    elBtn.disabled = true;
    elInput.disabled = true;
    elList.innerHTML = `<div class="suggestions-empty">Suggestions are currently unavailable.</div>`;
    return;
  }

  // Use shared Supabase client (singleton) to avoid multiple GoTrueClient warnings.
  supabase = sharedSupabase;

  // The module itself is intent-loaded by architecture v11.
  // Enhancements start only when Suggestions is actually opened.

  window.addEventListener("sr:notification-center-state", (event) => {
    applyNotificationCenterState(event?.detail || {});
  });

  window.addEventListener("sr:suggestion-unread-summary", (event) => {
    const count = Math.max(0, Number(event?.detail?.count || 0));
    if(suggestionNotificationsLoaded || mentionNotificationsAvailable) return;
    setBadge(badgeSuggestions, count);
  });

  window.addEventListener("sr:suggestions-public-event", (event) => {
    applySuggestionsPublicEvent(event?.detail || {});
  });

  window.addEventListener("sr:realtime-invalidated", (event) => {
    const detail = event?.detail || {};
    if(String(detail?.group || "") !== "suggestions") return;
    if(detail?.targeted === true) applyTargetedSuggestionRealtime(detail);
  });

  window.__srOpenSuggestions = openPanel;
  window.__srSuggestionsLoaded = true;


  // Public suggestion/reply updates arrive on the existing global broadcast
  // channel with row payloads. No duplicate postgres_changes subscriptions.
  // No focus/visibility/online refresh loops. Initial hydration + push only.
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init, { once:true });
}else{
  init();
}


window.addEventListener("sr:profile-updated", (event) => {
  const uid = String(event?.detail?.user_id || "");
  const name = String(event?.detail?.display_name || "").trim();
  if(!uid || !name) return;
  profileNameMap.set(uid, name);
  document.querySelectorAll(".suggestion-item,.sug-reply-item").forEach((row) => {
    const id = String(row.getAttribute("data-user-id") || "");
    if(id !== uid) return;
    const node = row.querySelector(".suggestion-name,.sug-reply-name");
    if(node) node.textContent = name;
  });
});


const suggestionRealtimeSeen = new Set();

function realtimeSuggestionCardHtml(row){
  const uid = String(row?.user_id || "");
  const nameRaw = displayNameForUser(uid, row?.display_name || row?.name || "User");
  const name = escapeHtml(nameRaw);
  const col = colorForUserId(uid || nameRaw);
  const sid = String(row?.id || "");
  const when = row?.created_at ? new Date(row.created_at).toLocaleString() : "";
  return `
    <div class="suggestion-item" style="--u:${escapeHtml(col)}" data-id="${escapeHtml(sid)}" data-user-id="${escapeHtml(uid)}">
      <div class="suggestion-meta">
        <span class="suggestion-who">
          <span class="suggestion-dot" aria-hidden="true"></span>
          <span class="suggestion-name">${name}</span>
          <span class="sr-suggest-react-anchor" data-reaction-target-type="suggestion" data-reaction-target-id="${escapeHtml(sid)}" aria-label="Suggestion reaction"></span>
        </span>
        <span class="suggestion-when">${escapeHtml(when)}</span>
      </div>
      <div class="suggestion-text">${escapeHtml(row?.text ?? "")}</div>
      <div class="suggestion-actions">
        <button class="sug-replies-toggle" type="button" data-id="${escapeHtml(sid)}" data-reply-count="0" aria-expanded="false">
          <span class="sug-replies-icon" aria-hidden="true">↩</span>
          <span class="sug-replies-label">Replies</span>
        </button>
      </div>
      <div class="suggestion-replies" id="sugReplies_${escapeHtml(sid)}" style="display:none"></div>
    </div>`;
}

function bindRealtimeSuggestionCard(card){
  const button = card?.querySelector?.("button.sug-replies-toggle");
  if(!button || button.dataset.srBound === "1") return;
  button.dataset.srBound = "1";
  button.addEventListener("click", async () => {
    const id = button.getAttribute("data-id");
    if(id) await toggleRepliesPanel(id, button);
  });
}

function updateReplyCountLocal(suggestionId, delta){
  const card = elList?.querySelector?.(`.suggestion-item[data-id="${String(suggestionId)}"]`);
  const button = card?.querySelector?.("button.sug-replies-toggle");
  if(!button) return;
  const next = Math.max(0, Number(button.dataset.replyCount || 0) + Number(delta || 0));
  button.dataset.replyCount = String(next);
  button.classList.toggle("has-replies", next > 0);
  card?.classList?.toggle("has-replies", next > 0);
  button.innerHTML = `<span class="sug-replies-icon" aria-hidden="true">↩</span><span class="sug-replies-label">Replies</span>${next ? `<span class="sug-replies-badge" aria-label="${next} replies">${next}</span>` : ""}`;
}

function applySuggestionsPublicEvent(detail = {}){
  const table = String(detail?.table || "");
  const op = String(detail?.op || "").toUpperCase();
  const row = detail?.row && typeof detail.row === "object" ? detail.row : null;
  const id = Number(row?.id);
  if(!row || !Number.isSafeInteger(id) || id < 1) return false;
  const dedupeKey = table + ":" + op + ":" + id;
  if(suggestionRealtimeSeen.has(dedupeKey)) return false;
  suggestionRealtimeSeen.add(dedupeKey);
  if(suggestionRealtimeSeen.size > 1500){
    const first = suggestionRealtimeSeen.values().next().value;
    if(first) suggestionRealtimeSeen.delete(first);
  }

  if(table === "suggestions"){
    if(op === "DELETE"){
      sugCache = sugCache.filter(x => Number(x?.id) !== id);
      elList?.querySelector?.(`.suggestion-item[data-id="${id}"]`)?.remove();
      updateSugBadgeFromCache();
      return true;
    }

    const index = sugCache.findIndex(x => Number(x?.id) === id);
    if(index >= 0) sugCache[index] = { ...sugCache[index], ...row };
    else sugCache = [row, ...sugCache].slice(0, 200);

    const existing = elList?.querySelector?.(`.suggestion-item[data-id="${id}"]`);
    if(existing){
      const nameNode = existing.querySelector(".suggestion-name");
      const textNode = existing.querySelector(".suggestion-text");
      const uid = String(row?.user_id || "");
      if(nameNode) nameNode.textContent = displayNameForUser(uid, row?.display_name || row?.name || "User");
      if(textNode) textNode.textContent = String(row?.text || "");
      existing.setAttribute("data-user-id", uid);
    }else if(elList){
      elList.querySelector(".suggestions-empty")?.remove();
      elList.insertAdjacentHTML("afterbegin", realtimeSuggestionCardHtml(row));
      bindRealtimeSuggestionCard(elList.querySelector(`.suggestion-item[data-id="${id}"]`));
    }
    updateSugBadgeFromCache();
    try{ window.dispatchEvent(new CustomEvent("sr:suggestions-rendered")); }catch{}
    return true;
  }

  if(table === "suggestion_replies"){
    const sid = Number(row?.suggestion_id);
    if(!Number.isSafeInteger(sid) || sid < 1) return false;
    const box = document.getElementById(`sugReplies_${sid}`);
    if(op === "DELETE"){
      updateReplyCountLocal(sid, -1);
      box?.querySelector?.(`.sug-reply-item[data-reply-id="${id}"]`)?.remove();
      return true;
    }
    if(op === "INSERT"){
      updateReplyCountLocal(sid, 1);
      if(box && box.style.display !== "none"){
        let list = box.querySelector(".sug-replies-list");
        if(list && !list.querySelector(`.sug-reply-item[data-reply-id="${id}"]`)){
          list.insertAdjacentHTML("beforeend", renderReplyItem(row, new Map()));
        }
      }
      try{ window.dispatchEvent(new CustomEvent("sr:suggestions-rendered")); }catch{}
      return true;
    }
  }
  return false;
}

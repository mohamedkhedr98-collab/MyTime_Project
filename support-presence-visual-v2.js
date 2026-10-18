/*
 * Support Presence visual consumer.
 * Decoration only: never owns Realtime, never writes Presence, never reorders controls.
 */

const SCHEME_COUNT = 12;
let presenceSnapshot = window.__srPresenceSnapshot || null;
let lastSeenSnapshot = window.__srLastSeenSnapshot || null;
let onlineIds = new Set(presenceSnapshot?.onlineUserIds || []);
let scheduled = false;

function hashText(value = ""){
  let h = 2166136261;
  const s = String(value || "").trim().toLowerCase();
  for(let i = 0; i < s.length; i += 1){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function cleanText(node){
  return String(node?.textContent || "").replace(/\s+/g, " ").trim();
}

function collectVisibleUserKeys(){
  const keys = [];
  const seen = new Set();
  for(const row of document.querySelectorAll("#supportUsersList .support-user, #supportMessagesList .support-msg")){
    const id = String(row.getAttribute("data-user-id") || row.getAttribute("data-sender-id") || "").trim();
    const name = cleanText(row.querySelector(".support-user-name, .support-msg-name"));
    const key = id || name;
    if(key && !seen.has(key)){
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function buildSchemeMap(){
  const keys = collectVisibleUserKeys();
  const assigned = new Map();
  const used = new Set();
  keys.sort((a, b) => hashText(a) - hashText(b));

  for(const key of keys){
    let scheme = hashText(key) % SCHEME_COUNT;
    let guard = 0;
    while(used.has(scheme) && guard < SCHEME_COUNT){
      scheme = (scheme + 3) % SCHEME_COUNT;
      guard += 1;
    }
    assigned.set(key, String(scheme));
    used.add(scheme);
  }
  return assigned;
}

function presenceStateForUser(userId){
  if(presenceSnapshot?.status !== "connected") return "unknown";
  return userId && onlineIds.has(userId) ? "online" : "offline";
}

function applyPresenceOrder(row, state){
  if(!row?.style) return;
  const order = state === "online" ? "0" : state === "offline" ? "2" : "1";
  if(row.style.getPropertyValue("--sr-presence-order") !== order){
    row.style.setProperty("--sr-presence-order", order);
  }
}

function parseTime(value){
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function serverNowMs(){
  const offset = Number(lastSeenSnapshot?.serverClockOffsetMs);
  return Date.now() + (Number.isFinite(offset) ? offset : 0);
}

function lastSeenForUser(userId){
  const id = String(userId || "").trim();
  if(!id) return "";
  const value = lastSeenSnapshot?.byUserId?.[id] || "";
  const time = parseTime(value);
  return time ? new Date(time).toISOString() : "";
}

function relativeLastSeen(value){
  const time = parseTime(value);
  if(!time) return "";
  const diff = Math.max(0, serverNowMs() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if(diff < minute) return "now";
  if(diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if(diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  if(diff < 30 * day) return `${Math.max(1, Math.floor(diff / day))}d`;

  try{
    return new Date(time).toLocaleDateString(undefined, {
      year:"numeric",
      month:"short",
      day:"numeric",
    });
  }catch{
    return "";
  }
}

function exactLastSeen(value){
  const time = parseTime(value);
  if(!time) return "";
  try{
    return new Date(time).toLocaleString(undefined, {
      year:"numeric",
      month:"short",
      day:"numeric",
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit",
    });
  }catch{
    return "";
  }
}

function activityClass(lastSeen){
  const time = parseTime(lastSeen);
  if(!time) return "is-offline-history-unknown";
  const age = Math.max(0, serverNowMs() - time);
  if(age <= 15 * 60 * 1000) return "is-offline-recent";
  if(age <= 24 * 60 * 60 * 1000) return "is-offline-today";
  return "is-offline-stale";
}

function ensureUserBadge(row, state, userId){
  const anchor = row?.querySelector?.(".support-user-name");
  if(!anchor?.parentElement) return;

  const statusLine = row.querySelector(".support-user-statusline") || anchor.parentElement;
  let badge = statusLine.querySelector(":scope > .support-presence-badge");
  if(!badge){
    badge = document.createElement("span");
    badge.className = "support-presence-badge";
    statusLine.appendChild(badge);
  }

  const lastSeen = state === "offline" ? lastSeenForUser(userId) : "";
  const relative = relativeLastSeen(lastSeen);
  const text = state === "online"
    ? "Online"
    : state === "unknown"
      ? "Unknown"
      : relative
        ? `Offline · ${relative}`
        : "Offline";

  if(badge.textContent !== text) badge.textContent = text;
  badge.classList.toggle("is-online", state === "online");
  badge.classList.toggle("is-offline", state === "offline");
  badge.classList.toggle("is-unknown", state === "unknown");

  row.classList.remove("is-offline-recent", "is-offline-today", "is-offline-stale", "is-offline-history-unknown");
  if(state === "offline") row.classList.add(activityClass(lastSeen));

  if(lastSeen) row.setAttribute("data-last-seen", lastSeen);
  else row.removeAttribute("data-last-seen");

  badge.title = lastSeen ? `Last online: ${exactLastSeen(lastSeen)}` : text;
}

function nameToIdMap(){
  const map = new Map();
  for(const row of document.querySelectorAll("#supportUsersList .support-user")){
    const id = String(row.getAttribute("data-user-id") || "").trim();
    const name = cleanText(row.querySelector(".support-user-name"));
    if(id && name) map.set(name, id);
  }
  return map;
}

function apply(){
  scheduled = false;
  const schemes = buildSchemeMap();
  const names = nameToIdMap();

  for(const row of document.querySelectorAll("#supportUsersList .support-user")){
    const id = String(row.getAttribute("data-user-id") || "").trim();
    const name = cleanText(row.querySelector(".support-user-name"));
    const key = id || name;
    const scheme = schemes.get(key) || schemes.get(name) || String(hashText(key || name) % SCHEME_COUNT);
    if(row.getAttribute("data-bubble-scheme") !== scheme) row.setAttribute("data-bubble-scheme", scheme);

    const state = presenceStateForUser(id);
    applyPresenceOrder(row, state);
    row.classList.toggle("is-online", state === "online");
    row.classList.toggle("is-offline", state === "offline");
    row.classList.toggle("is-presence-unknown", state === "unknown");
    ensureUserBadge(row, state, id);
  }

  for(const row of document.querySelectorAll("#supportMessagesList .support-msg")){
    const name = cleanText(row.querySelector(".support-msg-name"));
    const id = String(row.getAttribute("data-sender-id") || "").trim() || names.get(name) || "";
    const key = id || name;
    const scheme = schemes.get(key) || schemes.get(name) || String(hashText(key || name) % SCHEME_COUNT);
    if(row.getAttribute("data-bubble-scheme") !== scheme) row.setAttribute("data-bubble-scheme", scheme);

    const state = presenceStateForUser(id);
    row.classList.toggle("is-online", state === "online");
    row.classList.toggle("is-offline", state === "offline");
    row.classList.toggle("is-presence-unknown", state === "unknown");
  }
}

function scheduleApply(){
  if(scheduled) return;
  scheduled = true;
  requestAnimationFrame(apply);
}

function installAccentStyles(){
  if(document.getElementById("sr-support-last-seen-v3-styles")) return;
  const style = document.createElement("style");
  style.id = "sr-support-last-seen-v3-styles";
  style.textContent = `
    html body #supportChatOverlay.sr-support-pro-v4 #supportUsersList .support-user.is-offline-recent .support-presence-badge.is-offline{color:#d8b96b!important}
    html body #supportChatOverlay.sr-support-pro-v4 #supportUsersList .support-user.is-offline-today .support-presence-badge.is-offline{color:#96a8bb!important}
    html body #supportChatOverlay.sr-support-pro-v4 #supportUsersList .support-user.is-offline-stale .support-presence-badge.is-offline{color:#65768b!important}
  `;
  document.head.appendChild(style);
}

function init(){
  installAccentStyles();

  window.addEventListener("sr:presence-changed", (event) => {
    presenceSnapshot = event?.detail || window.__srPresenceSnapshot || null;
    onlineIds = new Set(presenceSnapshot?.onlineUserIds || []);
    scheduleApply();
  });

  window.addEventListener("sr:last-seen-changed", (event) => {
    lastSeenSnapshot = event?.detail || window.__srLastSeenSnapshot || null;
    scheduleApply();
  });

  window.addEventListener("sr:support-dom-changed", scheduleApply);
  window.addEventListener("sr:nickname-updated", scheduleApply);
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "visible") scheduleApply();
  });

  presenceSnapshot = window.__srPresenceSnapshot || presenceSnapshot;
  lastSeenSnapshot = window.__srLastSeenSnapshot || lastSeenSnapshot;
  onlineIds = new Set(presenceSnapshot?.onlineUserIds || []);
  scheduleApply();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init, { once:true });
}else{
  init();
}

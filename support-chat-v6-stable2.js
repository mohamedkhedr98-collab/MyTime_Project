
import { supabase } from "./supabase-client.js";
import { ADMIN_NAME } from "./supabase-config.js";
import { getStableUserId, getStoredUserName, setStoredUserName, clearStoredUserName, requireNicknameLogin } from "./stable-user-identity.js";
import { playSoftNotification, unlockSound } from "./notification-sound.js";
import { createActionGate, stableActionFingerprint } from "./runtime/action-gate-v11.js";

const SUPPORT_BUILD_VERSION = "20261008-mobile-support-paint-v2";
// Fixed Functions base for Cloudflare/Next.js.
// No Vercel/Netlify probing and no startup ping, to keep requests lower and behavior deterministic.
const SR_FN_BASE = "/api";
function resolveFnBase() {
  return Promise.resolve(SR_FN_BASE);
}

// ---------- User identity ----------
const USER_ID = getStableUserId();
const supportActionGate = createActionGate();

function getUserName() {
  return getStoredUserName();
}
function setUserName(name) {
  setStoredUserName(name);
}

// ---------- Elements ----------
const supportBtn = document.getElementById("supportToggleBtn");
const supportBadge = document.getElementById("badgeSupport");

const nameOverlay = document.getElementById("supportNameOverlay");
const nameInput = document.getElementById("supportNameInput");
const nameConfirmBtn = document.getElementById("supportNameConfirmBtn");
const nameCloseBtn = document.getElementById("supportNameCloseBtn");

const chatOverlay = document.getElementById("supportChatOverlay");
const chatCloseBtn = document.getElementById("supportChatCloseBtn");
const chatBackBtn = document.getElementById("supportChatBackBtn");
const chatTitle = document.getElementById("supportChatTitle");
const chatSubtitle = document.getElementById("supportChatSubtitle");

const usersList = document.getElementById("supportUsersList");
const messagesList = document.getElementById("supportMessagesList");
const msgInput = document.getElementById("supportMessageInput");
const sendBtn = document.getElementById("supportSendBtn");
const statusEl = document.getElementById("supportChatStatus");

// Emoji + attachments
const emojiBtn = document.getElementById("supportEmojiBtn");
const emojiPopover = document.getElementById("supportEmojiPopover");
const attachBtn = document.getElementById("supportAttachBtn");
const attachInput = document.getElementById("supportAttachInput");
const attachPreview = document.getElementById("supportAttachPreview");

// ---------- Paste image (Ctrl+V / Snipping Tool) ----------
msgInput?.addEventListener("paste", async (e) => {
  try{
    const items = e.clipboardData?.items;
    if(!items) return;
    for (const it of items){
      if(it.kind === "file" && (it.type || "").startsWith("image/")){
        const file = it.getAsFile();
        if(!file) continue;
        // Attach pasted image as if user selected it
        setSelectedFile(new File([file], `pasted-${Date.now()}.png`, { type: file.type || "image/png" }));
        statusEl.textContent = "Image pasted. Press Send to upload.";
        e.preventDefault();
        return;
      }
    }
  }catch(err){
    console.error(err);
  }
});


let selectedFile = null;
let supportReplyTarget = null;

function getSupportMentionUserIds(){
  try{
    const ids = window.__srSupportMentionsLite?.getMentionUserIds?.(msgInput);
    return Array.isArray(ids) ? ids.slice(0, 5) : [];
  }catch{
    return [];
  }
}

function getSupportMentionAll(){
  try{ return window.__srSupportMentionsLite?.getMentionAll?.(msgInput) === true; }
  catch{ return false; }
}

function getSupportMentionLabels(){
  try{
    const labels = window.__srSupportMentionsLite?.getMentionLabels?.(msgInput);
    return Array.isArray(labels) ? labels.slice(0, 5).map((value)=>String(value || "").trim()).filter(Boolean) : [];
  }catch{
    return [];
  }
}

function hasSupportMentions(){
  try{ return window.__srSupportMentionsLite?.hasMentions?.(msgInput) === true; }
  catch{ return getSupportMentionAll() || getSupportMentionUserIds().length > 0; }
}

function refreshSupportMentionSelection(){
  try{ window.__srSupportMentionsLite?.refresh?.(msgInput); }catch{}
}

function clearSupportMentionSelection(){
  try{ window.__srSupportMentionsLite?.clear?.(msgInput); }catch{}
}

function supportMentionCandidateAllowed(userId){
  const id = String(userId || "");
  if(!id || id === USER_ID) return false;
  if(activeRoom?.type !== "dm") return true;
  return String(activeRoom?.other?.user_id || "") === id;
}

function supportMentionEveryoneAllowed(){
  return activeRoom?.type === "public";
}

function compactSupportPreview(value, max = 180){
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function installSupportReplyStyles(){
  if(document.getElementById("sr-support-reply-upgrade-styles")) return;
  const style = document.createElement("style");
  style.id = "sr-support-reply-upgrade-styles";
  style.textContent = `
    .support-msg.is-reply-to-me{box-shadow:0 0 0 1px rgba(255,193,7,.58),0 10px 24px rgba(0,0,0,.2)}
    .support-reply-to-you{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:#ffb300;color:#241500;font-size:10px;font-weight:900}
    .support-message-mention-line{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:0 0 7px}
    .support-message-mention-chip{display:inline-flex;align-items:center;max-width:220px;padding:3px 8px;border:1px solid rgba(99,174,244,.28);border-radius:999px;background:rgba(43,113,181,.16);color:#cfeaff;font-size:10px;font-weight:850;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .support-message-mention-chip.is-all{border-color:rgba(91,201,148,.28);background:rgba(43,133,91,.15);color:#c9f3dc}
    .support-reply-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;min-height:27px;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:3px 10px;background:rgba(255,255,255,.09);color:inherit;font-size:11px;font-weight:900;cursor:pointer}
    .support-reply-btn:hover,.support-reply-btn:focus-visible{border-color:rgba(167,139,250,.62);background:rgba(124,58,237,.22);outline:none}
    .support-reply-reference{display:block;width:100%;text-align:start;margin:1px 0 7px;padding:7px 9px;border:0;border-inline-start:3px solid var(--u,#8b5cf6);border-radius:9px;background:rgba(255,255,255,.075);color:inherit;cursor:pointer}
    .support-reply-reference b,.support-reply-reference span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-reply-reference b{font-size:11px;color:var(--u,#c4b5fd);margin-bottom:2px}.support-reply-reference span{font-size:11px;opacity:.78}
    #supportReplyPreview{display:flex;align-items:center;gap:9px;margin:0 0 7px;padding:8px 10px;border-radius:11px;background:rgba(124,58,237,.14);border:1px solid rgba(167,139,250,.32)}
    #supportReplyPreview[hidden]{display:none!important}
    #supportReplyPreview .support-reply-preview-copy{flex:1;min-width:0}
    #supportReplyPreview b,#supportReplyPreview span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #supportReplyPreview b{font-size:11px;color:#c4b5fd}#supportReplyPreview span{font-size:11px;opacity:.76}
    #supportReplyPreview button{border:0;background:transparent;color:inherit;font-size:19px;cursor:pointer;padding:2px 5px}
  `;
  document.head.appendChild(style);
}

function ensureSupportReplyPreview(){
  let preview = document.getElementById("supportReplyPreview");
  if(preview) return preview;
  const compose = msgInput?.closest?.(".support-compose");
  if(!compose?.parentElement) return null;
  preview = document.createElement("div");
  preview.id = "supportReplyPreview";
  preview.hidden = true;
  preview.innerHTML = '<div class="support-reply-preview-copy"></div><button type="button" aria-label="Cancel reply">×</button>';
  compose.parentElement.insertBefore(preview, compose);
  preview.querySelector("button")?.addEventListener("click", () => {
    clearSupportReplyTarget();
    focusMessageInput();
  });
  return preview;
}

function renderSupportReplyPreview(){
  const preview = ensureSupportReplyPreview();
  if(!preview) return;
  if(!supportReplyTarget){
    preview.hidden = true;
    preview.querySelector(".support-reply-preview-copy")?.replaceChildren();
    return;
  }
  preview.hidden = false;
  const copy = preview.querySelector(".support-reply-preview-copy");
  if(copy){
    copy.innerHTML = `<b>Replying to ${escapeHtml(supportReplyTarget.sender_name || "User")}</b><span>${escapeHtml(compactSupportPreview(supportReplyTarget.message || ""))}</span>`;
  }
}

function setSupportReplyTarget(row){
  const r = normalizeSupportRow(row || {});
  const id = Number(r.id);
  if(!Number.isSafeInteger(id) || id <= 0) return;
  supportReplyTarget = {
    id,
    user_id:String(r.user_id || r.sender_id || ""),
    sender_id:String(r.sender_id || r.user_id || ""),
    sender_name:String(r.sender_name || "User"),
    message:String(r.message || ""),
    room_type:String(r.room_type || "public"),
    room_id:String(r.room_id || "public"),
  };
  renderSupportReplyPreview();
  focusMessageInput();
}

function clearSupportReplyTarget(){
  supportReplyTarget = null;
  renderSupportReplyPreview();
}

// ---------- Per-user colors (to make multi-user public chat easy to follow) ----------
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
  // bright, readable color
  return `hsl(${hue}, 85%, 60%)`;
}

// Return a small bundle of CSS colors for nicer full-bubble coloring
function colorBundleForUserId(userId = "") {
  const hue = hueFromString(userId);
  return {
    accent: `hsl(${hue}, 85%, 60%)`,
    // Slightly darker background tint (keeps text readable)
    bg: `hsla(${hue}, 65%, 35%, 0.22)`,
    border: `hsla(${hue}, 80%, 55%, 0.28)`,
  };
}

// ---------- Optional profiles table (admin can delete names) ----------
let PROFILE_TABLE_OK = null;
const supportProfileNames = new Map();
const supportRoleBadges = new Map();
let supportRoleBadgesLoaded = false;
let supportRoleBadgesLoading = null;

function supportRoleFor(userId){
  return String(supportRoleBadges.get(String(userId || "")) || "");
}

function supportRoleIconHtml(userId){
  const role = supportRoleFor(userId);
  if(role === "full_admin"){
    return '<span class="support-role-icon full-admin" aria-label="Full Admin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.6-2.7 8.1-7 10-4.3-1.9-7-5.4-7-10V6l7-3Z"></path><path d="m12 7 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4L12 7Z"></path></svg></span>';
  }
  if(role === "sr_admin"){
    return '<span class="support-role-icon sr-admin" aria-label="SR Management"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M7 4v6"></path><path d="M4 17h16"></path><path d="M17 14v6"></path><path d="M4 12h16"></path><path d="M12 9v6"></path></svg></span>';
  }
  return "";
}

async function loadSupportRoleBadges(){
  if(supportRoleBadgesLoaded) return supportRoleBadges;
  if(supportRoleBadgesLoading) return supportRoleBadgesLoading;

  supportRoleBadgesLoading = (async()=>{
    try{
      const res = await fetch("/api/support-role-badges", {
        method:"POST",
        credentials:"same-origin",
        headers:{ "content-type":"application/json" },
        body:"{}",
      });
      const data = await res.json().catch(()=>({}));
      if(res.ok && data?.ok && data?.roles && typeof data.roles === "object"){
        supportRoleBadges.clear();
        for(const [uid,role] of Object.entries(data.roles)){
          if(role === "sr_admin" || role === "full_admin"){
            supportRoleBadges.set(String(uid), role);
          }
        }
      }
    }catch{}
    supportRoleBadgesLoaded = true;
    return supportRoleBadges;
  })().finally(()=>{ supportRoleBadgesLoading = null; });

  return supportRoleBadgesLoading;
}

async function detectProfileTable() {
  if (PROFILE_TABLE_OK !== null) return PROFILE_TABLE_OK;
  try {
    const res = await supabase.from("support_public_profiles").select("user_id").limit(1);
    PROFILE_TABLE_OK = !res.error;
  } catch {
    PROFILE_TABLE_OK = false;
  }
  return PROFILE_TABLE_OK;
}

async function fetchProfileName() {
  const ok = await detectProfileTable();
  if (!ok) return null;
  try {
    const res = await supabase
      .from("support_public_profiles")
      .select("display_name")
      .eq("user_id", USER_ID)
      .limit(1);

    if (res.error) return null;
    const row = res.data && res.data[0] ? res.data[0] : null;
    return row?.display_name || null;
  } catch {
    return null;
  }
}

async function upsertProfileName(name) {
  const ok = await detectProfileTable();
  if (!ok) return;
  const safe = String(name || "").trim().slice(0, 60);
  if (!safe) return;
  try {
    const res = await fetch("/api/support-profile", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: safe }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error || "support profile update failed");
  } catch (e) {
    // If the table is not properly configured, don't break the chat.
    console.warn("support_users upsert failed", e);
  }
}


async function ensureNicknameReady() {
  const localName = getUserName();
  const okProfiles = await detectProfileTable();
  if (okProfiles) {
    const dbName = await fetchProfileName();
    if (dbName) {
      setUserName(dbName);
      return true;
    }
    clearStoredUserName();
    return false;
  }
  return !!localName;
}

function redirectToNicknameLogin() {
  try { requireNicknameLogin(); }
  catch { location.href = "/login?nickname=1"; }
}

// ---------- Helpers ----------
function escapeHtml(s = "") {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Convert URLs in plain text to safe clickable links.
function linkifyText(raw = "") {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const parts = String(raw).split(urlRe);
  return parts.map(p => {
    if (p.match(urlRe)) {
      const safeUrl = escapeHtml(p);
      return `<a class="support-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    }
    return escapeHtml(p);
  }).join("");
}


function isMissingColumnError(error){
  const msg = String(error?.message || "") + " " + String(error?.details || "");
  const code = String(error?.code || "");
  return code === "42P01" || code === "42703" || /Could not find|does not exist|column .* does not exist|schema cache/i.test(msg);
}

function normalizeSupportRow(row){
  const r = row && typeof row === "object" ? { ...row } : {};
  const userId = String(r.user_id || r.sender_id || "");
  const senderId = String(r.sender_id || r.user_id || userId || "");
  const replyTo = r.reply_to && typeof r.reply_to === "object" ? r.reply_to : null;
  const replyId = Number(r.reply_to_message_id || replyTo?.id);
  const rawReadCount = Number(r.read_count);
  const readCountKnown = r.read_count_known === true && Number.isFinite(rawReadCount) && rawReadCount >= 0;
  return {
    ...r,
    user_id: userId || senderId,
    sender_id: senderId || userId,
    sender_name: String(supportProfileNames.get(senderId) || r.sender_name || r.name || r.display_name || "User"),
    message: String(r.message || r.text || ""),
    room_type: String(r.room_type || "public"),
    room_id: String(r.room_id || "public"),
    reply_to_message_id: Number.isSafeInteger(replyId) && replyId > 0 ? replyId : null,
    reply_to: replyTo ? {
      id:Number(replyTo.id) || null,
      user_id:String(replyTo.user_id || replyTo.sender_id || ""),
      sender_id:String(replyTo.sender_id || replyTo.user_id || ""),
      sender_name:String(supportProfileNames.get(String(replyTo.sender_id || replyTo.user_id || "")) || replyTo.sender_name || replyTo.name || "User"),
      message:String(replyTo.message || replyTo.text || ""),
    } : null,
    read_count: readCountKnown ? Math.max(0, Math.floor(rawReadCount)) : null,
    read_count_known: readCountKnown,
    created_at: r.created_at || new Date().toISOString(),
  };
}

async function fetchSupportMessagesApi(params){
  const qs = new URLSearchParams(params || {});
  const res = await fetch((await resolveFnBase()) + "/support-messages?" + qs.toString(), {
    method: "GET",
    credentials: "same-origin",
    headers: { "accept": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok || !data?.ok) throw new Error(data?.error || "Could not load support messages.");
  return {
    rows: Array.isArray(data.rows) ? data.rows.map(normalizeSupportRow) : [],
    interactions: data?.interactions && typeof data.interactions === "object" ? data.interactions : {},
    interactionsAvailable: data?.interactions_available === true,
  };
}

const SUPPORT_REACTIONS = [
  ["like", "👍", "Like"],
  ["love", "❤️", "Love"],
  ["laugh", "😂", "Laugh"],
  ["angry", "😡", "Angry"],
  ["sad", "😢", "Sad"],
  ["dislike", "👎", "Dislike"],
];
let supportInteractions = Object.create(null);
let supportInteractionsAvailable = false;
let visibleMessageRows = [];
let supportUnreadRows = [];
let supportUnreadAvailable = false;
let supportUnreadLoaded = false;
let supportUnreadLoadInFlight = false;
let lastSupportUnreadLoadAt = 0;
let supportUnreadRetryTimer = 0;
const SUPPORT_UNREAD_MIN_INTERVAL_MS = 5000;
let lastSupportUnreadCount = null;
let frozenLegacySupportSeen = null;

function emptySupportInteraction(){
  return {
    reactions: {
      counts:{ like:0, love:0, laugh:0, angry:0, sad:0, dislike:0 },
      users:{ like:[], love:[], laugh:[], angry:[], sad:[], dislike:[] },
      mine:"",
    },
    readers:[],
    read_count:0,
  };
}

function interactionForMessage(id){
  return supportInteractions[String(id || "")] || emptySupportInteraction();
}

function supportInteractionSignature(id){
  if(!supportInteractionsAvailable || !id) return "";
  try { return JSON.stringify(interactionForMessage(id)?.reactions || {}); }
  catch { return ""; }
}

function mergeSupportInteractions(next){
  if(!next || typeof next !== "object") return;
  for(const [id, value] of Object.entries(next)){
    supportInteractions[String(id)] = value;
  }
}

async function postSupportInteraction(body){
  const res = await fetch("/api/support-message-interactions", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "content-type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data?.error || "Support interaction failed.");
  if(data?.available === false){
    supportInteractionsAvailable = false;
    return data;
  }
  supportInteractionsAvailable = true;
  mergeSupportInteractions(data?.interactions);
  return data;
}

function legacySupportSeenSnapshot(){
  if(frozenLegacySupportSeen) return frozenLegacySupportSeen;
  const rooms = Object.create(null);
  try{
    for(let i = 0; i < localStorage.length; i += 1){
      const key = localStorage.key(i) || "";
      if(!key.startsWith("sr_support_seen_dm_")) continue;
      const roomId = key.slice("sr_support_seen_dm_".length);
      const value = localStorage.getItem(key) || "";
      if(roomId && value) rooms[roomId] = value;
    }
  }catch{}
  frozenLegacySupportSeen = { public:getSeen(LS_PUBLIC_SEEN), rooms };
  return frozenLegacySupportSeen;
}

function targetedSupportNotificationCount(){
  const recentById = new Map(
    (Array.isArray(recentCache) ? recentCache : [])
      .map((row) => [String(row?.id || ""), normalizeSupportRow(row)])
      .filter(([id]) => id)
  );

  let count = 0;
  for(const raw of Array.isArray(supportUnreadRows) ? supportUnreadRows : []){
    const row = normalizeSupportRow(raw);
    const senderId = String(row.sender_id || row.user_id || "");
    if(!senderId || senderId === USER_ID) continue;

    if(row.mentioned_me){
      count += 1;
      continue;
    }

    if(isExplicitDmRow(row)){
      const participants = String(row.room_id || "").split("__").filter(Boolean);
      if(participants.includes(USER_ID) && participants.includes(senderId)){
        count += 1;
        continue;
      }
    }

    const replyId = Number(row.reply_to_message_id);
    if(!Number.isSafeInteger(replyId) || replyId <= 0) continue;

    const enriched = recentById.get(String(row.id));
    const target = row.reply_to || enriched?.reply_to || recentById.get(String(replyId)) || null;
    const targetOwner = String(target?.sender_id || target?.user_id || "");
    if(targetOwner === USER_ID) count += 1;
  }
  return count;
}

function publishSupportNotificationState(){
  try{
    window.dispatchEvent(new CustomEvent("sr:support-notification-state", {
      detail:{ count:targetedSupportNotificationCount() }
    }));
  }catch{}
}

function applySupportUnreadPayload(data, { allowSound = true } = {}){
  if(data?.available !== true){
    supportUnreadAvailable = false;
    supportUnreadLoaded = true;
    updateBadgesFromRecentCache();
    publishSupportNotificationState();
    return;
  }
  const previous = lastSupportUnreadCount;
  supportUnreadAvailable = true;
  supportUnreadLoaded = true;
  supportUnreadRows = Array.isArray(data?.rows) ? data.rows.map(normalizeSupportRow) : [];
  lastSupportUnreadCount = supportUnreadRows.length;
  updateBadgesFromRecentCache();
  publishSupportNotificationState();
  if(allowSound && previous != null && lastSupportUnreadCount > previous){
    try{ playSoftNotification(); }catch{}
  }
}

async function refreshSupportUnread(options = {}){
  const force = options?.force === true;
  const now = Date.now();
  if(!force && lastSupportUnreadLoadAt && now - lastSupportUnreadLoadAt < SUPPORT_UNREAD_MIN_INTERVAL_MS){
    if(!supportUnreadRetryTimer){
      const remaining = Math.max(50, SUPPORT_UNREAD_MIN_INTERVAL_MS - (now - lastSupportUnreadLoadAt));
      supportUnreadRetryTimer = setTimeout(() => {
        supportUnreadRetryTimer = 0;
        refreshSupportUnread({ ...options, force:true }).catch(()=>{});
      }, remaining);
    }
    return;
  }
  if(supportUnreadLoadInFlight) return;
  lastSupportUnreadLoadAt = now;
  supportUnreadLoadInFlight = true;
  try{
    const data = await postSupportInteraction({
      action:"unread",
      limit:500,
      legacy_seen:legacySupportSeenSnapshot(),
    });
    applySupportUnreadPayload(data, options);
  }catch(error){
    console.warn("support unread sync failed", error);
    if(!supportUnreadLoaded){
      supportUnreadLoaded = true;
      supportUnreadAvailable = false;
      supportUnreadRows = [];
      lastSupportUnreadCount = 0;
      updateBadgesFromRecentCache();
      publishSupportNotificationState();
    }
  }finally{
    supportUnreadLoadInFlight = false;
  }
}

let interactionsLoadInFlight = false;
let lastInteractionsLoadAt = 0;
let interactionsRefreshQueued = false;
let interactionsForceQueued = false;
let interactionsQueuedRows = [];

async function refreshSupportInteractions(rows, force = false){
  const safeRows = Array.isArray(rows) ? rows : [];
  const ids = safeRows
    .map((row) => Number(row?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, 500);
  if(!ids.length) return;
  if(interactionsLoadInFlight){
    interactionsRefreshQueued = true;
    interactionsForceQueued = interactionsForceQueued || !!force;
    interactionsQueuedRows = safeRows.length ? safeRows : interactionsQueuedRows;
    return;
  }
  const now = Date.now();
  if(!force && now - lastInteractionsLoadAt < 3500) return;
  lastInteractionsLoadAt = now;
  interactionsLoadInFlight = true;
  try{
    const before = JSON.stringify(supportInteractions);
    const result = await postSupportInteraction({ action:"list", message_ids:ids });
    if(result?.available === false){
      supportInteractions = Object.create(null);
    }else{
      supportInteractions = Object.assign(Object.create(null), result?.interactions || {});
    }
    if(before !== JSON.stringify(supportInteractions)){
      refreshRenderedSupportInteractions();
    }
  }catch(error){
    console.warn("support interactions refresh failed", error);
  }finally{
    interactionsLoadInFlight = false;
    if(interactionsRefreshQueued){
      const queuedRows = interactionsQueuedRows.length ? interactionsQueuedRows : visibleMessageRows;
      const queuedForce = interactionsForceQueued;
      interactionsRefreshQueued = false;
      interactionsForceQueued = false;
      interactionsQueuedRows = [];
      queueMicrotask(() => refreshSupportInteractions(queuedRows, queuedForce).catch(()=>{}));
    }
  }
}

function renderSupportTextWithMentionChips(raw = ""){
  const text = String(raw || "");
  const lines = text.split("\n");
  const first = String(lines[0] || "").trim();
  const parts = first.split(/\s+•\s+/).map((part)=>part.trim()).filter(Boolean);
  const isMentionLine = parts.length > 0 && parts.every((part)=>part.startsWith("@") && part.length > 1 && part.length <= 90);

  if(!isMentionLine){
    return '<div class="support-msg-text" dir="auto">' + linkifyText(text) + '</div>';
  }

  const chips = parts.map((part)=>{
    const all = ["@الكل","@everyone","@all"].includes(part.toLowerCase());
    return '<span class="support-message-mention-chip' + (all ? ' is-all' : '') + '">' + escapeHtml(part) + '</span>';
  }).join("");
  const rest = lines.slice(1).join("\n");
  return '<div class="support-message-mention-line">' + chips + '</div>' +
    (rest ? '<div class="support-msg-text" dir="auto">' + linkifyText(rest) + '</div>' : "");
}

function renderMessageHtml(m) {
  const text = m?.message || "";
  const lines = String(text).split("\n");
  const last = lines[lines.length - 1] || "";
  const urlMatch = last.match(/^(https?:\/\/[^\s]+)$/);

  if(urlMatch && lines.length >= 2 && lines[lines.length - 2].toLowerCase().startsWith("attachment:")){
    const url = safeSupportMediaUrl(urlMatch[1]);
    const label = lines[lines.length - 2].slice("attachment:".length).trim() || "Attachment";
    const body = lines.slice(0, -2).join("\n");
    const bodyHtml = body ? renderSupportTextWithMentionChips(body) : "";

    if(url && isSupportImageFileName(label)){
      const safeUrl = escapeHtml(url);
      const safeLabel = escapeHtml(label);
      return `${bodyHtml}
        <button type="button" class="support-image-card" data-support-image-url="${safeUrl}" data-support-image-name="${safeLabel}" aria-label="Open image ${safeLabel}">
          <img src="${safeUrl}" alt="${safeLabel}" loading="lazy" decoding="async">
          <span class="support-image-fallback" aria-hidden="true">🖼️ <span>Open image</span></span>
          <span class="support-image-overlay" aria-hidden="true">⛶</span>
        </button>
        <span class="support-image-caption" title="${safeLabel}">${safeLabel}</span>`;
    }

    if(url){
      return `${bodyHtml}<div class="support-attach-line">📎 <a class="support-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></div>`;
    }
  }

  return renderSupportTextWithMentionChips(text);
}

function renderSupportReplyReference(row){
  const targetId = Number(row?.reply_to_message_id || row?.reply_to?.id);
  if(!Number.isSafeInteger(targetId) || targetId <= 0) return "";
  const target = row?.reply_to && typeof row.reply_to === "object" ? row.reply_to : null;
  const name = target?.sender_name || "Original message";
  const preview = target ? compactSupportPreview(target.message || "") : "This message is no longer available.";
  return `<button type="button" class="support-reply-reference" data-target-message-id="${escapeHtml(String(targetId))}"><b>Replying to ${escapeHtml(name)}</b><span>${escapeHtml(preview)}</span></button>`;
}

function renderSupportReactionSummary(messageId){
  const current = interactionForMessage(messageId)?.reactions || {};
  const counts = current.counts || {};
  const users = current.users || {};
  const mine = String(current.mine || "");
  return SUPPORT_REACTIONS
    .filter(([key]) => Number(counts[key] || 0) > 0)
    .map(([key, icon, label]) => {
      const names = Array.isArray(users[key]) ? users[key].slice(0, 20) : [];
      const title = names.length ? names.join(", ") : label;
      return `<button type="button" class="support-reaction-badge ${mine === key ? "mine" : ""}" data-message-id="${escapeHtml(messageId)}" data-reaction="${escapeHtml(key)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}: ${Number(counts[key] || 0)}"><span aria-hidden="true">${icon}</span><span>${Number(counts[key] || 0)}</span></button>`;
    })
    .join("");
}

function renderSupportMessageInteractions(row){
  const id = row?.id == null ? "" : String(row.id);
  if(!id || id.startsWith("local-")) return "";
  return `
    <div class="support-msg-interactions">
      <div class="support-reaction-summary">${supportInteractionsAvailable ? renderSupportReactionSummary(id) : ""}</div>
      <button type="button" class="support-reply-btn" data-message-id="${escapeHtml(id)}" title="Reply to this message" aria-label="Reply to this message"><span aria-hidden="true">↩</span><span>Reply</span></button>
      ${supportInteractionsAvailable ? `<div class="support-msg-tools">
        <button type="button" class="support-msg-action support-react-open" data-message-id="${escapeHtml(id)}" title="React" aria-label="React to message">☺</button>
      </div>` : ""}
    </div>
  `;
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}
function setStatus(text, type = "info") {
  statusEl.textContent = text || "";
  statusEl.dataset.type = type;
}
function show(el) {
  if (!el) return;
  el.style.display = "flex";
  el.setAttribute("aria-hidden", "false");
}
function hide(el) {
  if (!el) return;
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
}

let supportPageLock = null;

// The physical mobile screen can stay narrow while browser CSS uses desktop width.
function supportNeedsCompactLayout() {
  const narrowViewport = !!window.matchMedia?.("(max-width: 680px)")?.matches;
  const touch = !!window.matchMedia?.("(pointer: coarse)")?.matches;
  const screenWidth = Number(window.screen?.width) || Infinity;
  const screenHeight = Number(window.screen?.height) || Infinity;
  return narrowViewport || (touch && Math.min(screenWidth, screenHeight) <= 680);
}
function syncSupportMobileShell() {
  chatOverlay?.classList.toggle("sr-support-mobile-viewport", supportNeedsCompactLayout());
}

function lockPageBehindSupport() {
  if (supportPageLock || !document.body || !document.documentElement) return;
  const body = document.body;
  const root = document.documentElement;
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  supportPageLock = {
    scrollX,
    scrollY,
    body: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    },
    rootOverflow: root.style.overflow,
  };
  // Fixed body can place Android browser composited overlays above the messages.
  if (supportNeedsCompactLayout()) {
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    return;
  }
  body.style.position = "fixed";
  body.style.top = `${-scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  root.style.overflow = "hidden";
}

function unlockPageBehindSupport() {
  const saved = supportPageLock;
  if (!saved || !document.body || !document.documentElement) return;
  supportPageLock = null;
  const body = document.body;
  body.style.position = saved.body.position;
  body.style.top = saved.body.top;
  body.style.left = saved.body.left;
  body.style.right = saved.body.right;
  body.style.width = saved.body.width;
  body.style.overflow = saved.body.overflow;
  document.documentElement.style.overflow = saved.rootOverflow;
  try { window.scrollTo({ left: saved.scrollX, top: saved.scrollY, behavior: "auto" }); }
  catch { window.scrollTo(saved.scrollX, saved.scrollY); }
}

function focusMessageInput() {
  if (!msgInput) return;
  try {
    msgInput.focus({ preventScroll: true });
    return;
  } catch {}
  try { msgInput.focus(); } catch {}
}

// ---------- Emoji UI ----------
const SUPPORT_EMOJI_GROUPS = [
  ["Faces", ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","😘","😋","😎","🤓","🤔","😐","😑","😶","🙄","😏","😣","😥","😮","😯","😪","😫","😴","😌","😛","😜","😝","😢","😭","😤","😠","😡","😳","😱","😨","😰","🤗","🤭","🤫"]],
  ["Gestures", ["👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","👏","🙌","🙏","💪","✍️","👀","🧠"]],
  ["Hearts", ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","💕","💞","💓","💗","💖","💘","💝","💟"]],
  ["Work", ["✅","☑️","❌","⚠️","ℹ️","❓","❗","💡","📌","📍","📎","📝","📄","📊","📈","📉","📞","☎️","💬","📩","📤","📥","📅","⏰","⏳","🕒","🔒","🔓","🔑","🛠️","⚙️","🔧","🔍"]],
  ["Fun", ["🔥","✨","⭐","🌟","💫","🎉","🎊","🎯","🏆","🥇","🚀","💯","💥","🎈","🎁","☕","🍵","🍕","🍔","🍟","🍰","🌹","🌷","🌞","🌙","⚡","🌈"]]
];

let supportEmojiCompatibilityCache = null;

function emojiCanvasSignature(ctx, value){
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = '28px "Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji",sans-serif';
  ctx.textBaseline = "top";
  ctx.fillText(String(value || ""), 4, 4);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  let ink = 0;
  for(let i=0;i<data.length;i+=4){
    const a=data[i+3];
    if(a) ink++;
    hash ^= (data[i] + data[i+1]*3 + data[i+2]*7 + a*11) & 255;
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0) + ":" + ink;
}

function emojiLooksSupported(emoji){
  const value = String(emoji || "");
  if(!value) return false;
  try{
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently:true });
    if(!ctx) return true;
    const sig = emojiCanvasSignature(ctx, value);
    const replacement = emojiCanvasSignature(ctx, "�");
    const box = emojiCanvasSignature(ctx, "□");
    return sig !== replacement && sig !== box && !sig.endsWith(":0");
  }catch{
    return true;
  }
}

function compatibleSupportEmojiGroups(){
  if(supportEmojiCompatibilityCache) return supportEmojiCompatibilityCache;
  supportEmojiCompatibilityCache = SUPPORT_EMOJI_GROUPS
    .map(([label, emojis]) => [label, emojis.filter(emojiLooksSupported)])
    .filter(([, emojis]) => emojis.length);
  return supportEmojiCompatibilityCache;
}

function renderEmojiPopover(){
  if(!emojiPopover) return;
  emojiPopover.innerHTML = `
    <div class="support-emoji-catalog" role="group" aria-label="Emoji picker">
      ${compatibleSupportEmojiGroups().map(([label, emojis]) => `
        <section class="support-emoji-section">
          <div class="support-emoji-section-title">${escapeHtml(label)}</div>
          <div class="support-emoji-grid">
            ${emojis.map(e=>`<button class="support-emoji-btn" type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
  emojiPopover.querySelectorAll("button.support-emoji-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const e = btn.getAttribute("data-emoji") || "";
      insertAtCursor(msgInput, e);
      closeEmojiPopover();
      focusMessageInput();
    });
  });
}

function openEmojiPopover(){
  if(!emojiPopover) return;
  renderEmojiPopover();
  emojiPopover.style.display = "block";
}
function closeEmojiPopover(){
  if(!emojiPopover) return;
  emojiPopover.style.display = "none";
}
function toggleEmojiPopover(){
  if(!emojiPopover) return;
  const open = emojiPopover.style.display !== "none" && emojiPopover.style.display !== "";
  if(open) closeEmojiPopover(); else openEmojiPopover();
}

function insertAtCursor(input, text){
  if(!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const v = input.value || "";
  input.value = v.slice(0, start) + text + v.slice(end);
  const p = start + text.length;
  try{ input.setSelectionRange(p, p); }catch{}
  input.dispatchEvent(new Event("input", { bubbles:true }));
}

// Close emoji popover on outside click
document.addEventListener("click", (e)=>{
  if(!emojiPopover) return;
  const t = e.target;
  if(t === emojiBtn) return;
  if(emojiPopover.contains(t)) return;
  closeEmojiPopover();
});

// ---------- Rich image attachments ----------
let selectedPreviewObjectUrl = "";

function isSupportImageFileName(name){
  return /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(String(name || "").split(/[?#]/)[0]);
}

function isSupportImageFile(file){
  return !!file && (
    String(file.type || "").toLowerCase().startsWith("image/") ||
    isSupportImageFileName(file.name)
  );
}

function safeSupportMediaUrl(value){
  try{
    const url = new URL(String(value || ""), location.href);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
  }catch{
    return "";
  }
}

function ensureSupportDesktopProStyles(){
  const href = `./support-desktop-pro-v4.css?v=${SUPPORT_BUILD_VERSION}`;
  let link = document.querySelector('link[data-sr-support-pro-v4="1"],link[href*="support-desktop-pro-v4.css"]');

  if(link?.sheet) return Promise.resolve(true);

  if(!link){
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.srSupportProV4 = "1";
    document.head.appendChild(link);
  }else{
    link.dataset.srSupportProV4 = "1";
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if(settled) return;
      settled = true;
      resolve(!!ok);
    };
    link.addEventListener("load", () => finish(true), { once:true });
    link.addEventListener("error", () => finish(false), { once:true });
    setTimeout(() => finish(!!link.sheet), 900);
  });
}

async function installSupportDesktopPro(){
  const legacyStyle = document.getElementById("sr-support-desktop-pro-styles");
  if(legacyStyle) legacyStyle.remove();

  await ensureSupportDesktopProStyles();

  chatOverlay?.classList?.add("sr-support-pro-v4");
  document.documentElement.classList.add("sr-support-pro-v4-active");
  document.documentElement.dataset.srSupportDesktopPro = "v4";

  const panel = chatOverlay?.querySelector?.(".support-chat");
  const header = chatOverlay?.querySelector?.(".support-chat-header");
  const titleWrap = header?.firstElementChild || null;

  panel?.classList?.remove("sr-support-desktop-stable");
  panel?.classList?.add("sr-support-desktop-v4");
  header?.classList?.remove("sr-support-desktop-header");
  header?.classList?.add("sr-support-desktop-header-v4");

  titleWrap?.querySelectorAll?.(".sr-support-app-badge,.sr-support-brand-pill")?.forEach((el) => el.remove());
  if(titleWrap){
    const badge = document.createElement("span");
    badge.className = "sr-support-brand-pill";
    badge.textContent = "S";
    badge.setAttribute("aria-hidden","true");
    titleWrap.insertBefore(badge, titleWrap.firstChild);
  }
}
function installSupportMediaEnhancements(){
  if(document.getElementById("sr-support-media-styles")) return;

  const style = document.createElement("style");
  style.id = "sr-support-media-styles";
  style.textContent = `
    #supportEmojiPopover{max-height:min(420px,65vh);overflow:hidden}
    #supportEmojiPopover .support-emoji-catalog{max-height:min(390px,60vh);overflow:auto;padding:5px 4px 7px;overscroll-behavior:contain;scrollbar-width:thin}
    #supportEmojiPopover .support-emoji-section{padding:3px 2px 8px}
    #supportEmojiPopover .support-emoji-section-title{position:sticky;top:0;z-index:2;padding:4px 5px;font-size:10px;font-weight:900;letter-spacing:.02em;opacity:.72;background:inherit;backdrop-filter:blur(8px)}
    #supportEmojiPopover .support-emoji-grid{display:grid;grid-template-columns:repeat(8,minmax(30px,1fr));gap:3px}
    #supportEmojiPopover .support-emoji-btn{display:grid;place-items:center;min-width:31px;min-height:31px;padding:2px;border-radius:8px;font-size:19px;line-height:1}
    .support-image-card{display:flex;position:relative;align-items:center;justify-content:center;width:min(330px,100%);max-width:100%;min-height:96px;margin:6px 0 2px;padding:0;border:1px solid rgba(148,163,184,.16);border-radius:14px;overflow:hidden;background:rgba(5,10,18,.38);cursor:zoom-in;box-shadow:0 4px 14px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.04)}
    .support-image-card img{display:block;width:auto;height:auto;max-width:100%;max-height:360px;margin:auto;object-fit:contain;background:transparent}
    .support-image-card::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.06) 45%,transparent 70%);transform:translateX(-120%);animation:srSupportImageLoad 1.1s ease-in-out infinite;pointer-events:none}
    .support-image-card.is-loaded::before,.support-image-card.is-broken::before{display:none}
    @keyframes srSupportImageLoad{to{transform:translateX(120%)}}
    .support-image-card .support-image-overlay{position:absolute;right:8px;bottom:8px;display:grid;place-items:center;width:30px;height:30px;border:1px solid rgba(255,255,255,.14);border-radius:50%;background:rgba(8,15,27,.76);color:#fff;font-size:15px;box-shadow:0 2px 10px rgba(0,0,0,.28);pointer-events:none}
    .support-image-card.is-broken img{display:none}
    .support-image-card .support-image-fallback{display:none;min-height:88px;padding:14px;align-items:center;justify-content:center;gap:8px;text-align:center;color:inherit}
    .support-image-card.is-broken .support-image-fallback{display:flex}
    .support-image-caption{display:block;max-width:min(330px,100%);margin:4px 2px 1px;font-size:10px;opacity:.62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #supportAttachPreview .support-compose-image-preview{display:grid;grid-template-columns:74px minmax(0,1fr) 30px;align-items:center;gap:9px;padding:7px;border-radius:12px;border:1px solid rgba(148,163,184,.24);background:rgba(15,23,42,.22)}
    #supportAttachPreview .support-compose-image-preview img{width:74px;height:62px;object-fit:contain;border-radius:9px;background:rgba(5,10,18,.34)}
    #supportAttachPreview .support-compose-image-copy{min-width:0}
    #supportAttachPreview .support-compose-image-copy b,#supportAttachPreview .support-compose-image-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #supportAttachPreview .support-compose-image-copy b{font-size:11px}
    #supportAttachPreview .support-compose-image-copy span{margin-top:3px;font-size:10px;opacity:.65}
    #supportAttachPreview .support-attach-remove{width:28px;height:28px;border-radius:50%}
    #srSupportImageLightbox{position:fixed;inset:0;z-index:2147483400;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(2,6,14,.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
    #srSupportImageLightbox.is-open{display:flex}
    #srSupportImageLightbox .sr-support-lightbox-frame{position:relative;display:flex;max-width:min(96vw,1200px);max-height:94vh;flex-direction:column;align-items:center;justify-content:center;gap:9px}
    #srSupportImageLightbox img{display:block;width:auto;height:auto;max-width:96vw;max-height:88vh;object-fit:contain;border-radius:10px;box-shadow:0 24px 70px rgba(0,0,0,.55)}
    #srSupportImageLightbox .sr-support-lightbox-caption{max-width:90vw;color:#fff;font-size:11px;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #srSupportImageLightbox .sr-support-lightbox-close{position:fixed;top:14px;right:16px;width:38px;height:38px;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:rgba(15,23,42,.72);color:#fff;font-size:25px;line-height:1;cursor:pointer}
  `;
  document.head.appendChild(style);

  const lightbox = document.createElement("div");
  lightbox.id = "srSupportImageLightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Image preview");
  lightbox.innerHTML = '<button type="button" class="sr-support-lightbox-close" aria-label="Close">×</button><div class="sr-support-lightbox-frame"><img alt=""><div class="sr-support-lightbox-caption"></div></div>';
  document.body.appendChild(lightbox);

  const close = () => {
    lightbox.classList.remove("is-open");
    const image = lightbox.querySelector("img");
    if(image) image.removeAttribute("src");
  };

  lightbox.querySelector(".sr-support-lightbox-close")?.addEventListener("click", close);
  lightbox.addEventListener("click", (event) => {
    if(event.target === lightbox) close();
  });
  document.addEventListener("keydown", (event) => {
    if(event.key === "Escape" && lightbox.classList.contains("is-open")) close();
  });

  messagesList?.addEventListener("click", (event) => {
    const card = event.target?.closest?.(".support-image-card[data-support-image-url]");
    if(!card) return;
    event.preventDefault();
    event.stopPropagation();

    const url = safeSupportMediaUrl(card.getAttribute("data-support-image-url"));
    if(!url) return;
    const caption = String(card.getAttribute("data-support-image-name") || "");

    const image = lightbox.querySelector("img");
    const captionEl = lightbox.querySelector(".sr-support-lightbox-caption");
    if(image){
      image.src = url;
      image.alt = caption || "Support image";
    }
    if(captionEl) captionEl.textContent = caption;
    lightbox.classList.add("is-open");
  });

  messagesList?.addEventListener("load", (event) => {
    const image = event.target;
    if(!(image instanceof HTMLImageElement) || !image.closest(".support-image-card")) return;
    image.closest(".support-image-card")?.classList.add("is-loaded");
  }, true);

  messagesList?.addEventListener("error", (event) => {
    const image = event.target;
    if(!(image instanceof HTMLImageElement) || !image.closest(".support-image-card")) return;
    const card = image.closest(".support-image-card");
    card?.classList.remove("is-loaded");
    card?.classList.add("is-broken");
  }, true);
}

// ---------- Attachments ----------
const UPLOAD_BUCKET = "support-uploads";

function setSelectedFile(file){
  if(selectedPreviewObjectUrl){
    try{ URL.revokeObjectURL(selectedPreviewObjectUrl); }catch{}
    selectedPreviewObjectUrl = "";
  }
  selectedFile = file || null;
  renderAttachmentPreview();
}

function renderAttachmentPreview(){
  if(!attachPreview) return;
  if(!selectedFile){
    attachPreview.style.display = "none";
    attachPreview.innerHTML = "";
    return;
  }

  const name = escapeHtml(selectedFile.name || "file");
  const sizeKb = Math.max(1, Math.round((selectedFile.size || 0) / 1024));
  attachPreview.style.display = "block";

  if(isSupportImageFile(selectedFile)){
    try{ selectedPreviewObjectUrl = URL.createObjectURL(selectedFile); }catch{ selectedPreviewObjectUrl = ""; }
    const previewUrl = escapeHtml(selectedPreviewObjectUrl);
    attachPreview.innerHTML = `
      <div class="support-compose-image-preview">
        ${previewUrl ? `<img src="${previewUrl}" alt="${name}">` : '<div aria-hidden="true">🖼️</div>'}
        <div class="support-compose-image-copy"><b>${name}</b><span>Image · ${sizeKb} KB</span></div>
        <button class="support-attach-remove" type="button" aria-label="Remove">×</button>
      </div>
    `;
  }else{
    attachPreview.innerHTML = `
      <span class="support-attach-chip">
        📎 <span>${name}</span>
        <span style="opacity:.7;">(${sizeKb} KB)</span>
        <button class="support-attach-remove" type="button" aria-label="Remove">×</button>
      </span>
    `;
  }

  attachPreview.querySelector(".support-attach-remove")?.addEventListener("click", ()=>{
    setSelectedFile(null);
    if(attachInput) attachInput.value = "";
  });
}

function sanitizeFileName(name){
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

async function uploadAttachment(file){
  // Basic size guard (public chat): 10MB
  const max = 10 * 1024 * 1024;
  if((file.size || 0) > max){
    throw new Error("File is too large (max 10MB)");
  }

  const safeName = sanitizeFileName(file.name);
  const pathBase = `${USER_ID}/${Date.now()}_${safeName}`;

  let path = pathBase;
  let up = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if(up.error && String(up.error.message || "").includes("already exists")){
    path = `${USER_ID}/${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName}`;
    up = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  }
  if(up.error) throw up.error;

  const pub = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  const url = pub?.data?.publicUrl;
  if(!url) throw new Error("Could not get public URL");
  return { url, name: file.name };
}

async function isBlocked() {
  // blocks table (supports either `expires_at` or legacy `blocked_until`)
  const now = new Date().toISOString();

  // Preferred schema: expires_at
  let res = await supabase
    .from("blocks")
    .select("expires_at, reason")
    .eq("user_id", USER_ID)
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1);

  // Legacy fallback: blocked_until
  if (res.error && (String(res.error.message || "").includes("expires_at") || String(res.error.details || "").includes("expires_at"))) {
    res = await supabase
      .from("blocks")
      .select("blocked_until, reason")
      .eq("user_id", USER_ID)
      .gt("blocked_until", now)
      .order("blocked_until", { ascending: false })
      .limit(1);

    if (!res.error && res.data && res.data[0]) {
      return { expires_at: res.data[0].blocked_until, reason: res.data[0].reason };
    }
  }

  if (res.error) return null;
  return (res.data && res.data[0]) ? res.data[0] : null;
}

// ---------- Chat state ----------
let activeRoom = { type: "public", room_id: "public" }; // default
let sub = null;
let bgSub = null;

// ---------- Unread tracking ----------
const LS_PUBLIC_SEEN = "sr_support_seen_public";
function lsDmSeenKey(roomId){ return `sr_support_seen_dm_${roomId}`; }
function getSeen(key){ return localStorage.getItem(key) || ""; }
function setSeen(key, iso){ try{ localStorage.setItem(key, iso); }catch{} }

function maxIso(a, b){
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return "";
  if (!Number.isFinite(ta)) return b || "";
  if (!Number.isFinite(tb)) return a || "";
  return ta >= tb ? (a || "") : (b || "");
}

function getLatestSeenIso(type, roomId){
  if(type === "public") return getSeen(LS_PUBLIC_SEEN);
  if(type === "dm") return getSeen(lsDmSeenKey(roomId));
  return "";
}

function markRoomSeenAt(type, roomId, iso){
  const current = getLatestSeenIso(type, roomId);
  const nextIso = maxIso(current, iso || new Date().toISOString()) || new Date().toISOString();

  if(type === "public") {
    setSeen(LS_PUBLIC_SEEN, nextIso);

    // إزالة الرسائل العامة المقروءة من الكاش
    recentCache = recentCache.filter(msg => {
      const room = msg.room_id || msg.roomId || "public";
      return room !== "public";
    });
  }

  if(type === "dm") {
    setSeen(lsDmSeenKey(roomId), nextIso);

    // إزالة رسائل الـ DM الخاصة بالغرفة المقروءة
    recentCache = recentCache.filter(msg => {
      const room = msg.room_id || msg.roomId;
      return room !== roomId;
    });
  }

  updateBadgesFromRecentCache();
}


function markActiveRoomSeenFromRows(rows){
  if(!Array.isArray(rows) || !rows.length) return;
  let latestIso = "";
  for(const r of rows){
    if(!isRowInActiveRoom(r)) continue;
    latestIso = maxIso(latestIso, r?.created_at || "");
  }
  if(latestIso) markRoomSeenAt(activeRoom.type, activeRoom.room_id, latestIso);
}

// On first run, avoid counting all historical messages as unread
if(!getSeen(LS_PUBLIC_SEEN)){
  setSeen(LS_PUBLIC_SEEN, new Date().toISOString());
}
// Freeze the one-time migration baseline before opening or switching a room can
// advance the legacy timestamp. Otherwise merely opening Support could mark
// messages as read before they were actually visible.
legacySupportSeenSnapshot();

function markRoomSeen(type, roomId){
  markRoomSeenAt(type, roomId, new Date().toISOString());
}

let recentCache = [];
let lastSupportUsersSignature = "";
let lastSupportUnreadSignature = "";

// ===== STEP 6.2 STABLE SUPPORT UI HELPERS START =====
let lastSupportListSignature = "";
let renderedSupportRoomKey = "";
let loadUsersTimer = null;
let seenFlushTimer = null;
const pendingOptimisticRows = new Map();

function supportOptimisticFingerprint(row){
  const r = normalizeSupportRow(row || {});
  return stableActionFingerprint([
    r.sender_id || r.user_id || "",
    r.room_type || "public",
    r.room_id || "public",
    r.reply_to_message_id || "",
    r.message || "",
  ]);
}

function findMatchingPendingOptimisticId(row){
  const wanted = supportOptimisticFingerprint(row);
  if(!wanted) return "";
  for(const [localId, pending] of pendingOptimisticRows){
    if(supportOptimisticFingerprint(pending) === wanted) return String(localId);
  }
  return "";
}

function reconcileIncomingSupportMessage(row, opts = {}){
  const r = normalizeSupportRow(row || {});
  const realId = supportMessageDomId(r);
  if(!realId) return false;

  const localId = findMatchingPendingOptimisticId(r);
  if(!localId) return false;

  const realElement = findSupportMessageElById(realId);
  if(realElement && realId !== localId){
    removeSupportMessageById(localId, opts);
    replaceSupportMessageById(realId, r, opts);
    return true;
  }

  if(findSupportMessageElById(localId)){
    return replaceSupportMessageById(localId, r, opts);
  }

  pendingOptimisticRows.delete(localId);
  return false;
}

function createSupportScrollController(list, options = {}) {
  const threshold = Math.max(4, Number(options.threshold) || 24);
  const requestFrame = options.requestFrame || ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || ((id) => cancelAnimationFrame(id));
  let userPinnedToBottom = true;
  let pendingFrame = 0;
  let pendingPolicy = null;

  function distanceFromBottom() {
    if (!list) return 0;
    return Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop);
  }

  function refreshPinnedState() {
    userPinnedToBottom = distanceFromBottom() <= threshold;
    return userPinnedToBottom;
  }

  function rows() {
    return Array.from(list?.querySelectorAll?.(".support-msg[data-support-msg-key]") || []);
  }

  function captureAnchor() {
    if (!list) return null;
    const listRect = list.getBoundingClientRect?.();
    if (!listRect) return { scrollTop: list.scrollTop, candidates: [] };
    const candidates = rows()
      .filter((row) => row.getBoundingClientRect().bottom > listRect.top + 1)
      .slice(0, 12)
      .map((row) => ({
        key: String(row.dataset.supportMsgKey || ""),
        offset: row.getBoundingClientRect().top - listRect.top,
      }))
      .filter((entry) => entry.key);
    return { scrollTop: list.scrollTop, candidates };
  }

  function findRowByKey(key) {
    return rows().find((row) => String(row.dataset.supportMsgKey || "") === key) || null;
  }

  function writeScrollTop(value) {
    if (!list) return;
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(max, Number(value) || 0));
  }

  function restoreAnchor(anchor) {
    if (!list || !anchor) return;
    const listRect = list.getBoundingClientRect?.();
    if (listRect) {
      for (const candidate of anchor.candidates || []) {
        const row = findRowByKey(candidate.key);
        if (!row) continue;
        const nextOffset = row.getBoundingClientRect().top - listRect.top;
        writeScrollTop(list.scrollTop + (nextOffset - candidate.offset));
        return;
      }
    }
    writeScrollTop(anchor.scrollTop);
  }

  function flushPendingPolicy() {
    pendingFrame = 0;
    const policy = pendingPolicy;
    pendingPolicy = null;
    if (!policy || !list) return;
    if (policy.stickToBottom) writeScrollTop(list.scrollHeight);
    else restoreAnchor(policy.anchor);
    refreshPinnedState();
  }

  function mergePolicy(policy) {
    if (!pendingPolicy) pendingPolicy = policy;
    else if (policy.stickToBottom) pendingPolicy.stickToBottom = true;
  }

  function requestPolicyFrame() {
    if (pendingFrame) return;
    pendingFrame = requestFrame(flushPendingPolicy);
  }

  function mutate(mutator, { stickToBottom = false } = {}) {
    const shouldStick = !!stickToBottom || userPinnedToBottom;
    mergePolicy({
      stickToBottom: shouldStick,
      anchor: shouldStick ? null : captureAnchor(),
    });
    const result = mutator?.();
    requestPolicyFrame();
    return result;
  }

  function scrollToBottomOnce() {
    mergePolicy({ stickToBottom: true, anchor: null });
    requestPolicyFrame();
  }

  function dispose() {
    if (pendingFrame) cancelFrame(pendingFrame);
    pendingFrame = 0;
    pendingPolicy = null;
    list?.removeEventListener?.("scroll", refreshPinnedState);
  }

  list?.addEventListener?.("scroll", refreshPinnedState, { passive: true });
  return {
    mutate,
    scrollToBottomOnce,
    distanceFromBottom,
    isPinnedToBottom: () => userPinnedToBottom,
    refreshPinnedState,
    dispose,
  };
}

const supportScroll = createSupportScrollController(messagesList, { threshold: 24 });

function notifySupportDomChanged(scope) {
  try {
    window.dispatchEvent(new CustomEvent("sr:support-dom-changed", { detail: { scope } }));
    if (scope === "users") window.dispatchEvent(new CustomEvent("sr:support-users-updated"));
  } catch {}
}

function activeSupportRoomKey() {
  return `${String(activeRoom.type || "public")}:${String(activeRoom.room_id || "public")}`;
}

function supportMessageDomId(row) {
  const r = normalizeSupportRow(row || {});
  return r.id == null ? "" : String(r.id);
}

function supportMessageFallbackKey(row) {
  const r = normalizeSupportRow(row || {});
  return [
    String(r.sender_id || r.user_id || ""),
    String(r.created_at || ""),
    String(r.message || "").slice(0, 160),
  ].join("|");
}

function supportMessageKey(row) {
  const id = supportMessageDomId(row);
  return id ? `id:${id}` : `fallback:${supportMessageFallbackKey(row)}`;
}

function supportRowSignature(row) {
  const r = normalizeSupportRow(row || {});
  return [
    supportMessageDomId(r) || supportMessageFallbackKey(r),
    String(r.sender_name || ""),
    supportRoleFor(r.sender_id || r.user_id),
    String(r.message || ""),
    String(r.room_type || ""),
    String(r.room_id || ""),
    String(r.reply_to_message_id || ""),
    String(r.reply_to?.sender_id || ""),
    String(r.reply_to?.sender_name || ""),
    String(r.reply_to?.message || ""),
    String(r.created_at || ""),
  ].join("¦");
}

function supportListSignature(rows) {
  return (rows || []).map(supportRowSignature).join("\n");
}

function supportRowTime(row) {
  const value = Date.parse(normalizeSupportRow(row || {}).created_at || "");
  return Number.isFinite(value) ? value : 0;
}

function sortSupportRowsChronologically(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row: normalizeSupportRow(row), index }))
    .sort((a, b) => {
      const byTime = supportRowTime(a.row) - supportRowTime(b.row);
      if (byTime) return byTime;
      const aId = Number(a.row.id);
      const bId = Number(b.row.id);
      if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function isSupportChatOpen() {
  return !!chatOverlay && chatOverlay.style.display !== "none";
}

function supportDistanceFromBottom() {
  return supportScroll.distanceFromBottom();
}

function isNearSupportBottom(px = 24) {
  return supportDistanceFromBottom() <= px;
}

function createSupportMessageElement(row) {
  const template = document.createElement("template");
  template.innerHTML = renderSupportMessageRow(row).trim();
  const element = template.content.firstElementChild;
  if (element) {
    element.dataset.supportRowSignature = supportRowSignature(row);
    element.dataset.supportInteractionSignature = supportInteractionSignature(row?.id);
  }
  return element;
}

function rowsWithPendingOptimistic(rows) {
  const merged = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = supportMessageKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  for (const row of pendingOptimisticRows.values()) {
    const key = supportMessageKey(row);
    if (isRowInActiveRoom(row) && !seen.has(key)) {
      seen.add(key);
      merged.push(row);
    }
  }
  return sortSupportRowsChronologically(merged);
}

function renderStableMessageList(rows, opts = {}) {
  const orderedRows = rowsWithPendingOptimistic(rows);
  const signature = supportListSignature(orderedRows);
  const roomKey = activeSupportRoomKey();
  const initialBottom = !!opts.initialBottom;
  const requestedBottom = initialBottom || !!opts.stickToBottom;
  if (signature === lastSupportListSignature && roomKey === renderedSupportRoomKey) {
    visibleMessageRows = orderedRows;
    if (initialBottom) supportScroll.scrollToBottomOnce();
    return false;
  }

  const previousKeys = new Set(
    Array.from(messagesList.querySelectorAll(".support-msg[data-support-msg-key]"))
      .map((element) => String(element.dataset.supportMsgKey || ""))
  );
  const ownNewMessage = orderedRows.some((row) => {
    const senderId = String(row.sender_id || row.user_id || "");
    return senderId === USER_ID && !previousKeys.has(supportMessageKey(row));
  });

  supportScroll.mutate(() => {
    const existing = new Map(
      Array.from(messagesList.querySelectorAll(".support-msg[data-support-msg-key]"))
        .map((element) => [String(element.dataset.supportMsgKey || ""), element])
    );
    const desired = [];

    for (const row of orderedRows) {
      const key = supportMessageKey(row);
      const rowSignature = supportRowSignature(row);
      let element = existing.get(key) || null;
      if (element && element.dataset.supportRowSignature !== rowSignature) {
        const replacement = createSupportMessageElement(row);
        if (replacement) {
          element.replaceWith(replacement);
          element = replacement;
        }
      }
      if (!element) element = createSupportMessageElement(row);
      if (!element) continue;
      desired.push(element);
      existing.delete(key);
    }

    messagesList.querySelectorAll(":scope > :not(.support-msg)").forEach((element) => element.remove());
    let cursor = messagesList.firstElementChild;
    for (const element of desired) {
      if (element === cursor) cursor = cursor.nextElementSibling;
      else messagesList.insertBefore(element, cursor || null);
    }
    existing.forEach((element) => element.remove());

    visibleMessageRows = orderedRows;
    lastSupportListSignature = signature;
    renderedSupportRoomKey = roomKey;
    notifySupportDomChanged("messages");
  }, { stickToBottom: requestedBottom || ownNewMessage });

  bindDeleteButtons();
  return true;
}

function queueLoadUsers(delay = 180) {
  if (loadUsersTimer) clearTimeout(loadUsersTimer);
  loadUsersTimer = setTimeout(() => {
    loadUsersTimer = null;
    loadUsers().catch((err) => console.warn("support users refresh failed", err));
  }, delay);
}

function markActiveRoomSeenFromCache() {
  if (!Array.isArray(recentCache) || !recentCache.length) {
    updateBadgesFromRecentCache();
    return;
  }
  let latestIso = "";
  for (const raw of recentCache) {
    const r = normalizeSupportRow(raw);
    if (!isRowInActiveRoom(r)) continue;
    latestIso = maxIso(latestIso, r.created_at || "");
  }
  if (latestIso) markRoomSeenAt(activeRoom.type, activeRoom.room_id, latestIso);
  else updateBadgesFromRecentCache();
}

function flushSeenForOpenRoom() {
  if (!isSupportChatOpen()) return;
  markActiveRoomSeenFromCache();
}

function scheduleSeenFlush() {
  if (seenFlushTimer) clearTimeout(seenFlushTimer);
  flushSeenForOpenRoom();
  seenFlushTimer = setTimeout(() => {
    seenFlushTimer = null;
    flushSeenForOpenRoom();
  }, 260);
}

function dropRecentMessageById(id) {
  if (id == null) return;
  const sid = String(id);
  const before = recentCache.length;
  recentCache = recentCache.filter((r) => supportMessageDomId(r) !== sid);
  if (recentCache.length !== before) updateBadgesFromRecentCache();
}

// ===== STEP 6.2 STABLE SUPPORT UI HELPERS END =====

function setFabBadge(el, count){
  if(!el) return;
  const n = Number(count||0);
  if(n > 0){
    el.textContent = String(n);
    el.classList.add("is-on");
  }else{
    el.textContent = "";
    el.classList.remove("is-on");
  }
}

function computeUnread(recentRows){
  if(supportUnreadAvailable){
    const dmByOther = new Map();
    let publicCount = 0;
    for(const raw of supportUnreadRows){
      const r = normalizeSupportRow(raw);
      const fromId = String(r.sender_id || r.user_id || "");
      if(!fromId || fromId === USER_ID) continue;
      if(isPublicRoomRow(r)){
        publicCount += 1;
        continue;
      }
      if(isExplicitDmRow(r) && String(r.room_id || "").includes(USER_ID)){
        dmByOther.set(fromId, (dmByOther.get(fromId) || 0) + 1);
      }
    }
    let dmTotal = 0;
    for(const value of dmByOther.values()) dmTotal += value;
    return { publicCount, dmByOther, dmTotal, total:publicCount + dmTotal };
  }
  const publicSeen = getSeen(LS_PUBLIC_SEEN);
  const publicSeenTs = publicSeen ? Date.parse(publicSeen) : 0;
  const dmByOther = new Map();
  let publicCount = 0;

  for(const raw of (recentRows||[])){
    const r = normalizeSupportRow(raw);
    const ts = Date.parse(r.created_at || "") || 0;
    const roomId = String(r.room_id || "public");
    const fromId = String(r.sender_id || r.user_id || "");

    if(isPublicRoomRow(r)){
      if(fromId && fromId !== USER_ID && ts > publicSeenTs) publicCount += 1;
      continue;
    }

    if(isExplicitDmRow(r) && roomId.includes(USER_ID)){
      if(!fromId || fromId === USER_ID) continue;
      const key = lsDmSeenKey(roomId);
      const seen = getSeen(key);
      const seenTs = seen ? Date.parse(seen) : 0;
      if(ts > seenTs){
        dmByOther.set(fromId, (dmByOther.get(fromId) || 0) + 1);
      }
    }
  }

  let dmTotal = 0;
  for(const v of dmByOther.values()) dmTotal += v;
  return { publicCount, dmByOther, dmTotal, total: publicCount + dmTotal };
}

function notifyIfSupportUnreadChanged() {
  const signature = Array.from(usersList?.querySelectorAll?.(".support-user") || [])
    .map((row) => {
      const badge = row.querySelector(".support-user-unread");
      return `${row.getAttribute("data-user-id") || ""}:${badge?.textContent || ""}:${badge?.classList.contains("is-on") ? 1 : 0}`;
    })
    .join("|");
  if (signature === lastSupportUnreadSignature) return;
  lastSupportUnreadSignature = signature;
  notifySupportDomChanged("users");
}

function updateBadgesFromRecentCache() {
  const { total, dmByOther, dmTotal } = computeUnread(recentCache);

  // لو مفيش أى رسائل غير مقروءة امسح كل الإشعارات نهائياً
  if (total <= 0) {
    setFabBadge(supportBadge, 0);

    if (supportBtn) {
      supportBtn.classList.remove("has-private");
    }

    usersList?.querySelectorAll(".support-user").forEach(btn => {
      const badge = btn.querySelector(".support-user-unread");
      if (!badge) return;

      badge.textContent = "";
      badge.classList.remove("is-on");
    });

    notifyIfSupportUnreadChanged();
    return;
  }

  setFabBadge(supportBadge, total);

  // تشغيل إضاءة زر الدعم فقط لو فيه DM غير مقروء
  if (supportBtn) {
    if ((dmTotal || 0) > 0)
      supportBtn.classList.add("has-private");
    else
      supportBtn.classList.remove("has-private");
  }

  // تحديث إشعارات كل مستخدم
  usersList?.querySelectorAll(".support-user").forEach(btn => {
    const uid = btn.getAttribute("data-user-id");
    const badge = btn.querySelector(".support-user-unread");

    if (!badge) return;

    if (!uid || uid === USER_ID) {
      badge.textContent = "";
      badge.classList.remove("is-on");
      return;
    }

    const c = dmByOther.get(uid) || 0;

    if (c > 0) {
      badge.textContent = String(c);
      badge.classList.add("is-on");
    } else {
      badge.textContent = "";
      badge.classList.remove("is-on");
    }
  });
  notifyIfSupportUnreadChanged();
}

function roomKeyForDm(otherUserId) {
  const a = USER_ID;
  const b = otherUserId;
  return (a < b) ? `${a}__${b}` : `${b}__${a}`;
}

function setRoomPublic() {
  clearSupportReplyTarget();
  activeRoom = { type: "public", room_id: "public" };
  refreshSupportMentionSelection();
  chatTitle.textContent = "Team Support";
  chatSubtitle.textContent = "Public chat";
  chatBackBtn.style.display = "none";
  markRoomSeen("public", "public");
  scheduleSeenFlush();
}

function setRoomDm(other) {
  clearSupportReplyTarget();
  activeRoom = { type: "dm", room_id: roomKeyForDm(other.user_id), other };
  refreshSupportMentionSelection();
  chatTitle.textContent = `Chat with ${other.sender_name || "User"}`;
  chatSubtitle.textContent = "Private chat";
  chatBackBtn.style.display = "inline-flex";
  markRoomSeen("dm", activeRoom.room_id);
  scheduleSeenFlush();
}

function supportPresenceOrderForUser(userId) {
  const id = String(userId || "").trim();
  const snapshot = window.__srPresenceSnapshot || null;
  if(snapshot?.status !== "connected") return 1;
  const ids = Array.isArray(snapshot?.onlineUserIds) ? snapshot.onlineUserIds : [];
  return id && ids.includes(id) ? 0 : 2;
}

function renderSupportUsers(items) {
  const normalized = Array.isArray(items) ? items : [];
  const signature = normalized
    .map((user) => `${String(user.sender_id || "")}¦${String(user.sender_name || "")}¦${supportRoleFor(user.sender_id)}`)
    .join("\n");

  if (signature !== lastSupportUsersSignature) {
    usersList.innerHTML = normalized
      .map((user) => {
        const isMe = user.sender_id === USER_ID;
        const color = colorForUserId(user.sender_id);
        return `
          <button class="support-user ${isMe ? "me" : ""}" data-user-id="${escapeHtml(user.sender_id)}" type="button" style="--u:${escapeHtml(color)};--sr-presence-order:${supportPresenceOrderForUser(user.sender_id)}">
            <span class="support-user-dot" aria-hidden="true"></span>
            <span class="support-user-copy">
              <span class="support-user-name-wrap"><span class="support-user-name">${escapeHtml(user.sender_name || "User")}</span>${supportRoleIconHtml(user.sender_id)}</span>
              <span class="support-user-statusline">
                <span class="support-presence-badge is-unknown">Unknown</span>
              </span>
            </span>
            ${isMe ? '<span class="support-user-badge">You</span>' : '<span class="support-user-unread" aria-hidden="true"></span>'}
          </button>
        `;
      })
      .join("");
    lastSupportUsersSignature = signature;

    usersList.querySelectorAll("button.support-user").forEach((button) => {
      button.addEventListener("click", () => {
        const userId = button.getAttribute("data-user-id");
        if (!userId || userId === USER_ID) return;
        const name = button.querySelector(".support-user-name")?.textContent || "User";
        setRoomDm({ user_id: userId, sender_name: name });
        refreshRoom({ initialBottom: true, refreshUsers:false });
      });
    });
    notifySupportDomChanged("users");
  }
  updateBadgesFromRecentCache();
}

// ---------- Data loading ----------
async function loadUsersFresh() {
  await loadSupportRoleBadges().catch(()=>{});
  // Always keep a small cache of recent rows for unread counters.
  // This is separate from the user list source.
  let recentRows = [];
  try {
    const recentPayload = await fetchSupportMessagesApi({ mode: "recent", limit: "500" });
    recentRows = recentPayload.rows;
    recentCache = recentRows;
  } catch (apiErr) {
    console.warn("authenticated support recent load failed", apiErr);
    recentCache = [];
  }

  await refreshSupportUnread({ allowSound:true }).catch(()=>{});

  // Preferred source: `support_users` profiles (allows admin to delete names)
  const profileOk = await detectProfileTable();
  if (profileOk) {
    try {
      const res = await supabase
        .from("support_public_profiles")
        .select("user_id, display_name")
        .order("display_name", { ascending: true })
        .limit(500);

      if (!res.error && Array.isArray(res.data)) {
        const map = new Map();
        supportProfileNames.clear();
        for (const r of res.data) {
          if (!r || !r.user_id) continue;
          const dn = String(r.display_name || "").trim();
          if(!dn) continue;
          map.set(String(r.user_id), dn);
          supportProfileNames.set(String(r.user_id), dn);
        }
        // Ensure current user appears
        map.set(USER_ID, getUserName() || map.get(USER_ID) || "Me");
        supportProfileNames.set(USER_ID, map.get(USER_ID));

        const items = Array.from(map.entries()).map(([sender_id, sender_name]) => ({ sender_id, sender_name }));
        items.sort((x, y) => (x.sender_name || "").localeCompare(y.sender_name || ""));

        renderSupportUsers(items);
        return;
      }
    } catch (e) {
      console.warn("support_users load failed", e);
    }
  }

  // Legacy fallback: derive unique names from recent messages (public + dm)
  const seen = new Map();
  for (const r of recentRows || []) {
    if (!r || !r.sender_id) continue;
    if (!seen.has(r.sender_id)) seen.set(r.sender_id, r.sender_name || "User");
  }
  seen.set(USER_ID, getUserName() || "Me");

  const items = Array.from(seen.entries()).map(([sender_id, sender_name]) => ({ sender_id, sender_name }));
  items.sort((x, y) => (x.sender_name || "").localeCompare(y.sender_name || ""));

  renderSupportUsers(items);
}

let supportUsersLoadInFlight = null;
let supportUsersLoadedAt = 0;
const SUPPORT_USERS_CACHE_MS = 8000;

async function loadUsers(options = {}) {
  const force = options?.force === true;
  if(!force && supportUsersLoadedAt && (Date.now() - supportUsersLoadedAt) < SUPPORT_USERS_CACHE_MS){
    return;
  }
  if(supportUsersLoadInFlight) return supportUsersLoadInFlight;

  supportUsersLoadInFlight = Promise.resolve()
    .then(() => loadUsersFresh())
    .then((value) => {
      supportUsersLoadedAt = Date.now();
      return value;
    })
    .finally(() => {
      supportUsersLoadInFlight = null;
    });

  return supportUsersLoadInFlight;
}


function isExplicitDmRow(m) {
  const r = normalizeSupportRow(m);
  const roomType = String(r.room_type || "public").trim().toLowerCase();
  const roomId = String(r.room_id || "public").trim();
  // Old/public rows may not have room columns at all. Treat every non-explicit-DM
  // row as public so users see the same saved messages that the admin panel sees.
  return roomType === "dm" || (!!roomId && roomId !== "public" && roomId.includes("__"));
}

function isPublicRoomRow(m) {
  return !isExplicitDmRow(m);
}

function isRowInActiveRoom(m) {
  if (!m) return false;
  const r = normalizeSupportRow(m);
  if (activeRoom.type === "public") return isPublicRoomRow(r);
  return String(r.room_type || "") === activeRoom.type && String(r.room_id || "") === String(activeRoom.room_id || "");
}

function renderSupportMessageRow(m) {
  const row = normalizeSupportRow(m);
  const senderId = String(row.sender_id || row.user_id || "");
  const mine = senderId === USER_ID;
  const bundle = colorBundleForUserId(senderId || row.sender_name || "");
  const safeId = row.id == null ? "" : escapeHtml(String(row.id));
  const safeKey = escapeHtml(supportMessageKey(row));
  const replyTargetId = String(row.reply_to?.sender_id || row.reply_to?.user_id || "");
  const replyToMe = !!row.reply_to_message_id && replyTargetId === USER_ID && !mine;
  const initialReadKnown = row.read_count_known === true && Number.isFinite(Number(row.read_count));
  const initialReadCount = initialReadKnown ? Math.max(0, Math.floor(Number(row.read_count))) : "";
  return `
      <div class="support-msg ${mine ? "mine" : ""} ${replyToMe ? "is-reply-to-me" : ""}" data-support-msg-id="${safeId}" data-support-msg-key="${safeKey}" data-sender-id="${escapeHtml(senderId)}" data-support-read-known="${initialReadKnown ? "1" : "0"}" data-support-read-count="${initialReadCount}" tabindex="0" style="--u:${escapeHtml(bundle.accent)};--ubg:${escapeHtml(bundle.bg)};--uborder:${escapeHtml(bundle.border)}">
        <div class="support-msg-meta">
          <span class="support-msg-dot" aria-hidden="true"></span>
          <span class="support-msg-name-wrap"><span class="support-msg-name">${escapeHtml(row.sender_name || "User")}</span>${supportRoleIconHtml(senderId)}</span>
          <span class="support-presence-badge is-unknown">Unknown</span>
          <span class="support-msg-time">${escapeHtml(fmtTime(row.created_at))}</span>
          ${replyToMe ? '<span class="support-reply-to-you">Reply to you</span>' : ""}
          ${mine && safeId && !String(safeId).startsWith("local-") ? `<button class="support-del-btn" data-id="${safeId}" title="Delete">🗑️</button>` : ""}
        </div>
        ${renderSupportReplyReference(row)}
        ${renderMessageHtml(row)}
        ${renderSupportMessageInteractions(row)}
      </div>
    `;
}

function findSupportMessageElById(id) {
  const sid = String(id || "");
  if (!sid || !messagesList) return null;
  return Array.from(messagesList.querySelectorAll(".support-msg")).find((el) => el?.dataset?.supportMsgId === sid) || null;
}

function findVisibleSupportRowById(id){
  const sid = String(id || "");
  return visibleMessageRows.find((row) => String(row?.id || "") === sid) || null;
}

function scrollToSupportMessage(id){
  const element = findSupportMessageElById(id);
  if(!element){
    return false;
  }
  const listRect = messagesList?.getBoundingClientRect?.();
  const elementRect = element.getBoundingClientRect?.();
  if(listRect && elementRect && messagesList){
    const targetTop = messagesList.scrollTop + (elementRect.top - listRect.top) - Math.max(0, (messagesList.clientHeight - elementRect.height) / 2);
    const top = Math.max(0, targetTop);
    if(typeof messagesList.scrollTo === "function"){
      try{ messagesList.scrollTo({ top, behavior:"smooth" }); }
      catch{ messagesList.scrollTo(0, top); }
    }else if(typeof messagesList.scroll === "function"){
      messagesList.scroll({ top });
    }
  }
  element.focus?.({ preventScroll:true });
  element.animate?.([
    { boxShadow:"0 0 0 0 rgba(255,193,7,0)" },
    { boxShadow:"0 0 0 3px rgba(255,193,7,.72)" },
    { boxShadow:"0 0 0 0 rgba(255,193,7,0)" },
  ], { duration:900, easing:"ease-out" });
  return true;
}

function removeSupportMessageById(id, opts = {}) {
  const el = findSupportMessageElById(id);
  pendingOptimisticRows.delete(String(id || ""));
  if (!el || !el.parentNode) {
    visibleMessageRows = visibleMessageRows.filter((row) => supportMessageDomId(row) !== String(id || ""));
    lastSupportListSignature = supportListSignature(visibleMessageRows);
    dropRecentMessageById(id);
    return;
  }
  supportScroll.mutate(() => {
    el.parentNode.removeChild(el);
    visibleMessageRows = visibleMessageRows.filter((row) => supportMessageDomId(row) !== String(id || ""));
    lastSupportListSignature = supportListSignature(visibleMessageRows);
    renderedSupportRoomKey = activeSupportRoomKey();
    dropRecentMessageById(id);
    notifySupportDomChanged("messages");
  }, { stickToBottom: !!opts.forceBottom });
}

function replaceSupportMessageById(id, row, opts = {}) {
  const el = findSupportMessageElById(id);
  if (!el || !row) return false;
  const r = normalizeSupportRow(row);
  const replacement = createSupportMessageElement(r);
  if (!replacement) return false;
  supportScroll.mutate(() => {
    el.replaceWith(replacement);
    pendingOptimisticRows.delete(String(id || ""));
    let replaced = false;
    visibleMessageRows = visibleMessageRows.map((current) => {
      if (supportMessageDomId(current) !== String(id || "")) return current;
      replaced = true;
      return r;
    });
    if (!replaced) visibleMessageRows.push(r);
    visibleMessageRows = sortSupportRowsChronologically(visibleMessageRows);
    lastSupportListSignature = supportListSignature(visibleMessageRows);
    renderedSupportRoomKey = activeSupportRoomKey();
    dropRecentMessageById(id);
    recentCache = [r, ...recentCache.filter((x) => supportMessageDomId(x) !== String(id || ""))].slice(0, 500);
    notifySupportDomChanged("messages");
  }, { stickToBottom: !!opts.forceBottom });
  bindDeleteButtons();
  if (isSupportChatOpen() && isRowInActiveRoom(r)) markRoomSeenAt(activeRoom.type, activeRoom.room_id, r.created_at || new Date().toISOString());
  else updateBadgesFromRecentCache();
  return true;
}

function appendSupportMessage(m, opts = {}) {
  if (!messagesList || !m) return;
  const row = normalizeSupportRow(m);
  const id = supportMessageDomId(row);
  if (id && findSupportMessageElById(id)) {
    replaceSupportMessageById(id, row, opts);
    return;
  }
  const nextRows = visibleMessageRows.filter((current) => supportMessageKey(current) !== supportMessageKey(row));
  nextRows.push(row);
  renderStableMessageList(nextRows, {
    stickToBottom: !!opts.forceBottom || String(row.sender_id || row.user_id || "") === USER_ID,
  });
  recentCache = [row, ...recentCache.filter((x) => supportMessageDomId(x) !== String(id || ""))].slice(0, 500);
  if (isSupportChatOpen() && isRowInActiveRoom(row)) markRoomSeenAt(activeRoom.type, activeRoom.room_id, row.created_at || new Date().toISOString());
  else updateBadgesFromRecentCache();
}

let messagesLoadInFlight = false;
let messagesReloadQueued = false;
let messagesForceInteractionsQueued = false;
let messagesQueuedNeedsInteractions = false;

async function loadMessages(opts = {}) {
  if(messagesLoadInFlight){
    messagesReloadQueued = true;
    messagesForceInteractionsQueued = messagesForceInteractionsQueued || !!opts.forceInteractions;
    messagesQueuedNeedsInteractions = messagesQueuedNeedsInteractions || opts.skipInteractions !== true;
    return;
  }
  messagesLoadInFlight = true;
  const initialBottom = !!opts.initialBottom;
  const forceInteractions = !!opts.forceInteractions;
  const skipInteractions = opts.skipInteractions === true;
  const requestedRoom = {
    type:String(activeRoom.type || "public"),
    room_id:String(activeRoom.room_id || "public"),
  };
  try {
    const payload = await fetchSupportMessagesApi({
      room_type: requestedRoom.type,
      room_id: requestedRoom.room_id,
      limit: "500",
    });
    if(
      requestedRoom.type !== String(activeRoom.type || "public") ||
      requestedRoom.room_id !== String(activeRoom.room_id || "public")
    ) return;

    if (payload.interactionsAvailable) {
      supportInteractionsAvailable = true;
      mergeSupportInteractions(payload.interactions);
    }
    const rows = payload.rows;
    let visibleRows = rows.filter((m) => activeRoom.type === "public" ? isPublicRoomRow(m) : isRowInActiveRoom(m));
    if (activeRoom.type === "public" && !visibleRows.length && rows.length) {
      visibleRows = rows.filter((m) => !isExplicitDmRow(m));
    }

    renderStableMessageList(visibleRows, { initialBottom });
    markActiveRoomSeenFromRows(visibleRows);

    if(!skipInteractions) refreshSupportInteractions(visibleRows, initialBottom || forceInteractions).catch(()=>{});
    scheduleSeenFlush();
    try{ window.__srSupportSeenReceipts?.refresh?.(); }catch{}
  } catch (apiErr) {
    console.error(apiErr);
    setStatus(`Could not load messages. Please contact ${ADMIN_NAME}.`, "error");
  } finally {
    messagesLoadInFlight = false;
    if(messagesReloadQueued){
      const queuedForceInteractions = messagesForceInteractionsQueued;
      const queuedNeedsInteractions = messagesQueuedNeedsInteractions;
      messagesReloadQueued = false;
      messagesForceInteractionsQueued = false;
      messagesQueuedNeedsInteractions = false;
      queueMicrotask(() => loadMessages({
        forceInteractions:queuedForceInteractions,
        skipInteractions:!queuedNeedsInteractions,
      }).catch(()=>{}));
    }
  }
}


async function deleteOwnMessage(messageId, triggerBtn){
  if(!messageId) return;
  const blocked = await isBlocked();
  if (blocked) {
    setStatus(`You are blocked until ${fmtTime(blocked.expires_at)}. Please contact ${ADMIN_NAME}.`, "error");
    return;
  }

  const row = triggerBtn?.closest?.(".support-msg") || messagesList.querySelector(`button.support-del-btn[data-id="${String(messageId)}"]`)?.closest?.(".support-msg");
  const ok = confirm("Delete this message?");
  if(!ok) return;

  const previousBtnHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "…";
    triggerBtn.setAttribute("aria-busy", "true");
  }
  if (row) {
    row.classList.add("is-deleting");
    row.style.pointerEvents = "none";
  }

  try{
    setStatus("Deleting…", "info");
    const res = await fetch((await resolveFnBase()) + "/user-delete-support-message", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: messageId, user_id: USER_ID })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data?.error || "Delete failed");

    if (row) {
      removeSupportMessageById(messageId);
    } else {
      dropRecentMessageById(messageId);
    }

    setStatus("Message deleted.", "success");
    setTimeout(() => {
      if ((statusEl?.textContent || "").trim() === "Message deleted.") setStatus("");
    }, 900);
    scheduleSeenFlush();
    queueLoadUsers(200);
  }catch(err){
    console.error(err);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = previousBtnHtml || "🗑️";
      triggerBtn.removeAttribute("aria-busy");
    }
    if (row) {
      row.classList.remove("is-deleting");
      row.style.pointerEvents = "";
    }
    const msg = String(err?.message || "");
    if (/not found/i.test(msg)) {
      setStatus("This message was already removed.", "info");
      removeSupportMessageById(messageId);
      scheduleSeenFlush();
      queueLoadUsers(200);
      return;
    }
    setStatus(msg || `Could not delete. Please contact ${ADMIN_NAME}.`, "error");
  }
}

function bindDeleteButtons(){
  messagesList.querySelectorAll("button.support-del-btn").forEach(btn=>{
    if(btn.dataset.bound==="1") return;
    btn.dataset.bound="1";
    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      deleteOwnMessage(btn.dataset.id, btn);
    });
  });
}

const busySupportReactions = new Set();

function closeSupportReactionMenu(){
  const menu = document.getElementById("supportReactionMenu");
  if(menu) menu.hidden = true;
}

function ensureSupportReactionMenu(){
  let menu = document.getElementById("supportReactionMenu");
  if(menu) return menu;
  menu = document.createElement("div");
  menu.id = "supportReactionMenu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  return menu;
}

function openSupportReactionMenu(button, messageId){
  if(!button || !messageId || !supportInteractionsAvailable) return;
  const menu = ensureSupportReactionMenu();
  const mine = String(interactionForMessage(messageId)?.reactions?.mine || "");
  menu.dataset.messageId = String(messageId);
  menu.innerHTML = SUPPORT_REACTIONS.map(([key, icon, label]) =>
    `<button type="button" class="${mine === key ? "active" : ""}" data-reaction="${escapeHtml(key)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</button>`
  ).join("");
  menu.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = Math.min(270, window.innerWidth - 16);
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left - 100))}px`;
  menu.style.top = `${Math.max(8, rect.top - 52)}px`;
}

function optimisticallyToggleSupportReaction(messageId, reaction){
  const id = String(messageId);
  const current = interactionForMessage(id);
  const next = JSON.parse(JSON.stringify(current));
  const reactions = next.reactions || emptySupportInteraction().reactions;
  const previousMine = String(reactions.mine || "");
  if(previousMine && Number(reactions.counts?.[previousMine] || 0) > 0){
    reactions.counts[previousMine] -= 1;
  }
  reactions.mine = previousMine === reaction ? "" : reaction;
  if(reactions.mine){
    reactions.counts[reactions.mine] = Number(reactions.counts?.[reactions.mine] || 0) + 1;
  }
  next.reactions = reactions;
  supportInteractions[id] = next;
}

function refreshRenderedSupportInteractions(){
  const changes = [];
  for (const row of visibleMessageRows) {
    const element = findSupportMessageElById(row?.id);
    if (!element) continue;
    const signature = supportInteractionSignature(row?.id);
    if (element.dataset.supportInteractionSignature === signature) continue;
    changes.push({ row, element, signature });
  }
  if (!changes.length) return;

  supportScroll.mutate(() => {
    for (const change of changes) {
      const current = change.element.querySelector(":scope > .support-msg-interactions");
      const template = document.createElement("template");
      template.innerHTML = renderSupportMessageInteractions(change.row).trim();
      const next = template.content.firstElementChild;
      if (current && next) current.replaceWith(next);
      else if (current) current.remove();
      else if (next) change.element.appendChild(next);
      change.element.dataset.supportInteractionSignature = change.signature;
    }
  });
  try{ window.__srSupportSeenReceipts?.refresh?.(); }catch{}
}

async function toggleSupportReaction(messageId, reaction){
  const id = String(messageId || "");
  const key = String(reaction || "");
  if(!id || !key || busySupportReactions.has(id) || !supportInteractionsAvailable) return;
  busySupportReactions.add(id);
  const previous = supportInteractions[id] ? JSON.parse(JSON.stringify(supportInteractions[id])) : emptySupportInteraction();
  optimisticallyToggleSupportReaction(id, key);
  refreshRenderedSupportInteractions();
  closeSupportReactionMenu();
  try{
    const result = await postSupportInteraction({ action:"toggle", message_id:Number(id), reaction:key });
    if(result?.available === false){
      supportInteractions = Object.create(null);
    }
  }catch(error){
    supportInteractions[id] = previous;
    setStatus("Could not save the reaction.", "error");
  }finally{
    busySupportReactions.delete(id);
    refreshRenderedSupportInteractions();
  }
}

messagesList?.addEventListener("click", async (event) => {
  const replyButton = event.target?.closest?.("button.support-reply-btn[data-message-id]");
  if(replyButton){
    event.preventDefault();
    event.stopPropagation();
    const row = findVisibleSupportRowById(replyButton.dataset.messageId);
    if(row) setSupportReplyTarget(row);
    return;
  }

  const replyReference = event.target?.closest?.("button.support-reply-reference[data-target-message-id]");
  if(replyReference){
    event.preventDefault();
    event.stopPropagation();
    scrollToSupportMessage(replyReference.dataset.targetMessageId);
    return;
  }

  const reactionBadge = event.target?.closest?.("button.support-reaction-badge");
  if(reactionBadge){
    event.preventDefault();
    event.stopPropagation();
    toggleSupportReaction(reactionBadge.dataset.messageId, reactionBadge.dataset.reaction);
    return;
  }

  const reactionOpen = event.target?.closest?.("button.support-react-open");
  if(reactionOpen){
    event.preventDefault();
    event.stopPropagation();
    openSupportReactionMenu(reactionOpen, reactionOpen.dataset.messageId);
    return;
  }

});

document.addEventListener("click", (event) => {
  const menuChoice = event.target?.closest?.("#supportReactionMenu button[data-reaction]");
  if(menuChoice){
    event.preventDefault();
    event.stopPropagation();
    const menu = menuChoice.closest("#supportReactionMenu");
    toggleSupportReaction(menu?.dataset?.messageId, menuChoice.dataset.reaction);
    return;
  }
  if(!event.target?.closest?.("#supportReactionMenu,.support-msg-tools")){
    closeSupportReactionMenu();
  }
}, true);

window.addEventListener("scroll", closeSupportReactionMenu, true);
window.addEventListener("resize", closeSupportReactionMenu);

let supportEventRefreshTimer = null;

function upsertSupportUnreadRow(rawRow){
  const row = normalizeSupportRow(rawRow);
  const id = String(row?.id || "");
  const senderId = String(row?.sender_id || row?.user_id || "");
  if(!id || !senderId || senderId === USER_ID) return;
  supportUnreadAvailable = true;
  supportUnreadLoaded = true;
  supportUnreadRows = [
    row,
    ...supportUnreadRows.filter((current) => String(current?.id || "") !== id),
  ].slice(0, 500);
  lastSupportUnreadCount = supportUnreadRows.length;
}

function applySupportRealtimeMessage(detail = {}){
  const op = String(detail?.op || "").toUpperCase();
  const raw = detail?.row && typeof detail.row === "object" ? detail.row : null;
  if(!raw) return false;

  const row = normalizeSupportRow({
    ...raw,
    ...(op === "INSERT" && raw?.read_count == null ? { read_count:0, read_count_known:true } : {}),
  });
  const id = String(row?.id || "");
  if(!id) return false;

  if(op === "DELETE"){
    supportUnreadRows = supportUnreadRows.filter((current) => String(current?.id || "") !== id);
    lastSupportUnreadCount = supportUnreadRows.length;
    removeSupportMessageById(id);
    updateBadgesFromRecentCache();
    publishSupportNotificationState();
    return true;
  }

  recentCache = [row, ...recentCache.filter((current) => String(current?.id || "") !== id)].slice(0, 500);

  if(op === "INSERT"){
    upsertSupportUnreadRow(row);
    const reconciledOwnMessage =
      String(row.sender_id || row.user_id || "") === USER_ID &&
      reconcileIncomingSupportMessage(row, { forceBottom:true });

    if(isSupportChatOpen() && isRowInActiveRoom(row)){
      if(!reconciledOwnMessage) appendSupportMessage(row);
    }else{
      updateBadgesFromRecentCache();
    }
  }else{
    const existing = findSupportMessageElById(id);
    if(existing && isRowInActiveRoom(row)) replaceSupportMessageById(id, row);
    updateBadgesFromRecentCache();
  }

  publishSupportNotificationState();
  return true;
}

function applySupportRealtimeReaction(detail = {}){
  const id = String(detail?.message_id || "");
  const actor = String(detail?.actor_user_id || "");
  if(!id || !actor) return false;

  const previous = String(detail?.old_reaction || "");
  const nextReaction = String(detail?.new_reaction || "");
  const current = supportInteractions[id]
    ? JSON.parse(JSON.stringify(supportInteractions[id]))
    : emptySupportInteraction();
  const reactions = current.reactions || { counts:{}, users:{}, mine:"" };
  reactions.counts = { like:0, love:0, laugh:0, angry:0, sad:0, dislike:0, ...(reactions.counts || {}) };
  reactions.users = { like:[], love:[], laugh:[], angry:[], sad:[], dislike:[], ...(reactions.users || {}) };
  const actorName = actor === USER_ID ? (getUserName() || "Me") : aliasForUserId(actor);

  if(previous && reactions.counts[previous] != null){
    reactions.counts[previous] = Math.max(0, Number(reactions.counts[previous] || 0) - 1);
    reactions.users[previous] = (reactions.users[previous] || []).filter((name) => name !== actorName);
  }
  if(nextReaction && reactions.counts[nextReaction] != null){
    reactions.counts[nextReaction] = Number(reactions.counts[nextReaction] || 0) + 1;
    if(!(reactions.users[nextReaction] || []).includes(actorName)){
      reactions.users[nextReaction] = [...(reactions.users[nextReaction] || []), actorName];
    }
  }
  if(actor === USER_ID) reactions.mine = nextReaction;

  current.reactions = reactions;
  supportInteractions[id] = current;
  supportInteractionsAvailable = true;
  refreshRenderedSupportInteractions();
  return true;
}

function subscribeRoom() {
  // Room updates now arrive through the authenticated Realtime invalidation bus.
  subscribeBackground();
}

// Event-driven background listener: no repeated Worker polling.
function subscribeBackground(){
  if(bgSub) return;

  const onRealtimeInvalidated = (event) => {
    const detail = event?.detail || {};
    const group = String(detail?.group || "all");
    if(group !== "support" && group !== "all") return;
    if(detail.source === "reconnect"){
      if(isSupportChatOpen()) refreshRoom({ refreshUsers:false }).catch(()=>{});
      refreshSupportUnread({ force:true, allowSound:false }).catch(()=>{});
      return;
    }

    const table = String(detail?.table || "");
    if(table === "support_message_reads"){
      // The isolated seen module consumes the absolute read_count payload.
      return;
    }

    if(table === "support_message_reactions"){
      applySupportRealtimeReaction(detail);
      return;
    }

    if(table === "support_messages" || table === "support_message_mentions" || table === "support_mentions"){
      applySupportRealtimeMessage(detail);
      return;
    }
  };

  bgSub = { onRealtimeInvalidated };
  window.addEventListener("sr:realtime-invalidated", onRealtimeInvalidated);

  window.addEventListener("pagehide", () => {
    window.removeEventListener("sr:realtime-invalidated", onRealtimeInvalidated);
    bgSub = null;
  }, { once:true });
}

async function refreshRoom(opts = {}) {
  setStatus("");
  const tasks = [
    loadMessages({ initialBottom: !!opts.initialBottom }).catch(()=>{}),
  ];
  if(opts.refreshUsers !== false) tasks.push(loadUsers().catch(()=>{}));
  await Promise.allSettled(tasks);
  scheduleSeenFlush();
  subscribeRoom();
}


// ---------- Sending ----------
async function sendMessage() {
  if(!supportActionGate.enter("send")) return;
  if(sendBtn) sendBtn.disabled = true;

  let localId = "";
  try{
    const name = getUserName();
    if (!name) {
      redirectToNicknameLogin();
      return;
    }

    const text = (msgInput.value || "").trim();
    const mentionUserIds = getSupportMentionUserIds();
    const mentionAll = getSupportMentionAll();
    const mentionLabels = getSupportMentionLabels();
    const mentionPrefix = mentionLabels.map((mentionName)=>"@" + mentionName).join(" • ");
    if (!text && !selectedFile && !hasSupportMentions()) return;

    let finalText = mentionPrefix
      ? mentionPrefix + (text ? "\n" + text : "")
      : text;

    if(selectedFile){
      setStatus("Uploading attachment…", "info");
      const up = await uploadAttachment(selectedFile);
      const marker = `Attachment: ${up.name}`;
      finalText = (finalText ? (finalText + "\n") : "") + marker + "\n" + up.url;
    }

    setStatus("Sending…", "info");

    const payload = {
      sender_id: USER_ID,
      user_id: USER_ID,
      sender_name: name || "Anonymous",
      message: finalText,
      room_type: activeRoom.type,
      room_id: activeRoom.room_id,
      reply_to_message_id:supportReplyTarget?.id || null,
      mention_user_ids:mentionUserIds,
      mention_all:mentionAll,
    };

    localId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localRow = normalizeSupportRow({
      ...payload,
      reply_to:supportReplyTarget ? { ...supportReplyTarget } : null,
      id: localId,
      created_at: new Date().toISOString(),
    });

    pendingOptimisticRows.set(localId, localRow);
    appendSupportMessage(localRow, { forceBottom: true });
    markRoomSeen(activeRoom.type, activeRoom.room_id);
    scheduleSeenFlush();

    const res = await fetch("/api/support-message", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    const data = await res.json().catch(() => ({}));

    if (data?.nickname_required) {
      removeSupportMessageById(localId);
      redirectToNicknameLogin();
      return;
    }
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Message insert failed.");

    msgInput.value = "";
    msgInput.dispatchEvent(new Event("input", { bubbles:true }));
    clearSupportMentionSelection();
    setSelectedFile(null);
    if(attachInput) attachInput.value = "";
    clearSupportReplyTarget();

    const inserted = Array.isArray(data?.data) && data.data[0]
      ? normalizeSupportRow(data.data[0])
      : null;

    if(inserted){
      const realId = supportMessageDomId(inserted);
      if(realId && findSupportMessageElById(realId) && realId !== localId){
        removeSupportMessageById(localId, { forceBottom:true });
        replaceSupportMessageById(realId, inserted, { forceBottom:true });
      }else if(!replaceSupportMessageById(localId, inserted, { forceBottom:true })){
        pendingOptimisticRows.delete(localId);
        appendSupportMessage(inserted, { forceBottom:true });
      }
    }else{
      pendingOptimisticRows.delete(localId);
      loadMessages({ skipInteractions:true }).catch(()=>{});
    }

    setStatus("");
    scheduleSeenFlush();
    queueLoadUsers(320);
    focusMessageInput();
  }catch(err){
    if(localId) removeSupportMessageById(localId);
    console.error(err);
    setStatus(String(err?.message || `Could not send your message. Please contact ${ADMIN_NAME}.`), "error");
  }finally{
    supportActionGate.leave("send");
    if(sendBtn) sendBtn.disabled = false;
  }
}
// ---------- UI wiring ----------
async function openSupport() {
  try { unlockSound(); } catch {}

  const ready = await ensureNicknameReady();
  if (!ready) {
    redirectToNicknameLogin();
    return;
  }

  const name = getUserName();
  if (!name) {
    redirectToNicknameLogin();
    return;
  }

  installSupportReplyStyles();
  installSupportMediaEnhancements();
  await installSupportDesktopPro();
  syncSupportMobileShell();
  ensureSupportReplyPreview();

  show(chatOverlay);
  lockPageBehindSupport();
  if(messagesList && !messagesList.querySelector(".support-msg")){
    messagesList.innerHTML = '<div class="support-loading-state">Loading messages…</div>';
    lastSupportListSignature = "__loading__";
  }
  if(usersList && !usersList.querySelector(".support-user")){
    usersList.innerHTML = '<div class="support-loading-state">Loading people…</div>';
  }
  setRoomPublic();
  await refreshRoom({ initialBottom: true });
  scheduleSeenFlush();
}

function closeAll() {
  hide(nameOverlay);
  hide(chatOverlay);
  chatOverlay?.classList.remove("sr-support-mobile-viewport");
  document.documentElement.classList.remove("sr-support-pro-v4-active");
  unlockPageBehindSupport();
  setStatus("");
}

async function openSupportNotificationTarget(item){
  const messageId = Number(item?.support_message_id);
  if(!Number.isSafeInteger(messageId) || messageId <= 0) return;

  await openSupport();

  const roomType = String(item?.support_room_type || "public");
  if(roomType === "dm"){
    const otherUserId = String(item?.support_other_user_id || item?.sender_user_id || "").trim();
    if(otherUserId && otherUserId !== USER_ID){
      setRoomDm({
        user_id:otherUserId,
        sender_name:String(item?.sender_name || "User"),
      });
      await refreshRoom({ initialBottom:false, refreshUsers:false });
    }
  }else if(activeRoom.type !== "public"){
    setRoomPublic();
    await refreshRoom({ initialBottom:false, refreshUsers:false });
  }

  if(!findSupportMessageElById(messageId)){
    await loadMessages().catch(()=>{});
  }

  for(const delay of [0, 70, 180]){
    if(delay) await new Promise((resolve)=>setTimeout(resolve, delay));
    if(scrollToSupportMessage(messageId)) return true;
  }

  setStatus("Could not locate the notification message in the loaded conversation.", "error");
  return false;
}

async function refreshSupportNotificationUnread(){
  await refreshSupportUnread({ allowSound:false }).catch(()=>{});
  const count = targetedSupportNotificationCount();
  publishSupportNotificationState();
  return count;
}

try {
  window.__srSupportBuildVersion = SUPPORT_BUILD_VERSION;
  document.documentElement.dataset.srSupportBuildVersion = SUPPORT_BUILD_VERSION;
  window.__srSupportChatReady = true;
  window.__srOpenSupportChat = openSupport;
  window.__srSupportNotificationBridge = Object.freeze({
    openTarget:openSupportNotificationTarget,
    refreshUnread:refreshSupportNotificationUnread,
    getUnreadCount:targetedSupportNotificationCount,
  });
  publishSupportNotificationState();
} catch {}

supportBtn?.addEventListener("click", openSupport);

nameConfirmBtn?.addEventListener("click", async () => {
  // Step 4 centralizes nickname collection on the login screen.
  redirectToNicknameLogin();
});

nameCloseBtn?.addEventListener("click", closeAll);
chatCloseBtn?.addEventListener("click", closeAll);

chatBackBtn?.addEventListener("click", () => {
  setRoomPublic();
  refreshRoom({ initialBottom: true, refreshUsers:false });
});

// Close on overlay click
[nameOverlay, chatOverlay].forEach(ov => {
  ov?.addEventListener("click", (e) => {
    if (e.target === ov) closeAll();
  });
});

// ESC to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (nameOverlay.style.display !== "none" || chatOverlay.style.display !== "none") closeAll();
  }
});

sendBtn?.addEventListener("click", sendMessage);
let supportInputComposing = false;
msgInput?.addEventListener("compositionstart", () => { supportInputComposing = true; });
msgInput?.addEventListener("compositionend", () => { supportInputComposing = false; });
msgInput?.addEventListener("keydown", (e) => {
  if(e.defaultPrevented) return;
  // Textarea UX: Enter sends, Shift+Enter inserts newline
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !supportInputComposing) {
    e.preventDefault();
    sendMessage();
  }
});

// Emoji + attachments wiring
emojiBtn?.addEventListener("click", (e)=>{
  e.preventDefault();
  e.stopPropagation();
  toggleEmojiPopover();
});

attachBtn?.addEventListener("click", (e)=>{
  e.preventDefault();
  attachInput?.click();
});

attachInput?.addEventListener("change", ()=>{
  const f = attachInput.files && attachInput.files[0];
  if(!f) return;
  setSelectedFile(f);
});

window.addEventListener("storage", (e) => {
  if (!e?.key) return;
  if (e.key === LS_PUBLIC_SEEN || e.key.startsWith("sr_support_seen_dm_")) {
    updateBadgesFromRecentCache();
  }
});

window.addEventListener("sr:support-seen-marked", (event) => {
  if(!supportUnreadAvailable) return;
  const confirmed = new Set(
    (Array.isArray(event?.detail?.message_ids) ? event.detail.message_ids : [])
      .map((id) => String(id || ""))
      .filter(Boolean)
  );
  if(!confirmed.size) return;
  supportUnreadRows = supportUnreadRows.filter((row) => !confirmed.has(String(row?.id || "")));
  lastSupportUnreadCount = supportUnreadRows.length;
  updateBadgesFromRecentCache();
  publishSupportNotificationState();
});

// ===== STEP 6.2 SUPPORT SEEN FLUSH EVENTS START =====
messagesList?.addEventListener("scroll", () => {
  if (isNearSupportBottom(80)) scheduleSeenFlush();
}, { passive: true });

chatOverlay?.addEventListener("pointerdown", () => {
  if (isSupportChatOpen()) scheduleSeenFlush();
}, { passive: true });

window.addEventListener("pagehide", unlockPageBehindSupport);
const refreshOpenSupportLayout = () => {
  if (chatOverlay?.style.display !== "none") syncSupportMobileShell();
};
window.addEventListener("resize", refreshOpenSupportLayout, { passive: true });
window.visualViewport?.addEventListener?.("resize", refreshOpenSupportLayout, { passive: true });
// ===== STEP 6.2 SUPPORT SEEN FLUSH EVENTS END =====

// Initial status cleanup
setStatus("");

// Realtime stays armed after the module is loaded, but the expensive users/recent
// hydration waits for an actual Support open. This avoids duplicate startup work.
subscribeBackground();
window.addEventListener("pageshow", event => {
  if(event.persisted){
    subscribeBackground();
    if(isSupportChatOpen()) lockPageBehindSupport();
  }
});

import("./support-mentions-lite.js?v=20260924-mentions-v2")
  .then((module) => module?.installSupportMentionsLite?.({
    input:msgInput,
    usersRoot:usersList,
    isCandidateAllowed:supportMentionCandidateAllowed,
    allowEveryone:supportMentionEveryoneAllowed,
  }))
  .catch(() => console.warn("Support @mentions unavailable; core Support remains active."));

import("./support-seen-receipts-v6.js?v=20260930-unified-seen-v1")
  .then((module) => module?.installSupportSeenReceipts?.())
  .catch(() => console.warn("Support seen receipts unavailable; core Support remains active."));


window.addEventListener("sr:role-badges-changed", async () => {
  supportRoleBadgesLoaded = false;
  await loadSupportRoleBadges().catch(()=>{});
  lastSupportUsersSignature = "__roles_changed__";
  lastSupportListSignature = "__roles_changed__";
  if(isSupportChatOpen()) await refreshRoom({ initialBottom:false }).catch(()=>{});
});

/* Account profile push: update visible names locally; never refetch after realtime. */
window.addEventListener("sr:profile-updated", (event) => {
  const uid = String(event?.detail?.user_id || "");
  const name = String(event?.detail?.display_name || "").trim();
  if(!uid || !name) return;
  supportProfileNames.set(uid, name);
  if(uid === USER_ID) setUserName(name);
  document.querySelectorAll(".support-msg[data-sender-id]").forEach((row) => {
    if(String(row.getAttribute("data-sender-id") || "") !== uid) return;
    const node = row.querySelector(".support-msg-name");
    if(node) node.textContent = name;
  });
  document.querySelectorAll("button.support-user[data-user-id]").forEach((row) => {
    if(String(row.getAttribute("data-user-id") || "") !== uid) return;
    const node = row.querySelector(".support-user-name");
    if(node) node.textContent = name;
  });
});

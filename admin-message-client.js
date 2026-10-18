import { playUrgentBannerNotification } from "./notification-sound.js";
import { getStableUserId } from "./stable-user-identity.js";

// Fixed API base for Cloudflare/Next.js.
// This removes the old Vercel/Netlify probing request and keeps the UI untouched.
const SR_API_BASE = "/api";

/*
 * Admin announcement (Envelope) client
 *
 * Requirements implemented:
 * - Admin writes an announcement from Admin Panel.
 * - All users see a badge on the UA07 envelope when there is a new message.
 * - When a user opens the envelope and reads the message, the badge disappears
 *   for that user/device until the admin changes the message again.
 *
 * Implementation notes:
 * - First load uses one safe API read to get the current announcement.
 * - After that, updates arrive through Supabase Realtime instead of polling.
 * - We do NOT depend on internal functions inside app.js (openSecretModal is
 *   scoped inside an IIFE). Instead, we hook the envelope button click and/or
 *   observe the modal opening, then inject/replace the modal content.
 */

const LS_SEEN_AT = "sr_admin_ann_seen_at";
const LS_SEEN_KEY = "sr_admin_ann_seen_key";
const LS_URGENT_DISMISSED_AT = "sr_admin_urgent_dismissed_at";
const LS_URGENT_DISMISSED_KEY = "sr_admin_urgent_dismissed_key";
const LS_URGENT_DISMISSED_SOURCE = "sr_admin_urgent_dismissed_source";
const LS_URGENT_ACK_STATE = "urgentAdminAckState";
const LS_URGENT_SHOW_COUNT_PREFIX = "sr_admin_urgent_show_count";
const SS_ANNOUNCEMENT_CACHE = "sr_admin_announcement_cache_v1";
const MAX_URGENT_ACKS_PER_MESSAGE = 3;
const URGENT_PREFIX = "URGENT_TICKER::";
const ANNOUNCEMENT_REALTIME_CHANNEL = "sr_admin_announcements_realtime";
// Realtime is authoritative after bootstrap. Session cache avoids repeat Worker reads
// on reload/envelope open while realtime keeps the current tab fresh.
const ANNOUNCEMENT_CACHE_TTL_MS = 15 * 60 * 1000;
const ANNOUNCEMENT_MIN_FETCH_INTERVAL_MS = 30 * 1000;
const SR_ANNOUNCEMENT_CHANNEL = (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel("sr_admin_announcement_state") : null;
const DEFAULT_URGENT_ARABIC_TTS_VOICE = "ar-EG-SalmaNeural";
const URGENT_ARABIC_TTS_VOICES = new Set([
  "ar-EG-SalmaNeural", "ar-EG-ShakirNeural",
  "ar-SA-ZariyahNeural", "ar-SA-HamedNeural",
  "ar-AE-FatimaNeural", "ar-AE-HamdanNeural",
  "ar-JO-SanaNeural", "ar-JO-TaimNeural",
  "ar-KW-NouraNeural", "ar-KW-FahedNeural",
  "ar-QA-AmalNeural", "ar-QA-MoazNeural",
  "ar-BH-LailaNeural", "ar-BH-AliNeural",
  "ar-IQ-RanaNeural", "ar-IQ-BasselNeural",
  "ar-LB-LaylaNeural", "ar-LB-RamiNeural",
  "ar-MA-MounaNeural", "ar-MA-JamalNeural",
  "ar-OM-AyshaNeural", "ar-OM-AbdullahNeural",
  "ar-SY-AmanyNeural", "ar-SY-LaithNeural",
  "ar-TN-ReemNeural", "ar-TN-HediNeural",
  "ar-YE-MaryamNeural", "ar-YE-SalehNeural"
]);
let urgentVoiceUnlocked = false;
let pendingUrgentText = "";
let pendingUrgentVoice = DEFAULT_URGENT_ARABIC_TTS_VOICE;
let lastStartedUrgentKey = "";
let currentUrgentAudio = null;
let currentUrgentAudioUrl = "";
let urgentArabicPlayback = { key: "", text: "", voice: DEFAULT_URGENT_ARABIC_TTS_VOICE, status: "idle", audio: null, url: "", blockedInteractionRetry: false };
const urgentHiddenThisPageKeys = new Set();

function announceStateChanged(kind, payload = {}) {
  try {
    SR_ANNOUNCEMENT_CHANNEL?.postMessage({ kind, ...payload });
  } catch {}
}


function normalizeUrgentArabicTtsVoice(value = "") {
  const v = String(value || "").trim();
  return URGENT_ARABIC_TTS_VOICES.has(v) ? v : DEFAULT_URGENT_ARABIC_TTS_VOICE;
}

function getUrgentSpeakKey(text = "", voice = "") {
  return `${normalizeUrgentArabicTtsVoice(voice)}\n${String(text || "").trim()}`;
}

function stopUrgentAudio() {
  try { window.speechSynthesis?.cancel?.(); } catch {}
  try {
    if (currentUrgentAudio) {
      currentUrgentAudio.pause();
      currentUrgentAudio.currentTime = 0;
      currentUrgentAudio.src = "";
      currentUrgentAudio.load?.();
    }
  } catch {}
  try { if (currentUrgentAudioUrl) URL.revokeObjectURL(currentUrgentAudioUrl); } catch {}
  currentUrgentAudio = null;
  currentUrgentAudioUrl = "";
  try {
    if (urgentArabicPlayback?.audio) {
      urgentArabicPlayback.audio.pause();
      urgentArabicPlayback.audio.src = "";
      urgentArabicPlayback.audio.load?.();
    }
    if (urgentArabicPlayback?.url) URL.revokeObjectURL(urgentArabicPlayback.url);
  } catch {}
  urgentArabicPlayback = { key: "", text: "", voice: DEFAULT_URGENT_ARABIC_TTS_VOICE, status: "idle", audio: null, url: "", blockedInteractionRetry: false };
}

function simpleHashKey(input = ""){
  let h = 2166136261;
  const s = String(input || "");
  for(let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function getUrgentShowStorageKey(annKey){
  const safeAnnKey = String(annKey || "").trim();
  if(!safeAnnKey) return "";
  let uid = "anon";
  try { uid = String(getStableUserId() || "anon").trim() || "anon"; } catch {}
  return `${LS_URGENT_SHOW_COUNT_PREFIX}:${uid}:${simpleHashKey(safeAnnKey)}`;
}

function getUrgentShowCount(annKey){
  try {
    const k = getUrgentShowStorageKey(annKey);
    if(!k) return 0;
    const n = parseInt(localStorage.getItem(k) || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function bumpUrgentShowCount(annKey){
  try {
    const k = getUrgentShowStorageKey(annKey);
    if(!k) return 0;
    const next = getUrgentShowCount(annKey) + 1;
    localStorage.setItem(k, String(next));
    announceStateChanged("urgent-shown", { key: String(annKey || "") });
    return next;
  } catch {
    return 0;
  }
}


function readUrgentAckState(){
  try{
    const raw = localStorage.getItem(LS_URGENT_ACK_STATE) || "{}";
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }catch{
    return {};
  }
}

function writeUrgentAckState(state){
  try{
    localStorage.setItem(LS_URGENT_ACK_STATE, JSON.stringify(state && typeof state === "object" ? state : {}));
  }catch{}
}

function normalizeUrgentAckCount(value){
  const n = Number(value || 0);
  if(!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_URGENT_ACKS_PER_MESSAGE, Math.floor(n));
}

function getUrgentAckRecord(messageKey){
  const key = String(messageKey || "").trim();
  if(!key) return { ackCount: 0, lastAckAt: "" };
  const state = readUrgentAckState();
  const record = state[key] && typeof state[key] === "object" ? state[key] : {};
  let ackCount = normalizeUrgentAckCount(record.ackCount);

  // One-time compatibility with the previous single-dismiss flag: an old
  // explicit "فهمت" counts as exactly one acknowledgement, not a permanent hide.
  if(ackCount === 0 && getUrgentDismissedKey() === key && getUrgentDismissedSource() === "ack"){
    ackCount = 1;
    state[key] = {
      ackCount,
      lastAckAt: record.lastAckAt || localStorage.getItem(LS_URGENT_DISMISSED_AT) || ""
    };
    writeUrgentAckState(state);
  }

  return {
    ackCount,
    lastAckAt: String(record.lastAckAt || "")
  };
}

function getUrgentAckCount(messageKey){
  return getUrgentAckRecord(messageKey).ackCount;
}

function acknowledgeUrgentMessage(messageKey){
  const key = String(messageKey || "").trim();
  if(!key) return 0;
  const state = readUrgentAckState();
  const record = state[key] && typeof state[key] === "object" ? state[key] : {};
  const ackCount = Math.min(MAX_URGENT_ACKS_PER_MESSAGE, normalizeUrgentAckCount(record.ackCount) + 1);
  const lastAckAt = new Date().toISOString();
  state[key] = { ackCount, lastAckAt };
  writeUrgentAckState(state);
  announceStateChanged("urgent-acknowledged", { key, ackCount, lastAckAt });
  return ackCount;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSeenTs() {
  try {
    const v = localStorage.getItem(LS_SEEN_AT) || "";
    return v ? Date.parse(v) : 0;
  } catch {
    return 0;
  }
}

function setSeenTs(isoOrDate) {
  try {
    const v = (isoOrDate instanceof Date) ? isoOrDate.toISOString() : String(isoOrDate || "");
    if (!v) return;
    localStorage.setItem(LS_SEEN_AT, v);
  } catch {}
}

function getSeenKey(){
  try { return localStorage.getItem(LS_SEEN_KEY) || ""; } catch { return ""; }
}

function setSeenKey(key){
  try {
    const v = String(key || "").trim();
    if (!v) return;
    localStorage.setItem(LS_SEEN_KEY, v);
  } catch {}
}

function getAnnouncementKey(ann){
  if(!ann) return "";
  const created = String(ann.created_at || "").trim();
  const env = String(ann.envelope_text ?? ann.text ?? "").trim();
  const urgent = String(ann.urgent_text ?? "").trim();
  return created || `${env}__${urgent}`;
}


function getUrgentMessageKey(ann, urgentText = "", urgentVoice = ""){
  if(!ann) return "";
  const keySource = {
    updated_at: String(ann.updated_at || "").trim(),
    created_at: String(ann.created_at || "").trim(),
    urgent: String(urgentText || ann.urgent_text || "").trim(),
    voice: normalizeUrgentArabicTtsVoice(urgentVoice || ann.urgent_voice),
    enabled: !!ann.urgent_enabled,
    text: String(ann.text || "").trim()
  };
  return `client:${simpleHashKey(JSON.stringify(keySource))}`;
}

function clearEnvelopeUnreadIfOpen() {
  const modal = document.getElementById("UA07_SECRET_MODAL");
  if (!modal) return;
  const isOpen = modal.style.display === "block" || modal.classList.contains("show") || modal.getAttribute("aria-hidden") === "false";
  if (!isOpen) return;
  if (_lastAnnouncement) {
    const annKey = getAnnouncementKey(_lastAnnouncement);
    if (_lastAnnouncement.created_at) setSeenTs(_lastAnnouncement.created_at);
    if (annKey) setSeenKey(annKey);
    const b = ensureEnvelopeBadge();
    if (b) b.style.display = "none";
  }
}


function getUrgentDismissedTs(){
  try{ const v = localStorage.getItem(LS_URGENT_DISMISSED_AT)||""; return v ? Date.parse(v) : 0; }catch{ return 0; }
}

function getUrgentDismissedKey(){
  try{ return localStorage.getItem(LS_URGENT_DISMISSED_KEY) || ""; }catch{ return ""; }
}

function getUrgentDismissedSource(){
  try{ return localStorage.getItem(LS_URGENT_DISMISSED_SOURCE) || ""; }catch{ return ""; }
}

function isUrgentUserDismissed(annKey){
  return getUrgentAckCount(annKey) >= MAX_URGENT_ACKS_PER_MESSAGE;
}

function dismissUrgent(createdAtIso, key, source = "ack"){
  try{
    if(createdAtIso) localStorage.setItem(LS_URGENT_DISMISSED_AT, new Date(createdAtIso).toISOString());
    const v = String(key || "").trim();
    if(v) localStorage.setItem(LS_URGENT_DISMISSED_KEY, v);
    localStorage.setItem(LS_URGENT_DISMISSED_SOURCE, String(source || "ack"));
    announceStateChanged("urgent-dismissed", { key: v, created_at: createdAtIso || "", source: String(source || "ack") });
  }catch{}
}

function markSeen(createdAtIso, key) {
  try {
    if (createdAtIso) localStorage.setItem(LS_SEEN_AT, new Date(createdAtIso).toISOString());
    const v = String(key || "").trim();
    if (v) localStorage.setItem(LS_SEEN_KEY, v);
    announceStateChanged("envelope-seen", { key: v, created_at: createdAtIso || "" });
  } catch {}
}

function parseAnnouncementTextClient(raw){
  const text = String(raw || "");
  let envelope_text = "";
  let urgent_text = "";
  let urgent_enabled = false;
  let urgent_voice = DEFAULT_URGENT_ARABIC_TTS_VOICE;

  try{
    const obj = JSON.parse(text);
    if(obj && typeof obj === "object"){
      envelope_text = String(obj.envelope || obj.envelope_text || "");
      urgent_text = String(obj.urgent || obj.urgent_text || "");
      urgent_enabled = !!obj.urgent_enabled;
      urgent_voice = normalizeUrgentArabicTtsVoice(obj.urgent_voice);
      return { text, envelope_text, urgent_text, urgent_enabled, urgent_voice };
    }
  }catch(_){}

  if(text.startsWith(URGENT_PREFIX)){
    urgent_enabled = true;
    urgent_text = text.slice(URGENT_PREFIX.length).trim();
    return { text, envelope_text, urgent_text, urgent_enabled, urgent_voice };
  }

  envelope_text = text;
  return { text, envelope_text, urgent_text, urgent_enabled, urgent_voice };
}

function isNotificationBroadcastRow(row){
  return String(row?.kind || "announcement").trim().toLowerCase() === "notification";
}

function emitNotificationBroadcast(row){
  if(!isNotificationBroadcastRow(row)) return false;
  try{
    window.dispatchEvent(new CustomEvent("sr:admin-notification-broadcast", {
      detail:{
        id:Number(row?.id) || null,
        created_at:row?.created_at || null,
        action:"upsert",
        // Realtime already carries the announcement row; avoid an API poll.
        text:String(row?.text || "").slice(0, 3200),
      }
    }));
  }catch{}
  return true;
}

function emitNotificationBroadcastDelete(row){
  const id = Number(row?.id);
  if(!Number.isSafeInteger(id) || id <= 0) return false;
  try{
    window.dispatchEvent(new CustomEvent("sr:admin-notification-broadcast", {
      detail:{ id, action:"delete" }
    }));
  }catch{}
  return true;
}

function normalizeAnnouncementRow(row){
  if(!row || isNotificationBroadcastRow(row)) return null;
  const parsed = parseAnnouncementTextClient(row?.text || "");
  return {
    text: parsed.text,
    envelope_text: parsed.envelope_text,
    urgent_text: parsed.urgent_text,
    urgent_enabled: parsed.urgent_enabled,
    urgent_voice: normalizeUrgentArabicTtsVoice(parsed.urgent_voice),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null
  };
}

function applyAnnouncement(ann){
  if(!ann) return;
  const prevKey = getAnnouncementKey(_lastAnnouncement);
  const nextKey = getAnnouncementKey(ann);
  _lastAnnouncement = ann;
  writeAnnouncementCache(ann);
  updateBadgeUI();
  updateUrgentUI();

  // If the envelope modal is already open, refresh its content without touching layout.
  if(nextKey && nextKey !== prevKey){
    announceStateChanged("announcement-realtime", { key: nextKey, created_at: ann.created_at || "" });
    setTimeout(renderAnnouncementInModal, 30);
    setTimeout(clearEnvelopeUnreadIfOpen, 60);
  }
}

async function fetchLatestAnnouncement(options = {}) {
  const force = options?.force === true;
  const now = Date.now();

  if (!force) {
    const cached = readAnnouncementCache();
    if (cached) return cached;

    if (_lastAnnouncement && _lastAnnouncementFetchAt && (now - _lastAnnouncementFetchAt) < ANNOUNCEMENT_MIN_FETCH_INTERVAL_MS) {
      return _lastAnnouncement;
    }
  }

  _lastAnnouncementFetchAt = now;

  try {
    const res = await fetch(SR_API_BASE + "/admin-announcement", { method: "GET", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Keep silent; we don't want to break the tool UI.
      return null;
    }
    const ann = normalizeAnnouncementPayload(data);
    writeAnnouncementCache(ann);
    return ann;
  } catch (e) {
    return null;
  }
}

function ensureUrgentTicker(){
  let wrap = document.getElementById('SR_URGENT_TICKER');
  if(wrap) return wrap;
  wrap = document.createElement('div');
  wrap.id = 'SR_URGENT_TICKER';
  wrap.className = 'sr-urgent-ticker';
  wrap.style.display = 'none';
  wrap.setAttribute('role','alert');
  wrap.setAttribute('aria-live','assertive');
  wrap.setAttribute('aria-atomic','true');
  wrap.innerHTML = `
    <div class="sr-urgent-inner">
      <div class="sr-urgent-label">عاجل</div>
      <div class="sr-urgent-track" aria-hidden="true">
        <div class="sr-urgent-marquee" id="SR_URGENT_MARQUEE"></div>
      </div>
      <button type="button" class="sr-urgent-ack" id="SR_URGENT_ACK">فهمت</button>
    </div>
    <div id="SR_URGENT_VOICE_STATUS" style="font-size:11px;opacity:0.9;margin:4px 8px 0 8px;"></div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

function setUrgentText(text){
  const wrap = ensureUrgentTicker();
  const marquee = wrap.querySelector('#SR_URGENT_MARQUEE');
  if(!marquee) return;

  const safe = String(text||'').trim();

  // Build a seamless loop (no gap) by duplicating the segment.
  marquee.innerHTML = '';
  if(!safe){
    marquee.textContent = '';
    marquee.style.removeProperty('--sr-urgent-duration');
    return;
  }

  const seg1 = document.createElement('div');
  seg1.className = 'sr-urgent-segment';
  seg1.textContent = safe;
  const seg2 = seg1.cloneNode(true);
  marquee.appendChild(seg1);
  marquee.appendChild(seg2);

  // Auto speed tuned for readability: longer text → a bit slower.
  // Requested: make it 2x faster than the previous setting.
  const len = safe.length;
  const baseSecs = Math.max(18, Math.min(45, len * 0.35));
  const secs = Math.max(9, Math.min(22.5, baseSecs / 2));
  marquee.style.setProperty('--sr-urgent-duration', secs.toFixed(1) + 's');
  setTimeout(checkAndReadVisibleUrgent, 0);
  setTimeout(checkAndReadVisibleUrgent, 150);
}

function getUrgentVoiceForLang(lang) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (String(lang).toLowerCase().startsWith("ar")) {
    return voices.find(v => /^ar/i.test(v.lang || "")) ||
      voices.find(v => /arabic|العربية|ar-/i.test(`${v.name || ""} ${v.lang || ""}`)) ||
      null;
  }
  return voices.find(v => /^en/i.test(v.lang || "")) || null;
}


function getUrgentVoiceStatusNode() {
  const wrap = document.getElementById('SR_URGENT_TICKER');
  return wrap ? wrap.querySelector('#SR_URGENT_VOICE_STATUS') : null;
}

function isUrgentBannerVisible() {
  const wrap = document.getElementById('SR_URGENT_TICKER');
  return !!wrap && wrap.style.display === 'block';
}

function isAutoplayBlockedError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return /NotAllowedError/i.test(name) || /autoplay|user gesture|user activation|not allowed/i.test(message);
}

function setUrgentArabicVoiceStatus(message = "") {
  const voiceStatus = getUrgentVoiceStatusNode();
  if (!voiceStatus) return;
  const btn = voiceStatus.querySelector('button[data-sr-urgent-voice-button="1"]');
  voiceStatus.textContent = String(message || "");
  if (btn) voiceStatus.appendChild(btn);
}

function hideUrgentArabicVoiceButton() {
  const btn = getUrgentVoiceStatusNode()?.querySelector('button[data-sr-urgent-voice-button="1"]');
  if (btn) btn.style.display = 'none';
}

function showUrgentArabicVoiceButton(label, text, voice) {
  const wrap = document.getElementById('SR_URGENT_TICKER');
  const voiceStatus = wrap?.querySelector('#SR_URGENT_VOICE_STATUS');
  if (!wrap || !voiceStatus) return;
  let btn = voiceStatus.querySelector('button[data-sr-urgent-voice-button="1"]');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.srUrgentVoiceButton = '1';
    btn.style.border = '0';
    btn.style.borderRadius = '999px';
    btn.style.padding = '6px 12px';
    btn.style.marginInlineStart = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '800';
    btn.style.background = 'rgba(255,255,255,0.94)';
    btn.style.color = '#8a150f';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
    btn.addEventListener('click', () => {
      const retryText = btn.dataset.urgentText || text;
      const retryVoice = btn.dataset.urgentVoice || voice;
      speakUrgentNow(retryText, retryVoice, { force: true, manual: true });
    });
    voiceStatus.appendChild(btn);
  }
  btn.textContent = label;
  btn.dataset.urgentText = String(text || "");
  btn.dataset.urgentVoice = normalizeUrgentArabicTtsVoice(voice);
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
}

async function fetchUrgentArabicTtsBlob(text, voice, attempts = 2) {
  const selectedVoice = normalizeUrgentArabicTtsVoice(voice);
  let lastError = null;
  const maxAttempts = Math.max(1, Math.min(2, Number(attempts) || 2));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
    try {
      const res = await fetch("/api/urgent-tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: String(text || ""), voice: selectedVoice }),
        signal: controller?.signal
      });
      if (!res.ok) throw new Error("urgent-tts-failed");
      const ct = String(res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("audio/mpeg") && !ct.includes("audio/wav")) throw new Error("urgent-tts-invalid-content-type");
      return await res.blob();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError || new Error("urgent-tts-failed");
}

function createUrgentArabicAudio(blob) {
  if (urgentArabicPlayback.url) {
    try { URL.revokeObjectURL(urgentArabicPlayback.url); } catch {}
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = "auto";
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  audio.playsInline = true;
  audio.src = url;
  currentUrgentAudio = audio;
  currentUrgentAudioUrl = url;
  urgentArabicPlayback.audio = audio;
  urgentArabicPlayback.url = url;
  return audio;
}

async function playUrgentArabicAudio(audio, speakKey) {
  await audio.play();
  if (urgentArabicPlayback.key !== speakKey || !isUrgentBannerVisible()) return;
  urgentArabicPlayback.status = "playing";
  hideUrgentArabicVoiceButton();
  setUrgentArabicVoiceStatus("جاري قراءة رسالة الأدمن العاجلة");
  audio.onended = () => {
    if (currentUrgentAudio === audio) currentUrgentAudio = null;
    if (urgentArabicPlayback.key === speakKey) urgentArabicPlayback.status = "ended";
  };
  audio.onerror = () => {
    if (urgentArabicPlayback.key === speakKey && isUrgentBannerVisible()) {
      urgentArabicPlayback.status = "failed";
      setUrgentArabicVoiceStatus("");
      showUrgentArabicVoiceButton("🔊 إعادة المحاولة", urgentArabicPlayback.text, urgentArabicPlayback.voice);
    }
  };
}

function scheduleBlockedAutoplayRetry(text, voice, speakKey) {
  if (urgentArabicPlayback.blockedInteractionRetry) return;
  urgentArabicPlayback.blockedInteractionRetry = true;
  const retry = () => {
    if (!isUrgentBannerVisible() || urgentArabicPlayback.key !== speakKey || urgentArabicPlayback.status !== "blocked") return;
    speakUrgentNow(text, voice, { force: true, interactionRetry: true });
  };
  ["pointerdown", "click", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, retry, { once: true, capture: true });
  });
}

function getVisibleUrgentText() {
  const wrap = document.getElementById('SR_URGENT_TICKER');
  if (!wrap || wrap.style.display !== 'block') return "";
  const marquee = wrap.querySelector('#SR_URGENT_MARQUEE');
  const firstSegment = marquee ? marquee.querySelector('.sr-urgent-segment') : null;
  return String(firstSegment?.textContent || marquee?.textContent || '').replace(/\s+/g, ' ').trim();
}

async function speakUrgentNow(rawText, requestedVoice = DEFAULT_URGENT_ARABIC_TTS_VOICE, options = {}){
  const voiceStatus = document.getElementById('SR_URGENT_VOICE_STATUS');
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  const arabicVoice = normalizeUrgentArabicTtsVoice(requestedVoice);
  const speakKey = getUrgentSpeakKey(text, arabicVoice);
  if(!text) return;

  const synth = window.speechSynthesis;
  const isArabic = /[؀-ۿ]/.test(text);

  if (isArabic) {
    const samePlayback = urgentArabicPlayback.key === speakKey;
    if (!options.force && samePlayback && ["fetching", "playing", "blocked", "failed", "ended"].includes(urgentArabicPlayback.status)) return;
    if (options.force && samePlayback && ["fetching", "playing"].includes(urgentArabicPlayback.status)) return;
    if (samePlayback && options.force && urgentArabicPlayback.audio && urgentArabicPlayback.status === "blocked") {
      try {
        await playUrgentArabicAudio(urgentArabicPlayback.audio, speakKey);
        lastStartedUrgentKey = speakKey;
        return;
      } catch (error) {
        if (isAutoplayBlockedError(error)) {
          urgentArabicPlayback.status = "blocked";
          setUrgentArabicVoiceStatus("");
          showUrgentArabicVoiceButton("🔊 تشغيل الصوت", text, arabicVoice);
          return;
        }
      }
    }

    stopUrgentAudio();
    urgentArabicPlayback = { key: speakKey, text, voice: arabicVoice, status: "fetching", audio: null, url: "", blockedInteractionRetry: false };
    lastStartedUrgentKey = "";
    hideUrgentArabicVoiceButton();
    setUrgentArabicVoiceStatus("جاري قراءة رسالة الأدمن العاجلة");

    try {
      const blob = await fetchUrgentArabicTtsBlob(text, arabicVoice, 2);
      if (urgentArabicPlayback.key !== speakKey || !isUrgentBannerVisible()) return;
      const audio = createUrgentArabicAudio(blob);
      await playUrgentArabicAudio(audio, speakKey);
      lastStartedUrgentKey = speakKey;
      return;
    } catch (error) {
      if (urgentArabicPlayback.key !== speakKey || !isUrgentBannerVisible()) return;
      if (isAutoplayBlockedError(error)) {
        urgentArabicPlayback.status = "blocked";
        setUrgentArabicVoiceStatus("");
        showUrgentArabicVoiceButton("🔊 تشغيل الصوت", text, arabicVoice);
        scheduleBlockedAutoplayRetry(text, arabicVoice, speakKey);
        return;
      }
      urgentArabicPlayback.status = "failed";
      setUrgentArabicVoiceStatus("");
      showUrgentArabicVoiceButton("🔊 إعادة المحاولة", text, arabicVoice);
      return;
    }
  }

  if(!synth || typeof SpeechSynthesisUtterance === "undefined") return;
  if(!options.force && speakKey === lastStartedUrgentKey) return;
  const voice = getUrgentVoiceForLang("en-US");
  stopUrgentAudio();
  lastStartedUrgentKey = speakKey;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (voice) utterance.voice = voice;
  utterance.onstart = ()=>{ if (voiceStatus) voiceStatus.textContent = "جاري القراءة"; };
  utterance.onend = ()=>{ if (voiceStatus) voiceStatus.textContent = "انتهت القراءة"; };
  utterance.onerror = ()=>{ if (voiceStatus) voiceStatus.textContent = "تعذر تشغيل القراءة"; };
  synth.speak(utterance);
}

function checkAndReadVisibleUrgent(){
  const text = getVisibleUrgentText();
  const wrap = document.getElementById('SR_URGENT_TICKER');
  const voice = normalizeUrgentArabicTtsVoice(wrap?.dataset?.urgentVoice || DEFAULT_URGENT_ARABIC_TTS_VOICE);
  if(!text) return;
  if(/[؀-ۿ]/.test(text)){
    speakUrgentNow(text, voice);
    return;
  }
  if(getUrgentSpeakKey(text, voice) === lastStartedUrgentKey) return;
  if(urgentVoiceUnlocked){
    speakUrgentNow(text, voice);
    return;
  }
  pendingUrgentText = text;
  pendingUrgentVoice = voice;
}

function unlockUrgentVoice() {
  if (urgentVoiceUnlocked) return;
  urgentVoiceUnlocked = true;
  if (pendingUrgentText) {
    const text = pendingUrgentText;
    pendingUrgentText = "";
    speakUrgentNow(text, pendingUrgentVoice);
  } else {
    checkAndReadVisibleUrgent();
  }
}

function bindUrgentVoiceUnlock() {
  const events = ["pointerdown", "click", "keydown", "input", "focusin"];
  events.forEach((evt) => {
    document.addEventListener(evt, unlockUrgentVoice, { once: true, capture: true });
  });
  try {
    if (navigator.userActivation && navigator.userActivation.hasBeenActive) {
      unlockUrgentVoice();
    }
  } catch {}
}

function showUrgent(createdAtIso, text, annKey, urgentVoice = DEFAULT_URGENT_ARABIC_TTS_VOICE){
  const effectiveKey = String(annKey || createdAtIso || text || "").trim();
  if(!effectiveKey || urgentHiddenThisPageKeys.has(effectiveKey) || getUrgentAckCount(effectiveKey) >= MAX_URGENT_ACKS_PER_MESSAGE){
    hideUrgent();
    return;
  }

  const wrap = ensureUrgentTicker();
  const selectedVoice = normalizeUrgentArabicTtsVoice(urgentVoice);
  const isAlreadyVisibleSame = wrap.style.display === 'block' && wrap.dataset.urgentActiveKey === effectiveKey && wrap.dataset.urgentVoice === selectedVoice;

  wrap.dataset.urgentActiveKey = effectiveKey;
  wrap.dataset.urgentCreatedAt = String(createdAtIso || "");
  wrap.dataset.urgentVoice = selectedVoice;

  setUrgentText(text);
  wrap.style.display = 'block';

  if(!isAlreadyVisibleSame){
    // Play the sound only after this urgent message is actually visible.
    try {
      const soundKey = `sr_admin_urgent_sound_played:${simpleHashKey(effectiveKey)}`;
      if(!sessionStorage.getItem(soundKey)){
        sessionStorage.setItem(soundKey, "1");
        playUrgentBannerNotification();
      }
    } catch {}
  }

  const ack = wrap.querySelector('#SR_URGENT_ACK');
  if(ack && !ack.__bound){
    ack.__bound = true;
    ack.addEventListener('click', ()=>{
      const activeKey = String(wrap.dataset.urgentActiveKey || "").trim();
      const activeCreatedAt = String(wrap.dataset.urgentCreatedAt || "").trim();
      const ackCount = acknowledgeUrgentMessage(activeKey);
      if(activeKey) urgentHiddenThisPageKeys.add(activeKey);
      stopUrgentAudio();
      wrap.style.display = 'none';
      dismissUrgent(activeCreatedAt, activeKey, ackCount >= MAX_URGENT_ACKS_PER_MESSAGE ? "ack-limit" : "ack");
    });
  }

  setTimeout(checkAndReadVisibleUrgent, 0);
  setTimeout(checkAndReadVisibleUrgent, 150);
}

function hideUrgent(){
  stopUrgentAudio();
  const wrap = document.getElementById('SR_URGENT_TICKER');
  if(wrap) wrap.style.display = 'none';
}

function ensureEnvelopeBadge() {
  const btn = document.getElementById("UA07_SECRET_ENVELOPE");
  if (!btn) return null;

  let badge = btn.querySelector(".ua07-ann-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "ua07-ann-badge";
    // Red dot badge (unread)
    badge.style.position = "absolute";
    badge.style.top = "2px";
    badge.style.right = "2px";
    badge.style.width = "10px";
    badge.style.height = "10px";
    badge.style.borderRadius = "50%";
    badge.style.backgroundColor = "#ff3b3b";
    badge.style.display = "none";
    badge.setAttribute("aria-hidden", "true");
    // Ensure absolute positioning works
    btn.style.position = "relative";
    btn.appendChild(badge);
  }
  return badge;
}

let _lastAnnouncement = null;
let _lastAnnouncementFetchAt = 0;

function normalizeAnnouncementPayload(data = {}) {
  const envelope_text = String(data?.envelope_text ?? data?.text ?? "").trim();
  const urgent_text = String(data?.urgent_text ?? "").trim();
  const urgent_enabled = !!(data?.urgent_enabled);
  const urgent_voice = normalizeUrgentArabicTtsVoice(data?.urgent_voice);
  const created_at = data?.created_at || null;
  const updated_at = data?.updated_at || null;

  if (!envelope_text && !(urgent_enabled && urgent_text)) {
    return { envelope_text: "", urgent_text: "", urgent_enabled: false, urgent_voice, created_at, updated_at };
  }
  return { envelope_text, urgent_text, urgent_enabled, urgent_voice, created_at, updated_at };
}

function runtimeStartupSnapshot(){
  try{
    const snapshot = window.__srNotificationCenterBridge?.getSnapshot?.();
    if(!snapshot || !Number(snapshot?.loaded_at || 0)) return null;
    return snapshot;
  }catch{
    return null;
  }
}

function runtimeStartupAnnouncement(){
  const snapshot = runtimeStartupSnapshot();
  const raw = snapshot?.announcement;
  if(!raw || typeof raw !== "object") return null;
  return normalizeAnnouncementPayload(raw);
}

function readAnnouncementCache() {
  try {
    const raw = sessionStorage.getItem(SS_ANNOUNCEMENT_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.saved_at || 0);
    if (!savedAt || (Date.now() - savedAt) > ANNOUNCEMENT_CACHE_TTL_MS) return null;
    const ann = parsed?.announcement;
    if (!ann || typeof ann !== "object") return null;
    return ann;
  } catch {
    return null;
  }
}

function writeAnnouncementCache(ann) {
  try {
    sessionStorage.setItem(SS_ANNOUNCEMENT_CACHE, JSON.stringify({
      saved_at: Date.now(),
      announcement: ann
    }));
  } catch {}
}

function shouldShowBadge(ann) {
  if (!ann) return false;
  const annKey = getAnnouncementKey(ann);
  if (!annKey) return false;
  const seenKey = getSeenKey();
  if (seenKey && seenKey === annKey) return false;

  if (!ann.created_at) return true;
  const annTs = Date.parse(ann.created_at);
  if (!Number.isFinite(annTs)) return true;
  return annTs > getSeenTs();
}

function updateUrgentUI(){
  const ann = _lastAnnouncement;
  if(!ann) { hideUrgent(); return; }

  // New format: separate urgent fields.
  let urgentEnabled = !!ann.urgent_enabled;
  let urgentText = String(ann.urgent_text || "").trim();
  const urgentVoice = normalizeUrgentArabicTtsVoice(ann.urgent_voice);

  // Backward compatibility: if server still returns legacy prefixed text
  if(!urgentEnabled && !urgentText){
    const raw = String(ann.text || "");
    if(raw.startsWith(URGENT_PREFIX)){
      urgentEnabled = true;
      urgentText = raw.slice(URGENT_PREFIX.length).trim();
    }
  }

  if(!urgentEnabled || !urgentText){ hideUrgent(); return; }

  const annKey = getUrgentMessageKey(ann, urgentText, urgentVoice);
  if(urgentHiddenThisPageKeys.has(annKey) || isUrgentUserDismissed(annKey)) { hideUrgent(); return; }

  const annTs = Date.parse(ann.created_at);
  if(!Number.isFinite(annTs)) {
    showUrgent(ann.created_at, urgentText, annKey, urgentVoice);
    return;
  }
  if(annTs <= getUrgentDismissedTs() && isUrgentUserDismissed(annKey)) { hideUrgent(); return; }
  showUrgent(ann.created_at, urgentText, annKey, urgentVoice);
}

function updateBadgeUI() {
  const badge = ensureEnvelopeBadge();
  if (!badge) return;
  const show = shouldShowBadge(_lastAnnouncement);
  badge.style.display = show ? "block" : "none";
}

async function refreshAnnouncementAndBadge(options = {}) {
  const ann = await fetchLatestAnnouncement(options);
  if (ann) {
    applyAnnouncement(ann);
  } else {
    updateBadgeUI();
    updateUrgentUI();
  }
}

// --- Modal injection ---
let _originalModalSnapshot = null;

function snapshotOriginalModal(modal) {
  if (_originalModalSnapshot) return;
  const titleEl = modal.querySelector(".ua07-secret-title");
  const iconEl = modal.querySelector(".ua07-secret-icon");
  const bodyEl = modal.querySelector(".ua07-secret-body");
  _originalModalSnapshot = {
    title: titleEl ? titleEl.textContent : "",
    iconHtml: iconEl ? iconEl.innerHTML : "",
    bodyHtml: bodyEl ? bodyEl.innerHTML : "",
  };
}

function renderAnnouncementInModal() {
  const modal = document.getElementById("UA07_SECRET_MODAL");
  if (!modal) return;

  snapshotOriginalModal(modal);

  const titleEl = modal.querySelector(".ua07-secret-title");
  const iconEl = modal.querySelector(".ua07-secret-icon");
  const bodyEl = modal.querySelector(".ua07-secret-body");
  if (!titleEl || !bodyEl) return;

  const ann = _lastAnnouncement;
  const hasAnn = !!(ann && (ann.envelope_text ?? ann.text) && String(ann.envelope_text ?? ann.text).trim());

  if (!hasAnn) {
    // Restore original modal when there is no announcement.
    if (_originalModalSnapshot) {
      titleEl.textContent = _originalModalSnapshot.title;
      if (iconEl) iconEl.innerHTML = _originalModalSnapshot.iconHtml;
      bodyEl.innerHTML = _originalModalSnapshot.bodyHtml;
    }
    return;
  }

  // Replace modal content with the admin message (clean envelope view).
  titleEl.textContent = "رسالة إدارية";
  if (iconEl) iconEl.textContent = "📣";

  const when = ann.created_at ? new Date(ann.created_at).toLocaleString("ar-EG") : "";
  const annText = String(ann.envelope_text ?? ann.text ?? "").trim();
  bodyEl.innerHTML = `
    <div class="ua07-secret-lead">رسالة من الأدمن</div>
    <div class="ua07-secret-text" style="white-space:pre-wrap;">${escapeHtml(annText)}</div>
    ${when ? `<div class="ua07-secret-text" style="opacity:0.7;font-size:12px;margin-top:10px;">${escapeHtml(when)}</div>` : ""}
  `;

  // Mark as seen and hide badge.
  const annKey = getAnnouncementKey(ann);
  markSeen(ann.created_at, annKey);
  updateBadgeUI();
}

function hookEnvelopeClick() {
  // We use event capturing so we run even if app.js stops propagation.
  document.addEventListener(
    "click",
    async (e) => {
      const t = e.target;
      if (!t) return;
      const btn = t.closest ? t.closest("#UA07_SECRET_ENVELOPE") : null;
      if (!btn) return;

      // Realtime keeps the cache current. Hit the Worker only if realtime is known unavailable.
      await refreshAnnouncementAndBadge({ force: window.__srAnnouncementRealtimeOk === false });

      // app.js opens the modal in its own click handler. Wait a tick.
      setTimeout(renderAnnouncementInModal, 30);
      // Mark as read when user opens the envelope.
      setTimeout(clearEnvelopeUnreadIfOpen, 60);
      setTimeout(renderAnnouncementInModal, 120);
      setTimeout(clearEnvelopeUnreadIfOpen, 160);
    },
    true
  );
}

function observeModalOpen() {
  // Extra robustness: if the modal gets opened by any other means,
  // detect it and render the announcement.
  const modal = document.getElementById("UA07_SECRET_MODAL");
  if (!modal || modal.__srAnnObserved) return;
  modal.__srAnnObserved = true;

  const obs = new MutationObserver(() => {
    const isOpen = modal.classList.contains("is-open") && modal.getAttribute("aria-hidden") === "false";
    if (isOpen) {
      renderAnnouncementInModal();
        clearEnvelopeUnreadIfOpen();
    }
  });
  obs.observe(modal, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
}

function bindAnnouncementSync() {
  window.addEventListener("storage", (e) => {
    if (!e?.key) return;
    if ([LS_SEEN_AT, LS_SEEN_KEY, LS_URGENT_DISMISSED_AT, LS_URGENT_DISMISSED_KEY, LS_URGENT_ACK_STATE].includes(e.key)) {
      updateBadgeUI();
      updateUrgentUI();
    }
  });

  if (SR_ANNOUNCEMENT_CHANNEL && !window.__srAnnChannelBound) {
    window.__srAnnChannelBound = true;
    SR_ANNOUNCEMENT_CHANNEL.addEventListener("message", () => {
      updateBadgeUI();
      updateUrgentUI();
    });
  }
}

async function subscribeAnnouncementRealtime(){
  if(window.__srAnnouncementRealtimeBound) return;
  window.__srAnnouncementRealtimeBound = true;

  try{
    // Load Supabase only after the first API read has been scheduled.
    // The urgent/envelope message must not depend on the external esm.sh Supabase import;
    // if that network import fails, the initial /api/admin-announcement fetch still works.
    const mod = await import("./supabase-client.js");
    const supabase = mod && mod.supabase;
    if(!supabase || typeof supabase.channel !== "function") throw new Error("Supabase client unavailable");

    const channel = supabase
      .channel(ANNOUNCEMENT_REALTIME_CHANNEL)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcements" },
        (payload) => {
          if(emitNotificationBroadcast(payload?.new)) return;
          const ann = normalizeAnnouncementRow(payload?.new);
          if(ann) applyAnnouncement(ann);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "announcements" },
        (payload) => {
          if(emitNotificationBroadcast(payload?.new)) return;
          const ann = normalizeAnnouncementRow(payload?.new);
          if(ann) applyAnnouncement(ann);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "announcements" },
        (payload) => {
          emitNotificationBroadcastDelete(payload?.old);
        }
      )
      .subscribe((status) => {
        if(status === "SUBSCRIBED"){
          try { window.__srAnnouncementRealtimeOk = true; } catch {}
        }else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"){
          try { window.__srAnnouncementRealtimeOk = false; } catch {}
        }
      });

    window.__srAnnouncementRealtimeChannel = channel;
  }catch(e){
    // Keep the tool running even if Realtime is unavailable.
    // Explicit envelope intent and the bounded startup fallback can still use the API.
    try { window.__srAnnouncementRealtimeOk = false; } catch {}
  }
}

function init() {
  bindUrgentVoiceUnlock();
  bindAnnouncementSync();
  hookEnvelopeClick();

  // v11 announcement state rides inside the single startup notification snapshot.
  // Do not race it with a second Worker request; use the dedicated API only if
  // the unified startup owner fails to resolve within a bounded recovery window.
  let startupSnapshotResolved = false;
  let startupFallbackTimer = 0;

  const consumeStartupSnapshot = (detail) => {
    if(detail?.available !== true) return false;
    startupSnapshotResolved = true;
    if(startupFallbackTimer){
      clearTimeout(startupFallbackTimer);
      startupFallbackTimer = 0;
    }
    const raw = detail?.announcement;
    if(raw && typeof raw === "object") applyAnnouncement(normalizeAnnouncementPayload(raw));
    return true;
  };

  const existingSnapshot = runtimeStartupSnapshot();
  if(existingSnapshot){
    consumeStartupSnapshot({ ...existingSnapshot, available:true });
  }else{
    startupFallbackTimer = setTimeout(() => {
      startupFallbackTimer = 0;
      if(startupSnapshotResolved) return;
      refreshAnnouncementAndBadge({ force:true }).catch(() => {});
    }, 3200);
  }

  window.addEventListener("sr:notification-center-state", (event) => {
    consumeStartupSnapshot(event?.detail || {});
  });

  // Live updates: no repeated polling; new admin messages arrive through Supabase Realtime.
  subscribeAnnouncementRealtime();

  // Keep multiple tabs/windows in sync for the same user.
  window.addEventListener("storage", (e) => {
    const keys = [LS_SEEN_AT, LS_SEEN_KEY, LS_URGENT_DISMISSED_AT, LS_URGENT_DISMISSED_KEY, LS_URGENT_DISMISSED_SOURCE, LS_URGENT_ACK_STATE];
    if (!e || !keys.includes(e.key)) return;
    updateBadgeUI();
    updateUrgentUI();
  });

  // Use the shared event-driven DOM readiness broker instead of a 200ms retry loop.
  const bindModalObserver = () => {
    observeModalOpen();
    return !!document.getElementById("UA07_SECRET_MODAL");
  };
  if(!bindModalObserver()){
    if(typeof window.__srWaitForDom === "function") window.__srWaitForDom(bindModalObserver, 8000);
    else setTimeout(bindModalObserver, 0);
  }
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(init, 0);
} else {
  document.addEventListener("DOMContentLoaded", init);
}

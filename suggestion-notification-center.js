import { getStableUserId } from "./stable-user-identity.js";

const CENTER_LIMIT = 60;
const EXTRA_COUNT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const STARTUP_SNAPSHOT_PREFIX = "sr_notification_startup_snapshot_v1:";

let installed = false;
let bell = null;
let badge = null;
let panel = null;
let list = null;
let markAllButton = null;
let items = [];
let loading = false;
let refreshInFlight = null;
let lastSnapshotAt = 0;
let visibleReadTimer = 0;
let visibleReadInFlight = false;
let targetedUnread = 0;
let broadcastUnread = 0;
let supportUnread = 0;
let latestAnnouncement = null;
let extraCountPromise = null;
let lastExtraCountAt = 0;
let activeFilter = "all";
let unreadViewKeys = new Set();
let loadError = false;
let markAllInFlight = false;
let notificationPanelOpenToken = 0;
let snapshotGeneration = 0;
let reconnectSnapshotQueued = false;
const seenBroadcastEvents = new Set();
const seenSupportPushIds = new Set();
const RELEASE_KEY_PREFIX = "sr_tool_release_notice_v1:";
let releaseNotice = null;

function currentReleaseKey(){
  try{
    const uid = String(getStableUserId() || "").trim();
    return uid ? RELEASE_KEY_PREFIX + uid : "";
  }catch{ return ""; }
}

function readReleaseNotice(){
  const sha = String(document.querySelector('meta[name="sr-release-revision"]')?.content || "").trim();
  const key = currentReleaseKey();
  if(!key || !/^[a-f0-9]{40,64}$/i.test(sha)) return null;
  let state = null;
  try{ state = JSON.parse(localStorage.getItem(key) || "null"); }catch{}
  const same = state?.sha === sha;
  const publishedAt=String(document.querySelector('meta[name="sr-release-published-at"]')?.content || "");
  const created=publishedAt && Number.isFinite(Date.parse(publishedAt))
    ? publishedAt : (same && state?.created_at ? state.created_at : new Date().toISOString());
  const notice = {
    key:"release:" + sha, kind:"release", title:"تحديث جديد في SR Main",
    text:"تم نشر إصدار جديد للتول. معرّف التحديث: " + sha.slice(0, 7),
    category:"tool_release", created_at:created, read:same && state?.read === true,
    target:"notification", sender_name:"SR System",
  };
  try{ localStorage.setItem(key, JSON.stringify({
    sha, read:notice.read, created_at:created,
  })); }catch{}
  return notice;
}

function currentReleaseRevision(){
  return String(document.querySelector('meta[name="sr-release-revision"]')?.content || "").trim();
}
function dismissArchivedRelease(data){
  if(data?.release_removed!==true || !releaseNotice)return false;
  releaseNotice=null;
  items=items.filter(item=>item?.kind!=="release");
  refreshCombinedBadge();
  return true;
}
function mergeNotificationsByTime(rows){
  const merged=releaseNotice
    ? [releaseNotice,...rows.filter(item=>item?.kind!=="release")]
    : rows.filter(item=>item?.kind!=="release");
  return merged.sort((a,b)=>
    (Date.parse(b?.created_at||"")||0)-(Date.parse(a?.created_at||"")||0)
  ).slice(0,CENTER_LIMIT);
}
function markReleaseRead(){
  if(!releaseNotice || releaseNotice.read) return;
  releaseNotice.read = true;
  const key = currentReleaseKey();
  if(key){
    try{ localStorage.setItem(key, JSON.stringify({
      sha:String(releaseNotice.key).slice(8),
      read:true, created_at:releaseNotice.created_at,
    })); }catch{}
  }
  refreshCombinedBadge();
}


function startupSnapshotKey(){
  try{
    const uid = String(getStableUserId() || "").trim();
    return uid ? STARTUP_SNAPSHOT_PREFIX + uid : "";
  }catch{
    return "";
  }
}

function readStartupSnapshot(){
  const key = startupSnapshotKey();
  if(!key) return null;
  try{
    const raw = sessionStorage.getItem(key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.saved_at || 0);
    if(!savedAt || Date.now() - savedAt >= STARTUP_SNAPSHOT_TTL_MS){
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  }catch{
    return null;
  }
}

function writeStartupSnapshot(data = {}){
  const key = startupSnapshotKey();
  if(!key || data?.available !== true) return;
  try{
    sessionStorage.setItem(key, JSON.stringify({
      saved_at:Date.now(),
      available:true,
      suggestion_unread_count:Math.max(0, Number(targetedUnread || 0)),
      broadcast_unread_count:Math.max(0, Number(broadcastUnread || 0)),
      support_unread_count:Math.max(0, Number(supportUnread || 0)),
      announcement:latestAnnouncement,
      release_removed:releaseNotice===null,
      release_revision:currentReleaseRevision(),
      mentions_available:data?.mentions_available !== false,
      broadcasts_available:data?.broadcasts_available !== false,
      support_available:data?.support_available !== false,
    }));
  }catch{}
}

function applyStartupSnapshot(data = {}){
  if(data?.available !== true) return false;
  // Public broadcasts do not replay events from the previous document's gap.
  // Reuse cached paint, then perform one fresh snapshot after transport joins.
  window.__srNotificationStartupWasCached = true;
  if(data?.release_revision === currentReleaseRevision())dismissArchivedRelease(data);
  targetedUnread = Math.max(0, Number(data?.suggestion_unread_count || 0));
  broadcastUnread = Math.max(0, Number(data?.broadcast_unread_count || 0));
  supportUnread = Math.max(0, Number(data?.support_unread_count || 0));
  latestAnnouncement = data?.announcement && typeof data.announcement === "object"
    ? data.announcement
    : null;
  const savedAt = Number(data?.saved_at || Date.now());
  lastExtraCountAt = Number.isFinite(savedAt) ? savedAt : Date.now();
  refreshCombinedBadge();
  publishNotificationSnapshot(data, "startup-cache");
  return true;
}

function $(sel, root = document){
  return root?.querySelector?.(sel) || null;
}

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function when(value){
  const ts = Date.parse(value || "");
  if(!Number.isFinite(ts)) return "";
  try{ return new Date(ts).toLocaleString(); }catch{ return ""; }
}

function whenCompact(value){
  const ts = Date.parse(value || "");
  if(!Number.isFinite(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if(diff < minute) return "Now";
  if(diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if(diff < day) return `${Math.max(1, Math.floor(diff / hour))}h`;
  if(diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))}d`;
  try{ return new Date(ts).toLocaleDateString(undefined, { month:"short", day:"numeric" }); }catch{ return ""; }
}

async function postCenter(body){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try{
  const res = await fetch("/api/suggestion-notification-center", {
    method:"POST",
    credentials:"same-origin",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body || {}),
    signal:controller.signal,
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data?.error || "Notifications unavailable.");
  return data;
  }finally{ clearTimeout(timeout); }
}

function ensureStyles(){
  if(document.getElementById("sr-notification-center-style")) return;
  const style = document.createElement("style");
  style.id = "sr-notification-center-style";
  style.textContent = `
    .floating-actions .sr-notifications-fab{
      position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;
      width:48px;min-width:48px;height:48px;padding:0;overflow:visible;
      border:1px solid #5b5040;border-radius:16px;color:#edce98;cursor:pointer;
      background:linear-gradient(145deg,#37332e,#191b20 72%);
      box-shadow:0 8px 24px #0005,inset 0 1px 0 #ffffff19;
      transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease;
      -webkit-tap-highlight-color:transparent;
    }
    .floating-actions .sr-notifications-fab::before{
      content:"";position:absolute;inset:4px;border:1px solid #e6c58c13;border-radius:12px;pointer-events:none;
    }
    .floating-actions .sr-notifications-fab svg{width:22px;height:22px;display:block;transform-origin:50% 15%}
    .floating-actions .sr-notifications-fab:hover,
    .floating-actions .sr-notifications-fab[aria-expanded="true"]{
      transform:translateY(-2px);border-color:#b59b70;box-shadow:0 10px 28px #0006,0 0 0 4px #e4be7810;
    }
    .floating-actions .sr-notifications-fab:focus-visible{outline:2px solid #edce98;outline-offset:4px}
    .floating-actions .sr-notifications-fab.has-unread svg{animation:srNotificationBell .65s ease both}
    @keyframes srNotificationBell{0%,100%{transform:rotate(0)}20%{transform:rotate(12deg)}45%{transform:rotate(-10deg)}70%{transform:rotate(5deg)}}
    .floating-actions .sr-notifications-badge{
      position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;box-sizing:border-box;
      display:none;align-items:center;justify-content:center;padding:0 5px;border:2px solid #191b20;
      border-radius:999px;background:#edce98;color:#28231a;
      font:800 10px/1 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 3px 10px #0004;
    }
    .floating-actions .sr-notifications-badge.is-on{display:inline-flex}
    #srNotificationCenter{
      --nc-bg:#15171c;--nc-surface:#1c1f26;--nc-hover:#232730;--nc-border:#ffffff12;
      --nc-text:#f4f3ef;--nc-body:#bec2cd;--nc-muted:#9299a9;--nc-accent:#e8c995;
      --nc-accent-soft:#e8c99512;--nc-shadow:#0006;
      position:fixed;z-index:2147483400;width:min(448px,calc(100vw - 24px));
      max-height:min(672px,calc(100dvh - 24px));display:flex;flex-direction:column;
      box-sizing:border-box;overflow:hidden;border:1px solid #bca57738;border-radius:24px;
      background:var(--nc-bg);color:var(--nc-text);color-scheme:dark;
      box-shadow:0 24px 80px #0008,0 4px 16px #0003,inset 0 1px 0 #ffffff08;
      backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
      font:400 13px/1.5 "Segoe UI",Tahoma,Arial,sans-serif;text-align:left;direction:ltr;
      transform-origin:bottom right;animation:srNotificationPanelIn .22s cubic-bezier(.2,.8,.2,1) both;
    }
    #srNotificationCenter[hidden]{display:none!important}
    #srNotificationCenter *,#srNotificationCenter *::before,#srNotificationCenter *::after{box-sizing:border-box}
    #srNotificationCenter button{font:inherit;letter-spacing:normal;cursor:pointer;-webkit-tap-highlight-color:transparent}
    #srNotificationCenter svg{display:block;width:18px;height:18px;flex-shrink:0}
    #srNotificationCenter button:focus-visible,#srNotificationCenter [tabindex="0"]:focus-visible{
      outline:2px solid var(--nc-accent);outline-offset:3px;
    }
    @keyframes srNotificationPanelIn{from{opacity:0;transform:translateY(10px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
    #srNotificationCenter .sr-notification-handle{display:none}
    #srNotificationCenter .sr-notification-head{
      flex:0 0 auto;display:flex;align-items:flex-start;gap:12px;padding:24px 22px 18px;
      background:radial-gradient(ellipse at 10% 0,#e8c9950d,transparent 75%);
    }
    #srNotificationCenter .sr-notification-heading{display:flex;align-items:center;gap:13px;flex:1;min-width:0}
    #srNotificationCenter .sr-notification-head-icon{
      display:inline-flex;align-items:center;justify-content:center;width:44px;height:48px;flex:0 0 44px;
      border:1px solid #e8c99530;border-radius:15px;background:linear-gradient(145deg,#e8c99519,#e8c99503);
      color:var(--nc-accent);box-shadow:inset 0 1px 0 #ffffff08;
    }
    #srNotificationCenter .sr-notification-head-icon svg{width:23px;height:23px}
    #srNotificationCenter .sr-notification-heading-copy{display:grid;gap:2px;min-width:0}
    #srNotificationCenter .sr-notification-eyebrow{font-size:9px;line-height:1.4;font-weight:700;letter-spacing:1.8px;color:var(--nc-accent)}
    #srNotificationCenter .sr-notification-title{font-size:23px;line-height:1.25;font-weight:650;letter-spacing:-.7px;color:var(--nc-text)}
    #srNotificationCenter .sr-notification-subtitle{margin-top:5px;font-size:11px;color:var(--nc-muted);line-height:1.4}
    #srNotificationCenter .sr-notification-close{
      display:inline-flex;align-items:center;justify-content:center;flex:0 0 32px;width:32px;height:32px;padding:0;
      border:1px solid var(--nc-border);border-radius:10px;background:transparent;color:var(--nc-muted);
      transition:background .18s ease,color .18s ease;
    }
    #srNotificationCenter .sr-notification-close:hover{background:var(--nc-hover);color:var(--nc-text)}
    #srNotificationCenter .sr-notification-toolbar{
      flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;
      margin:0 20px;padding-bottom:16px;border-bottom:1px solid var(--nc-border);
    }
    #srNotificationCenter .sr-notification-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--nc-border);border-radius:11px;background:#0002}
    #srNotificationCenter .sr-notification-tab{
      display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:6px 10px;min-height:32px;
      border:1px solid transparent;border-radius:8px;background:transparent;color:var(--nc-muted);font-size:11px;font-weight:600;
      transition:background .18s ease,color .18s ease;
    }
    #srNotificationCenter .sr-notification-tab[aria-pressed="true"]{
      background:var(--nc-hover);border-color:var(--nc-border);color:var(--nc-text);box-shadow:0 2px 5px #0002;
    }
    #srNotificationCenter .sr-notification-tab:hover{color:var(--nc-text)}
    #srNotificationCenter .sr-notification-unread-count{
      display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;
      border-radius:5px;background:var(--nc-accent-soft);color:var(--nc-accent);font-size:10px;line-height:1;font-variant-numeric:tabular-nums;
    }
    #srNotificationCenter .sr-notification-mark-all{
      display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:38px;padding:6px 0 6px 6px;
      border:0;border-radius:8px;background:transparent;color:var(--nc-accent);font-size:11px;font-weight:600;
    }
    #srNotificationCenter .sr-notification-mark-all svg{width:16px;height:16px}
    #srNotificationCenter .sr-notification-mark-all:hover{color:var(--nc-text)}
    #srNotificationCenter .sr-notification-mark-all:disabled{opacity:.4;cursor:default}
    #srNotificationCenter .sr-notification-list{
      min-height:0;overflow:auto;flex:1 1 auto;padding:2px 12px 14px;overscroll-behavior:contain;
      scrollbar-width:thin;scrollbar-color:#949aa53d transparent;scroll-padding:8px;
    }
    #srNotificationCenter .sr-notification-list::-webkit-scrollbar{width:6px}
    #srNotificationCenter .sr-notification-list::-webkit-scrollbar-thumb{background:#949aa53d;border-radius:6px}
    #srNotificationCenter .sr-notification-group{
      display:flex;align-items:center;gap:10px;padding:16px 9px 10px;
      color:var(--nc-muted);font-size:10px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;
    }
    #srNotificationCenter .sr-notification-group::after{content:"";height:1px;flex:1;background:var(--nc-border)}
    #srNotificationCenter .sr-notification-item{
      --nc-kind:#c1b8f2;--nc-tint:#c1b8f212;
      position:relative;display:grid;grid-template-columns:38px minmax(0,1fr);align-items:start;gap:12px;
      width:100%;padding:15px 13px;margin:0 0 7px;overflow:hidden;
      border:1px solid var(--nc-border);border-radius:16px;background:var(--nc-surface);color:var(--nc-text);
      text-align:left;cursor:pointer;transition:background .16s ease,border-color .16s ease;
    }
    #srNotificationCenter .sr-notification-item:hover{background:var(--nc-hover);border-color:#ffffff24}
    #srNotificationCenter .sr-notification-item.is-unread{border-color:#e8c99526;background:linear-gradient(110deg,#e8c99506,transparent 75%),var(--nc-surface)}
    #srNotificationCenter .sr-notification-item.is-unread::before{
      content:"";position:absolute;left:0;top:17px;bottom:17px;width:2px;border-radius:0 2px 2px 0;background:var(--nc-kind);
    }
    #srNotificationCenter .sr-notification-item[data-kind="broadcast"]{--nc-kind:#e8c995;--nc-tint:#e8c99512;cursor:default}
    #srNotificationCenter .sr-notification-item[data-category="sr_change"]{--nc-kind:#9fc6fa;--nc-tint:#9fc6fa12}
    #srNotificationCenter .sr-notification-item[data-category="tags_change"]{--nc-kind:#e8c995;--nc-tint:#e8c99512}
    #srNotificationCenter .sr-notification-item[data-kind^="support_"]{--nc-kind:#8fd7c0;--nc-tint:#8fd7c012}
    #srNotificationCenter .sr-notification-item[data-kind="mention"]{--nc-kind:#c5b1f4;--nc-tint:#c5b1f412}
    #srNotificationCenter .sr-notification-icon{
      display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;margin-top:1px;
      border:1px solid var(--nc-border);border-radius:12px;background:var(--nc-tint);color:var(--nc-kind);
    }
    #srNotificationCenter .sr-notification-icon svg{width:18px;height:18px}
    #srNotificationCenter .sr-notification-copy{min-width:0;display:flex;flex-direction:column;gap:7px}
    #srNotificationCenter .sr-notification-meta-top{display:flex;align-items:center;gap:7px;min-height:15px}
    #srNotificationCenter .sr-notification-category,#srNotificationCenter .sr-notification-admin-pill{
      display:inline-block;min-width:0;color:var(--nc-kind);font-size:9px;font-weight:700;letter-spacing:.75px;line-height:1.4;text-transform:uppercase;
    }
    #srNotificationCenter .sr-notification-meta-top time{
      margin-left:auto;flex:0 0 auto;color:var(--nc-muted);font-size:10px;line-height:1;font-variant-numeric:tabular-nums;
    }
    #srNotificationCenter .sr-notification-dot{width:5px;height:5px;flex:0 0 5px;border-radius:50%;background:var(--nc-kind)}
    #srNotificationCenter .sr-notification-item:not(.is-unread) .sr-notification-dot{visibility:hidden}
    #srNotificationCenter .sr-notification-title-row{display:block;min-width:0}
    #srNotificationCenter .sr-notification-copy b{
      display:block;min-width:0;color:var(--nc-text);font-size:13px;font-weight:600;line-height:1.5;
      white-space:normal;overflow-wrap:anywhere;word-break:break-word;text-align:start;
    }
    #srNotificationCenter .sr-notification-text{
      display:block;min-width:0;color:var(--nc-body);font-size:12px;font-weight:400;line-height:1.8;
      white-space:pre-wrap;overflow:visible;overflow-wrap:anywhere;word-break:break-word;text-align:start;
    }
    #srNotificationCenter .sr-notification-item[data-kind="broadcast"] .sr-notification-copy,
    #srNotificationCenter .sr-notification-item[data-kind="broadcast"] .sr-notification-copy *{-webkit-user-select:text;user-select:text}
    #srNotificationCenter .sr-notification-item[data-kind="broadcast"] .sr-notification-copy{cursor:text}
    #srNotificationCenter .sr-notification-copy ::selection{background:#e8c99545;color:var(--nc-text)}
    #srNotificationCenter .sr-notification-actor{
      display:inline-flex;align-items:center;gap:5px;align-self:flex-start;max-width:100%;padding-top:3px;
      color:var(--nc-muted);font-size:10px;line-height:1.5;overflow-wrap:anywhere;text-align:start;
    }
    #srNotificationCenter .sr-notification-actor svg{width:12px;height:12px;flex:0 0 12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    #srNotificationCenter .sr-notification-actor[data-role="full_admin"]{color:var(--nc-accent)}
    #srNotificationCenter .sr-notification-footer{
      flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:7px;min-height:43px;
      padding:11px 18px;border-top:1px solid var(--nc-border);background:#0001;color:var(--nc-muted);font-size:10px;text-align:center;
    }
    #srNotificationCenter .sr-notification-footer svg{width:13px;height:13px;color:var(--nc-accent)}
    #srNotificationCenter .sr-notification-feedback:empty{display:none}
    #srNotificationCenter .sr-notification-feedback{padding:10px 20px;color:var(--nc-accent);font-size:12px}
    #srNotificationCenter .sr-notification-state{min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 24px;text-align:center}
    #srNotificationCenter .sr-notification-state-symbol{
      display:grid;place-items:center;width:66px;height:66px;margin-bottom:5px;border:1px solid #e8c99530;border-radius:22px;
      background:radial-gradient(circle at 30% 0,#e8c99519,transparent),var(--nc-accent-soft);color:var(--nc-accent);box-shadow:0 0 0 8px #e8c99505;
    }
    #srNotificationCenter .sr-notification-state-symbol svg{width:29px;height:29px}
    #srNotificationCenter .sr-notification-state strong{font-size:17px;font-weight:600;color:var(--nc-text);letter-spacing:-.3px}
    #srNotificationCenter .sr-notification-state p{margin:0;max-width:260px;font-size:12px;line-height:1.7;color:var(--nc-muted)}
    #srNotificationCenter .sr-notification-retry{
      display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:8px 15px;margin-top:5px;
      border:1px solid #e8c99530;border-radius:10px;background:var(--nc-accent-soft);color:var(--nc-accent);font-size:12px;
    }
    #srNotificationCenter .sr-notification-skeleton{display:grid;grid-template-columns:38px 1fr;gap:12px;margin:14px 0 0;padding:16px 13px;border:1px solid var(--nc-border);border-radius:16px}
    #srNotificationCenter .sr-notification-skeleton i{display:block;height:10px;margin:4px 0 11px;border-radius:4px;background:var(--nc-hover)}
    #srNotificationCenter .sr-notification-skeleton > i{width:38px;height:38px;margin:0;border-radius:12px}
    #srNotificationCenter .sr-notification-skeleton span i:first-child{width:42%}
    #srNotificationCenter .sr-notification-skeleton span i:last-child{width:75%;margin-bottom:0}
    #srNotificationCenter .sr-notification-skeleton{animation:srNotificationLoading 1.2s ease-in-out 3 alternate}
    @keyframes srNotificationLoading{to{opacity:.4}}
    #srNotificationCenter .sr-notification-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .suggestion-item.sr-notification-target-flash,.sug-reply-item.sr-notification-target-flash{animation:srNotificationTargetFlash 1.45s ease both}
    @keyframes srNotificationTargetFlash{0%,100%{outline:0 solid #e8c99500}38%{outline:3px solid #e8c99555}}
    @media(max-width:520px){
      #srNotificationCenter{border-radius:24px;max-height:calc(100dvh - 28px);transform-origin:bottom center}
      #srNotificationCenter .sr-notification-handle{display:block;flex:0 0 4px;width:30px;height:4px;margin:10px auto 0;border-radius:4px;background:#9299a940}
      #srNotificationCenter .sr-notification-head{padding:16px 16px 18px}
      #srNotificationCenter .sr-notification-title{font-size:22px}
      #srNotificationCenter .sr-notification-toolbar{margin-inline:14px;gap:6px}
      #srNotificationCenter .sr-notification-list{padding-inline:9px}
      #srNotificationCenter .sr-notification-item{gap:10px;padding:14px 11px}
      #srNotificationCenter .sr-notification-close{width:38px;height:38px;flex-basis:38px}
      #srNotificationCenter .sr-notification-tab{min-height:38px;padding-inline:9px}
      #srNotificationCenter .sr-notification-mark-all{min-height:44px;font-size:10px}
      #srNotificationCenter .sr-notification-state{min-height:230px}
    }
    @media(prefers-reduced-motion:reduce){
      #srNotificationCenter,#srNotificationCenter *,.floating-actions .sr-notifications-fab,.floating-actions .sr-notifications-fab svg{animation:none!important;transition:none!important}
      .suggestion-item.sr-notification-target-flash,.sug-reply-item.sr-notification-target-flash{animation:none!important;outline:2px solid #e8c99555}
    }
  `;
  document.head.appendChild(style);
}

function currentUnreadCount(){
  try{
    const value = Number(window.__srSuggestionNotificationCenterBridge?.getUnreadCount?.());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }catch{
    return 0;
  }
}

function publishSuggestionUnreadSummary(){
  const count = Math.max(0, Number(targetedUnread || 0));
  const suggestionBadge = document.getElementById("badgeSuggestions");
  if(suggestionBadge){
    if(count > 0){
      suggestionBadge.textContent = count > 99 ? "99+" : String(count);
      suggestionBadge.classList.add("is-on");
    }else{
      suggestionBadge.textContent = "";
      suggestionBadge.classList.remove("is-on");
    }
  }
  try{
    window.dispatchEvent(new CustomEvent("sr:suggestion-unread-summary", {
      detail:{ count }
    }));
  }catch{}
}

function refreshCombinedBadge(){
  setBellBadge(
    Math.max(0, Number(targetedUnread || 0)) +
    Math.max(0, Number(broadcastUnread || 0)) +
    Math.max(0, Number(supportUnread || 0)) +
    (releaseNotice && !releaseNotice.read ? 1 : 0)
  );
  publishSuggestionUnreadSummary();
}

function publishNotificationSnapshot(data = {}, mode = "list"){
  lastSnapshotAt = Date.now();
  try{
    window.dispatchEvent(new CustomEvent("sr:notification-center-state", {
      detail:{
        available:data?.available === true,
        items:Array.isArray(items) ? items.slice() : [],
        targeted_unread_count:Math.max(0, Number(targetedUnread || 0)),
        broadcast_unread_count:Math.max(0, Number(broadcastUnread || 0)),
        support_unread_count:Math.max(0, Number(supportUnread || 0)),
        announcement:latestAnnouncement,
        mentions_available:data?.mentions_available !== false,
        broadcasts_available:data?.broadcasts_available !== false,
        support_available:data?.support_available !== false,
        loaded_at:lastSnapshotAt,
        mode:String(mode || "list"),
      }
    }));
  }catch{}
}

async function syncExtraUnread(options = {}){
  const force = options?.force === true;
  const now = Date.now();

  if(extraCountPromise) return extraCountPromise;
  if(!force && document.visibilityState === "hidden") return null;
  if(!force && lastExtraCountAt && now - lastExtraCountAt < EXTRA_COUNT_MIN_INTERVAL_MS) return null;

  lastExtraCountAt = now;
  const generation = snapshotGeneration;
  extraCountPromise = (async () => {
    try{
      const data = await postCenter({ action:"counts", fresh:force && lastSnapshotAt > 0, release_revision:currentReleaseRevision() });
      if(generation !== snapshotGeneration) return null;
      if(data?.available === true){
        dismissArchivedRelease(data);
        targetedUnread = Math.max(0, Number(data?.suggestion_unread_count || 0));
        broadcastUnread = Math.max(0, Number(data?.broadcast_unread_count || 0));
        supportUnread = Math.max(0, Number(data?.support_unread_count || 0));
        latestAnnouncement = data?.announcement && typeof data.announcement === "object"
          ? data.announcement
          : null;
        refreshCombinedBadge();
        writeStartupSnapshot(data);
        publishNotificationSnapshot(data, "counts");
      }
      if(data?.available !== true) lastExtraCountAt = 0;
      return data;
    }catch{
      lastExtraCountAt = 0;
      return null;
    }finally{
      extraCountPromise = null;
      if(reconnectSnapshotQueued){
        reconnectSnapshotQueued = false;
        syncExtraUnread({force:true}).catch(()=>{});
      }
    }
  })();

  return extraCountPromise;
}

function setBellBadge(count){
  const n = Math.max(0, Number(count || 0));
  if(!badge) return;
  bell?.classList.toggle("has-unread", n > 0);
  if(n > 0){
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.classList.add("is-on");
    bell?.setAttribute("aria-label", `Notifications, ${n} unread`);
  }else{
    badge.textContent = "";
    badge.classList.remove("is-on");
    bell?.setAttribute("aria-label", "Notifications");
  }
}

function ensureBell(){
  if(bell) return bell;
  const suggestionsFab = document.getElementById("suggestionsFab");
  const host = suggestionsFab?.parentElement || document.querySelector(".floating-actions");
  if(!host) return null;

  bell = document.createElement("button");
  bell.id = "srNotificationsFab";
  bell.className = "sr-notifications-fab";
  bell.type = "button";
  bell.title = "Notifications";
  bell.setAttribute("aria-label", "Notifications");
  bell.setAttribute("aria-haspopup", "dialog");
  bell.setAttribute("aria-controls", "srNotificationCenter");
  bell.setAttribute("aria-expanded", "false");
  bell.innerHTML = bellIcon() + '<span id="srNotificationsBadge" class="sr-notifications-badge" aria-hidden="true"></span>';
  suggestionsFab?.insertAdjacentElement("afterend", bell) || host.appendChild(bell);
  badge = document.getElementById("srNotificationsBadge");
  targetedUnread = currentUnreadCount();
  refreshCombinedBadge();
  return bell;
}

function bellIcon(){
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 6-2 6-2 8h16c0-2-2-2-2-8Z"></path><path d="M10 20a2 2 0 0 0 4 0M12 2V1"></path></svg>';
}

function checkIcon(){
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 12 4 4L17 6M12 16l9-10"></path></svg>';
}

function ensurePanel(){
  if(panel) return panel;
  panel = document.createElement("div");
  panel.id = "srNotificationCenter";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "srNotificationTitle");
  panel.setAttribute("aria-describedby", "srNotificationSubtitle");
  panel.innerHTML = `
    <div class="sr-notification-handle" aria-hidden="true"></div>
    <div class="sr-notification-head">
      <div class="sr-notification-heading">
        <span class="sr-notification-head-icon" aria-hidden="true">${bellIcon()}</span>
        <span class="sr-notification-heading-copy">
          <span class="sr-notification-eyebrow">YOUR ACTIVITY</span>
          <span class="sr-notification-title" id="srNotificationTitle">Notifications</span>
          <span class="sr-notification-subtitle" id="srNotificationSubtitle">Replies, mentions and team updates</span>
        </span>
      </div>
      <button class="sr-notification-close" type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"></path></svg></button>
    </div>
    <div class="sr-notification-toolbar">
      <div class="sr-notification-tabs" role="group" aria-label="Filter notifications">
        <button class="sr-notification-tab" type="button" data-notification-filter="all" aria-pressed="true" aria-controls="srNotificationList">All activity</button>
        <button class="sr-notification-tab" type="button" data-notification-filter="unread" aria-pressed="false" aria-controls="srNotificationList">Unread <span class="sr-notification-unread-count">0</span></button>
      </div>
      <button class="sr-notification-mark-all" type="button" disabled>${checkIcon()}<span>Mark all read</span></button>
    </div>
    <div class="sr-notification-list" id="srNotificationList" tabindex="0" role="region" aria-label="Notification activity"></div>
    <div class="sr-notification-feedback" role="status" aria-live="polite"></div>
    <div class="sr-notification-footer">${checkIcon()}<span>Your updates, all in one place</span></div>
  `;
  document.body.appendChild(panel);
  list = $(".sr-notification-list", panel);
  markAllButton = $(".sr-notification-mark-all", panel);

  $(".sr-notification-close", panel)?.addEventListener("click", () => closePanel({ returnFocus:true }));
  markAllButton?.addEventListener("click", () => markAllRead().catch(()=>{}));
  panel.querySelectorAll("[data-notification-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.notificationFilter === "unread" ? "unread" : "all";
      // Keep the opening set in view after automatic reads, so cards never
      // disappear under the pointer or reveal and auto-read unseen rows.
      unreadViewKeys = new Set(items.filter((item) => !item?.read).map((item) => String(item?.key || "")));
      render();
      if(list) list.scrollTop = 0;
    });
  });
  list?.addEventListener("click", (event) => {
    if(event.target?.closest?.(".sr-notification-retry")){
      loadCenter().catch(()=>{});
      return;
    }
    const card = event.target?.closest?.("[data-notification-key]");
    if(!card) return;

    // Admin broadcasts are reading/selecting surfaces. Clicking their text must
    // never steal selection or turn a drag-to-copy gesture into card activation.
    if(card.dataset.kind === "broadcast" && event.target?.closest?.(".sr-notification-copy")) return;

    const selection = window.getSelection?.();
    if(selection && !selection.isCollapsed && String(selection).trim()) return;

    const item = items.find((row) => String(row?.key || "") === String(card.dataset.notificationKey || ""));
    if(item) openItem(item).catch(()=>{});
  });

  list?.addEventListener("keydown", (event) => {
    if(event.target?.closest?.("button")) return;
    if(event.key !== "Enter" && event.key !== " ") return;
    const card = event.target?.closest?.("[data-notification-key]");
    if(!card) return;
    event.preventDefault();
    const item = items.find((row) => String(row?.key || "") === String(card.dataset.notificationKey || ""));
    if(item) openItem(item).catch(()=>{});
  });

  list?.addEventListener("scroll", () => scheduleVisibleRead(520), { passive:true });

  return panel;
}

function positionPanel(){
  if(!panel || panel.hidden || !bell) return;
  const rect = bell.getBoundingClientRect();
  const mobile = window.innerWidth <= 520;
  const margin = mobile ? 8 : 12;
  const width = Math.min(448, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width));

  panel.style.width = width + "px";
  panel.style.left = (mobile ? margin : left) + "px";
  panel.style.maxHeight = mobile
    ? "min(82dvh, calc(100dvh - 24px - env(safe-area-inset-bottom, 0px)))"
    : Math.min(672, window.innerHeight - margin * 2) + "px";
  if(mobile){
    panel.style.top = "auto";
    panel.style.bottom = "calc(8px + env(safe-area-inset-bottom, 0px))";
    return;
  }
  panel.style.bottom = "auto";
  const panelHeight = panel.offsetHeight;
  const above = rect.top - panelHeight - 12;
  const top = above >= margin ? above : Math.max(margin, Math.min(window.innerHeight - panelHeight - margin, rect.bottom + 12));
  panel.style.top = top + "px";
}

function titleFor(item){
  if(item?.kind === "broadcast" || item?.kind === "release") return String(item?.title || "Admin notification");
  const name = String(item?.sender_name || "Someone");
  if(item?.kind === "support_reply") return `${name} replied to you in Support`;
  if(item?.kind === "support_mention") return `${name} mentioned you in Support`;
  if(item?.kind === "support_message") return `${name} sent you a private message`;
  if(item?.kind === "mention") return `${name} mentioned you`;
  if(item?.target === "comment") return `${name} replied to your comment`;
  return `${name} replied to your suggestion`;
}

function notificationIconFor(item){
  const kind = String(item?.kind || "");
  if(kind === "broadcast" && (String(item?.category || "") === "sr_change" || String(item?.category || "") === "tags_change")){
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10"></path><path d="M7 8h10"></path><path d="M7 12h6"></path><path d="M5 18h14"></path><path d="M9 15l-3 3 3 3"></path><path d="M15 15l3 3-3 3"></path></svg>';
  }
  if(kind === "broadcast"){
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2"></path><path d="M6 9v6"></path><path d="M9 8l9-4v16l-9-4z"></path><path d="M9 16l1.4 4H7.7L6 15"></path></svg>';
  }
  if(kind === "support_message" || kind === "support_reply" || kind === "support_mention"){
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"></path><path d="M8 10h8M8 13h5"></path></svg>';
  }
  if(kind === "mention"){
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7l-5 5 5 5"></path><path d="M4 12h10a6 6 0 0 1 6 6"></path></svg>';
}

function notificationGroupFor(item){
  const date = new Date(item?.created_at || "");
  if(!Number.isFinite(date.getTime())) return "Earlier";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if(date.toDateString() === today.toDateString()) return "Today";
  if(date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return "Earlier";
}

function categoryFor(item){
  if(item?.kind === "release") return "Tool Update";
  if(item?.kind === "broadcast") return item?.category === "sr_change" ? "SR Update" : item?.category === "tags_change" ? "Tags Update" : "Announcement";
  if(item?.kind === "support_message") return "Private message";
  if(item?.kind === "support_reply") return "Support reply";
  if(item?.kind === "support_mention") return "Support mention";
  return item?.kind === "mention" ? "Mention" : "Suggestion reply";
}

function stateMarkup(kind){
  const error = kind === "error";
  const unread = kind === "unread";
  return `<div class="sr-notification-state" role="status">
    <span class="sr-notification-state-symbol" aria-hidden="true">${unread ? checkIcon() : bellIcon()}</span>
    <strong>${error ? "Couldn't load notifications" : unread ? "You're all caught up" : "Nothing here just yet"}</strong>
    <p>${error ? "We couldn't load your notifications. Please try again." : unread ? "You've seen all your latest updates. You're good to go." : "Replies, mentions and team updates will appear here."}</p>
    ${error ? '<button type="button" class="sr-notification-retry">Try again <span aria-hidden="true">↻</span></button>' : ""}
  </div>`;
}

function render(){
  if(!list) return;
  // All notification sources share one descending timestamp order, including
  // Tool Update and realtime broadcasts.
  items = mergeNotificationsByTime(items);
  const unread = items.filter((item) => !item?.read).length;
  const count = $(".sr-notification-unread-count", panel);
  if(count) count.textContent = unread > 99 ? "99+" : String(unread);
  if(markAllButton) markAllButton.disabled = loading || markAllInFlight || unread < 1;
  panel?.querySelectorAll("[data-notification-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.notificationFilter === activeFilter));
  });
  const footer = $(".sr-notification-footer span", panel);
  if(footer) footer.textContent = activeFilter === "unread"
    ? "Read updates stay here until you switch views"
    : "Your updates, all in one place";
  list.setAttribute("aria-busy", String(loading));
  if(loading){
    list.innerHTML = '<span class="sr-notification-sr-only" role="status">Loading notifications…</span>' +
      Array.from({ length:3 }, () => '<div class="sr-notification-skeleton" aria-hidden="true"><i></i><span><i></i><i></i><i></i></span></div>').join("");
    requestAnimationFrame(positionPanel);
    return;
  }
  if(loadError){
    list.innerHTML = stateMarkup("error");
    requestAnimationFrame(positionPanel);
    return;
  }

  const scrollTop = list.scrollTop;
  const focusedKey = list.contains(document.activeElement)
    ? document.activeElement?.closest?.("[data-notification-key]")?.dataset.notificationKey
    : null;
  const focusedInList = list.contains(document.activeElement) && document.activeElement !== list;
  const visibleItems = activeFilter === "unread"
    ? items.filter((item) => !item?.read || unreadViewKeys.has(String(item?.key || "")))
    : items;
  // New targeted pushes join the unread view without changing existing rows.
  if(activeFilter === "unread") visibleItems.forEach((item) => unreadViewKeys.add(String(item?.key || "")));
  let previousGroup = "";
  list.innerHTML = visibleItems.length ? visibleItems.map((item) => {
    const unread = !item?.read;
    const icon = notificationIconFor(item);
    const group = notificationGroupFor(item);
    const groupMarkup = group !== previousGroup
      ? `<div class="sr-notification-group" role="heading" aria-level="3">${group}</div>`
      : "";
    previousGroup = group;
    const categoryClass = item?.kind === "broadcast" || item?.kind === "release"
      ? "sr-notification-admin-pill" : "sr-notification-category";
    const actorName = String(item?.actor_name || "").trim();
    const actorRole = ["full_admin","sr_admin"].includes(String(item?.actor_role || "").trim())
      ? String(item.actor_role).trim()
      : "";
    const actorLine = (String(item?.category || "") === "sr_change" || String(item?.category || "") === "tags_change") && actorName
      ? '<span class="sr-notification-actor" dir="auto" data-role="' + escapeHtml(actorRole) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path><path d="M4 21a8 8 0 0 1 16 0"></path></svg>' +
        '<span>عدّله: ' + escapeHtml(actorName) + '</span></span>'
      : "";
    return `${groupMarkup}
      <div
        role="${item?.kind === "broadcast" ? "article" : "button"}"
        tabindex="0"
        class="sr-notification-item${unread ? " is-unread" : ""}"
        data-kind="${escapeHtml(item?.kind || "reply")}"
        data-category="${escapeHtml(item?.category || "")}"
        data-notification-key="${escapeHtml(item?.key || "")}">
        <span class="sr-notification-icon" aria-hidden="true">${icon}</span>
        <span class="sr-notification-copy">
          <span class="sr-notification-meta-top">
            <span class="${categoryClass}">${categoryFor(item)}</span>
            <time datetime="${escapeHtml(item?.created_at || "")}" title="${escapeHtml(when(item?.created_at))}">${escapeHtml(whenCompact(item?.created_at))}</time>
            <span class="sr-notification-dot" aria-hidden="true"></span>
            ${unread ? '<span class="sr-notification-sr-only">Unread</span>' : ""}
          </span>
          <span class="sr-notification-title-row"><b dir="auto">${escapeHtml(titleFor(item))}</b></span>
          <span class="sr-notification-text" dir="auto">${escapeHtml(item?.text || "Open the related conversation.")}</span>
          ${actorLine}
        </span>
      </div>
    `;
  }).join("") : stateMarkup(activeFilter === "unread" ? "unread" : "empty");

  list.scrollTop = scrollTop;
  if(focusedKey){
    const target = Array.from(list.querySelectorAll("[data-notification-key]")).find((card) => card.dataset.notificationKey === focusedKey);
    (target || list).focus({ preventScroll:true });
  }else if(focusedInList){
    list.focus({ preventScroll:true });
  }
  requestAnimationFrame(() => {
    positionPanel();
    scheduleVisibleRead(720);
  });
}

async function loadCenter(options = {}){
  if(refreshInFlight) return refreshInFlight;
  const silent = options?.silent === true;
  loadError = false;
  loading = !silent;
  if(!silent) render();
  const generation = snapshotGeneration;

  refreshInFlight = (async () => {
    const data = await postCenter({ action:"list", limit:CENTER_LIMIT, release_revision:currentReleaseRevision() });
    if(generation !== snapshotGeneration) return null;
    if(data?.available !== true){
      throw new Error("Notifications are temporarily unavailable.");
    }

    dismissArchivedRelease(data);
    items = mergeNotificationsByTime(Array.isArray(data?.items) ? data.items : []);
    targetedUnread = items.filter((item) =>
      !item?.read && (item?.kind === "reply" || item?.kind === "mention")
    ).length;
    broadcastUnread = Math.max(
      0,
      Number(data?.broadcast_unread_count ?? items.filter((item) => item?.kind === "broadcast" && !item?.read).length)
    );
    supportUnread = Math.max(
      0,
      Number(data?.support_unread_count ?? items.filter((item) =>
        (item?.kind === "support_message" || item?.kind === "support_reply" || item?.kind === "support_mention") && !item?.read
      ).length)
    );
    refreshCombinedBadge();
    publishNotificationSnapshot(data, "list");
    return data;
  })();

  try{
    return await refreshInFlight;
  }catch(error){
    console.warn("notification center unavailable", error);
    loadError = true;
    return null;
  }finally{
    loading = false;
    refreshInFlight = null;
    if(!silent) render();
  }
}

function openPanel(){
  ensurePanel();
  if(!panel || !bell) return;
  const openToken = ++notificationPanelOpenToken;
  activeFilter = "all";
  unreadViewKeys.clear();
  const feedback = $(".sr-notification-feedback", panel);
  if(feedback) feedback.textContent = "";
  panel.hidden = false;
  bell.setAttribute("aria-expanded", "true");
  positionPanel();
  // Opening the bell acknowledges its notifications without requiring any row
  // click or viewport/dwell threshold. Persist through the existing per-user
  // read_all API only after a successful list load, and never after a close.
  loadCenter().then((data) => {
    if(data?.available !== true || !panel || panel.hidden || openToken !== notificationPanelOpenToken) return;
    markAllRead({ automatic:true }).catch(()=>{});
  }).catch(()=>{});
  $("[data-notification-filter=all]", panel)?.focus({ preventScroll:true });
}

function closePanel(options = {}){
  if(!panel || !bell) return;
  ++notificationPanelOpenToken;
  panel.hidden = true;
  bell.setAttribute("aria-expanded", "false");
  if(options?.returnFocus === true) bell.focus({ preventScroll:true });
  if(visibleReadTimer){
    clearTimeout(visibleReadTimer);
    visibleReadTimer = 0;
  }
}

function togglePanel(){
  if(!panel || panel.hidden) openPanel();
  else closePanel();
}

async function syncUnread(){
  try{
    await Promise.allSettled([
      window.__srSuggestionNotificationCenterBridge?.refreshUnread?.(),
      window.__srSupportNotificationBridge?.refreshUnread?.(),
    ]);
  }catch{}
  targetedUnread = currentUnreadCount();
  refreshCombinedBadge();
}

function visibleUnreadItems(){
  if(!panel || panel.hidden || !list) return [];
  const viewport = list.getBoundingClientRect();
  if(viewport.width <= 0 || viewport.height <= 0) return [];

  const out = [];
  list.querySelectorAll(".sr-notification-item.is-unread[data-notification-key]").forEach((el) => {
    const rect = el.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, viewport.top);
    const visibleBottom = Math.min(rect.bottom, viewport.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const ratio = rect.height > 0 ? visibleHeight / rect.height : 0;
    const enoughPixels = visibleHeight >= Math.min(140, Math.max(70, rect.height * 0.60));
    if(ratio < 0.60 && !enoughPixels) return;

    const key = String(el.dataset.notificationKey || "");
    const item = items.find((row) => !row?.read && String(row?.key || "") === key);
    if(item) out.push(item);
  });
  return out;
}

function scheduleVisibleRead(delay = 650){
  if(!panel || panel.hidden || !list) return;
  if(visibleReadTimer) clearTimeout(visibleReadTimer);
  visibleReadTimer = setTimeout(() => {
    visibleReadTimer = 0;
    markVisibleRead().catch(()=>{});
  }, Math.max(250, Number(delay) || 650));
}

async function markVisibleRead(){
  if(markAllInFlight || visibleReadInFlight || !panel || panel.hidden) return;
  const visible = visibleUnreadItems();
  if(!visible.length) return;

  const replyIds = visible
    .filter((item) => item?.kind === "reply")
    .map((item) => Number(item?.reply_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const mentionIds = visible
    .filter((item) => item?.kind === "mention")
    .map((item) => Number(item?.mention_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const tagsEventIds = visible
    .filter((item) => item?.kind === "broadcast" && item?.tags_event_id)
    .map((item) => Number(item?.tags_event_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const broadcastIds = visible
    .filter((item) => item?.kind === "broadcast" && !item?.tags_event_id)
    .map((item) => Number(item?.broadcast_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  const supportMessageIds = visible
    .filter((item) => item?.kind === "support_message" || item?.kind === "support_reply" || item?.kind === "support_mention")
    .map((item) => Number(item?.support_message_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  if(!replyIds.length && !mentionIds.length && !broadcastIds.length && !tagsEventIds.length && !supportMessageIds.length) return;

  visibleReadInFlight = true;
  try{
    const data = await postCenter({
      action:"read",
      reply_ids:replyIds,
      mention_ids:mentionIds,
      broadcast_ids:broadcastIds,
      tags_event_ids:tagsEventIds,
      support_message_ids:supportMessageIds,
    });
    if(data?.available !== true) return;

    const markedReplies = new Set((Array.isArray(data.reply_ids) ? data.reply_ids : []).map(Number));
    const markedMentions = new Set((Array.isArray(data.mention_ids) ? data.mention_ids : []).map(Number));
    const markedBroadcasts = new Set((Array.isArray(data.broadcast_ids) ? data.broadcast_ids : []).map(Number));
    const markedTags = new Set((Array.isArray(data.tags_event_ids) ? data.tags_event_ids : []).map(Number));
    const markedSupport = new Set((Array.isArray(data.support_message_ids) ? data.support_message_ids : []).map(Number));

    for(const item of visible){
      const readNow =
        (item?.kind === "reply" && markedReplies.has(Number(item.reply_id))) ||
        (item?.kind === "mention" && markedMentions.has(Number(item.mention_id))) ||
        (item?.kind === "broadcast" && item?.tags_event_id && markedTags.has(Number(item.tags_event_id))) ||
        (item?.kind === "broadcast" && !item?.tags_event_id && markedBroadcasts.has(Number(item.broadcast_id))) ||
        ((item?.kind === "support_message" || item?.kind === "support_reply" || item?.kind === "support_mention") && markedSupport.has(Number(item.support_message_id)));

      if(!readNow) continue;
      item.read = true;
    }

    if(markedBroadcasts.size || markedTags.size){
      broadcastUnread = Math.max(0, broadcastUnread - markedBroadcasts.size - markedTags.size);
    }
    if(markedSupport.size){
      supportUnread = Math.max(0, supportUnread - markedSupport.size);
    }

    render();
    await syncUnread();
  }catch(error){
    console.warn("could not auto-mark visible notifications read", error);
  }finally{
    visibleReadInFlight = false;
    if(panel && !panel.hidden) scheduleVisibleRead(720);
  }
}

async function markSingle(item){
  if(!item || item.read) return;
  if(item.kind === "release"){
    markReleaseRead();
    render();
    return;
  }
  const body = {
    action:"read",
    reply_ids:item.kind === "reply" && item.reply_id ? [item.reply_id] : [],
    mention_ids:item.kind === "mention" && item.mention_id ? [item.mention_id] : [],
    broadcast_ids:item.kind === "broadcast" && item.broadcast_id ? [item.broadcast_id] : [],
    tags_event_ids:item.kind === "broadcast" && item.tags_event_id ? [item.tags_event_id] : [],
    support_message_ids:(item.kind === "support_message" || item.kind === "support_reply" || item.kind === "support_mention") && item.support_message_id ? [item.support_message_id] : [],
  };
  const data = await postCenter(body);
  if(data?.available !== true) return;
  item.read = true;
  if(item.kind === "broadcast") broadcastUnread = Math.max(0, broadcastUnread - 1);
  if(item.kind === "support_message" || item.kind === "support_reply" || item.kind === "support_mention") supportUnread = Math.max(0, supportUnread - 1);
  render();
  await syncUnread();
}

async function markAllRead({ automatic = false } = {}){
  if(markAllInFlight || !items.some((item) => !item?.read)) return;
  if(!items.some(item => !item?.read && item?.kind !== "release")){
    markReleaseRead();
    render();
    return;
  }
  markAllInFlight = true;
  const feedback = $(".sr-notification-feedback", panel);
  if(feedback) feedback.textContent = "";
  if(markAllButton) markAllButton.disabled = true;
  try{
    const data = await postCenter({ action:"read_all" });
    if(data?.available !== true) throw new Error("Read state unavailable.");
    items.forEach((item) => { if(item.kind !== "release") item.read = true; });
    markReleaseRead();
    unreadViewKeys.clear();
    broadcastUnread = 0;
    supportUnread = 0;
    render();
    await syncUnread();
    if(feedback && !automatic) feedback.textContent = "All notifications marked as read.";
  }catch{
    if(feedback) feedback.textContent = "Couldn't mark notifications as read. Please try again.";
  }finally{
    markAllInFlight = false;
    if(markAllButton) markAllButton.disabled = !items.some((item) => !item?.read);
  }
}

async function openItem(item){
  try{ await markSingle(item); }catch{}
  if(item?.kind === "broadcast" || item?.kind === "release"){
    render();
    return;
  }

  closePanel();

  if(item?.kind === "support_message" || item?.kind === "support_reply" || item?.kind === "support_mention"){
    try{
      if(window.__srSupportNotificationBridge?.openTarget){
        await window.__srSupportNotificationBridge.openTarget(item);
      }else{
        await window.__srArchitectureV11?.features?.openSupportTarget?.(item);
      }
    }catch(error){
      console.warn("could not open Support notification target", error);
    }
    return;
  }

  try{
    if(window.__srSuggestionNotificationCenterBridge?.openTarget){
      await window.__srSuggestionNotificationCenterBridge.openTarget(item);
    }else{
      await window.__srArchitectureV11?.features?.openSuggestionTarget?.(item);
    }
  }catch{}
}

function onUnreadState(event){
  const n = Number(event?.detail?.count);
  targetedUnread = Number.isFinite(n) ? Math.max(0, n) : currentUnreadCount();
  refreshCombinedBadge();
}

function onAdminBroadcast(event){
  let incoming=null;
  try{incoming=JSON.parse(String(event?.detail?.text||""));}catch{}
  if(incoming?.category==="tool_release_control"){
    if(String(incoming?.revision||"")===currentReleaseRevision()){
      dismissArchivedRelease({release_removed:true});
      if(panel && !panel.hidden)render();
    }
    return;
  }
  const id = Number(event?.detail?.id);
  const action = String(event?.detail?.action || "upsert").toLowerCase();

  if(action === "delete" && Number.isSafeInteger(id) && id > 0){
    const removed = items.find((item) => item?.kind === "broadcast" && Number(item?.broadcast_id) === id);
    items = items.filter((item) => !(item?.kind === "broadcast" && Number(item?.broadcast_id) === id));
    seenBroadcastEvents.delete(id);
    if(removed && !removed.read) broadcastUnread = Math.max(0, broadcastUnread - 1);
    refreshCombinedBadge();
    if(panel && !panel.hidden) render();
    return;
  }

  if(Number.isSafeInteger(id) && id > 0 && !seenBroadcastEvents.has(id)){
    seenBroadcastEvents.add(id);
    broadcastUnread += 1;
    refreshCombinedBadge();
    // Reuse the existing Supabase announcement Realtime row: no polling, no
    // additional Worker reads, and the open bell displays a new SR update now.
    if(panel && !panel.hidden && typeof event?.detail?.text === "string"){
      const raw = String(event.detail.text || "");
      let payload;
      try{ payload = JSON.parse(raw); }catch{ payload = null; }
      const title = payload && typeof payload === "object"
        ? String(payload.title || "Admin notification") : "Admin notification";
      const message = payload && typeof payload === "object"
        ? String(payload.message || payload.body || "") : raw;
      const item = {
        key:"broadcast:" + id, kind:"broadcast", broadcast_id:id,
        sender_user_id:"admin",
        sender_name:String(payload?.category || "") === "sr_change" ? "SR System" : "Admin",
        title:title.slice(0, 80), text:message.slice(0, 1200),
        category:String(payload?.category || "").slice(0, 40),
        actor_name:String(payload?.actor_name || "").slice(0, 80),
        actor_role:["sr_admin","full_admin"].includes(String(payload?.actor_role || ""))
          ? String(payload.actor_role) : "",
        created_at:event.detail.created_at || new Date().toISOString(),
        read:false, target:"notification",
      };
      items = [item, ...items.filter(row => String(row?.key || "") !== item.key)]
        .slice(0, CENTER_LIMIT);
      render();
      scheduleVisibleRead();
    }
  }
}

function onTagsNotification(event){
  const detail=event?.detail||{},id=Number(detail?.id),key="tags:"+id;
  if(!Number.isSafeInteger(id)||id<=0||seenBroadcastEvents.has(key)) return;
  seenBroadcastEvents.add(key);broadcastUnread+=1;refreshCombinedBadge();
  if(panel && !panel.hidden){
    const pushed={key,kind:"broadcast",broadcast_id:null,tags_event_id:id,sender_user_id:String(detail?.actor_user_id||""),sender_name:String(detail?.actor_name||"User"),title:String(detail?.title||"Tags Update"),text:String(detail?.summary||""),category:"tags_change",change_count:1,actor_name:String(detail?.actor_name||""),actor_role:"user",created_at:detail?.created_at||new Date().toISOString(),read:false,target:"notification"};
    items=[pushed,...items.filter((item)=>String(item?.key||"")!==key)].slice(0,CENTER_LIMIT);render();scheduleVisibleRead();
  }
}

function onSupportUnreadState(event){
  const n = Number(event?.detail?.count);
  supportUnread = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : supportUnread;
  refreshCombinedBadge();
}

function supportNotificationItemFromPush(detail, notificationKind, messageId){
  const row = detail?.row && typeof detail.row === "object" ? detail.row : {};
  const id = Number(messageId || row?.id);
  if(!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    key:"support:" + id,
    kind:notificationKind,
    support_message_id:id,
    support_room_type:String(row?.room_type || "public"),
    support_room_id:String(row?.room_id || "public"),
    support_other_user_id:String(row?.sender_id || row?.user_id || ""),
    sender_user_id:String(row?.sender_id || row?.user_id || ""),
    sender_name:String(row?.sender_name || "User").trim().slice(0, 60) || "User",
    text:String(row?.message || ""),
    created_at:row?.created_at || new Date().toISOString(),
    reply_to_message_id:Number(row?.reply_to_message_id) || null,
    target:"support",
    read:false,
    read_at:null,
  };
}

function onSupportRealtimeInvalidated(event){
  const detail = event?.detail || {};
  const group = String(detail?.group || "");
  if(group !== "support" && group !== "all") return;

  const notificationKind = String(detail?.notification_kind || "");
  if(detail?.targeted === true && (
    notificationKind === "support_message" ||
    notificationKind === "support_reply" ||
    notificationKind === "support_mention"
  )){
    const id = Number(detail?.row?.id || detail?.message_id);
    if(Number.isSafeInteger(id) && id > 0 && !seenSupportPushIds.has(id)){
      seenSupportPushIds.add(id);
      supportUnread += 1;
      refreshCombinedBadge();

      const pushed = supportNotificationItemFromPush(detail, notificationKind, id);
      if(pushed && panel && !panel.hidden){
        const key = String(pushed.key || "");
        items = [pushed, ...items.filter((item) => String(item?.key || "") !== key)].slice(0, CENTER_LIMIT);
        render();
      }
    }
  }

  // Closed panel stays zero-polling. If it is already open, the rich targeted
  // Realtime payload is enough to render the new Support notification locally.
}

function onSuggestionRealtimeInvalidated(event){
  const detail = event?.detail || {};
  if(String(detail?.group || "") !== "suggestions" || detail?.targeted !== true) return;
  const kind = String(detail?.notification_kind || "");
  if(kind !== "suggestion_reply" && kind !== "suggestion_mention") return;
  targetedUnread += 1;
  refreshCombinedBadge();
}



export function installSuggestionNotificationCenter(){
  if(installed) return;
  installed = true;
  ensureStyles();
  ensureBell();
  ensurePanel();

  bell?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });

  window.addEventListener("sr:suggestion-unread-state", onUnreadState);
  window.addEventListener("sr:admin-notification-broadcast", onAdminBroadcast);
  window.addEventListener("sr:tags-notification", onTagsNotification);
  window.addEventListener("sr:support-notification-state", onSupportUnreadState);
  window.addEventListener("sr:realtime-invalidated", onSupportRealtimeInvalidated);
  window.addEventListener("sr:realtime-invalidated", onSuggestionRealtimeInvalidated);
  window.addEventListener("sr:runtime-cache-invalidated", () => { snapshotGeneration += 1; });
  window.addEventListener("sr:realtime-invalidated", event => {
    if(event.detail?.source !== "reconnect") return;
    if(extraCountPromise) reconnectSnapshotQueued = true;
    else syncExtraUnread({force:true}).catch(()=>{});
    if(panel && !panel.hidden) loadCenter({silent:true}).catch(()=>{});
  });
  window.addEventListener("resize", positionPanel);
  window.addEventListener("scroll", positionPanel, true);

  document.addEventListener("mousedown", (event) => {
    if(!panel || panel.hidden) return;
    if(panel.contains(event.target) || bell?.contains(event.target)) return;
    closePanel();
  }, true);

  document.addEventListener("keydown", (event) => {
    if(event.key === "Escape" && panel && !panel.hidden){
      event.preventDefault();
      closePanel({ returnFocus:true });
    }
  });

  releaseNotice = readReleaseNotice();
  if(releaseNotice) items = mergeNotificationsByTime([]);
  targetedUnread = currentUnreadCount();
  refreshCombinedBadge();

  window.__srNotificationCenterBridge = Object.freeze({
    prime:() => syncExtraUnread({ force:false }),
    refresh:() => syncExtraUnread({ force:true }),
    getSnapshot:() => ({
      items:items.slice(),
      targeted_unread_count:targetedUnread,
      broadcast_unread_count:broadcastUnread,
      support_unread_count:supportUnread,
      announcement:latestAnnouncement,
      loaded_at:lastSnapshotAt,
    }),
  });

  // Reuse a bounded per-user session snapshot across reloads. Realtime owns freshness
  // after startup; if the cache is absent/expired, hydrate counts once from the Worker.
  const cachedStartup = readStartupSnapshot();
  if(!applyStartupSnapshot(cachedStartup)){
    syncExtraUnread({ force:false }).catch(()=>{});
  }else if(window.__srRealtimeEventBridgeState?.stats?.realtimeStatus === "subscribed"){
    window.__srNotificationStartupWasCached = false;
    syncExtraUnread({ force:true }).catch(()=>{});
  }
}

const API = "/api/presence-last-seen";
const HYDRATE_MAX_AGE_MS = 5 * 60 * 1000;
const TOUCH_DEDUPE_MS = 10 * 1000;

let inFlightTouch = null;
let inFlightHydrate = null;
let stopped = false;
let lastHydratedAt = 0;
let lastTouchAt = 0;
let serverClockOffsetMs = 0;
let previousOnlineIds = new Set();
const lastSeenByUser = new Map();

function cleanIso(value){
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function mergeRow(row){
  const userId = String(row?.user_id || "").trim();
  const lastSeen = cleanIso(row?.last_seen);
  if(!userId || !lastSeen) return false;

  const next = Date.parse(lastSeen);
  const current = Date.parse(lastSeenByUser.get(userId) || "");
  if(Number.isFinite(current) && current >= next) return false;

  lastSeenByUser.set(userId, lastSeen);
  return true;
}

function mergeRows(rows){
  let changed = false;
  for(const row of Array.isArray(rows) ? rows : []){
    if(mergeRow(row)) changed = true;
  }
  return changed;
}

function updateServerClock(serverNow, startedAt, finishedAt = Date.now()){
  const serverTime = Date.parse(String(serverNow || ""));
  if(!Number.isFinite(serverTime)) return;
  const midpoint = Math.round((Number(startedAt || finishedAt) + Number(finishedAt)) / 2);
  serverClockOffsetMs = serverTime - midpoint;
}

function serverNowIso(){
  return new Date(Date.now() + serverClockOffsetMs).toISOString();
}

function snapshot(){
  const byUserId = Object.create(null);
  for(const [userId, iso] of lastSeenByUser.entries()) byUserId[userId] = iso;
  return Object.freeze({
    status:"ready",
    byUserId:Object.freeze(byUserId),
    serverClockOffsetMs,
    serverNow:serverNowIso(),
    updatedAt:Date.now(),
  });
}

function publish(){
  const next = snapshot();
  window.__srLastSeenSnapshot = next;
  try{
    window.dispatchEvent(new CustomEvent("sr:last-seen-changed", { detail:next }));
  }catch{}
  return next;
}

async function request(method, body, { keepalive = false } = {}){
  const startedAt = Date.now();
  const response = await fetch(API, {
    method,
    credentials:"same-origin",
    headers:{
      "accept":"application/json",
      ...(method === "POST" ? { "content-type":"application/json" } : {}),
    },
    ...(method === "POST" ? { body:JSON.stringify(body || {}) } : {}),
    cache:"no-store",
    keepalive:!!keepalive,
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok || !data?.ok) throw new Error(data?.error || "Last-seen request failed.");
  updateServerClock(data?.server_now, startedAt, Date.now());
  return data;
}

async function hydrate({ force = false } = {}){
  if(stopped || navigator.onLine === false) return null;
  if(!force && lastHydratedAt && (Date.now() - lastHydratedAt) < HYDRATE_MAX_AGE_MS){
    return window.__srLastSeenSnapshot || snapshot();
  }
  if(inFlightHydrate) return inFlightHydrate;

  inFlightHydrate = request("GET")
    .then((data) => {
      mergeRows(data?.rows);
      lastHydratedAt = Date.now();
      publish();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inFlightHydrate = null;
    });
  return inFlightHydrate;
}

async function touch({ keepalive = false, force = false } = {}){
  if(stopped || navigator.onLine === false) return null;
  if(inFlightTouch) return inFlightTouch;

  const now = Date.now();
  if(!force && lastTouchAt && (now - lastTouchAt) < TOUCH_DEDUPE_MS) return null;
  lastTouchAt = now;

  const task = request("POST", { hydrate:false }, { keepalive })
    .then((data) => {
      mergeRow(data?.current);
      publish();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      if(inFlightTouch === task) inFlightTouch = null;
    });

  inFlightTouch = task;
  return task;
}

function onPresenceChanged(event){
  const live = event?.detail || window.__srPresenceSnapshot || null;
  if(live?.status !== "connected") return;

  const nextIds = new Set(
    (Array.isArray(live?.onlineUserIds) ? live.onlineUserIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  const leftIds = [];
  for(const id of previousOnlineIds){
    if(!nextIds.has(id)) leftIds.push(id);
  }
  previousOnlineIds = nextIds;

  if(!leftIds.length) return;

  let changed = false;
  const leftAt = serverNowIso();
  for(const userId of leftIds){
    if(mergeRow({ user_id:userId, last_seen:leftAt })) changed = true;
  }
  if(changed) publish();
}

function persistLifecycle(){
  if(stopped || navigator.onLine === false) return;
  touch({ keepalive:true }).catch(()=>{});
}

function stop(){
  if(stopped) return;
  persistLifecycle();
  stopped = true;
}

function resume(){
  if(!stopped) return;
  stopped = false;
  previousOnlineIds = new Set(window.__srPresenceSnapshot?.onlineUserIds || []);
}

function start(){
  previousOnlineIds = new Set(window.__srPresenceSnapshot?.onlineUserIds || []);

  window.addEventListener("sr:presence-changed", onPresenceChanged);
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", resume);
}

window.__srLastSeenSidecar = Object.freeze({
  version:5,
  getSnapshot:() => window.__srLastSeenSnapshot || snapshot(),
  refresh:() => hydrate(),
  forceRefresh:() => hydrate({ force:true }),
  touch:() => touch({ force:true }),
});

start();

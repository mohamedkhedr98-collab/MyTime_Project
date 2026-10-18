// My Time Runtime Kernel v11
// Single owner for client-side resource loading, Worker-read coalescing, push-invalidated
// memory caching, and lightweight runtime metrics. No polling and no focus refresh loops.

const VERSION = "20260924-architecture-v11";
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_READS = 64;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const READ_TIMEOUT_MS = 15000;

const moduleLoads = new Map();
const scriptLoads = new Map();
const styleLoads = new Map();
const responseCache = new Map();
const inFlightReads = new Map();

const stats = {
  version: VERSION,
  workerReads: 0,
  memoryHits: 0,
  coalescedReads: 0,
  invalidations: 0,
  modulesLoaded: 0,
  stylesLoaded: 0,
};

function currentOrigin(){
  return typeof location !== "undefined" && location.origin
    ? location.origin
    : "https://sr-tool.invalid";
}

function toUrl(input){
  const raw = typeof input === "string" || input instanceof URL
    ? String(input)
    : (input && typeof input.url === "string" ? input.url : "");
  try { return new URL(raw, currentOrigin()); } catch { return null; }
}

function requestMethod(input, init = {}){
  return String(
    init?.method ||
    (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET") ||
    "GET"
  ).toUpperCase();
}

function parseJsonBody(init = {}){
  if(typeof init?.body !== "string" || !init.body.trim()) return null;
  try { return JSON.parse(init.body); } catch { return null; }
}

function stableJson(value){
  if(value == null || typeof value !== "object") return JSON.stringify(value);
  if(Array.isArray(value)) return JSON.stringify(value.map((item) => item && typeof item === "object" ? JSON.parse(stableJson(item)) : item));
  const out = {};
  for(const key of Object.keys(value).sort()) out[key] = value[key];
  return JSON.stringify(out);
}

function normalizeGroups(groups){
  const src = Array.isArray(groups) ? groups : [groups];
  return Array.from(new Set(src.map((v) => String(v || "").trim()).filter(Boolean)));
}

function classifyRequest(input, init = {}){
  // Preserve caller cancellation and custom credential semantics. These reads
  // cannot safely share another caller's signal or an identity-free cache key.
  if(init.signal || input instanceof Request || init.credentials === "omit" ||
      new Headers(init.headers).has("authorization")) return null;
  const url = toUrl(input);
  if(!url || url.origin !== currentOrigin()) return null;
  const method = requestMethod(input, init);
  const body = method === "POST" ? parseJsonBody(init) : null;

  if(method === "GET" && url.pathname === "/api/support-messages"){
    return {
      key: `GET ${url.pathname}${url.search}`,
      groups: ["support"],
      ttlMs: DEFAULT_CACHE_TTL_MS,
    };
  }

  if(method === "POST" && url.pathname === "/api/support-message-interactions" && body?.action === "unread"){
    return {
      key: `POST ${url.pathname} ${stableJson(body)}`,
      groups: ["support"],
      ttlMs: DEFAULT_CACHE_TTL_MS,
    };
  }

  if(method === "POST" && url.pathname === "/api/suggestion-notifications" && body?.action === "list"){
    return {
      key: `POST ${url.pathname} ${stableJson(body)}`,
      groups: ["suggestions"],
      ttlMs: DEFAULT_CACHE_TTL_MS,
    };
  }

  if(method === "POST" && url.pathname === "/api/suggestion-notification-center"){
    const action = String(body?.action || "").toLowerCase();
    if(action === "counts" && body?.fresh === true) return null;
    if(action === "counts" || action === "broadcast_count" || action === "list"){
      return {
        key: `POST ${url.pathname} ${stableJson(body)}`,
        groups: ["support", "suggestions", "notifications"],
        ttlMs: DEFAULT_CACHE_TTL_MS,
      };
    }
  }

  return null;
}

function mutationGroups(input, init){
  const url = toUrl(input);
  if(!url || url.origin !== currentOrigin() || requestMethod(input, init) !== "POST") return null;
  const path = url.pathname, action = parseJsonBody(init)?.action;
  if(/^\/api\/(support-message|user-delete-support-message)$/.test(path) ||
    (/^\/api\/support-seen-(v2|receipts)$/.test(path) && action === "mark") ||
    (path === "/api/support-message-interactions" && ["toggle","read"].includes(action))) return ["support", "notifications"];
  if(/^\/api\/(public-suggestion|public-suggestion-reply)$/.test(path) ||
    (/^\/api\/suggestion-(item-)?reactions$/.test(path) && action === "toggle")) return ["suggestions", "notifications"];
  if(path === "/api/suggestion-notification-center" && ["read", "read_all", "archive", "delete"].includes(action)) return ["notifications", "support", "suggestions"];
  return null;
}

function copyHeaders(headers){
  return Array.from(headers.entries());
}

function responseFromEntry(entry){
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

function entryMatchesGroup(entry, wanted){
  if(!entry || !Array.isArray(entry.groups)) return false;
  if(wanted === "all") return true;
  return entry.groups.includes(wanted);
}

export function invalidateRuntimeCache(groups = "all", meta = {}){
  const wanted = normalizeGroups(groups);
  const all = !wanted.length || wanted.includes("all");
  for(const [key, entry] of responseCache){
    if(all || wanted.some((group) => entryMatchesGroup(entry, group))){
      responseCache.delete(key);
    }
  }
  for(const [key, entry] of inFlightReads){
    if(all || wanted.some((group) => entryMatchesGroup(entry, group))){
      inFlightReads.delete(key);
      entry.controller.abort(new DOMException("Read invalidated", "AbortError"));
    }
  }
  stats.invalidations += 1;
  try{
    window.dispatchEvent(new CustomEvent("sr:runtime-cache-invalidated", {
      detail:{ groups: all ? ["all"] : wanted, ...meta }
    }));
  }catch{}
}

function pruneReadCache(){
  let bytes = 0;
  for(const [key, entry] of responseCache){
    if(Date.now() - entry.savedAt >= entry.ttlMs) responseCache.delete(key);
    else bytes += entry.body.byteLength;
  }
  for(const [key, entry] of responseCache){
    if(responseCache.size <= MAX_CACHED_READS && bytes <= MAX_CACHE_BYTES) break;
    bytes -= entry.body.byteLength;
    responseCache.delete(key);
  }
}

async function fetchAndRemember(rawFetch, input, init, spec, read){
  const response = await rawFetch(input, { ...init, signal:read.controller.signal });
  read.controller.signal.throwIfAborted();
  // Consume the network stream once. Response.clone() previously left the
  // original branch unread while retaining additional tee buffers per caller.
  const body = await response.arrayBuffer();
  read.controller.signal.throwIfAborted();
  const entry = {
    savedAt:Date.now(), ttlMs:spec.ttlMs || DEFAULT_CACHE_TTL_MS,
    groups:normalizeGroups(spec.groups), status:response.status,
    statusText:response.statusText, headers:copyHeaders(response.headers), body,
  };
  if(response.ok){
    if(body.byteLength <= MAX_CACHE_BYTES) responseCache.set(spec.key, entry);
    pruneReadCache(); stats.workerReads += 1;
  }
  return entry;
}

export function installRequestBroker(){
  if(typeof window === "undefined" || typeof window.fetch !== "function") return null;
  if(window.__srRuntimeRequestBrokerInstalled) return window.__srRuntime;
  window.__srRuntimeRequestBrokerInstalled = true;

  const rawFetch = window.fetch.bind(window);

  window.fetch = async function runtimeFetch(input, init = {}){
    const spec = classifyRequest(input, init);
    if(!spec){
      const response = await rawFetch(input, init);
      const groups = mutationGroups(input, init);
      if(response.ok && groups) invalidateRuntimeCache(groups, {source:"mutation"});
      return response;
    }
    pruneReadCache();

    const cached = responseCache.get(spec.key);
    if(cached){
      const ttl = Number(cached.ttlMs || DEFAULT_CACHE_TTL_MS);
      if(Date.now() - cached.savedAt < ttl){
        stats.memoryHits += 1;
        return responseFromEntry(cached);
      }
      responseCache.delete(spec.key);
    }

    const existing = inFlightReads.get(spec.key);
    if(existing){
      stats.coalescedReads += 1;
      return responseFromEntry(await existing.promise);
    }

    const read = { groups:spec.groups, controller:new AbortController(), promise:null };
    const timer = setTimeout(() => read.controller.abort(
      new DOMException("Read timed out", "TimeoutError")), READ_TIMEOUT_MS);
    const pending = read.promise = fetchAndRemember(rawFetch, input, init, spec, read);
    inFlightReads.set(spec.key, read);
    try{
      return responseFromEntry(await pending);
    }finally{
      clearTimeout(timer);
      if(inFlightReads.get(spec.key) === read) inFlightReads.delete(spec.key);
    }
  };

  return window.__srRuntime;
}

export function loadModule(key, src){
  const id = String(key || src || "").trim();
  if(!id) return Promise.reject(new Error("Missing runtime module key."));
  if(!moduleLoads.has(id)){
    const pending = import(src).then((mod) => {
      stats.modulesLoaded += 1;
      return mod;
    });
    moduleLoads.set(id, pending);
    pending.catch(() => { if(moduleLoads.get(id) === pending) moduleLoads.delete(id); });
  }
  return moduleLoads.get(id);
}

export function loadScript(key, src){
  const id = String(key || src || "").trim();
  if(!id) return Promise.reject(new Error("Missing runtime script key."));
  if(scriptLoads.has(id)) return scriptLoads.get(id);

  const pending = new Promise((resolve, reject) => {
    try{
      const existing = Array.from(document.scripts || []).find(
        (node) => node.dataset?.srRuntimeScript === id
      );
      if(existing) return resolve(existing);

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.srRuntimeScript = id;
      script.addEventListener("load", () => {
        stats.modulesLoaded += 1;
        resolve(script);
      }, { once:true });
      script.addEventListener("error", () => {
        // Never retain failed script nodes: later on-demand attempts must be able to retry.
        script.remove();
        reject(new Error("Could not load " + src));
      }, { once:true });
      (document.head || document.documentElement).appendChild(script);
    }catch(error){
      reject(error);
    }
  });
  scriptLoads.set(id, pending);
  // Keep concurrent requests coalesced while pending/successful, but release failures.
  // Otherwise a single interrupted Tags load poisons the entire browser session.
  pending.catch(() => { if(scriptLoads.get(id) === pending) scriptLoads.delete(id); });
  return pending;
}

export function loadStyle(key, href){
  const id = String(key || href || "").trim();
  if(!id) return Promise.resolve(null);
  if(styleLoads.has(id)) return styleLoads.get(id);

  const pending = new Promise((resolve) => {
    try{
      const existing = document.querySelector(`link[data-sr-runtime-style="${CSS.escape(id)}"]`);
      if(existing) return resolve(existing);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.srRuntimeStyle = id;
      link.addEventListener("load", () => resolve(link), { once:true });
      link.addEventListener("error", () => {
        link.remove();
        styleLoads.delete(id);
        resolve(null);
      }, { once:true });
      document.head.appendChild(link);
      stats.stylesLoaded += 1;
    }catch{
      resolve(null);
    }
  });
  styleLoads.set(id, pending);
  return pending;
}

export function onIdle(fn, delay = 1600){
  if(typeof fn !== "function") return;
  // requestIdleCallback's timeout is a deadline, not a minimum delay.
  // Start the idle wait only when this task's staggered delay has elapsed.
  const wait = Number.isFinite(delay) ? Math.max(0, delay) : 1600;
  return setTimeout(() => {
    if(typeof window !== "undefined" && typeof window.requestIdleCallback === "function"){
      window.requestIdleCallback(() => fn(), { timeout:1200 });
    }else{
      fn();
    }
  }, wait);
}

export function runtimeStats(){
  return {
    ...stats,
    cachedReads: responseCache.size,
    cachedBytes: Array.from(responseCache.values()).reduce((n, entry) => n + entry.body.byteLength, 0),
    inFlightReads: inFlightReads.size,
    loadedModules: moduleLoads.size,
    loadedScripts: scriptLoads.size,
    loadedStyles: styleLoads.size,
  };
}

export const runtime = {
  version: VERSION,
  loadModule,
  loadScript,
  loadStyle,
  onIdle,
  invalidate: invalidateRuntimeCache,
  stats: runtimeStats,
};

if(typeof window !== "undefined"){
  window.__srRuntime = runtime;
  installRequestBroker();
  window.addEventListener("sr:account-updated", () => invalidateRuntimeCache("all"));
  window.addEventListener("pagehide", () => invalidateRuntimeCache("all", { source:"page-hidden" }));
  window.addEventListener("pageshow", event => {
    if(event.persisted) invalidateRuntimeCache("all", { source:"page-restored" });
  });
}

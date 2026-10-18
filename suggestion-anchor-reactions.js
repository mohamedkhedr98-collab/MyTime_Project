import { getStableUserId } from "./stable-user-identity.js";

// Anchor-based reactions for Suggestions only.
// Requires anchors rendered by public/suggestions.js:
// .sr-suggest-react-anchor[data-reaction-target-type][data-reaction-target-id]

const API = "/api/suggestion-item-reactions";
const TABLE = "suggestion_item_reactions";
const REACTIONS = [
  ["like", "👍", "أعجبني"],
  ["love", "❤️", "أحببته"],
  ["angry", "😡", "أغضبني"],
  ["laugh", "😂", "أضحكني"],
  ["sad", "😢", "أحزنني"],
  ["dislike", "👎", "لم يعجبني"]
];
const META = Object.fromEntries(REACTIONS.map(([key, icon, label]) => [key, { icon, label }]));
let state = Object.create(null);
let items = [];
let busy = false;
let timer = 0;
let lastKey = "";

function esc(v = ""){
  return String(v == null ? "" : v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function uid(){ try { return String(getStableUserId() || "").trim(); } catch { return ""; } }
function typeOk(v){ v = String(v || "").trim(); return v === "suggestion" || v === "reply" ? v : ""; }
function idOk(v){ const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
function keyOf(type, id){ return `${type}:${Number(id)}`; }
function emptyCounts(){ return { like:0, love:0, angry:0, laugh:0, sad:0, dislike:0 }; }
function emptyUsers(){ return { like:[], love:[], angry:[], laugh:[], sad:[], dislike:[] }; }
function itemState(item){ return state[item.key] || { counts: emptyCounts(), users: emptyUsers(), mine: "" }; }
function cssEscape(v){ try { return CSS.escape(String(v)); } catch { return String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); } }
function targetsKey(list){ return list.map((x) => x.key).sort().join(","); }

function ensureStyle(){
  if (document.getElementById("sr-anchor-reactions-style")) return;
  const s = document.createElement("style");
  s.id = "sr-anchor-reactions-style";
  s.textContent = `
    #suggestionsOverlay .sr-suggest-react-anchor{display:inline-flex!important;align-items:center!important;vertical-align:middle!important;margin-inline-start:6px!important;}
    #suggestionsOverlay .sr-react-host{display:inline-flex!important;align-items:center!important;gap:5px!important;vertical-align:middle!important;}
    #suggestionsOverlay .sr-react-summary{display:inline-flex!important;align-items:center!important;gap:5px!important;border:1px solid rgba(255,255,255,.14)!important;background:rgba(255,255,255,.06)!important;border-radius:999px!important;padding:3px 7px!important;font-size:12px!important;font-weight:800!important;line-height:1!important;}
    #suggestionsOverlay .sr-react-badge{display:inline-flex!important;align-items:center!important;gap:2px!important;cursor:help!important;}
    #suggestionsOverlay .sr-react-badge.mine{filter:drop-shadow(0 0 6px rgba(34,197,94,.55))!important;}
    #suggestionsOverlay .sr-react-open{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:23px!important;height:23px!important;border-radius:999px!important;border:1px solid rgba(255,255,255,.18)!important;background:rgba(255,255,255,.08)!important;color:inherit!important;cursor:pointer!important;font-weight:900!important;line-height:1!important;padding:0!important;}
    #sr-react-menu{position:fixed!important;z-index:2147483000!important;display:none!important;align-items:center!important;gap:5px!important;padding:7px!important;border-radius:999px!important;background:rgba(18,18,22,.96)!important;border:1px solid rgba(255,255,255,.18)!important;box-shadow:0 14px 40px rgba(0,0,0,.35)!important;backdrop-filter:blur(12px)!important;}
    #sr-react-menu.open{display:flex!important;}
    #sr-react-menu .choice{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:34px!important;height:34px!important;border-radius:999px!important;border:0!important;background:rgba(255,255,255,.08)!important;color:#fff!important;cursor:pointer!important;font-size:18px!important;line-height:1!important;}
    #sr-react-menu .choice:hover{background:rgba(34,197,94,.22)!important;transform:translateY(-2px) scale(1.08)!important;}
    #sr-react-menu .choice.active{background:rgba(34,197,94,.30)!important;outline:1px solid rgba(34,197,94,.75)!important;}
  `;
  document.head.appendChild(s);
}

function readItems(){
  const anchors = Array.from(document.querySelectorAll("#suggestionsOverlay .sr-suggest-react-anchor[data-reaction-target-type][data-reaction-target-id]"));
  const out = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const type = typeOk(anchor.dataset.reactionTargetType);
    const id = idOk(anchor.dataset.reactionTargetId);
    if (!type || !id) continue;
    const key = keyOf(type, id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id, key, anchor });
  }
  return out;
}

async function loadState(list, force = false){
  const key = targetsKey(list);
  if (!list.length || (!force && key === lastKey && Object.keys(state).length)) return;
  lastKey = key;
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action:"list", targets:list.map((x)=>({ target_type:x.type, target_id:x.id })), user_id:uid() })
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data && typeof data.reactions === "object") state = data.reactions;
}

function summaryHtml(item){
  const st = itemState(item);
  const counts = { ...emptyCounts(), ...(st.counts || {}) };
  const users = { ...emptyUsers(), ...(st.users || {}) };
  const active = REACTIONS.filter(([key]) => Number(counts[key] || 0) > 0);
  if (!active.length) return "";
  return `<span class="sr-react-summary">${active.map(([key, icon, label]) => {
    const n = Number(counts[key] || 0);
    const title = (users[key] || []).slice(0, 12).join("، ") || label;
    return `<span class="sr-react-badge ${st.mine === key ? "mine" : ""}" title="${esc(title)}"><span>${esc(icon)}</span><span>${n}</span></span>`;
  }).join("")}</span>`;
}
function render(list){
  ensureStyle();
  const activeKeys = new Set(list.map((x) => x.key));
  document.querySelectorAll("#suggestionsOverlay .sr-react-host[data-react-key]").forEach((host) => {
    if (!activeKeys.has(host.dataset.reactKey || "")) host.remove();
  });
  for (const item of list) {
    let host = item.anchor.querySelector(`.sr-react-host[data-react-key="${cssEscape(item.key)}"]`);
    if (!host) {
      host = document.createElement("span");
      host.className = "sr-react-host";
      host.dataset.reactKey = item.key;
      item.anchor.appendChild(host);
    }
    const html = `${summaryHtml(item)}<button type="button" class="sr-react-open" data-react-type="${esc(item.type)}" data-react-id="${esc(item.id)}" title="اختيار تفاعل">⌄</button>`;
    if (host.innerHTML !== html) host.innerHTML = html;
  }
}
async function refresh(force = false){
  if (busy) return;
  const list = readItems();
  items = list;
  if (!list.length) return;
  busy = true;
  try {
    await loadState(list, force);
    render(list);
  } catch {
    render(list);
  } finally { busy = false; }
}
function schedule(delay = 100, force = false){ clearTimeout(timer); timer = setTimeout(() => refresh(force), delay); }
function menu(){
  let m = document.getElementById("sr-react-menu");
  if (m) return m;
  m = document.createElement("div");
  m.id = "sr-react-menu";
  document.body.appendChild(m);
  return m;
}
function closeMenu(){ document.getElementById("sr-react-menu")?.classList.remove("open"); }
function findItem(type, id){ return items.find((x) => x.type === type && Number(x.id) === Number(id)) || { type, id:Number(id), key:keyOf(type, id) }; }
function openMenu(btn, item){
  const m = menu();
  const mine = itemState(item).mine;
  m.innerHTML = REACTIONS.map(([key, icon, label]) => `<button type="button" class="choice ${mine === key ? "active" : ""}" data-choice="${esc(key)}" data-react-type="${esc(item.type)}" data-react-id="${esc(item.id)}" title="${esc(label)}">${esc(icon)}</button>`).join("");
  const r = btn.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - 250, r.left - 105))}px`;
  m.style.top = `${Math.max(8, r.top - 46)}px`;
  m.classList.add("open");
}
async function toggle(type, id, reaction){
  const item = findItem(type, id);
  const key = keyOf(type, id);
  const prev = itemState(item);
  const counts = { ...emptyCounts(), ...(prev.counts || {}) };
  if (prev.mine && counts[prev.mine] > 0) counts[prev.mine] -= 1;
  const mine = prev.mine === reaction ? "" : reaction;
  if (mine) counts[mine] = (counts[mine] || 0) + 1;
  state[key] = { counts, mine, users: prev.users || emptyUsers() };
  render(items);
  try {
    const res = await fetch(API, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ action:"toggle", target_type:type, target_id:Number(id), reaction, user_id:uid() }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.reactions?.[key]) state[key] = data.reactions[key];
  } finally {
    closeMenu();
    render(items);
  }
}
function applyRealtimeReaction(detail = {}){
  const type = typeOk(detail?.target_type);
  const id = idOk(detail?.target_id);
  const actor = String(detail?.actor_user_id || "");
  const actorName = String(detail?.actor_name || actor.slice(0,10) || "User");
  const reactionKey = publicReactionKey(detail?.reaction);
  const op = String(detail?.op || "").toUpperCase();
  if(!type || !id || !actor || !reactionKey || (op !== "INSERT" && op !== "DELETE")) return false;

  const key = keyOf(type,id);
  const current = itemState({key});
  const counts = { ...emptyCounts(), ...(current.counts || {}) };
  const users = { ...emptyUsers(), ...(current.users || {}) };
  const delta = op === "INSERT" ? 1 : -1;
  counts[reactionKey] = Math.max(0, Number(counts[reactionKey] || 0) + delta);
  const list = Array.isArray(users[reactionKey]) ? [...users[reactionKey]] : [];
  if(op === "INSERT" && !list.includes(actorName)) list.push(actorName);
  if(op === "DELETE") users[reactionKey] = list.filter((name)=>name !== actorName);
  else users[reactionKey] = list;
  let mine = String(current.mine || "");
  if(actor === uid()) mine = op === "INSERT" ? reactionKey : (mine === reactionKey ? "" : mine);
  state[key] = { counts, users, mine };
  items = readItems();
  render(items);
  return true;
}
function publicReactionKey(value){
  const s=String(value||"");
  return s === "slipper" ? "dislike" : (META[s] ? s : "");
}
function bind(){
  document.addEventListener("click", (event) => {
    const open = event.target?.closest?.("button.sr-react-open");
    if (open) {
      event.preventDefault(); event.stopPropagation();
      openMenu(open, findItem(String(open.dataset.reactType || ""), Number(open.dataset.reactId || 0)));
      return;
    }
    const choice = event.target?.closest?.("#sr-react-menu button.choice");
    if (choice) {
      event.preventDefault(); event.stopPropagation();
      toggle(String(choice.dataset.reactType || ""), Number(choice.dataset.reactId || 0), String(choice.dataset.choice || ""));
      return;
    }
    if (!event.target?.closest?.("#sr-react-menu")) closeMenu();
  }, true);
  window.addEventListener("sr:suggestions-rendered", () => {
    items = readItems();
    render(items);
  });
  window.addEventListener("sr:suggestion-reaction-event", (event) => applyRealtimeReaction(event?.detail || {}));
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
}
function boot(){ bind(); schedule(600, true); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once:true });
else boot();

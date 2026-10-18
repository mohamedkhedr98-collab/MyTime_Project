const MAX_MENTIONS = 5;
const CACHE_TTL_MS = 60 * 1000;
const MAX_RESULTS = 8;

const candidateCache = new Map();
const selectedByInput = new WeakMap();
const autoMentionByInput = new WeakMap();

let installed = false;
let popup = null;
let activeInput = null;
let activeTrigger = null;
let activeRows = [];
let activeIndex = 0;
let requestSerial = 0;

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function selectedMap(input){
  let map = selectedByInput.get(input);
  if(!map){
    map = new Map();
    selectedByInput.set(input, map);
  }
  return map;
}

function pruneSelected(input){
  const map = selectedMap(input);
  const text = String(input?.value || "");
  for(const [id, item] of map){
    if(!text.includes("@" + item.name)) map.delete(id);
  }
  return map;
}

function suggestionIdForInput(input){
  if(input?.id === "suggestionInput") return null;
  const box = input?.closest?.(".suggestion-replies");
  const raw = String(box?.id || "").replace(/^sugReplies_/, "");
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function detectTrigger(input){
  if(!input || typeof input.selectionStart !== "number") return null;
  const caret = input.selectionStart;
  const prefix = String(input.value || "").slice(0, caret);
  const at = prefix.lastIndexOf("@");
  if(at < 0) return null;

  const before = at > 0 ? prefix[at - 1] : "";
  if(before && !/[\s([{:،؛]/.test(before)) return null;

  const query = prefix.slice(at + 1);
  if(query.length > 60 || /[\n\r,;:!?؟]/.test(query)) return null;

  for(const item of pruneSelected(input).values()){
    if(query.startsWith(item.name)){
      const rest = query.slice(item.name.length);
      if(rest === "" || /^\s/.test(rest)) return null;
    }
  }

  return {
    start:at,
    end:caret,
    query,
    suggestionId:suggestionIdForInput(input),
  };
}

function onlineIds(){
  const snap = window.__srPresenceSnapshot;
  if(snap?.status !== "connected") return new Set();
  return new Set((Array.isArray(snap.onlineUserIds) ? snap.onlineUserIds : [])
    .map((id) => String(id || ""))
    .filter(Boolean));
}

function matchRank(name, query){
  const n = normalize(name);
  const q = normalize(query);
  if(!q) return 1;
  if(n === q) return 5;
  if(n.startsWith(q)) return 4;
  if(n.split(" ").some((part) => part.startsWith(q))) return 3;
  if(n.includes(q)) return 2;
  return 0;
}

function prepareRows(rows, query){
  const online = onlineIds();
  const seen = new Set();

  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const id = String(row?.user_id || "");
      if(!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row) => ({
      ...row,
      online:online.has(String(row.user_id || "")),
      match:matchRank(row.display_name, query),
    }))
    .filter((row) => row.match > 0)
    .sort((a, b) => {
      if(a.match !== b.match) return b.match - a.match;
      if(!!a.thread_participant !== !!b.thread_participant) return a.thread_participant ? -1 : 1;
      if(!!a.online !== !!b.online) return a.online ? -1 : 1;
      if(Number(a.thread_last_at || 0) !== Number(b.thread_last_at || 0)){
        return Number(b.thread_last_at || 0) - Number(a.thread_last_at || 0);
      }
      return String(a.display_name || "").localeCompare(String(b.display_name || ""), undefined, { sensitivity:"base" });
    })
    .slice(0, MAX_RESULTS);
}

async function fetchCandidates(suggestionId){
  const key = String(suggestionId || "new");
  const now = Date.now();
  const cached = candidateCache.get(key);

  if(cached?.rows && now - cached.savedAt < CACHE_TTL_MS) return cached.rows;
  if(cached?.promise) return cached.promise;

  const promise = fetch("/api/suggestion-mentions", {
    method:"POST",
    credentials:"same-origin",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({ action:"candidates", suggestion_id:suggestionId || null }),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if(!res.ok || data?.available !== true) throw new Error(data?.error || "Could not load members.");
      const rows = Array.isArray(data.candidates) ? data.candidates : [];
      candidateCache.set(key, { rows, savedAt:Date.now(), promise:null });
      return rows;
    })
    .catch((error) => {
      candidateCache.delete(key);
      throw error;
    });

  candidateCache.set(key, { rows:null, savedAt:0, promise });
  return promise;
}

function ensureStyles(){
  if(document.getElementById("sr-suggestion-mentions-lite-style")) return;
  const style = document.createElement("style");
  style.id = "sr-suggestion-mentions-lite-style";
  style.textContent = `
    #srSuggestionMentionLite{position:fixed;z-index:2147483600;max-height:290px;overflow:auto;padding:5px;border:1px solid rgba(177,198,240,.24);border-radius:12px;background:rgba(7,12,24,.985);color:#f7f9ff;box-shadow:0 16px 42px rgba(0,0,0,.48)}
    #srSuggestionMentionLite[hidden]{display:none!important}
    #srSuggestionMentionLite .sr-mention-lite-option{width:100%;min-height:40px;display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}
    #srSuggestionMentionLite .sr-mention-lite-option:hover,#srSuggestionMentionLite .sr-mention-lite-option.is-active{background:rgba(111,166,255,.11);border-color:rgba(111,166,255,.24)}
    #srSuggestionMentionLite .sr-mention-lite-at{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 26px;border-radius:8px;background:rgba(99,235,160,.10);color:#8ff3b6;font-weight:950}
    #srSuggestionMentionLite .sr-mention-lite-copy{min-width:0;flex:1;display:grid;gap:2px}
    #srSuggestionMentionLite .sr-mention-lite-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
    #srSuggestionMentionLite .sr-mention-lite-meta{display:flex;gap:4px;font-size:9px;opacity:.75}
    #srSuggestionMentionLite .sr-mention-lite-tag{padding:1px 5px;border-radius:999px;background:rgba(255,255,255,.07)}
    #srSuggestionMentionLite .sr-mention-lite-tag.thread{color:#ffe4a3;background:rgba(243,204,114,.10)}
    #srSuggestionMentionLite .sr-mention-lite-tag.online{color:#9ff1bd;background:rgba(99,235,160,.10)}
    #srSuggestionMentionLite .sr-mention-lite-state{padding:9px 10px;font-size:11px;opacity:.72}
  `;
  document.head.appendChild(style);
}

function ensurePopup(){
  if(popup) return popup;
  ensureStyles();
  popup = document.createElement("div");
  popup.id = "srSuggestionMentionLite";
  popup.hidden = true;
  popup.setAttribute("role", "listbox");
  document.body.appendChild(popup);

  popup.addEventListener("mousedown", (event) => {
    const button = event.target?.closest?.("button[data-index]");
    if(!button) return;
    event.preventDefault();
    const index = Number(button.dataset.index);
    if(Number.isInteger(index) && activeRows[index]) selectRow(activeRows[index]);
  });

  return popup;
}

function positionPopup(){
  if(!popup || popup.hidden || !activeInput) return;
  const rect = activeInput.getBoundingClientRect();
  const width = Math.min(340, Math.max(250, rect.width));
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  const estimated = Math.min(290, 38 + activeRows.length * 40);
  const below = rect.bottom + 6;
  const top = below + estimated <= window.innerHeight - 8
    ? below
    : Math.max(8, rect.top - estimated - 6);

  popup.style.width = width + "px";
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

function renderPopup(stateText = ""){
  ensurePopup();
  if(!activeInput || !activeTrigger){
    closePopup();
    return;
  }

  if(stateText){
    popup.innerHTML = `<div class="sr-mention-lite-state">${escapeHtml(stateText)}</div>`;
    popup.hidden = false;
    positionPopup();
    return;
  }

  if(!activeRows.length){
    popup.innerHTML = '<div class="sr-mention-lite-state">No matching members</div>';
    popup.hidden = false;
    positionPopup();
    return;
  }

  popup.innerHTML = activeRows.map((row, index) => {
    const tags = [
      row.thread_participant ? '<span class="sr-mention-lite-tag thread">In this suggestion</span>' : "",
      row.online ? '<span class="sr-mention-lite-tag online">Online</span>' : "",
    ].join("");

    return `
      <button type="button" class="sr-mention-lite-option${index === activeIndex ? " is-active" : ""}" data-index="${index}" role="option" aria-selected="${index === activeIndex ? "true" : "false"}">
        <span class="sr-mention-lite-at">@</span>
        <span class="sr-mention-lite-copy">
          <b>${escapeHtml(row.display_name || "User")}</b>
          <span class="sr-mention-lite-meta">${tags || '<span class="sr-mention-lite-tag">Member</span>'}</span>
        </span>
      </button>
    `;
  }).join("");

  popup.hidden = false;
  positionPopup();
}

function closePopup(){
  if(popup) popup.hidden = true;
  activeInput = null;
  activeTrigger = null;
  activeRows = [];
  activeIndex = 0;
}

async function updatePicker(input){
  const trigger = detectTrigger(input);
  if(!trigger){
    if(activeInput === input) closePopup();
    return;
  }

  activeInput = input;
  activeTrigger = trigger;
  activeRows = [];
  activeIndex = 0;

  const serial = ++requestSerial;
  renderPopup("Loading members…");

  try{
    const rows = await fetchCandidates(trigger.suggestionId);
    if(serial !== requestSerial || activeInput !== input) return;
    activeRows = prepareRows(rows, trigger.query);
    activeIndex = 0;
    renderPopup();
  }catch{
    if(serial !== requestSerial || activeInput !== input) return;
    renderPopup("Members unavailable");
  }
}

function selectRow(row){
  if(!activeInput || !activeTrigger || !row) return;
  const id = String(row.user_id || "");
  const name = String(row.display_name || "").trim();
  if(!id || !name) return;

  const map = pruneSelected(activeInput);
  if(!map.has(id) && map.size >= MAX_MENTIONS){
    renderPopup("Maximum 5 mentions per message");
    return;
  }

  const normalizedName = normalize(name);
  for(const [otherId, item] of map){
    if(otherId !== id && normalize(item.name) === normalizedName) map.delete(otherId);
  }

  const value = String(activeInput.value || "");
  const before = value.slice(0, activeTrigger.start);
  const after = value.slice(activeTrigger.end);
  const inserted = "@" + name + " ";
  activeInput.value = before + inserted + after;
  const caret = before.length + inserted.length;
  try{ activeInput.setSelectionRange(caret, caret); }catch{}

  map.set(id, { name });
  const input = activeInput;
  closePopup();
  input.dispatchEvent(new Event("input", { bubbles:true }));
  input.focus();
}

function isMentionInput(target){
  return target?.matches?.("#suggestionInput, .sug-reply-input");
}

function getMentionUserIds(input){
  const map = pruneSelected(input);
  const auto = autoMentionByInput.get(input);
  const ids = [];
  if(auto?.id && map.has(auto.id)) ids.push(auto.id);
  for(const id of map.keys()){
    if(id === auto?.id || ids.includes(id)) continue;
    ids.push(id);
    if(ids.length >= MAX_MENTIONS) break;
  }
  return ids.slice(0, MAX_MENTIONS);
}

function removeAutoMentionText(input, item){
  if(!input || !item?.name) return false;
  const token = "@" + item.name;
  let value = String(input.value || "");
  if(value.startsWith(token)){
    value = value.slice(token.length);
    if(value.startsWith(" ")) value = value.slice(1);
    input.value = value;
    return true;
  }
  return false;
}

function clearAutoMention(input){
  if(!input) return false;
  const current = autoMentionByInput.get(input);
  if(!current) return false;

  const changed = removeAutoMentionText(input, current);
  selectedMap(input).delete(current.id);
  autoMentionByInput.delete(input);

  if(changed) input.dispatchEvent(new Event("input", { bubbles:true }));
  return changed;
}

function setAutoMention(input, member){
  if(!input) return false;
  const id = String(member?.user_id || "").trim();
  const name = String(member?.display_name || member?.name || "").trim();
  if(!id || !name) return false;

  const previous = autoMentionByInput.get(input);
  if(previous?.id && previous.id !== id){
    removeAutoMentionText(input, previous);
    selectedMap(input).delete(previous.id);
    autoMentionByInput.delete(input);
  }

  const map = pruneSelected(input);
  const token = "@" + name;
  let value = String(input.value || "");

  if(!value.startsWith(token)){
    const prefix = token + " ";
    const limit = Number(input.maxLength || input.getAttribute?.("maxlength") || 0);
    if(limit > 0 && prefix.length + value.length > limit) return false;
    value = prefix + value;
    input.value = value;
  }

  map.set(id, { name, auto:true });
  autoMentionByInput.set(input, { id, name });

  try{
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }catch{}
  input.dispatchEvent(new Event("input", { bubbles:true }));
  return true;
}

function clearMentions(input){
  if(input){
    selectedByInput.delete(input);
    autoMentionByInput.delete(input);
  }
  if(activeInput === input) closePopup();
}

export function installSuggestionMentionsLite(){
  if(installed) return window.__srSuggestionMentionsLite;
  installed = true;

  const overlay = document.getElementById("suggestionsOverlay");
  if(!overlay) return null;

  ensurePopup();

  overlay.addEventListener("input", (event) => {
    if(isMentionInput(event.target)) updatePicker(event.target);
  });

  overlay.addEventListener("click", (event) => {
    if(isMentionInput(event.target) && detectTrigger(event.target)) updatePicker(event.target);
  });

  document.addEventListener("keydown", (event) => {
    if(!popup || popup.hidden || !activeInput || event.target !== activeInput) return;

    if(event.key === "ArrowDown"){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(activeRows.length) activeIndex = (activeIndex + 1) % activeRows.length;
      renderPopup();
      return;
    }

    if(event.key === "ArrowUp"){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(activeRows.length) activeIndex = (activeIndex - 1 + activeRows.length) % activeRows.length;
      renderPopup();
      return;
    }

    if(event.key === "Enter" && !event.shiftKey){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(activeRows[activeIndex]) selectRow(activeRows[activeIndex]);
      return;
    }

    if(event.key === "Escape"){
      event.preventDefault();
      event.stopImmediatePropagation();
      closePopup();
    }
  }, true);

  document.addEventListener("mousedown", (event) => {
    if(!popup || popup.hidden) return;
    if(event.target === activeInput || popup.contains(event.target)) return;
    closePopup();
  }, true);

  window.addEventListener("resize", positionPopup);
  window.addEventListener("scroll", positionPopup, true);
  window.addEventListener("sr:presence-changed", () => {
    if(popup && !popup.hidden && activeInput && activeTrigger){
      const key = String(activeTrigger.suggestionId || "new");
      const rows = candidateCache.get(key)?.rows || [];
      activeRows = prepareRows(rows, activeTrigger.query);
      activeIndex = Math.min(activeIndex, Math.max(0, activeRows.length - 1));
      renderPopup();
    }
  });

  window.__srSuggestionMentionsLite = Object.freeze({
    getMentionUserIds,
    setAutoMention,
    clearAutoMention,
    clear:clearMentions,
    max:MAX_MENTIONS,
  });

  return window.__srSuggestionMentionsLite;
}

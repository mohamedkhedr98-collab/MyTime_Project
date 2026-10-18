const MAX_MENTIONS = 5;
const MAX_RESULTS = 8;
const ALL_ID = "__all__";

let installed = false;
let input = null;
let usersRoot = null;
let popup = null;
let chipRail = null;
let activeIndex = 0;
let allowedUser = () => true;
let allowEveryone = () => false;
const selectedByInput = new WeakMap();

function normalizeText(value){
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .trim();
}

function stateFor(target){
  let state = selectedByInput.get(target);
  if(!state){
    state = { users:new Map(), all:false };
    selectedByInput.set(target, state);
  }
  return state;
}

function pruneSelected(target){
  const state = stateFor(target);
  if(state.all && !allowEveryone()) state.all = false;
  for(const [id] of state.users){
    if(!allowedUser(id)) state.users.delete(id);
  }
  if(state.all) state.users.clear();
  renderChips(target);
  return state;
}

function getMentionUserIds(target = input){
  const state = pruneSelected(target);
  return state.all ? [] : Array.from(state.users.keys()).slice(0, MAX_MENTIONS);
}

function getMentionAll(target = input){
  return !!pruneSelected(target).all;
}

function getMentionLabels(target = input){
  const state = pruneSelected(target);
  if(state.all) return ["الكل"];
  return Array.from(state.users.values()).slice(0, MAX_MENTIONS).map((item) => String(item?.name || "").trim()).filter(Boolean);
}

function hasMentions(target = input){
  const state = pruneSelected(target);
  return state.all || state.users.size > 0;
}

function clear(target = input){
  if(target) selectedByInput.delete(target);
  renderChips(target);
  closePopup();
}

function refresh(target = input){
  if(target) pruneSelected(target);
  renderPopup();
}

function detectTrigger(target){
  if(!target) return null;
  const value = String(target.value || "");
  const caret = Number(target.selectionStart ?? value.length);
  const left = value.slice(0, caret);
  const match = left.match(/(?:^|\s)@([^@\n\r]*)$/);
  if(!match) return null;
  const query = match[1] || "";
  const start = caret - query.length - 1;
  return { query, start, end:caret };
}

function readCandidates(){
  if(!usersRoot) return [];
  const rows = [];
  usersRoot.querySelectorAll("button.support-user[data-user-id]").forEach((button) => {
    const id = String(button.getAttribute("data-user-id") || "").trim();
    if(!id || button.classList.contains("me") || !allowedUser(id)) return;
    const name = String(button.querySelector(".support-user-name")?.textContent || "").trim();
    if(!name) return;
    rows.push({
      id,
      name,
      online:button.querySelector(".support-presence-badge.is-online") != null,
    });
  });
  return rows;
}

function allCandidateMatches(query){
  const q = normalizeText(query);
  if(!q) return true;
  return ["الكل","كل","everyone","all","جميع"].some((value) => normalizeText(value).includes(q));
}

function currentResults(){
  const trigger = detectTrigger(input);
  if(!trigger) return [];
  const q = normalizeText(trigger.query);
  const selected = stateFor(input);
  const rows = readCandidates()
    .filter((row) => !selected.users.has(row.id))
    .filter((row) => !q || normalizeText(row.name).includes(q))
    .sort((a,b) => {
      const an = normalizeText(a.name);
      const bn = normalizeText(b.name);
      const aStarts = q && an.startsWith(q) ? 0 : 1;
      const bStarts = q && bn.startsWith(q) ? 0 : 1;
      if(aStarts !== bStarts) return aStarts - bStarts;
      if(a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  if(allowEveryone() && !selected.all && allCandidateMatches(trigger.query)){
    rows.unshift({ id:ALL_ID, name:"الكل", everyone:true, online:false });
  }
  return rows.slice(0, MAX_RESULTS);
}

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function ensureStyles(){
  if(document.getElementById("sr-support-mentions-v2-style")) return;
  const style = document.createElement("style");
  style.id = "sr-support-mentions-v2-style";
  style.textContent = `
    #srSupportMentionLite{
      position:fixed;
      z-index:2147483450;
      width:min(320px,calc(100vw - 18px));
      max-height:270px;
      overflow:auto;
      padding:5px;
      border:1px solid rgba(177,204,255,.22);
      border-radius:12px;
      background:rgba(10,17,31,.99);
      color:#f5f8ff;
      box-shadow:0 18px 48px rgba(0,0,0,.45);
      backdrop-filter:blur(12px);
    }
    #srSupportMentionLite[hidden]{display:none!important}
    #srSupportMentionLite button{
      width:100%;
      min-height:38px;
      display:flex;
      align-items:center;
      gap:8px;
      padding:7px 9px;
      border:1px solid transparent;
      border-radius:9px;
      background:transparent;
      color:inherit;
      text-align:left;
      cursor:pointer;
    }
    #srSupportMentionLite button:hover,
    #srSupportMentionLite button.is-active{
      background:rgba(92,146,255,.12);
      border-color:rgba(92,146,255,.23);
    }
    #srSupportMentionLite button[data-mention-all="1"]{
      background:rgba(63,158,117,.10);
      border-color:rgba(91,201,148,.17);
    }
    #srSupportMentionLite .sr-sm-name{
      min-width:0;
      flex:1;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      font-size:11.5px;
      font-weight:850;
    }
    #srSupportMentionLite .sr-sm-online{
      font-size:9px;
      color:#79efae;
      font-weight:850;
    }
    .sr-support-mention-chips{
      display:flex;
      flex-wrap:wrap;
      gap:6px;
      align-items:center;
      margin:0 0 7px;
      min-height:0;
    }
    .sr-support-mention-chips[hidden]{display:none!important}
    .sr-support-mention-chip{
      display:inline-flex;
      align-items:center;
      gap:6px;
      max-width:220px;
      min-height:28px;
      padding:3px 7px 3px 9px;
      border:1px solid rgba(102,174,245,.28);
      border-radius:999px;
      background:linear-gradient(180deg,rgba(43,113,181,.23),rgba(31,78,132,.20));
      color:#dff0ff;
      box-shadow:0 0 0 1px rgba(255,255,255,.02) inset;
      font:800 10px/1.2 Inter,Segoe UI,Arial,sans-serif;
      white-space:nowrap;
    }
    .sr-support-mention-chip.is-all{
      border-color:rgba(91,201,148,.28);
      background:linear-gradient(180deg,rgba(43,133,91,.22),rgba(27,91,62,.18));
      color:#c8f5dc;
    }
    .sr-support-mention-chip span{
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .sr-support-mention-chip button{
      width:18px;
      height:18px;
      display:grid;
      place-items:center;
      flex:0 0 18px;
      padding:0;
      border:0;
      border-radius:50%;
      background:rgba(255,255,255,.08);
      color:inherit;
      cursor:pointer;
      font:800 13px/1 Arial,sans-serif;
    }
    .sr-support-mention-chip button:hover{background:rgba(255,255,255,.16)}
  `;
  document.head.appendChild(style);
}

function ensureChipRail(){
  if(chipRail?.isConnected) return chipRail;
  const compose = input?.closest?.(".support-compose");
  const parent = compose?.parentElement;
  if(!compose || !parent) return null;
  chipRail = document.createElement("div");
  chipRail.className = "sr-support-mention-chips";
  chipRail.hidden = true;
  chipRail.setAttribute("aria-label","Selected mentions");
  parent.insertBefore(chipRail, compose);
  chipRail.addEventListener("click", (event) => {
    const remove = event.target?.closest?.("button[data-remove-mention]");
    if(!remove) return;
    event.preventDefault();
    const state = stateFor(input);
    const id = String(remove.dataset.removeMention || "");
    if(id === ALL_ID) state.all = false;
    else state.users.delete(id);
    renderChips(input);
    input?.focus();
  });
  return chipRail;
}

function renderChips(target = input){
  if(!target || target !== input) return;
  const rail = ensureChipRail();
  if(!rail) return;
  const state = stateFor(target);
  const items = state.all
    ? [{ id:ALL_ID, name:"الكل", all:true }]
    : Array.from(state.users.entries()).map(([id,item]) => ({ id, name:String(item?.name || ""), all:false }));

  if(!items.length){
    rail.hidden = true;
    rail.replaceChildren();
    return;
  }

  rail.innerHTML = items.map((item) =>
    '<span class="sr-support-mention-chip' + (item.all ? ' is-all' : '') + '">' +
      '<span>@' + escapeHtml(item.name) + '</span>' +
      '<button type="button" data-remove-mention="' + escapeHtml(item.id) + '" aria-label="Remove @' + escapeHtml(item.name) + '">×</button>' +
    '</span>'
  ).join("");
  rail.hidden = false;
}

function ensurePopup(){
  if(popup) return popup;
  popup = document.createElement("div");
  popup.id = "srSupportMentionLite";
  popup.hidden = true;
  popup.setAttribute("role","listbox");
  document.body.appendChild(popup);

  popup.addEventListener("mousedown", (event) => {
    const button = event.target?.closest?.("button[data-user-id]");
    if(!button) return;
    event.preventDefault();
    chooseCandidate(button.dataset.userId);
  });
  return popup;
}

function positionPopup(){
  if(!popup || popup.hidden || !input) return;
  const rect = input.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 18);
  popup.style.width = width + "px";
  popup.style.left = Math.max(9, Math.min(window.innerWidth - width - 9, rect.left)) + "px";
  const height = Math.min(popup.scrollHeight || 190, 270);
  const top = rect.top - height - 7;
  popup.style.top = (top >= 8 ? top : Math.min(window.innerHeight - height - 8, rect.bottom + 7)) + "px";
}

function closePopup(){
  if(!popup) return;
  popup.hidden = true;
  popup.replaceChildren();
  activeIndex = 0;
}

function renderPopup(){
  const trigger = detectTrigger(input);
  if(!trigger){ closePopup(); return; }

  const rows = currentResults();
  if(!rows.length){ closePopup(); return; }

  ensurePopup();
  activeIndex = Math.min(activeIndex, rows.length - 1);
  popup.innerHTML = rows.map((row,index) => `
    <button type="button" class="${index===activeIndex ? "is-active" : ""}" data-user-id="${escapeHtml(row.id)}" ${row.everyone ? 'data-mention-all="1"' : ""}>
      <span class="sr-sm-name">@${escapeHtml(row.name)}</span>
      ${row.everyone ? '<span class="sr-sm-online">Everyone</span>' : (row.online ? '<span class="sr-sm-online">Online</span>' : "")}
    </button>
  `).join("");
  popup.hidden = false;
  requestAnimationFrame(positionPopup);
}

function removeTypedTrigger(trigger){
  if(!input || !trigger) return;
  const value = String(input.value || "");
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.end);
  const next = before + after;
  input.value = next;
  const caret = trigger.start;
  try{ input.setSelectionRange(caret, caret); }catch{}
  input.dispatchEvent(new Event("input", { bubbles:true }));
}

function chooseCandidate(userId){
  const trigger = detectTrigger(input);
  const id = String(userId || "");
  if(!trigger || !input) return;

  const state = stateFor(input);
  if(id === ALL_ID){
    if(!allowEveryone()) return;
    state.all = true;
    state.users.clear();
    removeTypedTrigger(trigger);
    renderChips(input);
    closePopup();
    input.focus();
    return;
  }

  const row = readCandidates().find((item) => item.id === id);
  if(!row) return;
  if(!state.users.has(row.id) && state.users.size >= MAX_MENTIONS) return;

  state.all = false;
  state.users.set(row.id, { name:row.name });
  removeTypedTrigger(trigger);
  renderChips(input);
  closePopup();
  input.focus();
}

function onInput(){
  activeIndex = 0;
  pruneSelected(input);
  renderPopup();
}

function onKeydown(event){
  if(!popup || popup.hidden) return;
  const rows = currentResults();
  if(!rows.length) return;

  if(event.key === "ArrowDown"){
    event.preventDefault();
    activeIndex = (activeIndex + 1) % rows.length;
    renderPopup();
    return;
  }
  if(event.key === "ArrowUp"){
    event.preventDefault();
    activeIndex = (activeIndex - 1 + rows.length) % rows.length;
    renderPopup();
    return;
  }
  if(event.key === "Enter"){
    event.preventDefault();
    event.stopImmediatePropagation();
    chooseCandidate(rows[activeIndex]?.id);
    return;
  }
  if(event.key === "Escape"){
    event.preventDefault();
    closePopup();
  }
}

export function installSupportMentionsLite(options = {}){
  if(installed) return;
  input = options?.input || document.getElementById("supportMessageInput");
  usersRoot = options?.usersRoot || document.getElementById("supportUsersList");
  allowedUser = typeof options?.isCandidateAllowed === "function" ? options.isCandidateAllowed : (() => true);
  allowEveryone = typeof options?.allowEveryone === "function" ? options.allowEveryone : (() => false);
  if(!input || !usersRoot) return;

  installed = true;
  ensureStyles();
  ensurePopup();
  ensureChipRail();
  renderChips(input);

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown, true);
  input.addEventListener("blur", () => setTimeout(closePopup, 120));
  window.addEventListener("resize", positionPopup);
  window.addEventListener("scroll", positionPopup, true);

  window.__srSupportMentionsLite = Object.freeze({
    getMentionUserIds,
    getMentionAll,
    getMentionLabels,
    hasMentions,
    clear,
    refresh,
    max:MAX_MENTIONS,
  });
}

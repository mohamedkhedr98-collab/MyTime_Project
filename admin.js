
import { supabase } from "./supabase-client.js";
import { ADMIN_NAME } from "./supabase-config.js";

const overlay = document.getElementById("adminOverlay");
const closeBtn = document.getElementById("adminCloseBtn");

const authBox = document.getElementById("adminAuthBox");
const panel = document.getElementById("adminPanel");
const passInput = document.getElementById("adminPasswordInput");
const loginBtn = document.getElementById("adminLoginBtn");
const authStatus = document.getElementById("adminAuthStatus");
const adminStatus = document.getElementById("adminStatus");
const ADMIN_CONSOLE_BUILD = "My Time Admin Console V2.1";

function ensureMembersAdminSurface(){
  const supportBtn = document.querySelector(".admin-tab[data-tab='support']");
  const supportPanel = document.getElementById("adminTabSupport");
  if(!supportBtn || !supportPanel) return null;

  let membersBtn = document.querySelector(".admin-tab[data-tab='members']");
  if(!membersBtn){
    membersBtn = document.createElement("button");
    membersBtn.type = "button";
    membersBtn.className = "admin-tab";
    membersBtn.dataset.tab = "members";
    membersBtn.textContent = "Members";
    supportBtn.insertAdjacentElement("afterend", membersBtn);
  }

  let membersPanel = document.getElementById("adminTabMembers");
  if(!membersPanel){
    membersPanel = document.createElement("div");
    membersPanel.id = "adminTabMembers";
    membersPanel.className = "admin-tab-panel";
    membersPanel.style.display = "none";
    membersPanel.setAttribute("role","region");
    membersPanel.setAttribute("aria-label","Members management");
    supportPanel.insertAdjacentElement("afterend", membersPanel);
  }

  if(overlay){
    overlay.dataset.adminBuild = ADMIN_CONSOLE_BUILD;
    overlay.setAttribute("aria-hidden","true");
  }

  if(!document.getElementById("adminConsoleV2Styles")){
    const link = document.createElement("link");
    link.id = "adminConsoleV2Styles";
    link.rel = "stylesheet";
    link.href = "./admin-console-v2.css?v=20260923-v2";
    document.head.appendChild(link);
  }

  const modal = overlay?.querySelector(".admin-modal");
  if(modal){
    modal.classList.add("admin-console-v2","admin-auth-mode");
    const header = modal.querySelector(".support-modal-header");
    const heading = header?.querySelector("h2");
    if(heading) heading.textContent = "Admin Control Center";
    if(header && !header.querySelector(".admin-shell-subtitle")){
      const brandWrap = document.createElement("div");
      brandWrap.className = "admin-shell-brand";
      if(heading){
        heading.insertAdjacentElement("beforebegin",brandWrap);
        brandWrap.appendChild(heading);
      }else{
        header.prepend(brandWrap);
      }
      const subtitle = document.createElement("div");
      subtitle.className = "admin-shell-subtitle";
      subtitle.textContent = "MY TIME • MEMBERS • SUPPORT • SAFETY";
      brandWrap.appendChild(subtitle);
    }
  }

  return membersPanel;
}

const tabMembers = ensureMembersAdminSurface();
const adminTabsHost = document.querySelector("#adminPanel .admin-tabs");
const tabSuggestions = document.getElementById("adminTabSuggestions");
const tabSupport = document.getElementById("adminTabSupport");
const tabBlocks = document.getElementById("adminTabBlocks");
const tabAnnouncements = document.getElementById("adminTabAnnouncements");

const ADMIN_TAB_PANEL_IDS = Object.freeze({
  suggestions: "adminTabSuggestions",
  support: "adminTabSupport",
  members: "adminTabMembers",
  blocks: "adminTabBlocks",
  announcements: "adminTabAnnouncements",
  "sr-manager": "adminTabSrManager",
  "sr-access": "adminTabSrAccess",
  "sr-restore": "adminTabSrRestore",
  "login-help": "adminTabLoginHelp",
});

function resolveAdminTabPanel(button){
  if(!button) return null;
  const controlledId = String(button.getAttribute("aria-controls") || "").trim();
  const panelId = controlledId || ADMIN_TAB_PANEL_IDS[String(button.dataset.tab || "")] || "";
  return panelId ? document.getElementById(panelId) : null;
}

function activateAdminTab(button){
  if(!button || !adminTabsHost?.contains(button)) return false;
  const target = resolveAdminTabPanel(button);
  if(!target) return false;

  document.querySelectorAll("#adminPanel .admin-tab").forEach((item)=>{
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("#adminPanel .admin-tab-panel").forEach((item)=>{
    const active = item === target;
    item.style.display = active && String(button.dataset.tab || "") === "members" ? "flex" : (active ? "block" : "none");
    item.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if(button.dataset.tab === "members" && !membersLoaded) refreshMembers();
  try{
    window.dispatchEvent(new CustomEvent("sr:admin-tabchange", {
      detail:{ tab:String(button.dataset.tab || "") },
    }));
  }catch{}
  return true;
}

try { window.__srActivateAdminTab = activateAdminTab; } catch {}

adminTabsHost?.addEventListener("click", (event)=>{
  const button = event.target?.closest?.(".admin-tab");
  if(!button || !adminTabsHost.contains(button)) return;
  activateAdminTab(button);
});

let membersCache = [];
let membersMeta = {};
let memberSearchIndex = new Map();
let memberSelection = new Set();
let membersLoaded = false;

let adminPassword = ""; // kept only during the admin-login request; never sent after login

const URGENT_ARABIC_TTS_VOICES = [
  ["ar-EG-SalmaNeural", "Salma — Egyptian Arabic — Female"],
  ["ar-EG-ShakirNeural", "Shakir — Egyptian Arabic — Male"],
  ["ar-SA-ZariyahNeural", "Zariyah — Saudi Arabic — Female"],
  ["ar-SA-HamedNeural", "Hamed — Saudi Arabic — Male"],
  ["ar-AE-FatimaNeural", "Fatima — UAE Arabic — Female"],
  ["ar-AE-HamdanNeural", "Hamdan — UAE Arabic — Male"],
  ["ar-JO-SanaNeural", "Sana — Jordanian Arabic — Female"],
  ["ar-JO-TaimNeural", "Taim — Jordanian Arabic — Male"],
  ["ar-KW-NouraNeural", "Noura — Kuwaiti Arabic — Female"],
  ["ar-KW-FahedNeural", "Fahed — Kuwaiti Arabic — Male"],
  ["ar-QA-AmalNeural", "Amal — Qatari Arabic — Female"],
  ["ar-QA-MoazNeural", "Moaz — Qatari Arabic — Male"],
  ["ar-BH-LailaNeural", "Laila — Bahraini Arabic — Female"],
  ["ar-BH-AliNeural", "Ali — Bahraini Arabic — Male"],
  ["ar-IQ-RanaNeural", "Rana — Iraqi Arabic — Female"],
  ["ar-IQ-BasselNeural", "Bassel — Iraqi Arabic — Male"],
  ["ar-LB-LaylaNeural", "Layla — Lebanese Arabic — Female"],
  ["ar-LB-RamiNeural", "Rami — Lebanese Arabic — Male"],
  ["ar-MA-MounaNeural", "Mouna — Moroccan Arabic — Female"],
  ["ar-MA-JamalNeural", "Jamal — Moroccan Arabic — Male"],
  ["ar-OM-AyshaNeural", "Aysha — Omani Arabic — Female"],
  ["ar-OM-AbdullahNeural", "Abdullah — Omani Arabic — Male"],
  ["ar-SY-AmanyNeural", "Amany — Syrian Arabic — Female"],
  ["ar-SY-LaithNeural", "Laith — Syrian Arabic — Male"],
  ["ar-TN-ReemNeural", "Reem — Tunisian Arabic — Female"],
  ["ar-TN-HediNeural", "Hedi — Tunisian Arabic — Male"],
  ["ar-YE-MaryamNeural", "Maryam — Yemeni Arabic — Female"],
  ["ar-YE-SalehNeural", "Saleh — Yemeni Arabic — Male"]
];
const DEFAULT_URGENT_ARABIC_TTS_VOICE = "ar-EG-SalmaNeural";
function normalizeUrgentArabicVoice(v=""){
  const val = String(v || "").trim();
  return URGENT_ARABIC_TTS_VOICES.some(([id]) => id === val) ? val : DEFAULT_URGENT_ARABIC_TTS_VOICE;
}
function renderUrgentArabicVoiceOptions(selected=""){
  const active = normalizeUrgentArabicVoice(selected);
  return URGENT_ARABIC_TTS_VOICES.map(([id, label]) => `<option value="${id}"${id === active ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function show(el){ el.style.display = "flex"; }
function hide(el){ el.style.display = "none"; }

function setAdminScrollLock(locked){
  document.documentElement.classList.toggle("admin-shell-open",!!locked);
  document.body.classList.toggle("admin-shell-open",!!locked);
  if(overlay) overlay.setAttribute("aria-hidden",locked ? "false" : "true");
}

function setAdminAuthMode(enabled){
  const modal=overlay?.querySelector(".admin-modal");
  modal?.classList.toggle("admin-auth-mode",!!enabled);
}
function escapeHtml(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function fmtTime(ts){ try { return new Date(ts).toLocaleString(); } catch { return ""; } }
function setAuthStatus(t, type="info"){ authStatus.textContent=t||""; authStatus.dataset.type=type; }
function setAdminStatus(t, type="info"){ adminStatus.textContent=t||""; adminStatus.dataset.type=type; }

// Consistent per-user colors (matches Support UI)
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

async function apiAdmin(path, body){
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

async function apiAdminLogin(password){
  const res = await fetch("/api/admin-login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_password: password }),
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || "Admin login failed");
  return data;
}

async function apiAdminLogout(){
  try {
    await fetch("/api/admin-logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {}
}

function openAdmin(){
  passInput.value = "";
  adminPassword = "";
  authBox.style.display = "block";
  panel.style.display = "none";
  setAdminAuthMode(true);
  setAdminScrollLock(true);
  setAuthStatus("");
  setAdminStatus("");
  show(overlay);
  setTimeout(()=>passInput.focus(), 50);
}

function closeAdmin(){
  adminPassword = "";
  try { passInput.value = ""; } catch {}
  apiAdminLogout();
  setAdminScrollLock(false);
  setAdminAuthMode(true);
  hide(overlay);
}

function isAdminWorking(){
  return panel?.style?.display !== "none" && authBox?.style?.display === "none";
}

try {
  window.__srOpenAdminPanel = openAdmin;
  window.addEventListener("sr:open-admin", openAdmin);
} catch {}

// While the authenticated Admin workspace is open, only the explicit close button
// may dismiss it. Background clicks and Escape are ignored to prevent accidental
// closure while selecting text, scrolling, using dropdowns, or editing SR blocks.
closeBtn?.addEventListener("click", closeAdmin);
overlay?.addEventListener("click", (e)=>{
  if(e.target!==overlay) return;
  if(isAdminWorking()) return;
  closeAdmin();
});
document.addEventListener("keydown", (e)=>{
  if(e.key!=="Escape" || overlay.style.display==="none") return;
  if(isAdminWorking()) return;
  closeAdmin();
});
window.addEventListener("pagehide",()=>setAdminScrollLock(false),{once:false});

loginBtn?.addEventListener("click", async ()=>{
  const p = (passInput.value || "").trim();
  if(!p) return;
  adminPassword = p;
  // quick auth check by calling list blocks endpoint (light)
  try{
    setAuthStatus("Checking…");
    await apiAdminLogin(p);
    adminPassword = "";
    try { passInput.value = ""; } catch {}
    await apiAdmin("/api/admin-ping", {});
    setAuthStatus("");
    authBox.style.display = "none";
    panel.style.display = "flex";
    setAdminAuthMode(false);
    await refreshAll();
    try{
      const [srModule, accessModule, restoreModule, loginHelpModule] = await Promise.all([
        import("./admin-sr-manager.js?v=20261015-opened-proof-v4"),
        import("./admin-sr-access.js?v=20260925-sr-admin-access-v5"),
        import("./admin-sr-restore.js?v=20260926-sr-exact-restore-v1"),
        import("./admin-login-help.js?v=20261008-login-help-realtime-v2"),
      ]);
      await srModule.mountSrAdmin({ setAdminStatus });
      await accessModule.mountSrAdminAccess({ setAdminStatus });
      await restoreModule.mountSrRestoreActions({ setAdminStatus });
      await loginHelpModule.mountLoginHelpAdmin({ setAdminStatus, supabase });
    }catch(srError){
      console.error("SR Administration load failed", srError);
      setAdminStatus("Admin loaded, but SR Administration could not start.", "error");
    }
  }catch(err){
    console.error(err);
    adminPassword = "";
    setAuthStatus("Invalid password. Please contact Admin.", "error");
  }
});

async function refreshSuggestions(){
  const { data, error } = await supabase
    .from("suggestions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if(error){
    tabSuggestions.innerHTML = `<div class="admin-empty">Could not load suggestions. Please contact ${ADMIN_NAME}.</div>`;
    return;
  }
  if(!data || data.length===0){
    tabSuggestions.innerHTML = `<div class="admin-empty">No suggestions yet.</div>`;
    return;
  }
  tabSuggestions.innerHTML = data.map(r => `
  <div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-meta">${escapeHtml(fmtTime(r.created_at))} • ID ${escapeHtml(String(r.id))} • User ${escapeHtml(String(r.user_id || ""))}</div>
      <div class="admin-row-text">${escapeHtml(r.text || "")}</div>
    </div>
    <div class="admin-row-actions">
      <button class="admin-action" data-action="delete-suggestion" data-id="${escapeHtml(String(r.id))}">Delete</button>
      <button class="admin-action danger" data-action="delete-block-suggestion" data-id="${escapeHtml(String(r.id))}" data-user="${escapeHtml(String(r.user_id||""))}">Delete + Block</button>
    </div>
  </div>
`).join("");

tabSuggestions.querySelectorAll("button[data-action='delete-suggestion']").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const id = btn.getAttribute("data-id");
    if(!id) return;
    try{
      setAdminStatus("Deleting…");
      await apiAdmin("/api/admin-delete", { table: "suggestions", id: Number(id) });
      setAdminStatus("Deleted ✅");
      await refreshSuggestions();
      window.dispatchEvent(new CustomEvent("sr:suggestions-changed"));
    }catch(err){
      console.error(err);
      setAdminStatus(`Could not delete. Please contact ${ADMIN_NAME}.`, "error");
    }
  });
});

tabSuggestions.querySelectorAll("button[data-action='delete-block-suggestion']").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const id = btn.getAttribute("data-id");
    const userId = btn.getAttribute("data-user");
    if(!id) return;
    if(!userId){
      setAdminStatus("Missing user id on this record. Please contact Admin.", "error");
      return;
    }
    const minutesStr = prompt("Block duration in minutes:", "60");
    if(!minutesStr) return;
    const minutes = Number(minutesStr);
    if(!Number.isFinite(minutes) || minutes <= 0) return;

    try{
      setAdminStatus("Blocking…");
      const out = await apiAdmin("/api/admin-block", { user_id: userId, minutes });
      setAdminStatus(`Blocked until ${fmtTime(out.expires_at)}. Deleting…`);
      await apiAdmin("/api/admin-delete", { table: "suggestions", id: Number(id) });
      setAdminStatus(`Deleted + Blocked until ${fmtTime(out.expires_at)} ✅`);
      await refreshSuggestions();
      window.dispatchEvent(new CustomEvent("sr:suggestions-changed"));
      await refreshBlocks();
    }catch(err){
      console.error(err);
      setAdminStatus(`Could not apply action. Please contact ${ADMIN_NAME}.`, "error");
    }
  });
});

}

async function refreshSupport(){
  let data = [];
  try {
    const out = await apiAdmin("/api/admin-support-messages", {});
    data = Array.isArray(out?.rows) ? out.rows : [];
  } catch (error) {
    tabSupport.innerHTML = `<div class="admin-empty">Could not load chat messages. Please contact ${ADMIN_NAME}.</div>`;
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const publicMsgs = rows.filter((r) => r && String(r.room_type || "public") === "public");
  const privateMsgs = rows.filter((r) => r && String(r.room_type || "public") !== "public");

  function renderBulkBar(groupKey, title) {
    return `
      <div class="admin-bulkbar" data-group="${escapeHtml(groupKey)}">
        <span class="admin-bulk-title">${escapeHtml(title)}</span>
        <button class="admin-bulkbtn" type="button" data-bulk="select-all" data-group="${escapeHtml(groupKey)}">Select all</button>
        <button class="admin-bulkbtn" type="button" data-bulk="clear" data-group="${escapeHtml(groupKey)}">Clear</button>
        <button class="admin-bulkbtn danger" type="button" data-bulk="delete-selected" data-group="${escapeHtml(groupKey)}">Delete selected</button>
        <span class="admin-bulk-count" data-count-for="${escapeHtml(groupKey)}"></span>
      </div>
    `;
  }

  function renderRows(list, groupKey) {
    if (!list || list.length === 0) {
      return `<div class="admin-empty">No messages.</div>`;
    }
    return list
      .map(
        (r) => `
      <div class="admin-row" data-group="${escapeHtml(groupKey)}">
        <label class="admin-check" title="Select">
          <input class="admin-msg-check" type="checkbox" data-group="${escapeHtml(groupKey)}" data-id="${escapeHtml(String(r.id))}" />
        </label>
        <div class="admin-row-main">
          <div class="admin-row-meta">
            ${escapeHtml(fmtTime(r.created_at))} • ${escapeHtml(r.room_id || "public")} •
            <b>${escapeHtml(r.sender_name || "User")}</b> (${escapeHtml(r.sender_id || "")})
          </div>
          <div class="admin-row-text">${escapeHtml(r.message || "")}</div>
        </div>
        <div class="admin-row-actions">
          <button class="admin-action" type="button" data-action="delete-chat" data-id="${escapeHtml(String(r.id))}">Delete</button>
          <button class="admin-action danger" type="button" data-action="block-user" data-user="${escapeHtml(String(r.sender_id || ""))}">Block</button>
        </div>
      </div>
    `
      )
      .join("");
  }

  tabSupport.innerHTML = `
    <div style="margin:6px 0 12px; font-weight:800;">Public Support</div>
    ${renderBulkBar("public", "Bulk")}
    <div id="adminPublicSupportList">${renderRows(publicMsgs, "public")}</div>

    <hr style="opacity:0.15;margin:16px 0;" />

    <div style="margin:6px 0 12px; font-weight:800;">Private Support (DM)</div>
    ${renderBulkBar("private", "Bulk")}
    <div id="adminPrivateSupportList">${renderRows(privateMsgs, "private")}</div>

  `;

  // ----- Single row actions -----
  tabSupport.querySelectorAll("button[data-action='delete-chat']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      try {
        setAdminStatus("Deleting…");
        await apiAdmin("/api/admin-delete", { table: "support_messages", id: Number(id) });
        setAdminStatus("Deleted ✅");
        await refreshSupport();
      } catch (err) {
        console.error(err);
        setAdminStatus(`Could not delete. Please contact ${ADMIN_NAME}.`, "error");
      }
    });
  });

  tabSupport.querySelectorAll("button[data-action='block-user']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-user");
      if (!userId) return;
      const minutesStr = prompt("Block duration in minutes:", "60");
      if (!minutesStr) return;
      const minutes = Number(minutesStr);
      if (!Number.isFinite(minutes) || minutes <= 0) return;

      try {
        setAdminStatus("Blocking…");
        const out = await apiAdmin("/api/admin-block", { user_id: userId, minutes });
        setAdminStatus(`Blocked until ${fmtTime(out.expires_at)} ✅`);
        await refreshBlocks();
      } catch (err) {
        console.error(err);
        setAdminStatus(`Could not block user. Please contact ${ADMIN_NAME}.`, "error");
      }
    });
  });

  // ----- Bulk actions -----
  function updateBulkCount(groupKey) {
    const checks = Array.from(tabSupport.querySelectorAll(`input.admin-msg-check[data-group='${groupKey}']`));
    const selected = checks.filter((c) => c.checked).length;
    const el = tabSupport.querySelector(`.admin-bulk-count[data-count-for='${groupKey}']`);
    if (el) el.textContent = selected ? `${selected} selected` : "";
  }

  ["public", "private"].forEach((g) => {
    tabSupport.querySelectorAll(`input.admin-msg-check[data-group='${g}']`).forEach((c) => {
      c.addEventListener("change", () => updateBulkCount(g));
    });
    updateBulkCount(g);
  });

  tabSupport.querySelectorAll("button[data-bulk='select-all']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.getAttribute("data-group") || "";
      tabSupport.querySelectorAll(`input.admin-msg-check[data-group='${g}']`).forEach((c) => (c.checked = true));
      updateBulkCount(g);
    });
  });

  tabSupport.querySelectorAll("button[data-bulk='clear']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.getAttribute("data-group") || "";
      tabSupport.querySelectorAll(`input.admin-msg-check[data-group='${g}']`).forEach((c) => (c.checked = false));
      updateBulkCount(g);
    });
  });

  tabSupport.querySelectorAll("button[data-bulk='delete-selected']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const g = btn.getAttribute("data-group") || "";
      const ids = Array.from(tabSupport.querySelectorAll(`input.admin-msg-check[data-group='${g}']`))
        .filter((c) => c.checked)
        .map((c) => Number(c.getAttribute("data-id")))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) return;
      const ok = confirm(`Delete ${ids.length} messages?`);
      if (!ok) return;
      try {
        setAdminStatus("Bulk deleting…");
        await apiAdmin("/api/admin-bulk-delete", { table: "support_messages", ids });
        setAdminStatus("Bulk delete ✅");
        await refreshSupport();
      } catch (err) {
        console.error(err);
        // Fallback: delete one by one
        try {
          for (const id of ids) {
            await apiAdmin("/api/admin-delete", { table: "support_messages", id });
          }
          setAdminStatus("Bulk delete ✅");
          await refreshSupport();
        } catch (err2) {
          console.error(err2);
          setAdminStatus(`Could not bulk delete. Please contact ${ADMIN_NAME}.`, "error");
        }
      }
    });
  });
}

async function refreshMembers(){
  if(!tabMembers) return;
  membersLoaded = true;
  tabMembers.innerHTML = '<div class="admin-empty">Loading members…</div>';

  try{
    const out = await apiAdmin("/api/admin-members", {});
    membersCache = Array.isArray(out?.rows) ? out.rows : [];
    membersMeta = out || {};
    memberSearchIndex = new Map(membersCache.map((member)=>{
      const account=member?.account || {};
      const textValue=[
        member?.display_name,
        member?.user_id,
        member?.account_status,
        account?.email,
        account?.mobile,
        account?.auth_user_id,
        account?.telegram_username,
        account?.telegram_user_id,
      ].map((v)=>String(v || "").toLowerCase()).join(" ");
      return [String(member?.user_id || ""),textValue];
    }));
    memberSelection = new Set(Array.from(memberSelection).filter((uid)=>membersCache.some((m)=>m.user_id===uid)));
  }catch(err){
    membersLoaded = false;
    tabMembers.innerHTML = `<div class="admin-empty">Could not load members: ${escapeHtml(err?.message || String(err || ""))}</div>`;
    return;
  }

  const stats = membersMeta?.stats || {};
  const truncated = membersMeta?.truncated || {};
  const availability = membersMeta?.availability || {};

  tabMembers.innerHTML = `
    <div class="members-console">
      <div class="members-toolbar">
        <input id="adminMemberSearch" class="members-search" type="search" aria-label="Search members" placeholder="Search nickname, mobile, email or user ID…" autocomplete="off" />
        <select id="adminMemberFilter" class="members-filter" aria-label="Filter members">
          <option value="all">All members</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
          <option value="linked">Linked Auth</option>
          <option value="unlinked">No Auth</option>
          <option value="nickname-reset">Needs nickname</option>
        </select>
        <button id="adminMembersRefreshBtn" class="admin-action" type="button">Refresh members</button>
      </div>

      <div class="members-stats">
        <div class="member-stat"><b>${escapeHtml(String(stats.total || 0))}</b><span>Total</span></div>
        <div class="member-stat"><b>${escapeHtml(String(stats.active || 0))}</b><span>Active</span></div>
        <div class="member-stat"><b>${escapeHtml(String(stats.linked || 0))}</b><span>Auth linked</span></div>
        <div class="member-stat"><b>${escapeHtml(String(stats.blocked || 0))}</b><span>Blocked</span></div>
        <div class="member-stat"><b>${escapeHtml(String(stats.nickname_reset || 0))}</b><span>Needs nickname</span></div>
      </div>

      <div class="members-bulkbar">
        <button id="adminMembersSelectVisible" class="admin-bulkbtn" type="button">Select visible</button>
        <button id="adminMembersClearSelection" class="admin-bulkbtn" type="button">Clear</button>
        <button id="adminMembersResetSelected" class="admin-bulkbtn" type="button">Reset selected nicknames</button>
        <button id="adminMembersDeleteSelected" class="admin-bulkbtn danger" type="button">Delete selected accounts</button>
        <span id="adminMembersSelectionCount" class="members-bulk-count"></span>
      </div>

      ${(!availability.auth || truncated.auth_users || truncated.members || truncated.legacy_devices || truncated.trusted_devices)
        ? `<div class="members-note">
            ${!availability.auth ? "Auth email data is temporarily unavailable. " : ""}
            ${truncated.auth_users ? "Auth user list reached its safety cap. " : ""}
            ${truncated.members ? "Member list reached its safety cap. " : ""}
            ${truncated.legacy_devices || truncated.trusted_devices ? "Device summary reached its bounded scan cap; counts may be partial." : ""}
           </div>`
        : ""}

      <div id="adminMembersList" class="members-list"></div>
    </div>
  `;

  const search = tabMembers.querySelector("#adminMemberSearch");
  const filter = tabMembers.querySelector("#adminMemberFilter");
  const list = tabMembers.querySelector("#adminMembersList");
  const count = tabMembers.querySelector("#adminMembersSelectionCount");

  function memberMatches(member){
    const q = String(search?.value || "").trim().toLowerCase();
    const f = String(filter?.value || "all");
    const account = member?.account || {};
    const block = member?.block || {};

    let filterOk = true;
    if(f==="active") filterOk = member?.account_status === "active";
    else if(f==="blocked") filterOk = !!block.active;
    else if(f==="linked") filterOk = !!account.linked;
    else if(f==="unlinked") filterOk = !account.linked;
    else if(f==="nickname-reset") filterOk = !!member?.nickname_reset_required;
    if(!filterOk) return false;
    if(!q) return true;

    const hay = memberSearchIndex.get(String(member?.user_id || "")) || "";
    return hay.includes(q);
  }

  function visibleMembers(){
    return membersCache.filter(memberMatches);
  }

  function formatValue(value,fallback="—"){
    const v = String(value || "").trim();
    return v ? escapeHtml(v) : fallback;
  }

  function formatDateValue(value){
    return value ? escapeHtml(fmtTime(value)) : "—";
  }

  function renderMembers(){
    const rows = visibleMembers();
    if(!rows.length){
      list.innerHTML = '<div class="admin-empty">No members match this search/filter.</div>';
      updateSelectionCount();
      return;
    }

    list.innerHTML = rows.map((m)=>{
      const uid = String(m?.user_id || "");
      const account = m?.account || {};
      const block = m?.block || {};
      const dev = m?.devices || {};
      const checked = memberSelection.has(uid) ? " checked" : "";
      const name = String(m?.display_name || "").trim() || "Needs new nickname";
      const col = colorForUserId(uid);
      const linkedBadge = account.linked
        ? '<span class="member-badge ok">Auth linked</span>'
        : '<span class="member-badge warn">No Auth</span>';
      const statusBadge = m?.account_status === "active"
        ? '<span class="member-badge ok">Active</span>'
        : `<span class="member-badge bad">${escapeHtml(String(m?.account_status || "archived"))}</span>`;
      const blockedBadge = block.active
        ? `<span class="member-badge bad">${block.scope==="tool" ? "Tool blocked" : "Support blocked"}</span>`
        : '';
      const nickBadge = m?.nickname_reset_required ? '<span class="member-badge warn">Needs nickname</span>' : '';

      return `
        <article class="member-card" data-member-id="${escapeHtml(uid)}">
          <label class="member-select" title="Select member">
            <input type="checkbox" data-member-select="${escapeHtml(uid)}"${checked} />
          </label>

          <div class="member-main">
            <div class="member-head">
              <span class="member-dot" style="--u:${escapeHtml(col)}"></span>
              <span class="member-name">${escapeHtml(name)}</span>
              ${statusBadge}${linkedBadge}${blockedBadge}${nickBadge}
            </div>

            <div class="member-contact-grid">
              <div class="member-contact"><span>Email</span><b title="${formatValue(account.email)}">${formatValue(account.email)}</b></div>
              <div class="member-contact"><span>Mobile</span><b>${formatValue(account.mobile)}</b></div>
            </div>

            <div class="member-mini">
              User ID: <b>${escapeHtml(uid)}</b>
              • Last sign-in: ${formatDateValue(account.last_sign_in_at)}
              • Last seen: ${formatDateValue(dev.last_seen_at)}
              ${block.active ? (block.scope==="tool" ? " • Tool blocked until Admin unblocks" : ` • Support blocked until: ${formatDateValue(block.until)}`) : ""}
            </div>

            <details class="member-details">
              <summary>More user data</summary>
              <div class="member-detail-grid">
                <div class="member-detail"><span>Auth user ID</span><b>${formatValue(account.auth_user_id)}</b></div>
                <div class="member-detail"><span>Account status</span><b>${formatValue(m.account_status)}</b></div>
                <div class="member-detail"><span>Nickname</span><b>${formatValue(m.display_name,"(reset pending)")}</b></div>
                <div class="member-detail"><span>Member created</span><b>${formatDateValue(m.created_at)}</b></div>
                <div class="member-detail"><span>Member updated</span><b>${formatDateValue(m.updated_at)}</b></div>
                <div class="member-detail"><span>Disabled at</span><b>${formatDateValue(m.disabled_at)}</b></div>
                <div class="member-detail"><span>Linked at</span><b>${formatDateValue(account.linked_at)}</b></div>
                <div class="member-detail"><span>Link source</span><b>${formatValue(account.link_source)}</b></div>
                <div class="member-detail"><span>Auth created</span><b>${formatDateValue(account.auth_created_at)}</b></div>
                <div class="member-detail"><span>Email confirmed</span><b>${formatDateValue(account.email_confirmed_at)}</b></div>
                <div class="member-detail"><span>Signup pledge</span><b>${formatValue(account.signup_pledge_version)}</b></div>
                <div class="member-detail"><span>Trusted devices</span><b>${escapeHtml(String(dev.trusted_active || 0))} active / ${escapeHtml(String(dev.trusted_revoked || 0))} revoked</b></div>
                <div class="member-detail"><span>Legacy devices</span><b>${escapeHtml(String(dev.legacy_active || 0))} active / ${escapeHtml(String(dev.legacy_revoked || 0))} revoked</b></div>
                <div class="member-detail"><span>Best confidence</span><b>${escapeHtml(String(dev.best_confidence || 0))}%</b></div>
                <div class="member-detail"><span>Trusted last login</span><b>${formatDateValue(dev.last_login_at)}</b></div>
                <div class="member-detail"><span>Telegram</span><b>${formatValue(account.telegram_username || account.telegram_user_id)}</b></div>
                <div class="member-detail"><span>Block type</span><b>${block.active ? (block.scope==="tool" ? "Tool / Login" : "Support") : "—"}</b></div>
                <div class="member-detail"><span>Block reason</span><b>${formatValue(block.reason)}</b></div>
                <div class="member-detail"><span>Block until</span><b>${block.active && block.manual_release_only ? "Until Admin unblocks" : formatDateValue(block.until)}</b></div>
              </div>
            </details>
          </div>

          <div class="member-actions">
            <button class="member-action" type="button" data-member-action="reset-nickname" data-user-id="${escapeHtml(uid)}" ${m.account_status==="active" ? "" : "disabled"}>Reset nickname</button>
            ${block.active
              ? `<button class="member-action" type="button" data-member-action="unblock" data-user-id="${escapeHtml(uid)}">Unblock</button>`
              : `
                <button class="member-action" type="button" data-member-action="block-support" data-user-id="${escapeHtml(uid)}" ${m.account_status==="active" ? "" : "disabled"}>Block Support</button>
                <button class="member-action danger" type="button" data-member-action="block-tool" data-user-id="${escapeHtml(uid)}" ${m.account_status==="active" ? "" : "disabled"}>Block Tool</button>
              `}
            <button class="member-action danger" type="button" data-member-action="delete-account" data-user-id="${escapeHtml(uid)}" ${account.linked ? "" : "disabled"}>Delete account</button>
          </div>
        </article>
      `;
    }).join("");

    list.querySelectorAll("input[data-member-select]").forEach((box)=>{
      box.addEventListener("change",()=>{
        const uid=String(box.getAttribute("data-member-select") || "");
        if(box.checked) memberSelection.add(uid);
        else memberSelection.delete(uid);
        updateSelectionCount();
      });
    });
    updateSelectionCount();
  }

  function updateSelectionCount(){
    if(!count) return;
    if(!memberSelection.size){
      count.textContent="";
      return;
    }
    const selectedRows=Array.from(memberSelection)
      .map((uid)=>membersCache.find((m)=>m.user_id===uid))
      .filter(Boolean);
    const activeCount=selectedRows.filter((m)=>m.account_status==="active").length;
    count.textContent=activeCount===memberSelection.size
      ? `${memberSelection.size} selected`
      : `${memberSelection.size} selected • ${activeCount} active`;
  }

  async function resetNicknames(userIds){
    const selectedIds=Array.from(new Set(userIds)).filter((uid)=>
      Boolean(uid) && membersCache.some((m)=>m.user_id===uid)
    );
    if(!selectedIds.length) return;

    if(!confirm(`Reset nickname for ${selectedIds.length} selected member${selectedIds.length===1 ? "" : "s"}?\n\nThis clears the nickname only. The member record and account status stay unchanged, and the user will choose a new nickname on the next login.`)) return;

    setAdminStatus(`Resetting ${selectedIds.length} nickname${selectedIds.length===1 ? "" : "s"}…`);
    const out=selectedIds.length===1
      ? await apiAdmin("/api/admin-delete-support-user",{user_id:selectedIds[0]})
      : await apiAdmin("/api/admin-delete-support-user",{user_ids:selectedIds});

    const resetCount=Number(out?.reset_count ?? (out?.reset ? 1 : 0));
    const skippedCount=Number(out?.skipped_count || 0);
    const warnings=Array.isArray(out?.cleanup_warnings) ? out.cleanup_warnings : [];

    const parts=[`${resetCount} nickname${resetCount===1 ? "" : "s"} reset ✅`];
    if(skippedCount) parts.push(`${skippedCount} not found/skipped`);
    if(warnings.length) parts.push("device cleanup warning");
    setAdminStatus(parts.join(" • "),warnings.length || skippedCount ? "warn" : "info");

    memberSelection = new Set();
    await refreshMembers();
  }

  async function deleteAccounts(userIds){
    const ids=Array.from(new Set(userIds))
      .filter((uid)=>membersCache.some((m)=>m.user_id===uid && m?.account?.linked));
    if(!ids.length){
      setAdminStatus("Selected members do not have linked login accounts.", "warn");
      return;
    }
    if(ids.length>20){
      setAdminStatus("Delete up to 20 accounts at a time.", "warn");
      return;
    }
    const labels=ids.slice(0,5).map((uid)=>{
      const m=membersCache.find((x)=>x.user_id===uid);
      return `• ${String(m?.display_name || uid)} — ${String(m?.account?.email || m?.account?.mobile || "")}`;
    }).join("\n");
    const extra=ids.length>5 ? `\n…and ${ids.length-5} more` : "";
    if(!confirm(`Delete ${ids.length} login account${ids.length===1 ? "" : "s"}?\n\n${labels}${extra}\n\nEmail/mobile will be freed for NEW accounts. Historical internal rows stay archived to protect chat/history references.`)) return;

    setAdminStatus("Deleting account…");
    const out=ids.length===1
      ? await apiAdmin("/api/admin-account-access",{action:"delete_login_account",user_id:ids[0],confirm_text:"DELETE"})
      : await apiAdmin("/api/admin-account-access",{action:"delete_login_accounts",user_ids:ids,confirm_text:"DELETE"});

    const failed=Array.isArray(out?.failed) ? out.failed.length : 0;
    const deleted=Number(out?.deleted_count ?? (out?.deleted_login_account ? 1 : 0));
    setAdminStatus(failed ? `Deleted ${deleted}; failed ${failed}.` : `Account deletion completed ✅ (${deleted || ids.length})`, failed ? "warn" : "info");
    memberSelection = new Set();
    await refreshMembers();
    await refreshBlocks();
  }

  let memberSearchTimer=0;
  search?.addEventListener("input",()=>{
    if(memberSearchTimer) clearTimeout(memberSearchTimer);
    memberSearchTimer=setTimeout(()=>{
      memberSearchTimer=0;
      renderMembers();
    },70);
  });
  filter?.addEventListener("change",()=>{
    if(memberSearchTimer){
      clearTimeout(memberSearchTimer);
      memberSearchTimer=0;
    }
    renderMembers();
  });

  tabMembers.querySelector("#adminMembersRefreshBtn")?.addEventListener("click",async()=>{
    membersLoaded=false;
    await refreshMembers();
  });

  tabMembers.querySelector("#adminMembersSelectVisible")?.addEventListener("click",()=>{
    visibleMembers().forEach((m)=>memberSelection.add(String(m.user_id || "")));
    renderMembers();
  });

  tabMembers.querySelector("#adminMembersClearSelection")?.addEventListener("click",()=>{
    memberSelection = new Set();
    renderMembers();
  });

  tabMembers.querySelector("#adminMembersResetSelected")?.addEventListener("click",async()=>{
    await resetNicknames(Array.from(memberSelection));
  });

  tabMembers.querySelector("#adminMembersDeleteSelected")?.addEventListener("click",async()=>{
    await deleteAccounts(Array.from(memberSelection));
  });

  list.addEventListener("click",async(e)=>{
    const btn=e.target.closest("button[data-member-action]");
    if(!btn) return;
    const uid=String(btn.getAttribute("data-user-id") || "");
    const action=String(btn.getAttribute("data-member-action") || "");
    if(!uid || !action) return;

    const member=membersCache.find((m)=>m.user_id===uid);
    if(action==="reset-nickname"){
      await resetNicknames([uid]);
      return;
    }
    if(action==="delete-account"){
      await deleteAccounts([uid]);
      return;
    }
    if(action==="unblock"){
      setAdminStatus("Unblocking member…");
      await apiAdmin("/api/admin-unblock",{user_id:uid});
      setAdminStatus("Unblocked ✅");
      await refreshMembers();
      await refreshBlocks();
      return;
    }
    if(action==="block-support"){
      const minutesText=prompt(
        `Block SUPPORT for ${String(member?.display_name || uid)} for how many minutes?\n60 = 1 hour • 1440 = 24 hours • 10080 = 7 days`,
        "1440"
      );
      if(!minutesText) return;
      const minutes=Number(minutesText);
      if(!Number.isFinite(minutes) || minutes<=0){
        setAdminStatus("Invalid block duration.", "warn");
        return;
      }
      setAdminStatus("Blocking Support access…");
      const out=await apiAdmin("/api/admin-block",{
        user_id:uid,
        scope:"support",
        minutes,
        reason:"Support access blocked from Members admin",
      });
      setAdminStatus(`Support blocked until ${fmtTime(out.expires_at)} ✅`);
      await refreshMembers();
      await refreshBlocks();
      return;
    }
    if(action==="block-tool"){
      const ok=confirm(
        `Block TOOL LOGIN for ${String(member?.display_name || uid)}?\n\nThe user will not be able to sign in or open MyTime until an Admin presses Unblock.`
      );
      if(!ok) return;
      setAdminStatus("Blocking Tool/Login access…");
      await apiAdmin("/api/admin-block",{
        user_id:uid,
        scope:"tool",
        reason:"Tool/Login access blocked from Members admin",
      });
      setAdminStatus("Tool/Login blocked until Admin unblocks ✅");
      await refreshMembers();
      await refreshBlocks();
      return;
    }
  });

  renderMembers();
}

async function refreshBlocks(){
  // The blocks table schema can vary across deployments.
  // Preferred column: expires_at
  // Compat/legacy column: blocked_until
  let res = await supabase
    .from("blocks")
    .select("*")
    .order("expires_at", { ascending: false })
    .limit(200);

  if(res.error && (String(res.error.message || "").includes("expires_at") || String(res.error.details || "").includes("expires_at"))) {
    res = await supabase
      .from("blocks")
      .select("*")
      .order("blocked_until", { ascending: false })
      .limit(200);
  }

  const data = res.data;
  const error = res.error;

  if(error){
    tabBlocks.innerHTML = `<div class="admin-empty">Could not load blocks. Please contact ${ADMIN_NAME}.</div>`;
    return;
  }
  const now=Date.now();
  const activeBlocks=(Array.isArray(data) ? data : []).filter((r)=>{
    if(r?.manual_release_only === true) return true;
    const until=r?.expires_at || r?.blocked_until || "";
    const ts=Date.parse(until);
    return Number.isFinite(ts) && ts>now;
  });
  if(activeBlocks.length===0){
    tabBlocks.innerHTML = `<div class="admin-empty">No active blocks.</div>`;
    return;
  }

  tabBlocks.innerHTML = activeBlocks.map(r => {
    const until = r.expires_at || r.blocked_until || "";
    const scope = String(r.scope || "support") === "tool" ? "Tool / Login" : "Support";
    const untilLabel = r.manual_release_only === true ? "Until Admin unblocks" : fmtTime(until);
    return `
    <div class="admin-row">
      <div class="admin-row-main">
        <div class="admin-row-meta">
          User: <b>${escapeHtml(r.user_id||"")}</b> • Type: <b>${escapeHtml(scope)}</b> • Until: ${escapeHtml(untilLabel)}
        </div>
        <div class="admin-row-text">${escapeHtml(r.reason || "")}</div>
      </div>
      <div class="admin-row-actions">
        <button class="admin-action" data-action="unblock" data-user="${escapeHtml(r.user_id||"")}">Unblock</button>
      </div>
    </div>
  `;
  }).join("");

  tabBlocks.querySelectorAll("button[data-action='unblock']").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const userId = btn.getAttribute("data-user");
      if(!userId) return;
      try{
        setAdminStatus("Unblocking…");
        await apiAdmin("/api/admin-unblock", { user_id: userId });
        setAdminStatus("Unblocked ✅");
        await refreshBlocks();
      }catch(err){
        console.error(err);
        setAdminStatus(`Could not unblock. Please contact ${ADMIN_NAME}.`, "error");
      }
    });
  });
}

async function refreshAll(){
  // Independent admin datasets: same request count, much lower wall-clock time.
  await Promise.all([
    refreshSuggestions(),
    refreshSupport(),
    refreshBlocks(),
    refreshAnnouncements(),
  ]);
}

async function refreshAnnouncements(){
  if(!tabAnnouncements) return;

  let notificationBroadcasts = [];
  let deletedNotificationBroadcasts = [];
  const releaseRevision=String(document.querySelector('meta[name="sr-release-revision"]')?.content || "").trim().toLowerCase();
  const releasePublishedAt=String(document.querySelector('meta[name="sr-release-published-at"]')?.content || "").trim();
  const validRelease=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(releaseRevision);
  try{
    const [activeOut, deletedOut] = await Promise.all([
      apiAdmin("/api/admin-notification-broadcast", { action:"list", release_revision:validRelease?releaseRevision:"" }),
      apiAdmin("/api/admin-notification-broadcast", { action:"deleted_list", limit:60 }),
    ]);
    notificationBroadcasts = Array.isArray(activeOut?.items) ? activeOut.items : [];
    if(validRelease && activeOut?.release_removed!==true){
      notificationBroadcasts.push({
        kind:"release",
        release_revision:releaseRevision,
        title:"Tool Update",
        message:"تم نشر إصدار جديد للتول. معرّف التحديث: "+releaseRevision.slice(0,7),
        created_at:Number.isFinite(Date.parse(releasePublishedAt)) ? releasePublishedAt : new Date().toISOString(),
      });
    }
    notificationBroadcasts.sort((a,b)=>
      (Date.parse(b?.created_at||"")||0)-(Date.parse(a?.created_at||"")||0));
    deletedNotificationBroadcasts = Array.isArray(deletedOut?.items) ? deletedOut.items : [];
  }catch{}

  // Fetch latest announcement via server (service role) so Admin works even if RLS hides the table.
  // Supports both legacy single-text format and the newer { envelope, urgent, urgent_enabled } JSON format.
  let current = { envelope_text: "", urgent_text: "", urgent_enabled: false, urgent_voice: DEFAULT_URGENT_ARABIC_TTS_VOICE, created_at: null, text: "" };

  try{
    const res = await fetch("/api/admin-announcement", { method: "GET" });
    const data = await res.json().catch(()=>({}));
    if(res.ok){
      current = {
        envelope_text: String(data?.envelope_text ?? data?.text ?? ""),
        urgent_text: String(data?.urgent_text ?? ""),
        urgent_enabled: !!(data?.urgent_enabled),
        urgent_voice: normalizeUrgentArabicVoice(data?.urgent_voice),
        created_at: data?.created_at || null,
        text: String(data?.text ?? "")
      };
    }
  }catch(e){
    // Fallback to direct Supabase read (best-effort)
    try{
      let fallback = await supabase
        .from("announcements")
        .select("*")
        .eq("kind", "announcement")
        .order("created_at", { ascending: false })
        .limit(1);
      if(fallback.error && /kind|column .*does not exist|schema cache/i.test(String(fallback.error.message || ""))){
        fallback = await supabase
          .from("announcements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1);
      }
      const { data, error } = fallback;
      if(!error && Array.isArray(data) && data.length > 0){
        const item = data[0] || {};
        const raw = String(item.text || "");
        let envelope_text = "";
        let urgent_text = "";
        let urgent_enabled = false;
        let urgent_voice = DEFAULT_URGENT_ARABIC_TTS_VOICE;

        try{
          const obj = JSON.parse(raw);
          if(obj && typeof obj === "object"){
            envelope_text = String(obj.envelope || "");
            urgent_text = String(obj.urgent || "");
            urgent_enabled = !!obj.urgent_enabled;
            urgent_voice = normalizeUrgentArabicVoice(obj.urgent_voice);
          }else{
            envelope_text = raw;
          }
        }catch{
          const prefix = "URGENT_TICKER::";
          if(raw.startsWith(prefix)){
            urgent_enabled = true;
            urgent_text = raw.slice(prefix.length).trim();
          }else{
            envelope_text = raw;
          }
        }
        current = { envelope_text, urgent_text, urgent_enabled, urgent_voice: normalizeUrgentArabicVoice(urgent_voice), created_at: item.created_at || null, text: raw };
      }
    }catch(_){}
  }

  const when = current.created_at ? fmtTime(current.created_at) : "";
  const lastEnvelope = String(current.envelope_text || "").trim();
  const lastUrgent = String(current.urgent_text || "").trim();
  const lastUrgentEnabled = !!current.urgent_enabled;
  const lastUrgentVoice = normalizeUrgentArabicVoice(current.urgent_voice);

  const broadcastHistoryHtml = notificationBroadcasts.length
    ? notificationBroadcasts.slice(0, 20).map((item) => `
        <div style="padding:9px 10px;border:1px solid rgba(255,255,255,.10);border-radius:10px;margin-top:6px;background:rgba(255,255,255,.035);">
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
            <b style="font-size:12px;min-width:0;">${escapeHtml(item?.title || "Admin notification")}</b>
            <span style="font-size:10px;opacity:.62;white-space:nowrap;">${escapeHtml(fmtTime(item?.created_at))}</span>
          </div>
          <div style="font-size:12px;line-height:1.45;margin-top:4px;white-space:pre-wrap;">${escapeHtml(item?.message || "")}</div>
          <div style="display:flex;justify-content:flex-end;margin-top:8px;">
            <button
              type="button"
              class="admin-action"
              ${item?.kind === "release" ? 'data-admin-release-delete-revision="' + escapeHtml(item.release_revision) + '"' : 'data-admin-notification-delete-id="' + (Number(item?.id) || 0) + '"'}
              style="min-width:84px;border-color:rgba(255,91,105,.28);color:#ffd0d5;background:rgba(255,67,84,.07);">
              Delete
            </button>
          </div>
        </div>
      `).join("")
    : "<div style='opacity:.6;font-size:12px;margin-top:8px;'>No notification broadcasts yet.</div>";

  const deletedBroadcastHistoryHtml = deletedNotificationBroadcasts.length
    ? deletedNotificationBroadcasts.slice(0, 60).map((item) => `
        <div style="padding:9px 10px;border:1px dashed rgba(255,255,255,.11);border-radius:10px;margin-top:6px;background:rgba(255,255,255,.02);opacity:.88;">
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
            <b style="font-size:12px;min-width:0;">${escapeHtml(item?.title || "Admin notification")}</b>
            <span style="font-size:10px;opacity:.62;white-space:nowrap;">Deleted ${escapeHtml(fmtTime(item?.deleted_at))}</span>
          </div>
          <div style="font-size:12px;line-height:1.45;margin-top:4px;white-space:pre-wrap;">${escapeHtml(item?.message || "")}</div>
        </div>
      `).join("")
    : "<div style='opacity:.6;font-size:12px;margin-top:8px;'>No deleted notifications yet.</div>";

  tabAnnouncements.innerHTML = `
    <div class="admin-row" style="border-color:rgba(255,181,72,.28);">
      <div class="admin-row-main">
        <div style="font-weight:800;margin-bottom:8px;">🔔 Notification Center — send to all users</div>
        <input id="adminNotificationBroadcastTitle" class="admin-input" maxlength="80" placeholder="Title (optional)" />
        <textarea id="adminNotificationBroadcastMessage" class="admin-input" rows="4" maxlength="1200" style="margin-top:8px;" placeholder="Write a notification for all users..."></textarea>
        <div style="font-size:11px;opacity:.68;margin-top:6px;">Appears in every user's Notifications bell. Each user reads it independently.</div>
        <div style="margin-top:12px;font-weight:700;font-size:12px;">Recent notification broadcasts</div>
        <div id="adminNotificationBroadcastHistory">${broadcastHistoryHtml}</div>

        <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-weight:750;font-size:12px;">Deleted notifications — Admin only</div>
              <div style="font-size:10px;opacity:.62;margin-top:2px;">Hidden from every user's Notifications bell.</div>
            </div>
            <span style="font-size:10px;opacity:.72;">${deletedNotificationBroadcasts.length} archived</span>
          </div>
          <div id="adminNotificationDeletedHistory">${deletedBroadcastHistoryHtml}</div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button id="adminNotificationBroadcastSendBtn" class="admin-action">Send to all</button>
      </div>
    </div>

    <div class="admin-row">
      <div class="admin-row-main">
        <div class="admin-row-meta">${when ? `Last update at ${escapeHtml(when)}` : "No announcement posted"}</div>
        <div class="admin-row-text"><b>Envelope message:</b><br>${escapeHtml(lastEnvelope) || "<span style='opacity:.6'>(empty)</span>"}</div>
        <div class="admin-row-text" style="margin-top:10px;"><b>Urgent moving banner:</b> ${lastUrgentEnabled ? "<span style='color:#00e676'>(enabled)</span>" : "<span style='opacity:.7'>(disabled)</span>"}<br>${escapeHtml(lastUrgent) || "<span style='opacity:.6'>(empty)</span>"}</div>
      </div>
    </div>

    <div class="admin-row">
      <div class="admin-row-main">
        <div style="font-weight:700;margin-bottom:6px;">Envelope message (shows inside the envelope)</div>
        <textarea id="adminAnnouncementEnvelopeInput" class="admin-input" rows="4" placeholder="Write envelope message..."></textarea>

        <div style="font-weight:700;margin-top:14px;margin-bottom:6px;">Urgent moving banner (right → left)</div>
        <textarea id="adminAnnouncementUrgentInput" class="admin-input" rows="3" placeholder="Write urgent message..."></textarea>

        <div style="font-weight:700;margin-top:10px;margin-bottom:6px;">Arabic voice for urgent reading</div>
        <select id="adminAnnouncementUrgentVoiceSelect" class="admin-input" style="height:42px;cursor:pointer;">
          ${renderUrgentArabicVoiceOptions(lastUrgentVoice)}
        </select>
        <div style="font-size:12px;opacity:.75;margin-top:6px;">Free Edge TTS voice used only when the urgent message contains Arabic.</div>

        <label class="admin-check" style="margin-top:10px;">
          <input type="checkbox" id="adminAnnouncementUrgentChk" />
          <span>Enable urgent moving banner (will not disappear until user clicks “فهمت”)</span>
        </label>
      </div>
      <div class="admin-row-actions">
        <button id="adminAnnouncementSaveBtn" class="admin-action">Save</button>
      </div>
    </div>
  `;

  const broadcastTitleInput = tabAnnouncements.querySelector("#adminNotificationBroadcastTitle");
  const broadcastMessageInput = tabAnnouncements.querySelector("#adminNotificationBroadcastMessage");
  const broadcastSendBtn = tabAnnouncements.querySelector("#adminNotificationBroadcastSendBtn");

  tabAnnouncements.querySelectorAll("[data-admin-notification-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.adminNotificationDeleteId);
      if(!Number.isSafeInteger(id) || id <= 0) return;
      if(!window.confirm("Delete this notification for everyone and move it to the Admin archive?")) return;

      try{
        button.disabled = true;
        setAdminStatus("Deleting notification…");
        await apiAdmin("/api/admin-notification-broadcast", {
          action:"delete",
          broadcast_id:id,
        });
        setAdminStatus("Notification deleted and moved to Admin archive ✅");
        await refreshAnnouncements();
      }catch(err){
        console.error(err);
        setAdminStatus(`Could not delete notification. ${String(err?.message || "")}`, "error");
      }finally{
        if(button.isConnected) button.disabled = false;
      }
    });
  });

  tabAnnouncements.querySelectorAll("[data-admin-release-delete-revision]").forEach((button)=>{
    button.addEventListener("click",async()=>{
      const revision=String(button.dataset.adminReleaseDeleteRevision||"");
      if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision))return;
      if(!window.confirm("Remove this Tool Update from all users' notification bells?"))return;
      try{
        button.disabled=true;
        setAdminStatus("Removing Tool Update…");
        await apiAdmin("/api/admin-notification-broadcast",{
          action:"delete_release",release_revision:revision,
        });
        setAdminStatus("Tool Update removed from all users' notification bells ✅");
        await refreshAnnouncements();
      }catch(error){
        console.error(error);
        setAdminStatus("Could not remove Tool Update: "+String(error?.message||""),"error");
      }finally{
        if(button.isConnected)button.disabled=false;
      }
    });
  });

  if(broadcastSendBtn){
    broadcastSendBtn.addEventListener("click", async () => {
      const title = String(broadcastTitleInput?.value || "").trim();
      const message = String(broadcastMessageInput?.value || "").trim();
      if(!message){
        setAdminStatus("Write the notification message first.", "warn");
        broadcastMessageInput?.focus();
        return;
      }

      try{
        broadcastSendBtn.disabled = true;
        setAdminStatus("Sending notification to all users…");
        await apiAdmin("/api/admin-notification-broadcast", {
          action:"create",
          title,
          message,
        });
        setAdminStatus("Notification sent to all users ✅");
        await refreshAnnouncements();
      }catch(err){
        console.error(err);
        setAdminStatus(`Could not send notification. ${String(err?.message || "")}`, "error");
      }finally{
        if(broadcastSendBtn.isConnected) broadcastSendBtn.disabled = false;
      }
    });
  }

  const envInput = tabAnnouncements.querySelector("#adminAnnouncementEnvelopeInput");
  if(envInput) envInput.value = lastEnvelope;

  const urgInput = tabAnnouncements.querySelector("#adminAnnouncementUrgentInput");
  if(urgInput) urgInput.value = lastUrgent;

  const urgentChk = tabAnnouncements.querySelector("#adminAnnouncementUrgentChk");
  if(urgentChk) urgentChk.checked = lastUrgentEnabled;

  const urgentVoiceSelect = tabAnnouncements.querySelector("#adminAnnouncementUrgentVoiceSelect");
  if(urgentVoiceSelect) urgentVoiceSelect.value = lastUrgentVoice;

  const saveBtn = tabAnnouncements.querySelector("#adminAnnouncementSaveBtn");
  if(saveBtn){
    saveBtn.addEventListener("click", async ()=>{
      const envelopeVal = (envInput?.value || "").trim();
      const urgentVal = (urgInput?.value || "").trim();
      const urgentOn = !!urgentChk?.checked;
      const urgentVoice = normalizeUrgentArabicVoice(urgentVoiceSelect?.value);

      if(!envelopeVal && !(urgentOn && urgentVal)){
        setAdminStatus("Write an envelope message or enable urgent with a message.", "warn");
        return;
      }
      if(urgentOn && !urgentVal){
        setAdminStatus("Urgent banner is enabled but its message is empty.", "warn");
        return;
      }

      try{
        setAdminStatus("Saving…");
        await apiAdmin("/api/admin-announcement", {
          envelope_text: envelopeVal,
          urgent_text: urgentVal,
          urgent_enabled: urgentOn,
          urgent_voice: urgentVoice
        });
        setAdminStatus("Saved ✅");
        await refreshAnnouncements();
      }catch(err){
        console.error(err);
        setAdminStatus(`Could not save announcement. ${String(err?.message||"")}`, "error");
      }
    });
  }
}

// ---------- Hidden trigger: click logo 5 times ----------
let clickCount = 0;
let clickTimer = null;

function armLogo(el){
  if(!el || el.dataset.adminBound === "1") return;
  el.dataset.adminBound = "1";
  try {
    el.style.cursor = "pointer";
    el.style.pointerEvents = "auto";
    el.setAttribute("title", "Click 5 times to open Admin");
  } catch(e){}
  el.addEventListener("click", (evt)=>{
    try { evt.stopPropagation(); } catch(e){}
    clickCount += 1;
    if(clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(()=>{ clickCount = 0; }, 1800);
    if(clickCount >= 5){
      clickCount = 0;
      openAdmin();
    }
  });
}

function findAndArm(){
  // Required: open Admin by clicking the UA07 logo 5 times.
  // The UA07 logo is injected by app.js with id MNDO_UA07_LOGO3.
  const logoWrap =
    document.getElementById("UA07_LUX_LOGO_BETWEEN") ||
    document.getElementById("MNDO_UA07_LOGO3") ||
    document.getElementById("MNDO_UA07_LOGO");

  if(!logoWrap) return;

  // Support both the old SVG logo and the new image-based logo.
  const clickTarget =
    logoWrap.querySelector(".mndo-uwk07-logo-img") ||
    logoWrap.querySelector("img") ||
    logoWrap.querySelector("svg") ||
    logoWrap;

  try {
    logoWrap.style.pointerEvents = "auto";
    logoWrap.style.cursor = "pointer";
    clickTarget.style.pointerEvents = "auto";
    clickTarget.style.cursor = "pointer";
  } catch(e){}

  armLogo(logoWrap);
  if(clickTarget !== logoWrap) armLogo(clickTarget);
}

// admin.js is imported only after the logo trigger is used, so the logo already
// exists here. One bind is sufficient; the delegated loader remains the fallback.
findAndArm();

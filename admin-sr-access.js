const VERSION = "20260925-sr-admin-access-v5";

function esc(value=""){
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

async function api(body){
  const res = await fetch("/api/sr-admin-access", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "SR admin access request failed.");
  return data;
}

function ensureStyles(){
  if(document.getElementById("srAdminAccessStyles")) return;
  const link = document.createElement("link");
  link.id = "srAdminAccessStyles";
  link.rel = "stylesheet";
  link.href = "./admin-sr-access.css?v=" + VERSION;
  document.head.appendChild(link);
}

export async function mountSrAdminAccess({ setAdminStatus } = {}){
  if(document.getElementById("adminTabSrAccess")) return;
  ensureStyles();

  const tabsHost = document.querySelector("#adminPanel .admin-tabs");
  const panelHost = document.getElementById("adminPanel");
  if(!tabsHost || !panelHost) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-tab";
  btn.dataset.tab = "sr-access";
  btn.setAttribute("aria-controls", "adminTabSrAccess");
  btn.textContent = "SR Admins";
  tabsHost.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "adminTabSrAccess";
  panel.className = "admin-tab-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="sr-access-shell">
      <div class="sr-access-hero">
        <div>
          <div class="sr-access-eyebrow">SCOPED ACCESS • SR MANAGEMENT ONLY</div>
          <h3>SR Admins</h3>
          <p>Grant or revoke SR Management access without exposing account contact data.</p>
        </div>
        <span class="sr-access-privacy-badge">No Email / Mobile</span>
      </div>

      <section class="sr-access-supervisors-shell" aria-labelledby="srAccessSupervisorsTitle">
        <div class="sr-access-section-head">
          <div>
            <strong id="srAccessSupervisorsTitle">Current SR Supervisors</strong>
            <small>Full Admin can remove SR Management access immediately.</small>
          </div>
          <span id="srAccessSupervisorCount" class="sr-access-count">0</span>
        </div>
        <div id="srAccessSupervisors" class="sr-access-supervisors">
          <div class="sr-access-empty">No SR supervisors loaded yet.</div>
        </div>
      </section>

      <div class="sr-access-toolbar">
        <label class="sr-access-search-wrap" for="srAccessSearch">
          <span>Search users</span>
          <input id="srAccessSearch" class="sr-access-search" type="search" placeholder="Nickname or internal User ID…" autocomplete="off" />
        </label>
        <button id="srAccessRefresh" class="sr-access-refresh" type="button">Refresh</button>
      </div>

      <div class="sr-access-note">Only nickname and internal User ID are available here. Email, mobile, Telegram and Auth identifiers are not returned by this API.</div>

      <div id="srAccessList" class="sr-access-list"><div class="sr-access-empty">Open this tab to load users.</div></div>

      <div class="sr-access-audit-head">
        <div>
          <strong>Recent SR administration audit</strong>
          <small>Grant, revoke and publish activity without contact PII.</small>
        </div>
      </div>
      <div id="srAccessAudit" class="sr-access-audit"><div class="sr-access-empty">No audit events loaded yet.</div></div>
    </div>
  `;
  panelHost.insertBefore(panel, document.getElementById("adminStatus"));

  const search = panel.querySelector("#srAccessSearch");
  const supervisors = panel.querySelector("#srAccessSupervisors");
  const supervisorCount = panel.querySelector("#srAccessSupervisorCount");
  const list = panel.querySelector("#srAccessList");
  const audit = panel.querySelector("#srAccessAudit");
  const refresh = panel.querySelector("#srAccessRefresh");
  let data = null;

  function fmt(value){
    try{ return value ? new Date(value).toLocaleString() : "—"; }catch{ return "—"; }
  }

  function render(){
    const members = Array.isArray(data?.members) ? data.members : [];
    const currentSupervisors = members.filter((row)=>row?.sr_admin === true);
    supervisorCount.textContent = String(currentSupervisors.length);
    supervisors.innerHTML = currentSupervisors.length ? currentSupervisors.map((row)=>`
      <article class="sr-access-supervisor-card">
        <div class="sr-access-identity">
          <div class="sr-access-name-row">
            <span class="sr-access-name">${esc(row.display_name || "(no nickname)")}</span>
            <span class="sr-access-badge enabled">${row.role==="full_admin" ? "Full Admin" : "SR Supervisor"}</span>
          </div>
          <div class="sr-access-meta">
            User ID <b>${esc(row.user_id)}</b> • Granted ${esc(fmt(row.granted_at))}
          </div>
        </div>
        ${row.role==="full_admin"
          ? '<span class="sr-access-badge enabled">Protected role</span>'
          : `<button class="sr-access-button revoke supervisor-remove" type="button" data-revoke="${esc(row.user_id)}">Remove supervision</button>`}
      </article>
    `).join("") : '<div class="sr-access-empty">No SR supervisors assigned.</div>';

    const q = String(search.value || "").trim().toLowerCase();
    const rows = members.filter((row)=>{
      if(row?.sr_admin === true || String(row?.account_status || "") !== "active") return false;
      if(!q) return true;
      return [row.display_name,row.user_id].some((v)=>String(v || "").toLowerCase().includes(q));
    });
    list.innerHTML = rows.length ? rows.map((row)=>`
      <article class="sr-access-card" data-enabled="false">
        <div class="sr-access-identity">
          <div class="sr-access-name-row">
            <span class="sr-access-name">${esc(row.display_name || "(no nickname)")}</span>
            <span class="sr-access-badge">User</span>
          </div>
          <div class="sr-access-meta">User ID <b>${esc(row.user_id)}</b></div>
        </div>
        <div class="sr-access-actions">
          <button class="sr-access-button grant" type="button" data-grant="${esc(row.user_id)}">Grant SR Admin</button>
        </div>
      </article>
    `).join("") : '<div class="sr-access-empty">No active users available for a new SR supervisor grant.</div>';

    audit.innerHTML = (data?.audit || []).length ? data.audit.map((row)=>`
      <div class="sr-access-audit-row">
        <div class="sr-access-audit-top">
          <span class="sr-access-audit-event">${esc(row.event_type)}</span>
          <span>${esc(fmt(row.created_at))}</span>
        </div>
        <div class="sr-access-audit-main">${esc(row.actor_display_name || row.actor_user_id)}</div>
        <div class="sr-access-audit-meta">
          ${row.target_user_id ? "Target " + esc(row.target_user_id) + " • " : ""}
          ${row.commit_sha ? "Commit " + esc(row.commit_sha.slice(0,12)) + " • " : ""}
          ${row.operation_count ? esc(String(row.operation_count)) + " change(s)" : ""}
        </div>
      </div>
    `).join("") : '<div class="sr-access-empty">No SR admin audit events yet.</div>';

    list.querySelectorAll("[data-grant]").forEach((button)=>button.addEventListener("click", async ()=>{
      const uid = button.getAttribute("data-grant");
      if(!uid || !confirm("Grant SR Management access to this user?")) return;
      button.disabled = true;
      try{
        await api({ action:"grant", user_id:uid });
        window.dispatchEvent(new CustomEvent("sr:role-badges-changed", { detail:{ user_id:uid, role:"sr_admin" } }));
        setAdminStatus?.("SR Admin access granted.", "success");
        await load();
      }catch(error){
        button.disabled = false;
        setAdminStatus?.(error.message, "error");
      }
    }));

    panel.querySelectorAll("[data-revoke]").forEach((button)=>button.addEventListener("click", async ()=>{
      const uid = button.getAttribute("data-revoke");
      if(!uid || !confirm("Remove this user from SR supervision and revoke SR Management access?")) return;
      button.disabled = true;
      try{
        await api({ action:"revoke", user_id:uid });
        window.dispatchEvent(new CustomEvent("sr:role-badges-changed", { detail:{ user_id:uid, role:"" } }));
        setAdminStatus?.("SR supervision removed.", "success");
        await load();
      }catch(error){
        button.disabled = false;
        setAdminStatus?.(error.message, "error");
      }
    }));
  }

  async function load(){
    supervisors.innerHTML = '<div class="sr-access-empty">Loading SR supervisors…</div>';
    list.innerHTML = '<div class="sr-access-empty">Loading scoped access…</div>';
    try{
      data = await api({ action:"list" });
      render();
    }catch(error){
      supervisors.innerHTML = '<div class="sr-access-empty error">' + esc(error.message) + '</div>';
      list.innerHTML = '<div class="sr-access-empty error">' + esc(error.message) + '</div>';
    }
  }

  search.addEventListener("input", render);
  refresh.addEventListener("click", load);
  function activateThisTab(){
    const central = window.__srActivateAdminTab;
    if(typeof central === "function" && central(btn)) return;
    document.querySelectorAll("#adminPanel .admin-tab").forEach((item)=>item.classList.toggle("active", item === btn));
    document.querySelectorAll("#adminPanel .admin-tab-panel").forEach((item)=>{ item.style.display = item === panel ? "block" : "none"; });
  }

  btn.addEventListener("click", async ()=>{
    activateThisTab();
    if(!data) await load();
  });

  void VERSION;
}

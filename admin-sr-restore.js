const VERSION = "20260926-sr-exact-restore-v1";

function esc(value=""){
  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

async function api(body){
  const res = await fetch("/api/admin-sr-manager", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    const error = new Error(data?.error || "SR Restore request failed.");
    error.code = data?.code || "";
    throw error;
  }
  return data;
}

function ensureStyles(){
  if(document.getElementById("srRestoreActionsStyles")) return;
  const link = document.createElement("link");
  link.id = "srRestoreActionsStyles";
  link.rel = "stylesheet";
  link.href = "./admin-sr-restore.css?v=" + VERSION;
  document.head.appendChild(link);
}

function fmt(value){
  try{
    return value ? new Date(value).toLocaleString() : "—";
  }catch{
    return "—";
  }
}

function remaining(value){
  const ms = Date.parse(value || "") - Date.now();
  if(!Number.isFinite(ms) || ms <= 0) return "Expired";
  const days = Math.floor(ms / 86400000);
  const hours = Math.ceil((ms % 86400000) / 3600000);
  if(days > 0) return days + "d " + Math.max(0, hours) + "h left";
  return Math.max(1, hours) + "h left";
}

function operationLabel(operation){
  const op = String(operation || "");
  if(["insert_above","insert_below","append_to_menu","append_to_submenu"].includes(op)) return "Added SR";
  if(op === "replace") return "Edited SR";
  if(op === "delete") return "Deleted SR";
  if(op === "move_menu") return "Moved list";
  if(op === "move_submenu") return "Moved sub-list";
  if(op.startsWith("move_")) return "Moved SR";
  if(op === "create_menu") return "Created list";
  if(op === "create_submenu") return "Created sub-list";
  if(op === "delete_menu") return "Deleted list";
  if(op === "delete_submenu") return "Deleted sub-list";
  return op || "SR change";
}

function operationTone(operation){
  const op = String(operation || "");
  if(op === "delete" || op.startsWith("delete_")) return "danger";
  if(op === "replace" || op.startsWith("move_")) return "edit";
  return "add";
}

export async function mountSrRestoreActions({ setAdminStatus } = {}){
  if(document.getElementById("adminTabSrRestore")) return;
  ensureStyles();

  const tabsHost = document.querySelector("#adminPanel .admin-tabs");
  const panelHost = document.getElementById("adminPanel");
  if(!tabsHost || !panelHost) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-tab";
  btn.dataset.tab = "sr-restore";
  btn.setAttribute("aria-controls", "adminTabSrRestore");
  btn.textContent = "↩ Restore Actions";

  const srAccessBtn = tabsHost.querySelector('.admin-tab[data-tab="sr-access"]');
  if(srAccessBtn) srAccessBtn.insertAdjacentElement("afterend", btn);
  else tabsHost.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "adminTabSrRestore";
  panel.className = "admin-tab-panel";
  panel.style.display = "none";
  panel.setAttribute("role","region");
  panel.setAttribute("aria-label","SR Restore Actions");
  panel.innerHTML = `
    <div class="sr-restore-shell">
      <div class="sr-restore-hero">
        <div>
          <div class="sr-restore-eyebrow">FULL ADMIN ONLY • SAFE INVERSE RESTORE</div>
          <h3>Restore Actions</h3>
          <p>Restore one SR action without rolling back unrelated changes made after it.</p>
        </div>
        <div class="sr-restore-retention">10-day retention</div>
      </div>

      <div class="sr-restore-safety">
        Restore uses the exact original HTML location. If that exact slot changed, became ambiguous,
        or cannot be proven, Restore stops safely and nothing is written. It never guesses another position.
      </div>

      <div class="sr-restore-toolbar">
        <div>
          <strong id="srRestoreCount">0 restorable actions</strong>
          <small>Used actions disappear here and remain traceable in the SR audit.</small>
        </div>
        <button id="srRestoreRefresh" type="button">Refresh</button>
      </div>

      <div id="srRestoreStatus" class="sr-restore-status" hidden></div>
      <div id="srRestoreList" class="sr-restore-list">
        <div class="sr-restore-empty">Open this tab to load restore actions.</div>
      </div>
    </div>
  `;
  panelHost.insertBefore(panel, document.getElementById("adminStatus"));

  const list = panel.querySelector("#srRestoreList");
  const count = panel.querySelector("#srRestoreCount");
  const refresh = panel.querySelector("#srRestoreRefresh");
  const status = panel.querySelector("#srRestoreStatus");
  let items = null;

  function setLocalStatus(message="", type=""){
    status.hidden = !message;
    status.dataset.type = type;
    status.textContent = message || "";
  }

  function render(){
    const rows = Array.isArray(items) ? items : [];
    count.textContent = rows.length + " restorable action" + (rows.length === 1 ? "" : "s");

    if(!rows.length){
      list.innerHTML = '<div class="sr-restore-empty">No active restore actions. New SR Admin changes will stay here for 10 days.</div>';
      return;
    }

    list.innerHTML = rows.map((row)=>`
      <article class="sr-restore-card" data-restore-id="${Number(row.id || 0)}">
        <div class="sr-restore-card-main">
          <div class="sr-restore-title-row">
            <span class="sr-restore-kind ${operationTone(row.operation)}">${esc(operationLabel(row.operation))}</span>
            <strong>${esc(row.sr_name || row.summary || "SR action")}</strong>
            ${row.sr_type_id ? `<span class="sr-restore-id">ID ${esc(row.sr_type_id)}</span>` : ""}
          </div>
          <div class="sr-restore-path">${esc(row.sr_path || "Catalog structure")}</div>
          <div class="sr-restore-meta">
            By <b>${esc(row.actor_display_name || "Unknown supervisor")}</b>
            <span>•</span> ${esc(fmt(row.created_at))}
            <span>•</span> ${esc(remaining(row.expires_at))}
            <span>•</span> commit ${esc(String(row.commit_sha || "").slice(0, 10))}
          </div>
        </div>
        <div class="sr-restore-actions">
          <button type="button" data-restore-action="${Number(row.id || 0)}">Review & Restore</button>
        </div>
      </article>
    `).join("");

    list.querySelectorAll("[data-restore-action]").forEach((button)=>{
      button.addEventListener("click", async ()=>{
        const id = Number(button.getAttribute("data-restore-action") || 0);
        const row = rows.find((item)=>Number(item.id || 0) === id);
        if(!id || !row) return;

        button.disabled = true;
        setLocalStatus("Validating this restore against the current SR Target catalog…","pending");

        try{
          const prepared = await api({ action:"restore_prepare", restoreId:id });
          const source = prepared?.source || {};
          const before = Number(prepared?.before?.srCount || 0);
          const after = Number(prepared?.after?.srCount || 0);

          const confirmation = [
            "Restore this SR action?",
            "",
            operationLabel(source.operation || row.operation) + ": " + (source.srName || row.sr_name || row.summary || "SR action"),
            source.srTypeId ? "SR ID: " + source.srTypeId : "",
            "Path: " + (source.path || row.sr_path || "Catalog structure"),
            "Originally by: " + (source.actorDisplayName || row.actor_display_name || "Unknown supervisor"),
            "SR count: " + before + " → " + after,
            "",
            "This creates ONE new GitHub commit and does not roll back unrelated changes.",
          ].filter(Boolean).join("\n");

          if(!window.confirm(confirmation)){
            setLocalStatus("Restore cancelled. Nothing was written.","");
            button.disabled = false;
            return;
          }

          setLocalStatus("Validation passed • writing one safe restore commit…","pending");
          const saved = await api({
            action:"restore_commit",
            restoreId:id,
            expectedSha:prepared.expectedSha,
            prepareToken:prepared.prepareToken,
          });

          const label = saved?.restored?.srName || row.sr_name || row.summary || "SR action";
          setLocalStatus("Restored successfully • " + label + ". Cloudflare deployment will follow the new GitHub commit.","success");
          setAdminStatus?.("SR action restored successfully.", "success");
          await load();
        }catch(error){
          setLocalStatus(error.message + " No restore write was performed unless a success message is shown.","error");
          setAdminStatus?.(error.message, "error");
          button.disabled = false;
        }
      });
    });
  }

  async function load(){
    refresh.disabled = true;
    if(!items) list.innerHTML = '<div class="sr-restore-empty">Loading restore actions…</div>';
    try{
      const data = await api({ action:"restore_list" });
      items = Array.isArray(data?.items) ? data.items : [];
      render();
    }catch(error){
      items = [];
      list.innerHTML = '<div class="sr-restore-empty error">' + esc(error.message) + '</div>';
      setAdminStatus?.(error.message, "error");
    }finally{
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", load);

  function activateThisTab(){
    const central = window.__srActivateAdminTab;
    if(typeof central === "function" && central(btn)) return;
    document.querySelectorAll("#adminPanel .admin-tab").forEach((item)=>item.classList.toggle("active", item === btn));
    document.querySelectorAll("#adminPanel .admin-tab-panel").forEach((item)=>{ item.style.display = item === panel ? "block" : "none"; });
  }

  btn.addEventListener("click", async ()=>{
    activateThisTab();
    if(!items) await load();
  });
}

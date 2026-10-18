const VERSION = "20261008-login-help-realtime-v2";

function esc(value=""){
  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function fmt(value){
  try{ return value ? new Date(value).toLocaleString() : "—"; }catch{ return "—"; }
}
function fmtCairo(value){
  try{
    const date = new Date(value);
    if(!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone:"Africa/Cairo",
      day:"2-digit",
      month:"short",
      year:"numeric",
      hour:"numeric",
      minute:"2-digit",
      hour12:true,
    }).format(date) + " Cairo";
  }catch{
    return "—";
  }
}
function afterRequestLabel(requestAt, loginAt){
  const start = Date.parse(String(requestAt || ""));
  const end = Date.parse(String(loginAt || ""));
  if(!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const minutes = Math.max(1, Math.floor((end - start) / 60000));
  if(minutes < 60) return minutes + "m after request";
  const hours = Math.floor(minutes / 60);
  if(hours < 24) return hours + "h " + (minutes % 60) + "m after request";
  const days = Math.floor(hours / 24);
  return days + "d " + (hours % 24) + "h after request";
}
async function api(body){
  const res = await fetch("/api/admin-login-help", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(body || {}),
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Login Help request failed.");
  return data;
}
function ensureStyles(){
  if(document.getElementById("adminLoginHelpStyles")) return;
  const link = document.createElement("link");
  link.id = "adminLoginHelpStyles";
  link.rel = "stylesheet";
  link.href = "./admin-login-help.css?v=" + VERSION;
  document.head.appendChild(link);
}

export async function mountLoginHelpAdmin({ setAdminStatus, supabase } = {}){
  if(document.getElementById("adminTabLoginHelp")) return;
  ensureStyles();

  const tabsHost = document.querySelector("#adminPanel .admin-tabs");
  const panelHost = document.getElementById("adminPanel");
  const statusHost = document.getElementById("adminStatus");
  if(!tabsHost || !panelHost) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-tab login-help-tab";
  button.dataset.tab = "login-help";
  button.setAttribute("aria-controls", "adminTabLoginHelp");
  button.innerHTML = '<span>Login Help</span><span class="login-help-tab-count" aria-label="new requests"></span>';
  tabsHost.appendChild(button);

  const panel = document.createElement("div");
  panel.id = "adminTabLoginHelp";
  panel.className = "admin-tab-panel login-help-panel";
  panel.style.display = "none";
  panel.setAttribute("role","region");
  panel.setAttribute("aria-label","Login help requests");
  panel.innerHTML = `
    <div class="login-help-admin-shell">
      <div class="login-help-admin-head">
        <div>
          <div class="login-help-admin-kicker">PRE-LOGIN SUPPORT</div>
          <h3>Account & Login Help</h3>
          <p>Requests sent from the login page. Reply from My Time Support without exposing any admin identity; customer replies return to the same ticket.</p>
        </div>
        <button id="loginHelpRefresh" type="button" class="login-help-admin-refresh">Refresh</button>
      </div>

      <div class="login-help-admin-toolbar">
        <input id="loginHelpSearch" type="search" placeholder="Search company email, Gmail, mobile, message, mode or build…" autocomplete="off" />
        <select id="loginHelpFilter" aria-label="Request status">
          <option value="new">New first</option>
          <option value="all">All</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div id="loginHelpAdminList" class="login-help-admin-list">
        <div class="login-help-admin-empty">Loading requests…</div>
      </div>
    </div>
  `;
  panelHost.insertBefore(panel, statusHost || null);

  const countNode = button.querySelector(".login-help-tab-count");
  const list = panel.querySelector("#loginHelpAdminList");
  const search = panel.querySelector("#loginHelpSearch");
  const filter = panel.querySelector("#loginHelpFilter");
  const refresh = panel.querySelector("#loginHelpRefresh");

  let rows = [];
  let loaded = false;

  // Event-driven only: one Realtime channel while the Login Help tab is visible.
  // No timer, no interval, and no repeated API reads when nothing changes.
  let replyRealtimeChannel = null;
  let realtimeRefreshPending = false;
  let realtimeRefreshRunning = false;

  function historyMarkup(messages){
    return messages.length
      ? messages.map((item) => `
          <div class="login-help-thread-message ${item?.direction === "customer" ? "customer" : "support"}">
            <div class="login-help-thread-label">${item?.direction === "customer" ? "User" : "My Time Support"} • ${esc(fmt(item?.created_at))}</div>
            <div class="login-help-thread-body">${esc(item?.body || "")}</div>
          </div>
        `).join("")
      : '<div class="login-help-thread-empty">No email replies yet.</div>';
  }

  function threadSummaryText(messages){
    const userReplies = messages.filter((item)=>item?.direction === "customer").length;
    const total = messages.length;
    return userReplies + " user repl" + (userReplies === 1 ? "y" : "ies") + " • " + total + " message" + (total === 1 ? "" : "s");
  }

  function openThreadHosts(){
    return Array.from(list.querySelectorAll('[data-login-help-thread-host][data-open="1"]'));
  }

  async function refreshThreadHistory(id, threadHost){
    if(!threadHost || threadHost.dataset.open !== "1") return;
    const data = await api({ action:"thread", id });
    if(threadHost.dataset.open !== "1") return;

    const currentHistory = threadHost.querySelector(".login-help-thread-history");
    if(!currentHistory) return;
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    currentHistory.innerHTML = historyMarkup(messages);

    const summaryNode = threadHost.querySelector("[data-login-help-thread-summary]");
    if(summaryNode) summaryNode.textContent = threadSummaryText(messages);

    // A received Gmail reply is the important event. Always reveal the newest
    // message immediately instead of leaving it below an unobvious inner scroll.
    requestAnimationFrame(()=>{ currentHistory.scrollTop = currentHistory.scrollHeight; });
  }

  async function refreshOpenThreads(){
    const hosts = openThreadHosts();
    await Promise.allSettled(hosts.map((threadHost)=>{
      const card = threadHost.closest("[data-login-help-id]");
      const id = String(card?.dataset.loginHelpId || "");
      return id ? refreshThreadHistory(id, threadHost) : Promise.resolve();
    }));
  }

  async function refreshRealtimeView(){
    if(openThreadHosts().length){
      await refreshOpenThreads();
      return;
    }
    // No editor is open, so a quiet list refresh can safely update NEW badges/status.
    await load({ quiet:true });
  }

  function scheduleRealtimeRefresh(){
    realtimeRefreshPending = true;
    if(realtimeRefreshRunning) return;
    queueMicrotask(async ()=>{
      realtimeRefreshRunning = true;
      try{
        while(realtimeRefreshPending){
          realtimeRefreshPending = false;
          await refreshRealtimeView();
        }
      }catch(error){
        console.warn("Login Help realtime refresh failed", error);
      }finally{
        realtimeRefreshRunning = false;
      }
    });
  }

  function loginHelpTabVisible(){
    return !document.hidden && panel.style.display !== "none" && panel.getAttribute("aria-hidden") !== "true";
  }

  async function stopReplyRealtime(){
    const channel = replyRealtimeChannel;
    replyRealtimeChannel = null;
    if(!channel || !supabase) return;
    try{
      await supabase.removeChannel(channel);
    }catch{
      try{ await channel.unsubscribe?.(); }catch{}
    }
  }

  function ensureReplyRealtime(){
    if(!loginHelpTabVisible() || replyRealtimeChannel || !supabase?.channel) return;
    try{
      replyRealtimeChannel = supabase
        .channel("login-help-admin", { config:{ broadcast:{ self:false } } })
        .on("broadcast", { event:"login_help_changed" }, scheduleRealtimeRefresh)
        .subscribe();
    }catch(error){
      replyRealtimeChannel = null;
      console.warn("Login Help realtime unavailable", error);
    }
  }

  function syncReplyRealtime(){
    if(loginHelpTabVisible()) ensureReplyRealtime();
    else void stopReplyRealtime();
  }

  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden){
      void stopReplyRealtime();
      return;
    }
    if(loginHelpTabVisible()){
      // Catch anything that arrived while the browser tab was hidden, then resume push.
      scheduleRealtimeRefresh();
      ensureReplyRealtime();
    }
  });

  window.addEventListener("pagehide", ()=>{ void stopReplyRealtime(); }, { once:true });

  function updateBadge(){
    const pending = rows.filter((row)=>row?.status === "new").length;
    countNode.textContent = pending > 99 ? "99+" : (pending ? String(pending) : "");
    countNode.hidden = pending < 1;
    button.classList.toggle("has-new-login-help", pending > 0);
  }

  function visibleRows(){
    const q = String(search.value || "").trim().toLowerCase();
    const mode = String(filter.value || "new");
    return rows.filter((row)=>{
      if(mode === "new" && row?.status !== "new") return false;
      if(mode === "resolved" && row?.status !== "resolved") return false;
      if(!q) return true;
      const ctx = row?.context || {};
      return [
        row?.company_email,
        ctx?.contact_gmail,
        row?.mobile_e164,
        row?.message,
        row?.status,
        ctx?.mode,
        ctx?.recovery_step,
        ctx?.build,
        ctx?.ui_error,
        row?.login_success?.after_request ? "login success" : "",
        row?.login_success?.at,
      ].some((value)=>String(value || "").toLowerCase().includes(q));
    });
  }

  function render(){
    updateBadge();
    const data = visibleRows();
    if(!data.length){
      list.innerHTML = '<div class="login-help-admin-empty">No matching login help requests.</div>';
      syncReplyRealtime();
      return;
    }

    list.innerHTML = data.map((row)=>{
      const ctx = row?.context || {};
      const isNew = row?.status === "new";
      const loginSucceeded = row?.login_success?.after_request === true && !!row?.login_success?.at;
      const loginAt = loginSucceeded ? String(row.login_success.at) : "";
      const loginDelay = loginSucceeded ? afterRequestLabel(row?.created_at, loginAt) : "";
      const activationState = String(row?.activation?.state || "");
      const recoveryState = String(row?.recovery?.state || "");
      const activationDone = activationState === "consumed";
      const activationPending = activationState === "approved" || activationState === "processing";
      const recoveryDone = recoveryState === "consumed";
      const recoveryPending = recoveryState === "approved" || recoveryState === "processing";
      const isRecoveryRequest = String(ctx?.mode || "") === "recovery";
      const activationLocked =
        recoveryPending ||
        recoveryDone ||
        activationDone ||
        (activationPending && !isRecoveryRequest);
      const activationLabel = recoveryDone
        ? "Password reset used"
        : recoveryState === "processing"
          ? "Resetting…"
          : recoveryState === "approved"
            ? "Reset enabled"
            : activationDone
              ? "Account completed"
              : activationState === "processing" && !isRecoveryRequest
                ? "Completing…"
                : activationState === "approved" && !isRecoveryRequest
                  ? "Activated"
                  : isRecoveryRequest
                    ? "Enable password reset"
                    : "Activate account";
      return `
        <article class="login-help-request-card ${isNew ? "is-new" : "is-resolved"}${loginSucceeded ? " has-login-success" : ""}" data-login-help-id="${esc(row.id)}">
          <div class="login-help-request-top">
            <div class="login-help-request-contact">
              <div>
                <strong>${esc(row.company_email || "(legacy request)")}</strong>
                ${ctx.contact_gmail ? '<span style="display:block;margin-top:2px;font-size:10px;opacity:.88;">Gmail: ' + esc(ctx.contact_gmail) + '</span>' : ""}
                <span style="display:block;margin-top:2px;font-size:10px;opacity:.72;">${esc(row.mobile_e164 || "")}</span>
              </div>
              <span class="login-help-request-state">${isNew ? "NEW" : "RESOLVED"}</span>
            </div>
            <time title="${esc(fmt(row.created_at))}">${esc(fmt(row.created_at))}</time>
          </div>

          <div class="login-help-request-tags">
            ${ctx.mode ? '<span>' + esc(ctx.mode) + '</span>' : ""}
            ${ctx.recovery_step ? '<span>recovery: ' + esc(ctx.recovery_step) + '</span>' : ""}
            ${ctx.build ? '<span>' + esc(ctx.build) + '</span>' : ""}
          </div>

          ${loginSucceeded ? `
            <div class="login-help-login-success" title="Successful tool login after this Login Help request">
              <div class="login-help-login-success-head">
                <span>LOGIN SUCCESS</span>
                <b>✓</b>
              </div>
              <strong>${esc(fmtCairo(loginAt))}</strong>
              <small>${esc(loginDelay || "Successful tool login after this request")}</small>
            </div>
          ` : ""}

          ${ctx.ui_error ? '<div class="login-help-request-error"><b>UI error</b><span>' + esc(ctx.ui_error) + '</span></div>' : ""}

          <div class="login-help-request-message">${esc(row.message || "")}</div>

          <div class="login-help-request-actions">
            ${row.company_email && row.mobile_e164
              ? '<button class="login-help-admin-action activate" type="button" data-login-help-action="activate_account"' +
                (activationLocked ? ' disabled aria-disabled="true"' : '') +
                '>' + esc(activationLabel) + '</button>'
              : ""}
            ${(ctx.contact_gmail || row.company_email) ? '<button class="login-help-admin-action reply" type="button" data-login-help-action="reply">' + (ctx.contact_gmail ? 'Reply to Gmail' : 'Reply by email') + '</button>' : ""}
            ${row.has_screenshot ? '<button class="login-help-admin-action" type="button" data-login-help-action="screenshot">View screenshot</button>' : ""}
            <button class="login-help-admin-action ${isNew ? "resolve" : "reopen"}" type="button" data-login-help-action="${isNew ? "resolve" : "reopen"}">
              ${isNew ? "Mark resolved" : "Reopen"}
            </button>
          </div>
          <div class="login-help-thread-host" data-login-help-thread-host></div>
        </article>
      `;
    }).join("");
    syncReplyRealtime();
  }

  async function load({ quiet=false } = {}){
    if(!quiet) list.innerHTML = '<div class="login-help-admin-empty">Loading requests…</div>';
    try{
      const data = await api({ action:"list" });
      rows = Array.isArray(data?.rows) ? data.rows : [];
      loaded = true;
      render();
    }catch(error){
      if(!quiet) list.innerHTML = '<div class="login-help-admin-empty error">' + esc(error.message) + '</div>';
      setAdminStatus?.("Could not load Login Help requests.", "error");
    }
  }

  list.addEventListener("click", async (event)=>{
    const actionButton = event.target.closest("button[data-login-help-action]");
    if(!actionButton) return;
    const card = actionButton.closest("[data-login-help-id]");
    const id = String(card?.dataset.loginHelpId || "");
    const action = String(actionButton.dataset.loginHelpAction || "");
    if(!id || !action) return;

    const threadHost = card.querySelector("[data-login-help-thread-host]");

    if(action === "activate_account"){
      const row = rows.find((item)=>String(item?.id || "") === id);
      const email = String(row?.company_email || "");
      const mobile = String(row?.mobile_e164 || "");
      if(!email || !mobile){
        setAdminStatus?.("This Login Help request is missing email or mobile details.", "warn");
        return;
      }
      const ok = window.confirm(
        "Approve account assistance for this user?\n\n" +
        email + "\n" + mobile + "\n\n" +
        "If the account is already complete, this enables a one-time password reset for 24 hours. " +
        "If the account is incomplete, it enables assisted signup for 7 days. " +
        "The approval is bound to this company email + registered mobile."
      );
      if(!ok) return;

      actionButton.disabled = true;
      try{
        const data = await api({ action:"activate_account", id });
        if(row){
          if(data?.activation) row.activation = data.activation;
          if(data?.recovery) row.recovery = data.recovery;
        }
        const passwordRecovery = data?.purpose === "password_reset";
        setAdminStatus?.(
          data?.already_completed
            ? (passwordRecovery
                ? "Password recovery approval was already used."
                : "Account activation was already completed.")
            : passwordRecovery
              ? "Password reset enabled ✅ User should open Forgot password, enter the same company email + registered mobile, then choose a new password without OTP."
              : "Account activated for assisted signup ✅ User can finish without OTP.",
          "success"
        );
        await load({ quiet:true });
      }catch(error){
        actionButton.disabled = false;
        setAdminStatus?.(error.message, "error");
      }
      return;
    }

    if(action === "reply"){
      if(!threadHost) return;
      if(threadHost.dataset.open === "1"){
        threadHost.innerHTML = "";
        threadHost.dataset.open = "0";
        syncReplyRealtime();
        return;
      }
      actionButton.disabled = true;
      try{
        const data = await api({ action:"thread", id });
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const history = historyMarkup(messages);
        threadHost.innerHTML = `
          <div class="login-help-thread">
            <div class="login-help-thread-summary" data-login-help-thread-summary>${esc(threadSummaryText(messages))}</div>
            <div class="login-help-thread-history" aria-live="polite">${history}</div>
            <div class="login-help-thread-compose">
              <div class="login-help-thread-from">From: <b>My Time Support</b>${(() => { const row = rows.find((item)=>String(item?.id || "") === id); const gmail = String(row?.context?.contact_gmail || ""); return gmail ? ' • To: <b>' + esc(gmail) + '</b>' : ""; })()}</div>
              <textarea data-login-help-reply-text rows="4" maxlength="8000" placeholder="Write the reply that the user will receive…"></textarea>
              <div class="login-help-thread-compose-actions">
                <button class="login-help-admin-action" type="button" data-login-help-action="close_reply">Close</button>
                <button class="login-help-admin-action reply" type="button" data-login-help-action="send_reply">Send reply</button>
              </div>
            </div>
          </div>
        `;
        threadHost.dataset.open = "1";
        const historyNode = threadHost.querySelector(".login-help-thread-history");
        if(historyNode) historyNode.scrollTop = historyNode.scrollHeight;
        ensureReplyRealtime();
        threadHost.querySelector("[data-login-help-reply-text]")?.focus();
      }catch(error){
        setAdminStatus?.(error.message, "error");
      }finally{
        actionButton.disabled = false;
      }
      return;
    }

    if(action === "close_reply"){
      if(threadHost){
        threadHost.innerHTML = "";
        threadHost.dataset.open = "0";
        syncReplyRealtime();
      }
      return;
    }

    if(action === "send_reply"){
      if(!threadHost) return;
      const input = threadHost.querySelector("[data-login-help-reply-text]");
      const message = String(input?.value || "").trim();
      if(!message){
        setAdminStatus?.("Write the reply first.", "warn");
        input?.focus();
        return;
      }
      actionButton.disabled = true;
      try{
        await api({ action:"reply", id, message });
        setAdminStatus?.("Reply sent from My Time Support ✅", "success");
        await refreshThreadHistory(id, threadHost);
        if(input) input.value = "";
      }catch(error){
        setAdminStatus?.(error.message, "error");
      }finally{
        actionButton.disabled = false;
      }
      return;
    }

    if(action === "screenshot"){
      const popup = window.open("about:blank", "_blank");
      try{ if(popup) popup.opener = null; }catch{}
      actionButton.disabled = true;
      try{
        const data = await api({ action:"screenshot_url", id });
        if(!data?.url) throw new Error("Screenshot URL is unavailable.");
        if(popup) popup.location.href = data.url;
        else throw new Error("Popup was blocked. Allow popups and try again.");
      }catch(error){
        try{ popup?.close(); }catch{}
        setAdminStatus?.(error.message, "error");
      }finally{
        actionButton.disabled = false;
      }
      return;
    }

    if(action === "resolve" || action === "reopen"){
      actionButton.disabled = true;
      try{
        await api({ action, id });
        const row = rows.find((item)=>String(item?.id || "") === id);
        if(row) row.status = action === "resolve" ? "resolved" : "new";
        setAdminStatus?.(action === "resolve" ? "Login Help request resolved ✅" : "Login Help request reopened.", "success");
        await load({ quiet:true });
      }catch(error){
        actionButton.disabled = false;
        setAdminStatus?.(error.message, "error");
      }
    }
  });

  let searchTimer = 0;
  search.addEventListener("input", ()=>{
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>{ searchTimer=0; render(); }, 70);
  });
  filter.addEventListener("change", render);
  refresh.addEventListener("click", ()=>load());

  function activateThisTab(){
    const central = window.__srActivateAdminTab;
    if(typeof central === "function" && central(button)) return;
    document.querySelectorAll("#adminPanel .admin-tab").forEach((item)=>item.classList.toggle("active", item === button));
    document.querySelectorAll("#adminPanel .admin-tab-panel").forEach((item)=>{ item.style.display = item === panel ? "block" : "none"; });
  }

  button.addEventListener("click", async ()=>{
    activateThisTab();
    if(!loaded) await load();
    else if(openThreadHosts().length) await refreshOpenThreads();
    else await load({ quiet:true });
    syncReplyRealtime();
  });

  window.addEventListener("sr:admin-tabchange", ()=>{
    queueMicrotask(syncReplyRealtime);
  });

  // One bounded read after Full Admin login so the tab can show a pending count.
  load({ quiet:true }).catch(()=>{});
  void VERSION;
}

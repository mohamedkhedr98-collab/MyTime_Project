/* SR Edit private access: Ctrl+Shift+Star, existing SR grant, server-side audit. */
(() => {
  "use strict";

  const API = "/api/sr-private-edit";
  let busy = false;
  let editor = null;
  let editorInput = null;
  let editorStatus = null;
  let previousFocus = null;
  let auditPanel = null;
  let auditTab = null;
  let lastAdminTab = null;

  function isShortcut(event) {
    // Ctrl+Shift+* on either the regular keyboard (Shift+8 in common layouts)
    // or the numpad. Check physical codes because Ctrl can change event.key.
    return !event.repeat && event.ctrlKey && event.shiftKey &&
      !event.altKey && !event.metaKey &&
      (event.key === "*" || event.code === "NumpadMultiply" || event.code === "Digit8");
  }

  async function request(action, extra = {}) {
    const response = await fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, extra)),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "SR Edit is unavailable.");
    return data;
  }

  function ensureStyle() {
    if (document.getElementById("srPrivateEditStyle")) return;
    const link = document.createElement("link");
    link.id = "srPrivateEditStyle";
    link.rel = "stylesheet";
    link.href = "./sr-private-edit.css?v=20261011-preview-v1";
    document.head.appendChild(link);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function notify(message) {
    ensureStyle();
    let toast = document.getElementById("srPrivateEditToast");
    if (!toast) {
      toast = node("div", "srpe-toast");
      toast.id = "srPrivateEditToast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  function setStatus(message) {
    if (editorStatus) editorStatus.textContent = message || "";
  }

  function closeEditor() {
    if (!editor || editor.hidden) return;
    editor.hidden = true;
    if (editorInput) editorInput.value = "";
    setStatus("");
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function ensureEditor() {
    if (editor) return;
    ensureStyle();
    editor = node("div", "srpe-layer");
    editor.hidden = true;
    editor.id = "srPrivateEditLayer";
    const sheet = node("section", "srpe-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Open SR for edit");
    const close = node("button", "srpe-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeEditor);
    const form = node("form", "srpe-form");
    const input = node("input", "srpe-input");
    input.type = "text";
    input.placeholder = "SR Number";
    input.setAttribute("aria-label", "SR Number");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("maxlength", "18");
    input.required = true;
    input.dir = "ltr";
    const button = node("button", "srpe-submit", "فتح الـ SR");
    button.type = "submit";
    const status = node("div", "srpe-status");
    status.setAttribute("role", "status");
    form.append(input, button);
    sheet.append(close, form, status);
    editor.appendChild(sheet);
    document.body.appendChild(editor);
    editor.addEventListener("click", (event) => {
      if (event.target === editor) closeEditor();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const sn = input.value.trim();
      if (!/^[A-Za-z0-9_-]{1,18}$/.test(sn)) {
        setStatus("أدخل رقم SR صحيح بدون مسافات.");
        input.focus();
        return;
      }
      // Reserve the popup synchronously with the user's click: async permission
      // checks then navigate the reserved tab; BSS is never contacted on denial.
      const tab = window.open("about:blank", "_blank");
      if (tab) tab.opener = null;
      busy = true;
      button.disabled = true;
      setStatus("جارٍ التحقق وفتح الـ SR...");
      try {
        const result = await request("launch", { sr_number: sn });
        if (tab && !tab.closed) {
          tab.location.replace(result.url);
          setStatus("");
          input.value = "";
          input.focus();
        } else {
          setStatus("اسمح بالنوافذ المنبثقة ثم اضغط فتح مرة أخرى.");
        }
      } catch (error) {
        if (tab && !tab.closed) tab.close();
        setStatus(error.message || "تعذّر فتح الـ SR.");
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
    editorInput = input;
    editorStatus = status;
  }

  async function openEditor() {
    if (busy) return;
    busy = true;
    try {
      await request("open");
      ensureEditor();
      previousFocus = document.activeElement;
      editor.hidden = false;
      setStatus("");
      editorInput.focus();
    } catch (error) {
      notify(error.message || "SR Edit access denied.");
    } finally {
      busy = false;
    }
  }

  function primaryAdminOpen() {
    const overlay = document.getElementById("adminOverlay");
    const panel = document.getElementById("adminPanel");
    const auth = document.getElementById("adminAuthBox");
    return !!overlay && overlay.style.display !== "none" &&
      !!panel && panel.style.display !== "none" &&
      !!auth && auth.style.display === "none";
  }

  function adminLoginShowing() {
    const overlay = document.getElementById("adminOverlay");
    return !!overlay && overlay.style.display !== "none" && !primaryAdminOpen();
  }

  function ensureAuditPanel() {
    if (auditPanel?.isConnected) return true;
    const panelHost = document.getElementById("adminPanel");
    const tabs = panelHost?.querySelector(".admin-tabs");
    if (!tabs || typeof window.__srActivateAdminTab !== "function") return false;
    ensureStyle();

    const hiddenTab = node("button", "admin-tab");
    hiddenTab.type = "button";
    hiddenTab.style.display = "none";
    hiddenTab.dataset.tab = "sr-edit-audit";
    hiddenTab.setAttribute("aria-controls", "adminTabSrEditAudit");
    tabs.appendChild(hiddenTab);

    const content = node("div", "admin-tab-panel srpe-audit");
    content.id = "adminTabSrEditAudit";
    content.style.display = "none";
    const header = node("div", "srpe-audit-head");
    const titleWrap = node("div");
    titleWrap.appendChild(node("h3", "", "SR Edit — سجل الاستخدام"));
    titleWrap.appendChild(node("p", "", "فتح الأداة وطلبات فتح SR على BSS — وليس تأكيدًا لحفظ تعديل."));
    const buttons = node("div", "srpe-audit-actions");
    const refresh = node("button", "srpe-action", "تحديث السجل");
    refresh.type = "button";
    const back = node("button", "srpe-action srpe-secondary", "رجوع");
    back.type = "button";
    buttons.append(refresh, back);
    header.append(titleWrap, buttons);
    const status = node("p", "srpe-audit-status");
    status.setAttribute("role", "status");
    const list = node("div", "srpe-audit-list");
    content.append(header, status, list);
    panelHost.insertBefore(content, document.getElementById("adminStatus"));

    refresh.addEventListener("click", () => loadAudit());
    back.addEventListener("click", () => {
      const original = lastAdminTab?.isConnected ? lastAdminTab :
        tabs.querySelector('.admin-tab[data-tab="suggestions"]');
      if (original) window.__srActivateAdminTab(original);
    });
    auditTab = hiddenTab;
    auditPanel = content;
    return true;
  }

  async function loadAudit() {
    const status = auditPanel?.querySelector(".srpe-audit-status");
    const list = auditPanel?.querySelector(".srpe-audit-list");
    if (!status || !list) return;
    status.textContent = "جارٍ تحميل سجل الاستخدام...";
    list.replaceChildren();
    try {
      const result = await request("audit");
      const rows = Array.isArray(result.events) ? result.events : [];
      status.textContent = "آخر " + rows.length + " عملية مسجلة";
      if (!rows.length) {
        list.appendChild(node("p", "srpe-audit-empty", "لا يوجد استخدام مسجل حتى الآن."));
        return;
      }
      const table = node("table", "srpe-table");
      const header = node("tr");
      ["التاريخ والوقت", "المستخدم", "الحدث", "رقم SR", "البيئة"].forEach((label) => {
        header.appendChild(node("th", "", label));
      });
      const thead = node("thead");
      thead.appendChild(header);
      table.appendChild(thead);
      const tbody = node("tbody");
      rows.forEach((item) => {
        const line = node("tr");
        let date = "—";
        try { date = new Date(item.at).toLocaleString("ar-EG"); } catch {}
        [
          date, item.user || item.user_id || "—",
          item.event === "sr_edit_launch" ? "طلب فتح SR" : "فتح أداة التعديل",
          item.sr_number || "—", item.branch || "—",
        ].forEach((cell) => line.appendChild(node("td", "", String(cell))));
        tbody.appendChild(line);
      });
      table.appendChild(tbody);
      list.appendChild(table);
    } catch (error) {
      status.textContent = error.message || "لا يمكن تحميل السجل.";
    }
  }

  function openAudit() {
    if (!ensureAuditPanel()) {
      notify("افتح لوحة الإدارة بعد تسجيل الدخول وحاول مرة أخرى.");
      return;
    }
    const active = document.querySelector("#adminPanel .admin-tab.active");
    if (active && active !== auditTab) lastAdminTab = active;
    window.__srActivateAdminTab(auditTab);
    loadAudit();
  }

  document.getElementById("adminCloseBtn")?.addEventListener("click", () => {
    if (auditPanel?.isConnected) {
      auditPanel.querySelector(".srpe-audit-list")?.replaceChildren();
      const tabs = document.querySelector("#adminPanel .admin-tabs");
      const original = lastAdminTab?.isConnected ? lastAdminTab : tabs?.querySelector('.admin-tab[data-tab="suggestions"]');
      if (auditTab?.classList.contains("active") && original) window.__srActivateAdminTab?.(original);
      lastAdminTab = null;
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && editor && !editor.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeEditor();
      return;
    }
    if (!isShortcut(event)) return;
    event.preventDefault();
    if (primaryAdminOpen()) openAudit();
    else if (!adminLoginShowing() && (!editor || editor.hidden)) openEditor();
  }, true);
})();

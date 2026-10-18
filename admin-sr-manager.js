import { verifySrPublication, verifyOpenedSrCatalog, summarizeSrProof } from "./sr-publish-verifier.mjs?v=20261015-opened-proof-v1";
const MODULE_VERSION = "20261015-opened-proof-v4";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function srApi(body) {
  let res;
  try {
    res = await fetch("/api/admin-sr-manager", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch (cause) {
    const error = new Error("SR Manager network request failed. Check the current Preview connection and try again.");
    error.code = "NETWORK_ERROR";
    error.cause = cause;
    throw error;
  }

  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!res.ok || !data || typeof data !== "object") {
    const cfCode =
      raw.match(/(?:cloudflare\s+)?error\s*(?:code\s*)?(\d{3,4})/i)?.[1] ||
      raw.match(/code\s*[:#]?\s*(\d{3,4})/i)?.[1] ||
      "";
    const ray = String(res.headers.get("cf-ray") || "").trim();
    const cfErrorType = String(res.headers.get("cf-error-type") || "").trim();
    const fallback =
      (cfErrorType ? "Cloudflare Runtime " + cfErrorType + " • " : "") +
      (cfCode ? "Cloudflare Error " + cfCode + " • " : "") +
      "SR Manager HTTP " + res.status +
      (ray ? " • Ray " + ray : "");

    const error = new Error(data?.error || (res.status === 403 && !data
      ? fallback + " • Non-JSON access denial from an upstream layer. Check Cloudflare security and IP rules or your login; the Change Set remains saved."
      : fallback));
    error.code = data?.code || (cfCode ? "CLOUDFLARE_" + cfCode : "HTTP_" + res.status);
    error.status = res.status;
    error.data = data || { nonJsonResponse: true, cloudflareCode: cfCode, cfErrorType, ray };
    throw error;
  }

  return data;
}

function ensureStyles() {
  if (document.getElementById("adminSrManagerStyles")) return;
  const link = document.createElement("link");
  link.id = "adminSrManagerStyles";
  link.rel = "stylesheet";
  link.href = "./admin-sr-manager.css?v=" + MODULE_VERSION;
  document.head.appendChild(link);
}


const srChoiceInstances = new WeakMap();
let srChoiceOpen = null;
let srChoicePopover = null;
let srChoiceSerial = 0;
let srChoiceGlobalsInstalled = false;

function srChoiceAccessibleName(select) {
  const label = select?.closest?.("label");
  if (!label) return "Choose option";
  const parts = [];
  for (const node of label.childNodes) {
    if (node === select) break;
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent || "");
    else if (node.nodeType === Node.ELEMENT_NODE && !node.matches?.("select,input,textarea,button,.sr-admin-choice")) {
      parts.push(node.textContent || "");
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim() || "Choose option";
}

function selectedSrChoiceOption(select) {
  return select?.selectedIndex >= 0 ? select.options[select.selectedIndex] || null : null;
}

function syncSrChoiceControl(select) {
  const instance = srChoiceInstances.get(select);
  if (!instance) return;
  const option = selectedSrChoiceOption(select);
  const text = String(option?.textContent || "").replace(/\s+/g, " ").trim() || "Choose…";
  instance.trigger.textContent = text;
  instance.trigger.dataset.placeholder = select.value ? "false" : "true";
  instance.trigger.dataset.disabled = select.disabled ? "true" : "false";
  instance.trigger.tabIndex = select.disabled ? -1 : 0;
  instance.trigger.setAttribute("aria-disabled", select.disabled ? "true" : "false");
}

function closeSrChoice() {
  if (!srChoiceOpen) return;
  srChoiceOpen.trigger.setAttribute("aria-expanded", "false");
  srChoiceOpen.trigger.removeAttribute("aria-activedescendant");
  srChoiceOpen.wrapper.classList.remove("is-open");
  if (srChoicePopover) {
    srChoicePopover.hidden = true;
    srChoicePopover.replaceChildren();
    srChoicePopover.removeAttribute("aria-label");
  }
  srChoiceOpen = null;
}

function ensureSrChoicePopover() {
  if (srChoicePopover?.isConnected) return srChoicePopover;
  srChoicePopover = document.createElement("div");
  srChoicePopover.id = "srAdminChoicePopover";
  srChoicePopover.className = "sr-admin-choice-popover";
  srChoicePopover.hidden = true;
  srChoicePopover.setAttribute("role", "listbox");
  // Keep the popup inside the Admin overlay. A body-level fixed portal at the
  // maximum browser z-index can create a separate compositor layer over the
  // scoped iframe and visually blank the SR workspace in Chromium.
  const portalHost = document.getElementById("adminOverlay") || document.body;
  portalHost.appendChild(srChoicePopover);

  srChoicePopover.addEventListener("click", (event) => {
    const row = event.target?.closest?.("[data-sr-choice-index]");
    if (!row || !srChoiceOpen) return;
    event.preventDefault();
    const index = Number(row.dataset.srChoiceIndex);
    if (!Number.isInteger(index)) return;
    commitSrChoice(index);
  });

  return srChoicePopover;
}

function srChoiceEnabledIndices(instance) {
  return [...instance.select.options]
    .map((option, index) => option.disabled ? -1 : index)
    .filter((index) => index >= 0);
}

function setSrChoiceActive(index) {
  if (!srChoiceOpen || !srChoicePopover) return;
  const enabled = srChoiceEnabledIndices(srChoiceOpen);
  if (!enabled.length) return;
  let next = Number(index);
  if (!enabled.includes(next)) next = enabled[0];
  srChoiceOpen.activeIndex = next;

  srChoicePopover.querySelectorAll("[data-sr-choice-index]").forEach((row) => {
    const current = Number(row.dataset.srChoiceIndex) === next;
    row.classList.toggle("is-active", current);
    if (current) {
      srChoiceOpen.trigger.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView?.({ block: "nearest" });
    }
  });
}

function moveSrChoiceActive(delta) {
  if (!srChoiceOpen) return;
  const enabled = srChoiceEnabledIndices(srChoiceOpen);
  if (!enabled.length) return;
  const current = enabled.indexOf(srChoiceOpen.activeIndex);
  const base = current >= 0 ? current : 0;
  const next = (base + delta + enabled.length) % enabled.length;
  setSrChoiceActive(enabled[next]);
}

function renderSrChoicePopover(instance) {
  const popover = ensureSrChoicePopover();
  const options = [...instance.select.options];
  popover.setAttribute("aria-label", srChoiceAccessibleName(instance.select));
  popover.innerHTML = options.map((option, index) => {
    const selected = index === instance.select.selectedIndex;
    const disabled = option.disabled;
    return '<div id="srAdminChoice_' + instance.id + '_' + index + '"' +
      ' class="sr-admin-choice-option' + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + '"' +
      ' role="option" aria-selected="' + (selected ? 'true' : 'false') + '"' +
      ' aria-disabled="' + (disabled ? 'true' : 'false') + '"' +
      ' data-sr-choice-index="' + index + '">' +
      '<span>' + esc(String(option.textContent || "").replace(/\s+/g, " ").trim() || "—") + '</span>' +
      (selected ? '<span class="sr-admin-choice-check" aria-hidden="true">✓</span>' : '') +
      '</div>';
  }).join("");
}

function positionSrChoicePopover(instance) {
  if (!srChoicePopover || srChoicePopover.hidden) return;
  const rect = instance.trigger.getBoundingClientRect();
  const margin = 8;
  const maxWidth = Math.max(220, window.innerWidth - (margin * 2));
  const width = Math.min(Math.max(rect.width, 250), Math.min(480, maxWidth));
  srChoicePopover.style.width = width + "px";
  srChoicePopover.style.left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left)) + "px";

  const height = Math.min(srChoicePopover.scrollHeight || 220, 320);
  const below = window.innerHeight - rect.bottom - margin;
  const above = rect.top - margin;
  const useAbove = below < Math.min(height, 190) && above > below;
  const top = useAbove
    ? Math.max(margin, rect.top - height - 6)
    : Math.min(window.innerHeight - height - margin, rect.bottom + 6);
  srChoicePopover.style.top = Math.max(margin, top) + "px";
}

function openSrChoice(select, edge = "") {
  const instance = srChoiceInstances.get(select);
  if (!instance || select.disabled) return;

  if (srChoiceOpen && srChoiceOpen !== instance) closeSrChoice();
  srChoiceOpen = instance;
  syncSrChoiceControl(select);
  renderSrChoicePopover(instance);
  instance.wrapper.classList.add("is-open");
  instance.trigger.setAttribute("aria-expanded", "true");
  srChoicePopover.hidden = false;
  positionSrChoicePopover(instance);

  const enabled = srChoiceEnabledIndices(instance);
  let index = select.selectedIndex;
  if (!enabled.includes(index)) index = enabled[0] ?? -1;
  if (edge === "first") index = enabled[0] ?? index;
  if (edge === "last") index = enabled[enabled.length - 1] ?? index;
  if (index >= 0) setSrChoiceActive(index);
}

function commitSrChoice(index) {
  const instance = srChoiceOpen;
  if (!instance) return;
  const option = instance.select.options[index];
  if (!option || option.disabled) return;

  const changed = instance.select.selectedIndex !== index;
  instance.select.selectedIndex = index;
  syncSrChoiceControl(instance.select);
  closeSrChoice();
  instance.trigger.focus({ preventScroll: true });
  if (changed) instance.select.dispatchEvent(new Event("change", { bubbles: true }));
}

function onSrChoiceKeydown(instance, event) {
  if (instance.select.disabled) return;
  const isOpen = srChoiceOpen === instance;

  if (event.key === "Escape" && isOpen) {
    event.preventDefault();
    closeSrChoice();
    return;
  }
  if (event.key === "Tab" && isOpen) {
    closeSrChoice();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!isOpen) {
      openSrChoice(instance.select);
      if (srChoiceOpen === instance) moveSrChoiceActive(event.key === "ArrowDown" ? 1 : -1);
    } else {
      moveSrChoiceActive(event.key === "ArrowDown" ? 1 : -1);
    }
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    if (!isOpen) openSrChoice(instance.select, event.key === "Home" ? "first" : "last");
    else {
      const enabled = srChoiceEnabledIndices(instance);
      setSrChoiceActive(event.key === "Home" ? enabled[0] : enabled[enabled.length - 1]);
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!isOpen) openSrChoice(instance.select);
    else commitSrChoice(instance.activeIndex);
  }
}

function installSrChoiceGlobals() {
  if (srChoiceGlobalsInstalled) return;
  srChoiceGlobalsInstalled = true;

  document.addEventListener("pointerdown", (event) => {
    if (!srChoiceOpen) return;
    if (srChoiceOpen.wrapper.contains(event.target)) return;
    if (srChoicePopover?.contains(event.target)) return;
    closeSrChoice();
  }, true);

  window.addEventListener("resize", closeSrChoice);
  window.addEventListener("scroll", (event) => {
    if (srChoicePopover?.contains(event.target)) return;
    closeSrChoice();
  }, true);
}

function upgradeSrChoiceControl(select) {
  if (!select || srChoiceInstances.has(select)) {
    if (select) syncSrChoiceControl(select);
    return;
  }

  installSrChoiceGlobals();
  const wrapper = document.createElement("div");
  wrapper.className = "sr-admin-choice";
  const trigger = document.createElement("div");
  trigger.className = "sr-admin-choice-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "srAdminChoicePopover");
  trigger.setAttribute("aria-label", srChoiceAccessibleName(select));
  trigger.tabIndex = 0;

  select.classList.add("sr-admin-choice-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.insertAdjacentElement("afterend", wrapper);
  wrapper.appendChild(trigger);

  const instance = {
    id: ++srChoiceSerial,
    select,
    wrapper,
    trigger,
    activeIndex: select.selectedIndex,
  };
  srChoiceInstances.set(select, instance);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (srChoiceOpen === instance) closeSrChoice();
    else openSrChoice(select);
  });
  trigger.addEventListener("keydown", (event) => onSrChoiceKeydown(instance, event));
  select.addEventListener("change", () => syncSrChoiceControl(select));
  select.addEventListener("focus", () => {
    if (!select.disabled) queueMicrotask(() => trigger.focus({ preventScroll: true }));
  });

  syncSrChoiceControl(select);
}

function isScopedSrWorkspace() {
  const overlay = document.getElementById("adminOverlay");
  return !!overlay?.classList?.contains("sr-scoped-admin-parity");
}

function refreshSrChoiceControls(root = document) {
  // The dedicated SR Admin runs inside an iframe. Keep native selects there:
  // Chromium can blank the iframe compositor after repeated pointer activation
  // when the custom fixed-position combobox layer is used deep in Structure Builder.
  // Full Admin keeps the custom combobox UI.
  if (isScopedSrWorkspace()) return;

  root.querySelectorAll?.(".sr-admin-panel select").forEach(upgradeSrChoiceControl);
  root.querySelectorAll?.(".sr-admin-panel select").forEach(syncSrChoiceControl);
}

async function copyText(value) {
  const text = String(value || "");
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function commitLink(data) {
  const url = String(data?.commit?.commitUrl || "");
  return url
    ? '<a class="sr-admin-commit-link" href="' + esc(url) + '" target="_blank" rel="noopener">Open GitHub commit</a>'
    : "";
}

export async function mountSrAdmin({ setAdminStatus } = {}) {
  if (document.getElementById("adminTabSrManager")) return;
  ensureStyles();

  const tabsHost = document.querySelector("#adminPanel .admin-tabs");
  const panelHost = document.getElementById("adminPanel");
  const adminStatus = document.getElementById("adminStatus");
  if (!tabsHost || !panelHost || !adminStatus) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-tab";
  btn.dataset.tab = "sr-manager";
  btn.setAttribute("aria-controls", "adminTabSrManager");
  btn.textContent = "SR Management";
  tabsHost.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "adminTabSrManager";
  panel.className = "admin-tab-panel sr-admin-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="sr-admin-hero">
      <div>
        <div class="sr-admin-eyebrow">ADMIN ONLY • GITHUB SYNC</div>
        <h3>SR Management</h3>
        <p>Search existing SRs, generate a correct BSS SR from four guided logics, detect duplicates, then Add / Replace / Delete at an exact location.</p>
      </div>
      <div id="srAdminSyncBadge" class="sr-admin-badge">Checking…</div>
    </div>

    <div id="srAdminNotice" class="sr-admin-notice" hidden></div>

    <section class="sr-admin-card sr-admin-changeset">
      <div class="sr-admin-card-head">
        <div>
          <strong>Change Set • one deploy</strong>
          <small>Queue SRs, deletes, lists and sub-lists. Publishing saves one GitHub commit; Cloudflare must deploy before users see changes.</small>
        </div>
        <div class="sr-admin-changeset-count"><b id="srAdminChangeCount">0</b><span>queued</span></div>
      </div>
      <div id="srAdminChangeList" class="sr-admin-change-list">
        <div class="sr-admin-empty">No queued changes yet.</div>
      </div>
      <div class="sr-admin-inline sr-admin-changeset-actions">
        <button id="srAdminPublishBatch" type="button" disabled>Queue secure publish • GitHub Actions</button>
        <button id="srAdminCheckQueue" type="button" class="secondary" hidden>Check GitHub publish</button>
        <button id="srAdminValidateDraft" type="button" class="secondary" hidden>Validate preserved draft in GitHub</button>
        <button id="srAdminUnlockQueue" type="button" class="ghost" hidden>Manually resolve pending request</button>
        <button id="srAdminClearBatch" type="button" class="ghost" disabled>Clear change set</button>
      </div>
    </section>

    <section class="sr-admin-card">
      <div class="sr-admin-card-head">
        <div><strong>1. Find target SR</strong><small>Search by SR ID. If the ID exists more than once, every location is shown. Choose the exact action on the exact location.</small></div>
      </div>
      <div class="sr-admin-inline">
        <input id="srAdminSearchId" inputmode="numeric" autocomplete="off" placeholder="Example: 102049005" />
        <button id="srAdminSearchBtn" type="button">Search</button>
        <button id="srAdminRefreshBtn" type="button" class="secondary">Refresh</button>
      </div>
      <div id="srAdminSearchResult"></div>
    </section>

    <section class="sr-admin-card">
      <div class="sr-admin-card-head"><div>
        <strong>Direct SR • no internal list required</strong>
        <small>Select the Topic and create a directly visible SR action. The Topic ID and all existing menus stay intact.</small>
      </div></div>
      <div class="sr-admin-grid sr-admin-grid-3">
        <label>Destination Topic<select id="srAdminDirectTab"></select></label>
        <label>Position<select id="srAdminDirectPosition">
          <option value="last">After the last direct SR</option>
          <option value="first">Before the first direct SR</option>
          <option value="before">Before a specific top-level item</option>
          <option value="after">After a specific top-level item</option>
        </select></label>
        <div class="sr-admin-inline"><button type="button" id="srAdminUseDirect">Create direct SR</button></div>
      </div>
      <label id="srAdminDirectReferenceKindWrap" hidden>Reference item
        <select id="srAdminDirectReferenceKind">
          <option value="menu">Internal list (top-level dropdown)</option>
          <option value="sr">Standalone SR (by ID)</option>
        </select>
      </label>
      <label id="srAdminDirectMenuRefWrap" hidden>Reference internal list
        <select id="srAdminDirectMenuRef"></select>
      </label>
      <div id="srAdminDirectReferenceWrap" hidden>
        <div class="sr-admin-inline">
          <input id="srAdminDirectReferenceId" inputmode="numeric" autocomplete="off" placeholder="Reference SR ID" />
          <button type="button" id="srAdminDirectReferenceFind" class="secondary">Find direct SR</button>
        </div>
        <div id="srAdminDirectReferenceResults" class="sr-admin-change-list"></div>
      </div>
    </section>

    <section id="srAdminEditPanel" class="sr-admin-card" hidden>
      <div class="sr-admin-card-head">
        <div><strong>Edit existing SR • preserve original link</strong><small>Edit its label, ID, BSS type/name, content and number source. Advanced URL keeps all existing BSS parameters unless you change them.</small></div>
        <button id="srAdminEditClose" type="button" class="ghost">Close editor</button>
      </div>
      <div id="srAdminEditPath" class="sr-admin-target"></div>
      <div class="sr-admin-grid sr-admin-grid-3">
        <label>Visible SR name<input id="srAdminEditLabel" maxlength="300" /></label>
        <label>SR ID<input id="srAdminEditId" inputmode="numeric" autocomplete="off" /></label>
        <label>BSS SR Type Name<input id="srAdminEditTypeName" maxlength="500" /></label>
      </div>
      <div class="sr-admin-grid">
        <label>Subscriber number source<select id="srAdminEditMode">
          <option value="fbb">FBB • openLink</option>
          <option value="landline">Landline • openLinkk</option>
        </select></label>
        <label>BSS Content<textarea id="srAdminEditContent" rows="3" spellcheck="false"></textarea></label>
      </div>
      <label>Advanced • complete original BSS URL
        <textarea id="srAdminEditUrl" rows="4" spellcheck="false"></textarea>
        <small>Only the fields above are synchronized automatically; all other query parameters stay exactly as entered here.</small>
      </label>
      <div class="sr-admin-inline">
        <button id="srAdminEditSave" type="button">Add edited SR to Change Set</button>
      </div>
    </section>

    <section id="srAdminMovePanel" class="sr-admin-card sr-admin-move-card" hidden>
      <div class="sr-admin-card-head">
        <div>
          <strong>Move SR • anywhere in the catalog</strong>
          <small>Move any SR to a direct Topic position, another list or sub-list, or before / after any other SR.</small>
        </div>
        <button id="srAdminMoveCancel" type="button" class="ghost">Cancel move</button>
      </div>
      <div id="srAdminMoveSource" class="sr-admin-move-source">No SR selected for moving.</div>

      <div class="sr-admin-move-quick">
        <button id="srAdminMoveTop" type="button">First in current list</button>
        <button id="srAdminMoveBottom" type="button">Last in current list</button>
      </div>

      <div class="sr-admin-builder sr-admin-move-context-builder">
        <div class="sr-admin-builder-title">Move to Topic directly, internal list or nested sub-list</div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>Topic / Tab<select id="srAdminMoveTargetTab"></select></label>
          <label>Destination level<select id="srAdminMoveTargetMenu"></select></label>
          <label>Sub-list<select id="srAdminMoveTargetSub"></select></label>
        </div>
        <div class="sr-admin-grid">
          <label>Position<select id="srAdminMoveTargetPosition">
            <option value="last">After the last item in destination</option>
            <option value="first">Before the first item in destination</option>
            <option value="before_menu">Before a specific internal list</option>
            <option value="after_menu">After a specific internal list</option>
          </select></label>
          <label id="srAdminMoveMenuReferenceWrap" hidden>Reference list
            <select id="srAdminMoveMenuReference"></select>
          </label>
          <div class="sr-admin-inline sr-admin-move-context-action">
            <button id="srAdminMoveToList" type="button">Add move to Change Set</button>
          </div>
        </div>
      </div>

      <div class="sr-admin-move-destination">
        <label>Or move relative to another SR anywhere in the catalog
          <div class="sr-admin-inline">
            <input id="srAdminMoveDestinationId" inputmode="numeric" autocomplete="off" placeholder="Destination SR ID" />
            <button id="srAdminMoveDestinationSearch" type="button" class="secondary">Find destination</button>
          </div>
        </label>
        <div id="srAdminMoveDestinationResults"></div>
      </div>
    </section>

    <section class="sr-admin-card sr-admin-smart-builder">
      <div class="sr-admin-card-head">
        <div><strong>2. New / edited SR</strong><small>Search an SR or choose a queued new list. Fixed / TT naming is derived automatically from that exact list context.</small></div>
        <button id="srAdminClearEditor" type="button" class="ghost">Clear fields</button>
      </div>

      <div id="srAdminActionContext" class="sr-admin-action-context" data-ready="false">
        Search for an SR above, then choose Add before / Add after / Replace.
      </div>

      <div class="sr-admin-grid">
        <label>SR Type
          <select id="srAdminBuilderType">
            <option value="">Choose SR Type…</option>
            <option value="tt">TT</option>
            <option value="complaint_tech">Complaint • Technical</option>
            <option value="complaint_nontech">Complaint • Non-technical</option>
            <option value="inquiry_offer">Inquiry / Offer</option>
          </select>
        </label>
        <label id="srAdminComplaintChannelWrap" hidden>Complaint appears as
          <select id="srAdminComplaintChannel">
            <option value="">Choose TT or SR…</option>
            <option value="tt">TT</option>
            <option value="sr">SR</option>
          </select>
        </label>
      </div>

      <div class="sr-admin-grid">
        <label>SR Name<input id="srAdminBuilderName" maxlength="300" placeholder="Example: Customer experience complaints" /></label>
        <label>SR ID<input id="srAdminBuilderId" inputmode="numeric" autocomplete="off" placeholder="Example: 099023004" /></label>
      </div>

      <div id="srAdminSubscriberModeWrap" class="sr-admin-grid" hidden>
        <label>Subscriber number source
          <select id="srAdminSubscriberMode">
            <option value="">Choose FBB or landline…</option>
            <option value="fbb">FBB</option>
            <option value="landline">Landline without FBB</option>
          </select>
          <small id="srAdminSubscriberModeHint">Choose how the SR opens: FBB or landline without FBB.</small>
        </label>
      </div>

      <label>Content
        <textarea id="srAdminBuilderContent" class="sr-admin-builder-content" spellcheck="false" placeholder="Example: cst need manager"></textarea>
      </label>

      <div class="sr-admin-name-preview">
        <span>Search / list name</span>
        <b id="srAdminBuilderVisibleName">—</b>
        <small id="srAdminBuilderNameHint">The name is derived automatically from the selected SR location.</small>
      </div>

      <div class="sr-admin-inline">
        <button id="srAdminGenerateBtn" type="button">Generate & check ID</button>
        <button id="srAdminCopyUrlBtn" type="button" class="secondary" disabled>Copy generated URL</button>
        <button id="srAdminSaveAction" type="button" disabled>Add to Change Set</button>
      </div>

      <div id="srAdminBuilderDuplicate" class="sr-admin-builder-duplicate" hidden></div>
      <div id="srAdminTargetSummary" class="sr-admin-target">No target action selected.</div>

    </section>

    <section class="sr-admin-card">
      <div class="sr-admin-card-head">
        <div><strong>3. Structure builder</strong><small>Create or delete lists and sub-lists. This is separate from normal SR add / replace / delete.</small></div>
      </div>

      <div class="sr-admin-builder">
        <div class="sr-admin-builder-title">Create internal list</div>
        <div class="sr-admin-grid">
          <label>Parent Topic / Tab<select id="srAdminNewMenuTab"></select></label>
          <label>New list name<input id="srAdminNewMenuName" maxlength="100" placeholder="Example: Complaint Escalation" /></label>
        </div>
        <div class="sr-admin-grid">
          <label>Position<select id="srAdminNewMenuPosition">
            <option value="last">Last list</option>
            <option value="first">First list</option>
            <option value="before">Before a specific list</option>
            <option value="before_sr">Before a specific direct SR</option>
            <option value="before_sr">Before a specific direct SR</option>
            <option value="after">After a specific list</option>
            <option value="after_sr">After a specific direct SR</option>
            <option value="after_sr">After a specific direct SR</option>
          </select></label>
          <label id="srAdminNewMenuRefWrap">Reference list<select id="srAdminNewMenuRef"></select></label>
          <div id="srAdminNewMenuSrWrap" hidden><label>Reference SR ID<input id="srAdminNewMenuSrId" inputmode="numeric" placeholder="SR ID" /></label><button type="button" id="srAdminNewMenuSrFind" class="secondary">Find SR</button><div id="srAdminNewMenuSrResults"></div></div>
        </div>
        <button id="srAdminCreateMenu" type="button">Add new list to Change Set</button>
      </div>

      <div class="sr-admin-builder">
        <div class="sr-admin-builder-title">Create nested sub-list</div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>Topic / Tab<select id="srAdminSubTab"></select></label>
          <label>Parent internal list<select id="srAdminSubParent"></select></label>
          <label>New sub-list name<input id="srAdminSubName" maxlength="100" placeholder="Example: Complaint Channels" /></label>
        </div>
        <div class="sr-admin-grid">
          <label>Position<select id="srAdminSubPosition">
            <option value="last">Last sub-list</option>
            <option value="first">First sub-list</option>
            <option value="before">Before a specific sub-list</option>
            <option value="after">After a specific sub-list</option>
          </select></label>
          <label id="srAdminSubRefWrap">Reference sub-list<select id="srAdminSubRef"></select></label>
        </div>
        <button id="srAdminCreateSub" type="button">Add sub-list to Change Set</button>
      </div>

      <div class="sr-admin-builder">
        <div class="sr-admin-builder-title">Move internal list</div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>From Topic<select id="srAdminMoveMenuSourceTab"></select></label>
          <label>Internal list<select id="srAdminMoveMenuSource"></select></label>
          <label>To Topic<select id="srAdminMoveMenuDestTab"></select></label>
        </div>
        <div class="sr-admin-grid">
          <label>Position<select id="srAdminMoveMenuPosition">
            <option value="last">Last list</option>
            <option value="first">First list</option>
            <option value="before">Before a specific list</option>
            <option value="after">After a specific list</option>
          </select></label>
          <label id="srAdminMoveMenuRefWrap">Reference list<select id="srAdminMoveMenuRef"></select></label>
          <div id="srAdminMoveMenuSrWrap" hidden><label>Reference SR ID<input id="srAdminMoveMenuSrId" inputmode="numeric" placeholder="SR ID" /></label><button type="button" id="srAdminMoveMenuSrFind" class="secondary">Find SR</button><div id="srAdminMoveMenuSrResults"></div></div>
        </div>
        <button id="srAdminMoveMenu" type="button">Add list move to Change Set</button>
      </div>

      <div class="sr-admin-builder">
        <div class="sr-admin-builder-title">Move nested sub-list</div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>From Topic<select id="srAdminMoveSubSourceTab"></select></label>
          <label>Parent list<select id="srAdminMoveSubSourceParent"></select></label>
          <label>Sub-list<select id="srAdminMoveSubSource"></select></label>
        </div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>To Topic<select id="srAdminMoveSubDestTab"></select></label>
          <label>Destination parent<select id="srAdminMoveSubDestParent"></select></label>
          <label>Position<select id="srAdminMoveSubPosition">
            <option value="last">Last sub-list</option>
            <option value="first">First sub-list</option>
            <option value="before">Before a specific sub-list</option>
            <option value="after">After a specific sub-list</option>
            <option value="before_sr">Before a direct SR in parent</option>
            <option value="after_sr">After a direct SR in parent</option>
          </select></label>
        </div>
        <label id="srAdminMoveSubRefWrap">Reference sub-list<select id="srAdminMoveSubRef"></select></label>
        <div id="srAdminMoveSubSrWrap" hidden><label>Reference SR ID<input id="srAdminMoveSubSrId" inputmode="numeric" placeholder="SR ID" /></label><button type="button" id="srAdminMoveSubSrFind" class="secondary">Find SR</button><div id="srAdminMoveSubSrResults"></div></div>
        <button id="srAdminMoveSub" type="button">Add sub-list move to Change Set</button>
      </div>

      <div class="sr-admin-builder">
        <div class="sr-admin-builder-title">Rename Topic / internal list / nested sub-list</div>
        <small>Renaming a Topic changes its displayed title only; its internal ID and all SR links stay the same.</small>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>Rename<select id="srAdminRenameType">
            <option value="tab">Outer Topic / Tab</option>
            <option value="menu">Internal list</option>
            <option value="submenu">Nested sub-list</option>
          </select></label>
          <label>Topic<select id="srAdminRenameTab"></select></label>
          <label id="srAdminRenameMenuWrap" hidden>Internal list<select id="srAdminRenameMenu"></select></label>
        </div>
        <div class="sr-admin-grid">
          <label id="srAdminRenameSubWrap" hidden>Nested sub-list<select id="srAdminRenameSub"></select></label>
          <label>New display name<input id="srAdminRenameName" maxlength="100" /></label>
        </div>
        <button id="srAdminRenameAdd" type="button">Add rename to Change Set</button>
      </div>

      <div class="sr-admin-builder sr-admin-danger-zone">
        <div class="sr-admin-builder-title">Delete list / sub-list</div>
        <div class="sr-admin-grid sr-admin-grid-3">
          <label>Delete<select id="srAdminDeleteType">
            <option value="menu">Internal list</option>
            <option value="submenu">Nested sub-list</option>
          </select></label>
          <label>Topic / Tab<select id="srAdminDeleteTab"></select></label>
          <label>Internal list<select id="srAdminDeleteMenu"></select></label>
        </div>
        <div id="srAdminDeleteSubWrap">
          <label>Sub-list<select id="srAdminDeleteSub"></select></label>
        </div>
        <div id="srAdminDeleteSummary" class="sr-admin-delete-summary"></div>
        <button id="srAdminDeleteStructure" type="button" class="danger">Add structure delete to Change Set</button>
      </div>
    </section>

    <div id="srAdminResult" class="sr-admin-result" aria-live="polite"></div>
    <div id="srAdminLiveStatus" class="sr-admin-live-status" data-state="pending" role="status" aria-live="polite" hidden>
      <span id="srAdminLiveText"></span>
      <div class="sr-admin-inline">
        <button id="srAdminLiveCheck" type="button" class="secondary">Check deployed version</button>
        <button id="srAdminLiveReload" type="button" class="secondary" hidden>Reload tool with new SRs</button>
        <a id="srAdminBuildLogs" href="#" target="_blank" rel="noopener noreferrer" hidden>Cloudflare build logs</a>
      </div>
    </div>
  `;
  panelHost.insertBefore(panel, adminStatus);

  const badge = panel.querySelector("#srAdminSyncBadge");
  const notice = panel.querySelector("#srAdminNotice");
  const changeCount = panel.querySelector("#srAdminChangeCount");
  const changeList = panel.querySelector("#srAdminChangeList");
  const publishBatchBtn = panel.querySelector("#srAdminPublishBatch");
  const checkQueueBtn = panel.querySelector("#srAdminCheckQueue");
  const validateDraftBtn = panel.querySelector("#srAdminValidateDraft");
  const unlockQueueBtn = panel.querySelector("#srAdminUnlockQueue");
  const clearBatchBtn = panel.querySelector("#srAdminClearBatch");
  const searchId = panel.querySelector("#srAdminSearchId");
  const searchBtn = panel.querySelector("#srAdminSearchBtn");
  const refreshBtn = panel.querySelector("#srAdminRefreshBtn");
  const searchResult = panel.querySelector("#srAdminSearchResult");
  const targetSummary = panel.querySelector("#srAdminTargetSummary");

  const directTab = panel.querySelector("#srAdminDirectTab");
  const directPosition = panel.querySelector("#srAdminDirectPosition");
  const directRefKind = panel.querySelector("#srAdminDirectReferenceKind");
  const directRefKindWrap = panel.querySelector("#srAdminDirectReferenceKindWrap");
  const directMenuRefWrap = panel.querySelector("#srAdminDirectMenuRefWrap");
  const directMenuRef = panel.querySelector("#srAdminDirectMenuRef");
  const directReferenceWrap = panel.querySelector("#srAdminDirectReferenceWrap");
  const directReferenceId = panel.querySelector("#srAdminDirectReferenceId");
  const directReferenceFind = panel.querySelector("#srAdminDirectReferenceFind");
  const directReferenceResults = panel.querySelector("#srAdminDirectReferenceResults");
  const useDirectBtn = panel.querySelector("#srAdminUseDirect");
  const editPanel = panel.querySelector("#srAdminEditPanel");
  const editPath = panel.querySelector("#srAdminEditPath");
  const editLabel = panel.querySelector("#srAdminEditLabel");
  const editId = panel.querySelector("#srAdminEditId");
  const editTypeName = panel.querySelector("#srAdminEditTypeName");
  const editContent = panel.querySelector("#srAdminEditContent");
  const editMode = panel.querySelector("#srAdminEditMode");
  const editUrl = panel.querySelector("#srAdminEditUrl");
  const renameType = panel.querySelector("#srAdminRenameType");
  const renameTab = panel.querySelector("#srAdminRenameTab");
  const renameMenu = panel.querySelector("#srAdminRenameMenu");
  const renameSub = panel.querySelector("#srAdminRenameSub");
  const renameName = panel.querySelector("#srAdminRenameName");

  const movePanel = panel.querySelector("#srAdminMovePanel");
  const moveSource = panel.querySelector("#srAdminMoveSource");
  const moveTopBtn = panel.querySelector("#srAdminMoveTop");
  const moveBottomBtn = panel.querySelector("#srAdminMoveBottom");
  const moveCancelBtn = panel.querySelector("#srAdminMoveCancel");
  const moveDestinationId = panel.querySelector("#srAdminMoveDestinationId");
  const moveDestinationSearch = panel.querySelector("#srAdminMoveDestinationSearch");
  const moveDestinationResults = panel.querySelector("#srAdminMoveDestinationResults");
  const moveTargetTab = panel.querySelector("#srAdminMoveTargetTab");
  const moveTargetMenu = panel.querySelector("#srAdminMoveTargetMenu");
  const moveTargetSub = panel.querySelector("#srAdminMoveTargetSub");
  const moveTargetPosition = panel.querySelector("#srAdminMoveTargetPosition");
  const moveToListBtn = panel.querySelector("#srAdminMoveToList");
  const moveSrMenuRefWrap = panel.querySelector("#srAdminMoveMenuReferenceWrap");
  const moveSrMenuRef = panel.querySelector("#srAdminMoveMenuReference");

  const builderType = panel.querySelector("#srAdminBuilderType");
  const builderComplaintWrap = panel.querySelector("#srAdminComplaintChannelWrap");
  const builderComplaintChannel = panel.querySelector("#srAdminComplaintChannel");
  const builderName = panel.querySelector("#srAdminBuilderName");
  const builderId = panel.querySelector("#srAdminBuilderId");
  const builderContent = panel.querySelector("#srAdminBuilderContent");
  const builderSubscriberModeWrap = panel.querySelector("#srAdminSubscriberModeWrap");
  const builderSubscriberMode = panel.querySelector("#srAdminSubscriberMode");
  const builderSubscriberModeHint = panel.querySelector("#srAdminSubscriberModeHint");
  const builderVisibleName = panel.querySelector("#srAdminBuilderVisibleName");
  const builderNameHint = panel.querySelector("#srAdminBuilderNameHint");
  const builderGenerateBtn = panel.querySelector("#srAdminGenerateBtn");
  const builderCopyUrlBtn = panel.querySelector("#srAdminCopyUrlBtn");
  const builderDuplicate = panel.querySelector("#srAdminBuilderDuplicate");
  const actionContext = panel.querySelector("#srAdminActionContext");
  const saveActionBtn = panel.querySelector("#srAdminSaveAction");

  const newMenuTab = panel.querySelector("#srAdminNewMenuTab");
  const newMenuPosition = panel.querySelector("#srAdminNewMenuPosition");
  const newMenuRef = panel.querySelector("#srAdminNewMenuRef");
  const newMenuRefWrap = panel.querySelector("#srAdminNewMenuRefWrap");
  const newMenuSr = makeStructureSrReference("srAdminNewMenu", newMenuTab);

  const subTab = panel.querySelector("#srAdminSubTab");
  const subParent = panel.querySelector("#srAdminSubParent");
  const subPosition = panel.querySelector("#srAdminSubPosition");
  const subRef = panel.querySelector("#srAdminSubRef");
  const subRefWrap = panel.querySelector("#srAdminSubRefWrap");

  const moveMenuSourceTab = panel.querySelector("#srAdminMoveMenuSourceTab");
  const moveMenuSource = panel.querySelector("#srAdminMoveMenuSource");
  const moveMenuDestTab = panel.querySelector("#srAdminMoveMenuDestTab");
  const moveMenuPosition = panel.querySelector("#srAdminMoveMenuPosition");
  const moveMenuRef = panel.querySelector("#srAdminMoveMenuRef");
  const moveMenuRefWrap = panel.querySelector("#srAdminMoveMenuRefWrap");
  const moveMenuSr = makeStructureSrReference("srAdminMoveMenu", moveMenuDestTab);
  const moveMenuBtn = panel.querySelector("#srAdminMoveMenu");

  const moveSubSourceTab = panel.querySelector("#srAdminMoveSubSourceTab");
  const moveSubSourceParent = panel.querySelector("#srAdminMoveSubSourceParent");
  const moveSubSource = panel.querySelector("#srAdminMoveSubSource");
  const moveSubDestTab = panel.querySelector("#srAdminMoveSubDestTab");
  const moveSubDestParent = panel.querySelector("#srAdminMoveSubDestParent");
  const moveSubPosition = panel.querySelector("#srAdminMoveSubPosition");
  const moveSubRef = panel.querySelector("#srAdminMoveSubRef");
  const moveSubRefWrap = panel.querySelector("#srAdminMoveSubRefWrap");
  const moveSubBtn = panel.querySelector("#srAdminMoveSub");
  const moveSubSr = makeStructureSrReference("srAdminMoveSub", moveSubDestTab, () => selectedMenuFrom(moveSubDestTab, moveSubDestParent));
  moveSubDestParent.addEventListener("change", moveSubSr.reset);

  const deleteType = panel.querySelector("#srAdminDeleteType");
  const deleteTab = panel.querySelector("#srAdminDeleteTab");
  const deleteMenu = panel.querySelector("#srAdminDeleteMenu");
  const deleteSub = panel.querySelector("#srAdminDeleteSub");
  const deleteSubWrap = panel.querySelector("#srAdminDeleteSubWrap");
  const deleteSummary = panel.querySelector("#srAdminDeleteSummary");
  const deleteStructureBtn = panel.querySelector("#srAdminDeleteStructure");

  const result = panel.querySelector("#srAdminResult");
  const liveBox = panel.querySelector("#srAdminLiveStatus");
  const liveText = panel.querySelector("#srAdminLiveText");
  const liveCheckBtn = panel.querySelector("#srAdminLiveCheck");
  const liveReloadBtn = panel.querySelector("#srAdminLiveReload");
  const liveLogsLink = panel.querySelector("#srAdminBuildLogs");

  refreshSrChoiceControls(panel);

  let expectedLiveHash = "";
  let expectedCommitSha = "";
  let expectedProof = [];
  let liveCheckId = 0;
  const PENDING_KEY = "sr-admin-pending-verified-publication-v1";
  const CHANGESET_DRAFT_KEY = "sr-admin-change-set-draft-v1";
  const FREE_JOB_KEY = "sr-admin-free-publish-request-v1";
  const FREE_VALIDATION_KEY = "sr-admin-free-validation-request-v1";
  let freeValidationJob = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(FREE_VALIDATION_KEY) || "null");
    if (saved?.requestId && /^[0-9a-f-]{36}$/i.test(saved.requestId)) freeValidationJob = saved;
  } catch {}
  let freePendingJob = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(FREE_JOB_KEY) || "null");
    if (saved?.requestId && /^[0-9a-f-]{36}$/i.test(saved.requestId)) {
      freePendingJob = saved;
    }
  } catch {}
  checkQueueBtn.hidden = !freePendingJob;
  // Do not expire or delete outstanding drafts: an interrupted release can take days to recover.
  let fileSha = "";
  let overview = null;
  let selectedTarget = null;
  let builtSr = null;
  let builderMatches = [];
  let pendingOperation = "";
  let selectedAnchor = null;
  let changeSet = [];
  let changeSetBaseSha = "";
  let nextChangeId = 1;
  let activeStagedDestination = null;
  let activeSequenceSourceId = null;
  let moveSourceMatch = null;
  let editTarget = null;
  let editSourceBlock = "";
  let editSourceType = "";
  let editSourceForm = null;
  let directReference = null;

  function targetFromMatch(match) {
    return {
      srTypeId: String(match?.srTypeId || ""),
      occurrence: Number(match?.occurrence || 1),
      fingerprint: String(match?.fingerprint || ""),
    };
  }

  function sameExactPath(left, right) {
    return String(left?.tabId || "") === String(right?.tabId || "") &&
      String(left?.menuLabel || "") === String(right?.menuLabel || "") &&
      Number(left?.menuOccurrence || 1) === Number(right?.menuOccurrence || 1) &&
      String(left?.subMenuLabel || "") === String(right?.subMenuLabel || "") &&
      Number(left?.subMenuOccurrence || 1) === Number(right?.subMenuOccurrence || 1);
  }

  function sameExactTarget(left, right) {
    return String(left?.srTypeId || "") === String(right?.srTypeId || "") &&
      String(left?.fingerprint || "") === String(right?.fingerprint || "") &&
      Number(left?.occurrence || 1) === Number(right?.occurrence || 1);
  }

  function selectIdentity(select, value, occurrence = 1) {
    const option = [...(select?.options || [])].find((item) =>
      String(item.value || "") === String(value || "") &&
      Number(item.dataset.occ || 1) === Number(occurrence || 1)
    );
    if (option) option.selected = true;
    return !!option;
  }


  function resetDirectReference() {
    directReference = null;
    directReferenceResults.innerHTML = "";
    directReferenceId.value = "";
  }

  function renderDirectReferenceControls() {
    const relative = ["before", "after"].includes(directPosition.value);
    directRefKindWrap.hidden = !relative;
    directMenuRefWrap.hidden = !(relative && directRefKind.value === "menu");
    directReferenceWrap.hidden = !(relative && directRefKind.value === "sr");
    if (!relative || directRefKind.value !== "sr") resetDirectReference();
    if (relative && directRefKind.value === "menu") {
      const old = directMenuRef.value;
      const oldOcc = Number(directMenuRef.selectedOptions[0]?.dataset.occ || 1);
      directMenuRef.innerHTML = menuOptions(directTab.value);
      selectIdentity(directMenuRef, old, oldOcc);
    }
    refreshSrChoiceControls(panel);
  }

  async function findDirectReference() {
    const tabId = directTab.value;
    const srTypeId = String(directReferenceId.value || "").trim();
    resetDirectReferenceSelection();
    if (!currentTab(tabId) || !/^\d+$/.test(srTypeId)) {
      return setResult("Choose a Topic and enter a numeric reference SR ID.", "error");
    }
    try {
      const data = await srApi({ action: "find", srTypeId });
      if (fileSha && data.fileSha !== fileSha) {
        return setResult("Catalog changed since you loaded the Admin. Refresh before choosing a position.", "error");
      }
      const choices = (data.matches || []).filter(m =>
        m.tabId === tabId && !m.menuLabel && !m.subMenuLabel);
      if (!choices.length) {
        directReferenceResults.textContent = "No direct SR with this ID in this Topic. Choose an existing SR outside the lists.";
        return setResult("No direct SR found in this exact Topic.", "warn");
      }
      directReferenceResults.innerHTML = choices.map((m, i) =>
        '<button type="button" class="secondary" data-direct-ref="' + i + '">' +
        esc(m.name || "SR") + " • ID " + esc(m.srTypeId) +
        " • occurrence #" + Number(m.occurrence || 1) +
        "</button>").join("");
      directReferenceResults.querySelectorAll("[data-direct-ref]").forEach(btn => {
        btn.addEventListener("click", () => {
          const match = choices[Number(btn.dataset.directRef)];
          if (!match) return;
          directReference = match;
          directReferenceResults.querySelectorAll("button").forEach(x => x.classList.remove("active"));
          btn.classList.add("active");
          setResult("Direct reference selected: " + (match.name || "SR") +
            " • " + directPosition.value + ". Now choose Create direct SR.", "success");
        });
      });
      setResult("Select the exact reference SR from the results.", "success");
    } catch (error) {
      setResult(error.message, "error");
    }
  }

  function resetDirectReferenceSelection() {
    directReference = null;
    directReferenceResults.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  }

  function renderMoveSrDestination({ preferSource = false } = {}) {
    const tabs = Array.isArray(overview?.tabs) ? overview.tabs : [];
    const oldTab = preferSource ? String(moveSourceMatch?.tabId || "") : moveTargetTab.value;
    const tabOptions = tabs.map((tab) =>
      '<option value="' + esc(tab.id) + '">' + esc(tab.displayName || tab.id) + "</option>"
    ).join("");
    moveTargetTab.innerHTML = tabOptions;
    if (oldTab && tabs.some((tab) => tab.id === oldTab)) moveTargetTab.value = oldTab;

    const oldMenu = preferSource ? String(moveSourceMatch?.menuLabel || "") : moveTargetMenu.value;
    const oldMenuOcc = preferSource
      ? Number(moveSourceMatch?.menuOccurrence || 1)
      : Number(moveTargetMenu.selectedOptions[0]?.dataset.occ || 1);
    moveTargetMenu.innerHTML =
      '<option value="">Directly in Topic • no internal list</option>' +
      menuOptions(moveTargetTab.value);
    if (oldMenu) selectIdentity(moveTargetMenu, oldMenu, oldMenuOcc);
    else moveTargetMenu.value = "";

    const menu = selectedMenuFrom(moveTargetTab, moveTargetMenu);
    const oldSub = preferSource ? String(moveSourceMatch?.subMenuLabel || "") : moveTargetSub.value;
    const oldSubOcc = preferSource
      ? Number(moveSourceMatch?.subMenuOccurrence || 1)
      : Number(moveTargetSub.selectedOptions[0]?.dataset.occ || 1);
    moveTargetSub.innerHTML = menu
      ? subMenuOptions(menu, true)
      : '<option value="">No sub-list • direct Topic</option>';
    moveTargetSub.disabled = !menu;
    if (menu && oldSub) selectIdentity(moveTargetSub, oldSub, oldSubOcc);
    else moveTargetSub.value = "";

    const menuRelative = ["before_menu", "after_menu"].includes(moveTargetPosition.value);
    moveMenuRefWrap.hidden = !menuRelative || !!moveTargetMenu.value;
    const oldRef = moveMenuRef.value;
    const oldOcc = Number(moveMenuRef.selectedOptions[0]?.dataset.occ || 1);
    moveMenuRef.innerHTML = menuOptions(moveTargetTab.value);
    selectIdentity(moveMenuRef, oldRef, oldOcc);
    moveToListBtn.disabled = !selectedMoveSrContext() ||
      (menuRelative && (!!moveTargetMenu.value ||
        !selectedMenuFrom(moveTargetTab, moveMenuRef)));
    refreshSrChoiceControls(panel);
  }

  function selectedMoveSrContext() {
    const tabId = String(moveTargetTab.value || "");
    if (!currentTab(tabId)) return null;
    if (!moveTargetMenu.value) {
      return { tabId, menuLabel: "", menuOccurrence: 1, subMenuLabel: "", subMenuOccurrence: 1 };
    }
    const menu = selectedMenuFrom(moveTargetTab, moveTargetMenu);
    if (!menu) return null;
    const sub = moveTargetSub.value
      ? selectedSubFrom(moveTargetTab, moveTargetMenu, moveTargetSub)
      : null;
    if (moveTargetSub.value && !sub) return null;
    return {
      tabId: moveTargetTab.value,
      menuLabel: menu.label,
      menuOccurrence: Number(menu.occurrence || 1),
      subMenuLabel: sub?.label || "",
      subMenuOccurrence: Number(sub?.occurrence || 1),
    };
  }

  function resetMovePanel() {
    moveSourceMatch = null;
    movePanel.hidden = true;
    moveSource.textContent = "No SR selected for moving.";
    moveDestinationId.value = "";
    moveDestinationResults.innerHTML = "";
    searchResult?.querySelectorAll(".sr-admin-match").forEach((item) => item.classList.remove("selected"));
    searchResult?.querySelectorAll("[data-target-op]").forEach((button) => button.classList.remove("active"));
  }

  function startMove(match, card) {
    hideSrEditor();
    moveSourceMatch = match;
    movePanel.hidden = false;
    moveSource.textContent =
      (match.name || "SR") + " • ID " + match.srTypeId + " • " + targetPath(match);
    moveDestinationId.value = "";
    moveDestinationResults.innerHTML = "";
    renderMoveSrDestination({ preferSource: true });

    searchResult.querySelectorAll(".sr-admin-match").forEach((item) => item.classList.remove("selected"));
    searchResult.querySelectorAll("[data-target-op]").forEach((button) => button.classList.remove("active"));
    card?.classList.add("selected");
    card?.querySelector('[data-target-op="move"]')?.classList.add("active");

    actionContext.dataset.ready = "false";
    actionContext.textContent = "Move mode active • choose any destination list or find any destination SR.";
    targetSummary.textContent = "Moving: " + (match.name || "SR") + " • " + targetPath(match);
    setResult("Move mode ready. You can move this SR anywhere in the catalog.", "success");
  }

  function stageMove(operation, destinationMatch = null, destinationContext = null) {
    if (!moveSourceMatch) {
      return setResult("Choose Move on an SR first.", "error");
    }

    const payload = {
      operation,
      target: targetFromMatch(moveSourceMatch),
      block: "",
      ...(destinationMatch ? { destination: targetFromMatch(destinationMatch) } : {}),
      ...(destinationContext ? { destinationContext: { ...destinationContext } } : {}),
    };

    let detail = "";
    if (operation === "move_to_start" || operation === "move_to_end") {
      const destinationPath = destinationContext
        ? [destinationContext.tabId, destinationContext.menuLabel, destinationContext.subMenuLabel].filter(Boolean).join(" / ")
        : targetPath(moveSourceMatch);
      detail = (operation === "move_to_start" ? "Move to first • " : "Move to last • ") + destinationPath;
    } else {
      detail =
        (operation === "move_before" ? "Before " : "After ") +
        "SR " + destinationMatch.srTypeId + " • " + (destinationMatch.name || "SR") +
        " • " + targetPath(destinationMatch);
    }

    const queued = stageChange(
      payload,
      "Move SR " + moveSourceMatch.srTypeId + " • " + (moveSourceMatch.name || "SR"),
      detail
    );
    if (queued) resetMovePanel();
  }

  async function findMoveDestination() {
    if (!moveSourceMatch) return setResult("Choose Move on an SR first.", "error");
    const id = String(moveDestinationId.value || "").trim();
    if (!/^\d+$/.test(id)) {
      setResult("Enter a numeric destination SR ID.", "error");
      moveDestinationId.focus();
      return;
    }

    try {
      setResult("Finding destination SR anywhere in the catalog…");
      const data = await srApi({ action: "find", srTypeId: id });
      fileSha = data.fileSha;
      overview = data.overview;
      renderMenus();

      const compatible = (Array.isArray(data.matches) ? data.matches : [])
        .filter((match) =>
          !sameExactTarget(targetFromMatch(moveSourceMatch), targetFromMatch(match))
        );

      if (!compatible.length) {
        moveDestinationResults.innerHTML =
          '<div class="sr-admin-empty">No usable destination SR found.</div>';
        setResult("No usable destination SR was found.", "warn");
        return;
      }

      moveDestinationResults.innerHTML = compatible.map((match, index) => `
        <article class="sr-admin-move-destination-item" data-move-destination-index="${index}">
          <div>
            <b>${esc(match.name || "Unnamed SR")}</b>
            <small>ID ${esc(match.srTypeId)} • ${esc(targetPath(match))}</small>
          </div>
          <div class="sr-admin-target-actions">
            <button type="button" data-move-relative="before">Move before</button>
            <button type="button" data-move-relative="after">Move after</button>
          </div>
        </article>
      `).join("");

      moveDestinationResults.querySelectorAll("[data-move-destination-index]").forEach((card) => {
        const match = compatible[Number(card.dataset.moveDestinationIndex)];
        card.querySelectorAll("[data-move-relative]").forEach((button) => {
          button.addEventListener("click", () => {
            stageMove(button.dataset.moveRelative === "before" ? "move_before" : "move_after", match);
          });
        });
      });

      setResult("Destination found. It can be a direct SR or inside any list / sub-list.", "success");
    } catch (error) {
      setResult(error.message, "error");
    }
  }

  function setResult(message, type = "info", extra = "") {
    result.dataset.type = type;
    result.innerHTML = esc(message || "") + (extra || "");
    if (typeof setAdminStatus === "function") {
      setAdminStatus(message || "", type === "error" ? "error" : "info");
    }
  }

  async function reportDeploymentProblem(reason, pending = false) {
    const requestCheckId = liveCheckId;
    const requestCommit = expectedCommitSha;
    liveBox.dataset.state = pending ? "pending" : "unverified";
    liveText.textContent = (pending ? "NOT published yet: " : "NOT verified: ") + reason;
    liveLogsLink.hidden = true;
    if (!requestCommit) return;
    try {
      const status = await srApi({ action: "deployment_status", commitSha: requestCommit });
      if (requestCheckId !== liveCheckId) return;
      if (status?.state === "failed") {
        liveBox.dataset.state = "failed";
        liveText.textContent = "Cloudflare BUILD FAILED. GitHub saved your edit, but it is NOT in the tool. Fix the build; do not submit the same edit twice.";
        try {
          const link = new URL(status.detailsUrl);
          if (link.protocol === "https:" && link.hostname === "dash.cloudflare.com") {
            liveLogsLink.href = link.href;
            liveLogsLink.hidden = false;
          }
        } catch {}
      } else if (status?.state === "build_success" && pending) {
        liveBox.dataset.state = "unverified";
        liveText.textContent = "Cloudflare built this commit, but the exact updated HTML is still NOT served. Check again; never assume this edit is live.";
      }
    } catch { /* A missing GitHub Checks scope must never become a false success. */ }
  }

  // Both the full Admin (inside tool) and scoped SR Admin (nested iframe)
  // must inspect the actual TOOL document, never the management workspace.
  function currentToolDocument() {
    if (document.querySelector('meta[name="sr-catalog-sha256"]')) return document;
    try {
      const parent = window.parent?.document;
      if (parent && parent !== document &&
          parent.querySelector('meta[name="sr-catalog-sha256"]')) return parent;
    } catch { /* Different origin or inaccessible parent: cannot claim success. */ }
    return document;
  }

  // Fail closed: an admin cannot publish new changes while the source catalog
  // is absent from the deployed HTML or the currently opened SR tool.
  async function requireLiveBaseline() {
    const hash = String(overview?.sha256 || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("Cannot verify the catalog version. Refresh SR Management before saving.");
    }
    if (expectedLiveHash && expectedLiveHash !== hash) {
      throw new Error("A previous SR edit is still awaiting publication. Check its status before another edit.");
    }
    setResult("Checking that the current GitHub catalog is actually visible in the open SR tool…");
    let state;
    try {
      state = await verifyOpenedSrCatalog({
        hash,
        proof: [],
        currentDocument: currentToolDocument(),
      });
    } catch (error) {
      throw Object.assign(new Error("Publishing safely paused: unable to verify the live SR tool. " + error.message), { code: "PREFLIGHT_LIVE_UNVERIFIED" });
    }
    if (state.state !== "live") {
      throw Object.assign(new Error("Publishing paused: " + state.reason +
        " Reload the tool after Cloudflare deploys, then check again."), { code: "PREFLIGHT_LIVE_UNVERIFIED" });
    }
  }

  // One explicit post-save check, one on reopening Admin, and manual checks.
  // Both compiled HTML and the CURRENT opened iframe must contain the edit.
  async function checkDeployedCatalog() {
    if (!expectedLiveHash) return;
    const checkId = ++liveCheckId;
    liveCheckBtn.disabled = true;
    liveReloadBtn.hidden = true;
    liveLogsLink.hidden = true;
    liveBox.dataset.state = "pending";
    liveText.textContent = "Checking Cloudflare's actual HTML and this open tool's visible SRs…";
    try {
      const state = await verifySrPublication({
        hash: expectedLiveHash,
        proof: expectedProof,
        currentDocument: currentToolDocument(),
      });
      if (checkId !== liveCheckId) return;
      liveBox.dataset.state = state.state;
      liveText.textContent = state.reason;
      liveReloadBtn.hidden = state.state !== "deployed" && !state.reloadRequired;
      liveBox.dataset.reloadRequired = state.reloadRequired ? "1" : "0";
      if (state.state === "live") {
        // Release the pending write lock only after proving the exact change
        // is rendered in the CURRENTLY OPEN tool, not merely built on Cloudflare.
        try { sessionStorage.removeItem(PENDING_KEY); } catch {}
        expectedLiveHash = "";
        expectedCommitSha = "";
        expectedProof = [];
      }
      if (state.state === "pending") await reportDeploymentProblem(state.reason, true);
    } catch (error) {
      if (checkId !== liveCheckId) return;
      await reportDeploymentProblem(error?.message || "Could not verify the deployed SR markup.");
      liveReloadBtn.hidden = true;
    } finally {
      if (checkId === liveCheckId) liveCheckBtn.disabled = false;
    }
  }

  function trackPublication(data, operations = []) {
    const hash = String(data?.after?.sha256 || "").trim().toLowerCase();
    expectedLiveHash = /^[a-f0-9]{64}$/.test(hash) ? hash : "";
    expectedCommitSha = String(data?.commit?.commitSha || "");
    expectedProof = summarizeSrProof(operations,
      Array.isArray(data?.results) ? data.results : [{ added: data?.added }]);
    liveBox.hidden = false;
    liveBox.dataset.state = "pending";
    liveReloadBtn.hidden = true;
    liveText.textContent = "Saved to GitHub. NOT published until the actual Cloudflare HTML AND this open tool are verified.";
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        hash: expectedLiveHash, commit: expectedCommitSha,
        proof: expectedProof, savedAt: Date.now()
      }));
    } catch {}
    if (expectedLiveHash) void checkDeployedCatalog();
  }

  liveCheckBtn.addEventListener("click", () => { void checkDeployedCatalog(); });
  liveReloadBtn.addEventListener("click", () => {
    if (!expectedLiveHash || (liveBox.dataset.state !== "deployed" && liveBox.dataset.reloadRequired !== "1")) return;
    persistChangeSetDraft();
    // Scoped SR Admin runs in /sr-admin-workspace.html INSIDE the tool.
    // Reload the actual parent tool document, not this management-only iframe.
    let target = window;
    if (!document.querySelector('meta[name="sr-catalog-sha256"]')) {
      try {
        if (window.parent !== window &&
            new URL(window.parent.location.href).origin === window.location.origin) {
          target = window.parent;
        } else {
          throw new Error("The actual tool window is not accessible for safe reload.");
        }
      } catch {
        liveBox.dataset.state = "unverified";
        liveText.textContent = "The updated SRs are deployed, but the open tool could not be reloaded from this workspace. Reopen the main tool.";
        return;
      }
    }
    const url = new URL(target.location.href);
    url.searchParams.set("sr_catalog_rev", expectedLiveHash.slice(0, 16));
    target.location.replace(url.href);
  });

  // Preserve the pending receipt through iframe reload and across admin reopen.
  try {
    const previous = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    if (previous && /^[a-f0-9]{64}$/i.test(String(previous.hash || "")) &&
        Date.now() - Number(previous.savedAt || 0) < 30 * 24 * 3600 * 1000) {
      expectedLiveHash = previous.hash;
      expectedCommitSha = String(previous.commit || "");
      expectedProof = Array.isArray(previous.proof) ? previous.proof.slice(0, 100) : [];
      liveBox.hidden = false;
      void checkDeployedCatalog();
    }
  } catch {}

  function showNotice(message, type = "warn") {
    notice.hidden = !message;
    notice.dataset.type = type;
    notice.textContent = message || "";
  }

  function removeChangeSetDraft() {
    try { sessionStorage.removeItem(CHANGESET_DRAFT_KEY); } catch {}
  }

  function persistChangeSetDraft() {
    try {
      if (!changeSet.length) {
        removeChangeSetDraft();
        return;
      }
      sessionStorage.setItem(CHANGESET_DRAFT_KEY, JSON.stringify({
        v: 1,
        baseSha: String(changeSetBaseSha || ""),
        changeSet: changeSet.slice(0, 100),
        nextChangeId: Number(nextChangeId || 1),
        activeQueueId: Number(activeStagedDestination?.queueId || 0) || null,
        activeSequenceSourceId: Number(activeSequenceSourceId || 0) || null,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  function readChangeSetDraft() {
    try {
      const raw = sessionStorage.getItem(CHANGESET_DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      // Invalid / older drafts remain in storage for manual recovery; never delete silently.
      if (draft?.v !== 1 || !Array.isArray(draft?.changeSet) ||
          !draft.changeSet.length || draft.changeSet.length > 100 ||
          draft.changeSet.some((item) => !item || typeof item !== "object" ||
            !item.payload || typeof item.payload !== "object")) {
        return null;
      }
      return draft;
    } catch {
      // Leave the exact original sessionStorage bytes for manual recovery.
      return null;
    }
  }

  function restoreActiveDraftDestination(activeQueueId) {
    const queueId = Number(activeQueueId || 0);
    const item = queueId ? changeSet.find((entry) => entry.id === queueId && entry.destination) : null;
    activeStagedDestination = item?.destination ? { ...item.destination, queueId: item.id } : null;
    selectedAnchor = null;
    selectedTarget = null;

    if (activeStagedDestination) {
      pendingOperation = activeStagedDestination.operation;
      builderSubscriberMode.value = "";
      syncSrChoiceControl(builderSubscriberMode);
      actionContext.dataset.ready = "true";
      actionContext.textContent = "Restored queued destination • " + activeStagedDestination.label;
      targetSummary.textContent = "Draft restored. New SRs will continue inside this queued destination.";
    } else {
      pendingOperation = "";
      actionContext.dataset.ready = "false";
      actionContext.textContent = "Draft restored • choose a queued destination or search for an SR.";
    }
  }

  async function restoreChangeSetDraft() {
    const stored = readChangeSetDraft();
    let loadedFromStorage = false;
    let activeQueueId = Number(activeStagedDestination?.queueId || 0) || null;
    let restoredSequenceId = Number(activeSequenceSourceId || 0) || null;

    if (!changeSet.length && stored) {
      changeSet = stored.changeSet;
      changeSetBaseSha = String(stored.baseSha || "");
      const maxId = changeSet.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0);
      nextChangeId = Math.max(Number(stored.nextChangeId || 1), maxId + 1, 1);
      activeQueueId = Number(stored.activeQueueId || 0) || null;
      restoredSequenceId = Number(stored.activeSequenceSourceId || 0) || null;
      loadedFromStorage = true;
    }

    if (!changeSet.length) return;
    if (freePendingJob || freeValidationJob) {
      renderChangeSet();
      setResult("An asynchronous SR request is pending. Check GitHub status before modifying the preserved draft.", "warn");
      return;
    }

    renderChangeSet();
    renderSubParent();
    const sequenceItem = restoredSequenceId
      ? changeSet.find((entry) => entry.id === restoredSequenceId && entry.nextSr)
      : null;
    if (sequenceItem) {
      activateSequentialAdd(sequenceItem, { persist: false, clearFields: false });
    } else {
      activeSequenceSourceId = null;
      restoreActiveDraftDestination(activeQueueId);
    }

    if (!fileSha) {
      persistChangeSetDraft();
      return;
    }

    if (changeSetBaseSha === fileSha) {
      persistChangeSetDraft();
      if (loadedFromStorage) {
        setResult(
          "Restored " + changeSet.length + " queued change" + (changeSet.length === 1 ? "" : "s") +
          " after reload. Nothing was written.",
          "success"
        );
      }
      return;
    }

    persistChangeSetDraft();
    renderChangeSet();
    setResult(
      "The SR catalog changed after this draft was staged. All " + changeSet.length +
      " queued changes are preserved with their original SHA. " +
      "Use Validate preserved draft in GitHub to check compatibility without a Cloudflare catalog scan or a write. " +
      "The original SHA stays locked until you approve a validated rebase.",
      "warn"
    );
  }

  function queueLabel(entry) {
    return String(entry?.summary || entry?.payload?.operation || "Queued change");
  }

  function queuedSrMatches(srTypeId) {
    const id = String(srTypeId || "").trim();
    if (!id) return [];
    return changeSet.map((item, index) => ({ item, index })).filter(({ item }) =>
      String(item?.srMeta?.srTypeId || "") === id
    );
  }

  function descendantChangeIds(rootId) {
    const found = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of changeSet) {
        if (item.dependsOn && found.has(item.dependsOn) && !found.has(item.id)) {
          found.add(item.id);
          changed = true;
        }
      }
    }
    return found;
  }

  function isSequentialSrAdd(operation = "") {
    return ["insert_above", "insert_below", "append_to_menu", "append_to_submenu", "append_to_tab"]
      .includes(String(operation || ""));
  }

  function sequenceTemplateForAdd(payload = {}, context = {}) {
    const operation = String(payload?.operation || "");
    if (!isSequentialSrAdd(operation)) return null;

    if (operation === "insert_above" || operation === "insert_below") {
      const anchor = context.anchor || {};
      return {
        kind: "anchor",
        operation,
        target: payload?.target ? { ...payload.target } : null,
        anchor: {
          srTypeId: String(anchor?.srTypeId || payload?.target?.srTypeId || ""),
          name: String(anchor?.name || "SR"),
          tabId: String(anchor?.tabId || ""),
          menuLabel: String(anchor?.menuLabel || ""),
          menuOccurrence: Number(anchor?.menuOccurrence || 1),
          subMenuLabel: String(anchor?.subMenuLabel || ""),
          subMenuOccurrence: Number(anchor?.subMenuOccurrence || 1),
          occurrence: Number(anchor?.occurrence || payload?.target?.occurrence || 1),
          fingerprint: String(anchor?.fingerprint || payload?.target?.fingerprint || ""),
        },
        label: String(context.label || ""),
      };
    }

    const destination = context.destination || {};
    return {
      kind: "destination",
      operation,
      menu: payload?.menu ? { ...payload.menu } : null,
      submenu: payload?.submenu ? { ...payload.submenu } : null,
      tabId: String(payload?.tabId || destination?.tabId || ""),
      mode: String(destination?.mode || ""),
      placement: payload?.placement ? { ...payload.placement } : null,
      label: String(context.label || destination?.label || "queued list"),
      menuLabel: String(destination?.menuLabel || payload?.menu?.label || payload?.menu?.newLabel || ""),
      subMenuLabel: String(destination?.subMenuLabel || payload?.submenu?.label || payload?.submenu?.newLabel || ""),
      structureQueueId: Number(context.structureQueueId || destination?.queueId || 0) || null,
      subscriberMode: String(context.subscriberMode || ""),
    };
  }

  function sequenceItemLabel(item) {
    return String(item?.srMeta?.name || item?.summary || "queued SR");
  }

  function activateSequentialAdd(item, { persist = true, clearFields = true } = {}) {
    if (!item?.nextSr) return false;

    activeSequenceSourceId = item.id;
    const next = item.nextSr;

    if (next.kind === "anchor") {
      activeStagedDestination = null;
      selectedTarget = next.target ? { ...next.target } : null;
      selectedAnchor = next.anchor ? { ...next.anchor } : null;
      pendingOperation = next.operation;
    } else if (next.kind === "destination") {
      selectedTarget = null;
      selectedAnchor = null;
      activeStagedDestination = {
        operation: next.operation,
        ...(next.menu ? { menu: { ...next.menu } } : {}),
        ...(next.submenu ? { submenu: { ...next.submenu } } : {}),
        tabId: next.tabId,
        mode: next.mode,
        ...(next.placement ? { placement: { ...next.placement } } : {}),
        label: next.label,
        menuLabel: next.menuLabel,
        subMenuLabel: next.subMenuLabel,
        queueId: next.structureQueueId || null,
      };
      pendingOperation = next.operation;
    } else {
      activeSequenceSourceId = null;
      return false;
    }

    builderSubscriberMode.value =
      next.kind === "destination" ? String(next.subscriberMode || "") : "";
    syncSubscriberModeControl({ reset: next.kind !== "destination" || !next.subscriberMode });
    invalidateBuilderGeneration();

    if (clearFields) {
      clearSmartBuilder();
    } else {
      renderBuilderPreview();
    }

    actionContext.dataset.ready = "true";
    actionContext.textContent =
      "Sequence mode • next SR after Item #" +
      (changeSet.findIndex((entry) => entry.id === item.id) + 1) +
      " • " + sequenceItemLabel(item);
    targetSummary.textContent =
      next.kind === "destination"
        ? "Next SR will stay inside “" + String(next.label || "this list") +
          "” and follow “" + sequenceItemLabel(item) + "” in the Change Set order. Keep adding or Publish when ready."
        : "Next SR will be placed directly after “" + sequenceItemLabel(item) +
          "” in the final published order. Keep adding or Publish when ready.";
    saveActionBtn.textContent = "Add next SR to Change Set";

    if (persist) persistChangeSetDraft();
    builderName.focus();
    return true;
  }

  function renderChangeSet() {
    changeCount.textContent = String(changeSet.length);
    const needsRevalidation = !!changeSet.length && !!fileSha &&
      changeSetBaseSha !== fileSha;
    publishBatchBtn.disabled = changeSet.length === 0 || !!freePendingJob ||
      !!freeValidationJob || needsRevalidation;
    validateDraftBtn.hidden = !needsRevalidation && !freeValidationJob;
    validateDraftBtn.disabled = !changeSet.length || !!freePendingJob;
    validateDraftBtn.textContent = freeValidationJob
      ? "Check GitHub validation" : "Validate preserved draft in GitHub";
    clearBatchBtn.disabled = changeSet.length === 0 || !!freePendingJob ||
      !!freeValidationJob;

    if (!changeSet.length) {
      changeList.innerHTML = '<div class="sr-admin-empty">No queued changes yet.</div>';
      return;
    }

    changeList.innerHTML = changeSet.map((item, index) => `
      <article class="sr-admin-change-item${activeSequenceSourceId === item.id ? " sequence-active" : ""}" data-change-id="${item.id}">
        <div class="sr-admin-change-index">${index + 1}</div>
        <div class="sr-admin-change-copy">
          <b>${esc(queueLabel(item))}</b>
          <small>${esc(item.detail || "")}</small>
        </div>
        <div class="sr-admin-change-actions">
          ${item.nextSr ? '<button type="button" class="secondary sr-admin-next-sr" data-add-next-sr aria-pressed="' + (activeSequenceSourceId === item.id ? "true" : "false") + '" title="Continue from this SR in the same list and keep the final order">' + (activeSequenceSourceId === item.id ? "✓ Next SR active" : "+ Add next SR") + '</button>' : ""}
          ${item.destination ? '<button type="button" class="secondary" data-use-destination>Use for next SRs</button>' : ""}
          <button type="button" class="ghost" data-remove-change>Remove</button>
        </div>
      </article>
    `).join("");

    changeList.querySelectorAll("[data-remove-change]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-change-id]");
        const id = Number(card?.dataset.changeId || 0);
        const ids = descendantChangeIds(id);
        if (ids.size > 1 && !window.confirm("Removing this queued item will also remove " + (ids.size - 1) + " dependent next change(s). Continue?")) {
          return;
        }
        if (freePendingJob || freeValidationJob) {
          setResult("Draft is locked until the GitHub request is resolved.", "warn");
          return;
        }
        changeSet = changeSet.filter((item) => !ids.has(item.id));
        if (activeSequenceSourceId && ids.has(activeSequenceSourceId)) {
          activeSequenceSourceId = null;
        }
        if (activeStagedDestination && ids.has(activeStagedDestination.queueId)) {
          activeStagedDestination = null;
          selectedAnchor = null;
          selectedTarget = null;
          pendingOperation = "";
          actionContext.dataset.ready = "false";
          actionContext.textContent = "Search for an SR above, or choose Use for next SRs from a queued list.";
          clearSmartBuilder();
        }
        if (!changeSet.length) changeSetBaseSha = "";
        renderChangeSet();
        renderSubParent();
        persistChangeSetDraft();
      });
    });

    changeList.querySelectorAll("[data-add-next-sr]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-change-id]");
        const id = Number(card?.dataset.changeId || 0);
        const item = changeSet.find((entry) => entry.id === id);
        if (!item?.nextSr) return;
        activateSequentialAdd(item);
        renderChangeSet();
        setResult(
          "Sequence mode active • the next SR will be directly after “" +
          sequenceItemLabel(item) + "”.",
          "success"
        );
      });
    });

    changeList.querySelectorAll("[data-use-destination]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-change-id]");
        const id = Number(card?.dataset.changeId || 0);
        const item = changeSet.find((entry) => entry.id === id);
        if (!item?.destination) return;
        activeSequenceSourceId = null;
        activeStagedDestination = { ...item.destination, queueId: item.id };
        selectedAnchor = null;
        selectedTarget = null;
        pendingOperation = item.destination.operation;
        builderSubscriberMode.value = "";
        syncSrChoiceControl(builderSubscriberMode);
        invalidateBuilderGeneration();
        renderBuilderPreview();
        actionContext.dataset.ready = "true";
        actionContext.textContent = "Queued destination • " + item.destination.label;
        targetSummary.textContent = "New SRs will be added inside this queued destination. Add as many as needed before Publish.";
        persistChangeSetDraft();
        builderName.focus();
      });
    });
  }

  function stageChange(payload, summary, detail = "", options = {}) {
    if (freePendingJob || freeValidationJob) {
      setResult("A GitHub publish or validation is unresolved. Check its status before changing the staged draft.", "warn");
      return null;
    }
    if (!fileSha) {
      setResult("Refresh the SR catalog before adding changes.", "error");
      return null;
    }
    if (changeSet.length >= 100) {
      setResult("A single Change Set can contain at most 100 changes.", "error");
      return null;
    }
    if (changeSetBaseSha && changeSetBaseSha !== fileSha) {
      setResult("The catalog changed while this Change Set was open. Clear it and refresh before mixing versions.", "error");
      return null;
    }

    const op = String(payload?.operation || "");
    if (["replace", "delete", "move_before", "move_after", "move_to_start", "move_to_end"].includes(op)) {
      const target = payload?.target || {};
      const duplicateTarget = changeSet.some((item) => {
        if (!["replace", "delete", "move_before", "move_after", "move_to_start", "move_to_end"].includes(String(item.payload?.operation || ""))) return false;
        const existing = item.payload?.target || {};
        return String(existing.srTypeId || "") === String(target.srTypeId || "") &&
          String(existing.fingerprint || "") === String(target.fingerprint || "") &&
          Number(existing.occurrence || 1) === Number(target.occurrence || 1);
      });
      if (duplicateTarget) {
        setResult("That exact SR already has a queued Replace / Delete / Move action.", "error");
        return null;
      }
    }

    if (["move_menu", "delete_menu", "move_submenu", "delete_submenu"].includes(op)) {
      const sourceKey = op.endsWith("_menu") && !op.includes("submenu")
        ? [
            "menu",
            String(payload?.menu?.tabId || ""),
            String(payload?.menu?.label || ""),
            Number(payload?.menu?.occurrence || 1),
          ].join("|")
        : [
            "submenu",
            String(payload?.menu?.tabId || ""),
            String(payload?.menu?.label || ""),
            Number(payload?.menu?.occurrence || 1),
            String(payload?.submenu?.label || ""),
            Number(payload?.submenu?.occurrence || 1),
          ].join("|");

      const duplicateStructure = changeSet.some((item) => {
        const existingOp = String(item.payload?.operation || "");
        if (!["move_menu", "delete_menu", "move_submenu", "delete_submenu"].includes(existingOp)) return false;
        const existingKey = existingOp.endsWith("_menu") && !existingOp.includes("submenu")
          ? [
              "menu",
              String(item.payload?.menu?.tabId || ""),
              String(item.payload?.menu?.label || ""),
              Number(item.payload?.menu?.occurrence || 1),
            ].join("|")
          : [
              "submenu",
              String(item.payload?.menu?.tabId || ""),
              String(item.payload?.menu?.label || ""),
              Number(item.payload?.menu?.occurrence || 1),
              String(item.payload?.submenu?.label || ""),
              Number(item.payload?.submenu?.occurrence || 1),
            ].join("|");
        return existingKey === sourceKey;
      });
      if (duplicateStructure) {
        setResult("That exact list / sub-list already has a queued Move or Delete action.", "error");
        return null;
      }
    }

    if (op === "create_menu") {
      const tabId = String(payload?.menu?.tabId || "");
      const label = String(payload?.menu?.newLabel || "").toLowerCase();
      const existsNow = (currentTab(tabId)?.menus || []).some((menu) => String(menu.label || "").toLowerCase() === label);
      const existsQueued = changeSet.some((item) =>
        item.payload?.operation === "create_menu" &&
        String(item.payload?.menu?.tabId || "") === tabId &&
        String(item.payload?.menu?.newLabel || "").toLowerCase() === label
      );
      if (existsNow || existsQueued) {
        setResult("An internal list with this name already exists or is already queued in this Topic.", "error");
        return null;
      }
    }

    if (!changeSetBaseSha) changeSetBaseSha = fileSha;

    const automaticNextSr =
      options.srMeta && isSequentialSrAdd(op)
        ? sequenceTemplateForAdd(payload, options.sequenceContext || {})
        : null;

    const item = {
      id: nextChangeId++,
      payload,
      summary,
      detail,
      dependsOn: options.dependsOn || null,
      destination: options.destination || null,
      nextSr: options.nextSr === undefined ? automaticNextSr : options.nextSr,
      srMeta: options.srMeta ? {
        srTypeId: String(options.srMeta.srTypeId || ""),
        name: String(options.srMeta.name || ""),
        path: String(options.srMeta.path || detail || ""),
      } : null,
    };
    const insertAfterId = Number(options.insertAfterId || 0);
    const insertAfterIndex = insertAfterId
      ? changeSet.findIndex((entry) => entry.id === insertAfterId)
      : -1;
    if (insertAfterIndex >= 0) {
      changeSet.splice(insertAfterIndex + 1, 0, item);
    } else {
      changeSet.push(item);
    }
    renderChangeSet();
    renderSubParent();
    persistChangeSetDraft();
    setResult("Added to Change Set • " + changeSet.length + " queued change" + (changeSet.length === 1 ? "" : "s") + ".", "success");
    return item;
  }

  function clearChangeSet() {
    if (!changeSet.length) return;
    if (!window.confirm("Clear all " + changeSet.length + " queued changes? Nothing has been deployed yet.")) return;
    changeSet = [];
    changeSetBaseSha = "";
    removeChangeSetDraft();
    activeStagedDestination = null;
    activeSequenceSourceId = null;
    selectedAnchor = null;
    selectedTarget = null;
    pendingOperation = "";
    resetMovePanel();
    renderChangeSet();
    renderSubParent();
    clearSmartBuilder();
    actionContext.dataset.ready = "false";
    actionContext.textContent = "Search for an SR above, or choose a queued destination.";
    setResult("Change Set cleared. Nothing was written to GitHub.", "success");
  }


  // Workers Free: no catalog mutation or large HTML scan in the HTTP request.
  // GitHub Actions validates and writes the whole Change Set asynchronously.
  async function freeQueueApi(body) {
    const res = await fetch("/api/sr-publish-queue", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Could not confirm GitHub queue status (HTTP " + res.status + ").");
    }
    return data;
  }

  async function validateRestoredDraft() {
    if (freePendingJob) return setResult(
      "Publishing is unresolved. Check the GitHub publish before validating again.", "warn");
    if (!changeSet.length) return;
    validateDraftBtn.disabled = true;
    try {
      if (freeValidationJob) {
        const status = await freeQueueApi({
          action: "status", kind: "validate", requestId: freeValidationJob.requestId,
        });
        if (status.state !== "validated") {
          // A validation-only GitHub runner never publishes the catalog. Once
          // GitHub has conclusively finished without a receipt, an explicit
          // operator recovery can release ONLY its request lock.
          if (status.state === "failed_or_unconfirmed" && window.confirm(
            "GitHub validation ended without a trusted receipt. Have you checked the linked " +
            "workflow result? Unlock ONLY this validation request to validate again?\\n\\n" +
            "Your original SR Change Set and SHA will remain unchanged. Nothing is published."
          )) {
            freeValidationJob = null;
            try { sessionStorage.removeItem(FREE_VALIDATION_KEY); } catch {}
            renderChangeSet();
            return setResult(
              "Validation request lock released. The original draft was preserved. " +
              "You may request a new GitHub validation after checking the catalog.",
              "warn"
            );
          }
          return setResult(
            "GitHub validation: " + status.state +
              ". Your original Change Set and SHA remain preserved. Check again later; no publish retry occurs.",
            "warn"
          );
        }
        const report = status.validation || {};
        if (report.expectedSha !== freeValidationJob.expectedSha ||
            report.operationCount !== freeValidationJob.operations.length ||
            JSON.stringify(changeSet.map(item => item.payload)) !==
              JSON.stringify(freeValidationJob.operations) ||
            changeSetBaseSha !== freeValidationJob.expectedSha) {
          return setResult("Validation receipt does not match this preserved Change Set. No rebase made.", "error");
        }
        freeValidationJob = null;
        try { sessionStorage.removeItem(FREE_VALIDATION_KEY); } catch {}
        if (!report.valid) {
          renderChangeSet();
          return setResult(
            "GitHub rejected draft compatibility" +
              (Number.isInteger(report.batchIndex) ? " at item " + (report.batchIndex + 1) : "") +
              ": " + (report.reason || "conflicting catalog change") +
              ". Your original draft and SHA are untouched. Nothing was published.", "warn");
        }
        if (report.currentSha !== fileSha) {
          renderChangeSet();
          return setResult(
            "GitHub catalog changed again during validation. Refresh the SR overview and validate again. " +
            "The original draft has not been rebased.", "warn");
        }
        if (!window.confirm(
          "GitHub validated all " + report.operationCount +
          " staged changes against the current catalog without writing anything.\\n\\n" +
          "Approve updating ONLY the draft baseline SHA to the current GitHub version? " +
          "The publisher will revalidate all operations again before any commit."
        )) {
          renderChangeSet();
          return setResult("Validated, but you declined the SHA rebase. The original draft remains intact.", "warn");
        }
        changeSetBaseSha = report.currentSha;
        persistChangeSetDraft();
        renderChangeSet();
        return setResult(
          "GitHub validation accepted. Draft SHA updated with your approval; no SRs published. " +
          "Review the Change Set before choosing Queue secure publish.", "success");
      }
      if (!fileSha || !changeSetBaseSha || fileSha === changeSetBaseSha) {
        return setResult("Refresh the SR overview before requesting compatibility validation.", "warn");
      }
      const pending = {
        requestId: crypto.randomUUID(),
        expectedSha: changeSetBaseSha,
        operations: changeSet.map(item => item.payload),
        savedAt: Date.now(),
      };
      // A stable, persisted request ID survives lost responses and reloads.
      freeValidationJob = pending;
      sessionStorage.setItem(FREE_VALIDATION_KEY, JSON.stringify(pending));
      renderChangeSet();
      const reply = await freeQueueApi({
        action: "validate", requestId: pending.requestId,
        expectedSha: pending.expectedSha, operations: pending.operations,
      });
      setResult("GitHub compatibility validation " + reply.state +
        ". Nothing has been published; select Check GitHub validation for the signed result.", "warn");
    } catch (error) {
      setResult("GitHub draft validation status is uncertain: " + error.message +
        ". Original draft untouched. Check the same request ID; do not discard it.", "error");
    } finally {
      renderChangeSet();
    }
  }
  validateDraftBtn.addEventListener("click", () => { void validateRestoredDraft(); });

  async function checkFreeQueuedPublish() {
    if (!freePendingJob?.requestId) {
      return setResult("There is no pending GitHub publication.", "warn");
    }
    checkQueueBtn.disabled = true;
    unlockQueueBtn.hidden = true;
    try {
      const status = await freeQueueApi({ action: "status", requestId: freePendingJob.requestId });
      if (status.state === "saved" && status.data?.commit?.commitSha &&
          /^[a-f0-9]{64}$/i.test(String(status.data?.after?.sha256 || ""))) {
        const originalOperations = freePendingJob.operations || [];
        if (JSON.stringify(changeSet.map(item => item.payload)) !==
            JSON.stringify(originalOperations) ||
            changeSetBaseSha !== freePendingJob.expectedSha) {
          return setResult(
            "GitHub saved this request, but the staged draft no longer matches the submitted operations. " +
            "The draft remains preserved for manual inspection; no local data was deleted.", "error");
        }
        trackPublication(status.data, originalOperations);
        freePendingJob = null;
        try { sessionStorage.removeItem(FREE_JOB_KEY); } catch {}
        changeSet = [];
        changeSetBaseSha = "";
        removeChangeSetDraft();
        activeStagedDestination = null;
        activeSequenceSourceId = null;
        selectedAnchor = null;
        selectedTarget = null;
        pendingOperation = "";
        renderChangeSet();
        checkQueueBtn.hidden = true;
        unlockQueueBtn.hidden = true;
        const notes = status.data.auditRecorded === false || status.data.restoreRecorded === false
          ? " IMPORTANT: audit/restore recording needs inspection in GitHub run."
          : "";
        setResult("GitHub commit saved: " + status.data.commit.commitSha.slice(0, 12) +
          ". Cloudflare deployment must still be verified." + notes, "warn", commitLink(status.data));
        return;
      }
      unlockQueueBtn.hidden = status.state === "queued";
      const label = status.state === "queued"
        ? "GitHub is still validating/publishing."
        : status.state === "failed_or_unconfirmed"
          ? "GitHub workflow reported a failure, but the commit may already be saved."
          : "GitHub result cannot yet be confirmed.";
      setResult(label + " Keep the Change Set untouched. Inspect the GitHub run before any retry.", "warn",
        status.workflowUrl ? ' <a href="' + esc(status.workflowUrl) +
          '" target="_blank" rel="noopener noreferrer">GitHub workflow</a>' : "");
    } catch (error) {
      setResult("Status check failed: " + error.message +
        " The original draft is preserved; do not retry Publish blindly.", "error");
    } finally {
      checkQueueBtn.disabled = false;
      renderChangeSet();
    }
  }

  checkQueueBtn.addEventListener("click", () => { void checkFreeQueuedPublish(); });
  unlockQueueBtn.addEventListener("click", async () => {
    if (!freePendingJob) return;
    try {
      const status = await freeQueueApi({ action: "status", requestId: freePendingJob.requestId });
      if (status.state === "saved" || status.state === "queued") {
        unlockQueueBtn.hidden = true;
        return setResult("GitHub has a saved or active publish. Resolve it using Check GitHub publish.", "warn");
      }
      if (!window.confirm(
        "Manual recovery only: have you inspected the linked GitHub workflow, main commit history and SR catalog, and confirmed this pending request cannot still publish?\n\n" +
        "This unlock will NOT retry automatically. Clear and rebuild the Change Set from a freshly loaded catalog before publishing again."
      )) return;
      freePendingJob = null;
      try { sessionStorage.removeItem(FREE_JOB_KEY); } catch {}
      changeSetBaseSha = "";
      persistChangeSetDraft();
      unlockQueueBtn.hidden = true;
      checkQueueBtn.hidden = true;
      renderChangeSet();
      setResult("Pending lock released manually. The original draft is kept for reference but has no valid publish baseline. Clear and rebuild it after refreshing the catalog.", "warn");
    } catch (error) {
      setResult("Cannot verify GitHub status: " + error.message + ". The pending request stays locked.", "error");
    }
  });


  async function publishChangeSet(options = {}) {
    if (!changeSet.length) return;
    if (freePendingJob || freeValidationJob) {
      return setResult("A GitHub request is already pending. Check its status first.", "warn");
    }
    if (fileSha && changeSetBaseSha !== fileSha) {
      return setResult("Catalog SHA changed. Validate the preserved draft on GitHub before publishing.", "warn");
    }
    const baseSha = changeSetBaseSha;
    if (!baseSha) return setResult("Change Set has no catalog baseline. Refresh before publishing.", "error");
    const entries = changeSet.map((item, index) => (index + 1) + ". " + queueLabel(item)).join("\n");
    if (options?.skipConfirm !== true && !window.confirm(
      "Queue " + changeSet.length + " SR changes to GitHub Actions for validation and one atomic commit?\n\n" +
      entries + "\n\nDo not queue twice if the confirmation is lost."
    )) return;
    const operations = changeSet.map(item => item.payload);
    const requestId = crypto.randomUUID();
    const pending = { requestId, operations, expectedSha: baseSha, savedAt: Date.now() };
    publishBatchBtn.disabled = true;
    try {
      await requireLiveBaseline();
      persistChangeSetDraft();
      // Store the identifier BEFORE dispatch, so even a lost 202 response
      // cannot cause a blind second commit.
      freePendingJob = pending;
      sessionStorage.setItem(FREE_JOB_KEY, JSON.stringify(pending));
      checkQueueBtn.hidden = false;
      setResult("Sending secure publishing request to GitHub Actions…", "info");
      const response = await freeQueueApi({
        action: "enqueue", requestId,
        expectedSha: baseSha, operations,
      });
      setResult(response.state === "saved"
        ? "GitHub already has a receipt for this request. Check status."
        : "Publishing queued on GitHub. Your Change Set is locked until verified. Use Check GitHub publish.",
        "warn");
    } catch (error) {
      if (error?.code === "PREFLIGHT_LIVE_UNVERIFIED" && !freePendingJob) {
        setResult("SR publish was NOT sent to GitHub. " + error.message +
          " Your original Change Set is preserved. Do not clear it; check the opened tool version.", "error");
      } else {
        setResult("GitHub queue acknowledgement unavailable: " + error.message +
          ". Check GitHub publish before retrying or changing the draft.", "error");
      }
    } finally {
      renderChangeSet();
    }
  }

  function currentTab(id) {
    return (overview?.tabs || []).find((item) => item.id === id) || null;
  }

  function selectedMenuFrom(tabEl, menuEl) {
    const tab = currentTab(tabEl.value);
    const option = menuEl.selectedOptions[0];
    if (!tab || !option) return null;
    return (tab.menus || []).find(
      (menu) => menu.label === option.value &&
        Number(menu.occurrence || 1) === Number(option.dataset.occ || 1)
    ) || null;
  }

  function selectedSubFrom(tabEl, menuEl, subEl) {
    const menu = selectedMenuFrom(tabEl, menuEl);
    const option = subEl.selectedOptions[0];
    if (!menu || !option) return null;
    return (menu.submenus || []).find(
      (sub) => sub.label === option.value &&
        Number(sub.occurrence || 1) === Number(option.dataset.occ || 1)
    ) || null;
  }

  function menuOptions(tabId, exclude = null) {
    const tab = currentTab(tabId);
    return (tab?.menus || [])
      .filter((menu) => !exclude ||
        menu.label !== exclude.label ||
        Number(menu.occurrence || 1) !== Number(exclude.occurrence || 1))
      .map((menu) =>
        '<option value="' + esc(menu.label) + '" data-occ="' + Number(menu.occurrence || 1) + '">' +
        esc(menu.label || "(unnamed)") +
        (Number(menu.occurrence || 1) > 1 ? " #" + Number(menu.occurrence) : "") +
        "</option>"
      ).join("");
  }

  function subMenuOptions(menu, includeDirect = false, exclude = null) {
    const direct = includeDirect ? '<option value="">Directly in internal list</option>' : "";
    return direct + (menu?.submenus || [])
      .filter((sub) => !exclude ||
        sub.label !== exclude.label ||
        Number(sub.occurrence || 1) !== Number(exclude.occurrence || 1))
      .map((sub) =>
        '<option value="' + esc(sub.label) + '" data-occ="' + Number(sub.occurrence || 1) + '">' +
        esc(sub.label || "(unnamed)") +
        (Number(sub.occurrence || 1) > 1 ? " #" + Number(sub.occurrence) : "") +
        "</option>"
      ).join("");
  }


  function makeStructureSrReference(prefix, tabEl, parentPicker = null) {
    const wrap = panel.querySelector("#" + prefix + "SrWrap");
    const input = panel.querySelector("#" + prefix + "SrId");
    const results = panel.querySelector("#" + prefix + "SrResults");
    const find = panel.querySelector("#" + prefix + "SrFind");
    let chosen = null;
    const reset = () => { chosen = null; results.replaceChildren(); };
    input.addEventListener("input", reset);
    tabEl.addEventListener("change", reset);
    find.addEventListener("click", async () => {
      reset();
      const id = String(input.value || "").trim();
      if (!/^\d+$/.test(id) || !currentTab(tabEl.value)) {
        return setResult("Choose a Topic and enter a numeric SR ID.", "error");
      }
      try {
        const data = await srApi({ action:"find", srTypeId:id });
        if (fileSha && data.fileSha !== fileSha) {
          return setResult("Catalog changed. Refresh before choosing a reference SR.", "error");
        }
        const parent = parentPicker?.();
        const matches = (data.matches || []).filter(m =>
          m.tabId === tabEl.value && !m.subMenuLabel &&
          (parentPicker
            ? !!parent && m.menuLabel === parent.label &&
              Number(m.menuOccurrence || 1) === Number(parent.occurrence || 1)
            : !m.menuLabel));
        if (!matches.length) {
          results.textContent = "No direct SR with this ID in the selected Topic.";
          return;
        }
        matches.forEach((match) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = (match.name || "SR") + " • ID " + match.srTypeId +
            " • occurrence #" + Number(match.occurrence || 1);
          button.addEventListener("click", () => {
            chosen = match;
            results.querySelectorAll("button").forEach(b => b.classList.remove("active"));
            button.classList.add("active");
            setResult("Reference SR selected. Add the change to the Change Set.", "success");
          });
          results.appendChild(button);
          if (matches.length === 1) button.click();
        });
        if (matches.length > 1) {
          setResult("Multiple matching SRs found. Select the exact reference from the results.", "warn");
        }
      } catch (error) { setResult(error.message, "error"); }
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); find.click(); }
    });
    return {
      wrap,
      reset,
      placement: (mode) => chosen && chosen.tabId === tabEl.value &&
        (!parentPicker || (parentPicker() && chosen.menuLabel === parentPicker().label &&
          Number(chosen.menuOccurrence || 1) === Number(parentPicker().occurrence || 1))) &&
        String(chosen.srTypeId) === String(input.value).trim()
        ? { mode: mode === "before_sr" ? "before" : "after", reference:targetFromMatch(chosen) }
        : null
    };
  }

  function renderNewMenuReference() {
    newMenuRef.innerHTML = menuOptions(newMenuTab.value);
    newMenuRefWrap.hidden = !["before", "after"].includes(newMenuPosition.value);
    newMenuSr.wrap.hidden = !["before_sr", "after_sr"].includes(newMenuPosition.value);
    refreshSrChoiceControls(panel);
  }

  function renderSubParent() {
    const staged = changeSet
      .filter((item) => item.payload?.operation === "create_menu" && item.payload?.menu?.tabId === subTab.value)
      .map((item) =>
        '<option value="' + esc(item.payload.menu.newLabel) + '" data-occ="1" data-staged-id="' + item.id + '">' +
        esc(item.payload.menu.newLabel) + " • queued" +
        "</option>"
      ).join("");

    subParent.innerHTML = menuOptions(subTab.value) + staged;
    renderSubReference();
    refreshSrChoiceControls(panel);
  }

  function renderSubReference() {
    const parentOption = subParent.selectedOptions[0];
    const stagedParent = Number(parentOption?.dataset.stagedId || 0);
    if (stagedParent) {
      subRef.innerHTML = "";
      if (["before", "after"].includes(subPosition.value)) subPosition.value = "last";
      subRefWrap.hidden = true;
      refreshSrChoiceControls(panel);
      return;
    }
    const menu = selectedMenuFrom(subTab, subParent);
    subRef.innerHTML = subMenuOptions(menu, false);
    subRefWrap.hidden = !["before", "after"].includes(subPosition.value);
    refreshSrChoiceControls(panel);
  }

  function fillTabSelect(select, preferred = "") {
    const tabs = Array.isArray(overview?.tabs) ? overview.tabs : [];
    const old = preferred || select.value;
    select.innerHTML = tabs.map((tab) =>
      '<option value="' + esc(tab.id) + '">' + esc(tab.id) + "</option>"
    ).join("");
    if (old && tabs.some((tab) => tab.id === old)) select.value = old;
  }

  function renderMoveMenuControls() {
    const oldSourceTab = moveMenuSourceTab.value;
    const oldDestTab = moveMenuDestTab.value;
    const oldSourceLabel = moveMenuSource.value;
    const oldSourceOcc = Number(moveMenuSource.selectedOptions[0]?.dataset.occ || 1);
    const oldRefLabel = moveMenuRef.value;
    const oldRefOcc = Number(moveMenuRef.selectedOptions[0]?.dataset.occ || 1);

    fillTabSelect(moveMenuSourceTab, oldSourceTab);
    fillTabSelect(moveMenuDestTab, oldDestTab || moveMenuSourceTab.value);

    moveMenuSource.innerHTML = menuOptions(moveMenuSourceTab.value);
    if (oldSourceLabel) selectIdentity(moveMenuSource, oldSourceLabel, oldSourceOcc);
    const source = selectedMenuFrom(moveMenuSourceTab, moveMenuSource);

    const exclude = source && moveMenuDestTab.value === moveMenuSourceTab.value
      ? { label: source.label, occurrence: Number(source.occurrence || 1) }
      : null;
    moveMenuRef.innerHTML = menuOptions(moveMenuDestTab.value, exclude);
    if (oldRefLabel) selectIdentity(moveMenuRef, oldRefLabel, oldRefOcc);

    const needsRef = ["before", "after"].includes(moveMenuPosition.value);
    moveMenuRefWrap.hidden = !needsRef;
    moveMenuSr.wrap.hidden = !["before_sr", "after_sr"].includes(moveMenuPosition.value);
    moveMenuBtn.disabled = !source || !moveMenuDestTab.value || (needsRef && !moveMenuRef.value);
    refreshSrChoiceControls(panel);
  }

  function renderMoveSubControls() {
    const oldSourceTab = moveSubSourceTab.value;
    const oldDestTab = moveSubDestTab.value;
    const oldSourceParent = moveSubSourceParent.value;
    const oldSourceParentOcc = Number(moveSubSourceParent.selectedOptions[0]?.dataset.occ || 1);
    const oldSourceSub = moveSubSource.value;
    const oldSourceSubOcc = Number(moveSubSource.selectedOptions[0]?.dataset.occ || 1);
    const oldDestParent = moveSubDestParent.value;
    const oldDestParentOcc = Number(moveSubDestParent.selectedOptions[0]?.dataset.occ || 1);
    const oldRef = moveSubRef.value;
    const oldRefOcc = Number(moveSubRef.selectedOptions[0]?.dataset.occ || 1);

    fillTabSelect(moveSubSourceTab, oldSourceTab);
    fillTabSelect(moveSubDestTab, oldDestTab || moveSubSourceTab.value);

    moveSubSourceParent.innerHTML = menuOptions(moveSubSourceTab.value);
    if (oldSourceParent) selectIdentity(moveSubSourceParent, oldSourceParent, oldSourceParentOcc);
    const sourceParent = selectedMenuFrom(moveSubSourceTab, moveSubSourceParent);

    moveSubSource.innerHTML = subMenuOptions(sourceParent, false);
    if (oldSourceSub) selectIdentity(moveSubSource, oldSourceSub, oldSourceSubOcc);
    const sourceSub = selectedSubFrom(moveSubSourceTab, moveSubSourceParent, moveSubSource);

    moveSubDestParent.innerHTML = menuOptions(moveSubDestTab.value);
    if (oldDestParent) selectIdentity(moveSubDestParent, oldDestParent, oldDestParentOcc);
    const destParent = selectedMenuFrom(moveSubDestTab, moveSubDestParent);

    const sameParent = sourceParent && destParent &&
      moveSubSourceTab.value === moveSubDestTab.value &&
      sourceParent.label === destParent.label &&
      Number(sourceParent.occurrence || 1) === Number(destParent.occurrence || 1);
    const exclude = sameParent && sourceSub
      ? { label: sourceSub.label, occurrence: Number(sourceSub.occurrence || 1) }
      : null;
    moveSubRef.innerHTML = subMenuOptions(destParent, false, exclude);
    if (oldRef) selectIdentity(moveSubRef, oldRef, oldRefOcc);

    const needsRef = ["before", "after"].includes(moveSubPosition.value);
    moveSubRefWrap.hidden = !needsRef;
    moveSubSr.wrap.hidden = !["before_sr", "after_sr"].includes(moveSubPosition.value);
    moveSubBtn.disabled = !sourceParent || !sourceSub || !destParent || (needsRef && !moveSubRef.value);
    refreshSrChoiceControls(panel);
  }

  function isComplaintBuilderType() {
    return builderType.value === "complaint_tech" || builderType.value === "complaint_nontech";
  }

  function labelHasFixed(value) {
    return /\bfixed\b/i.test(
      String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, " ").replace(/\s+/g, " ").trim()
    );
  }

  function builderContextLabels() {
    if (activeStagedDestination) {
      return [activeStagedDestination.subMenuLabel, activeStagedDestination.menuLabel];
    }
    if (selectedAnchor) {
      return [selectedAnchor.subMenuLabel, selectedAnchor.menuLabel];
    }
    return [];
  }

  function builderIsFixedContext() {
    return builderContextLabels().some(labelHasFixed);
  }

  function subscriberModeLabel(mode) {
    return mode === "fbb" ? "FBB" : mode === "landline" ? "Landline without FBB" : "Unknown";
  }

  function syncSubscriberModeControl({ reset = false } = {}) {
    const manual = !!activeStagedDestination || !!editTarget;
    builderSubscriberModeWrap.hidden = !manual;

    if (reset || !manual) {
      builderSubscriberMode.value = "";
    }

    builderSubscriberModeHint.textContent = editTarget
      ? "Exact original SR mode loaded. You may change it explicitly."
      : manual
        ? "Choose the FBB or Landline source for this direct SR or new list."
        : "Existing lists infer the mode from neighboring SRs.";

    syncSrChoiceControl(builderSubscriberMode);
  }

  function addVisibleKind(value, kind) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!kind) return text;
    const prefix = new RegExp("^" + kind + "(?:\\s*:)?\\s+", "i");
    return prefix.test(text) ? text.replace(prefix, kind + " ") : kind + " " + text;
  }

  function computeBuilderVisibleName() {
    if (!selectedAnchor && !activeStagedDestination) return "";
    let name = String(builderName.value || "").replace(/\s+/g, " ").trim();
    if (!name) return "";

    let kind = "";
    if (builderType.value === "tt") {
      kind = "TT";
    } else if (isComplaintBuilderType()) {
      const channel = String(builderComplaintChannel.value || "").toLowerCase();
      if (!channel) return "";
      kind = channel === "tt" ? "TT" : "";
    }

    name = addVisibleKind(name, kind);

    if (builderIsFixedContext() && !/^fixed\b/i.test(name)) {
      name = "Fixed " + name;
    }

    return name;
  }

  function renderBuilderPreview() {
    const complaint = isComplaintBuilderType();
    builderComplaintWrap.hidden = !complaint;
    syncSubscriberModeControl();

    const visible = computeBuilderVisibleName();
    const unchangedEditLabel = editTarget && editSourceForm &&
      builderType.value === editSourceForm.type &&
      builderName.value === editSourceForm.srName &&
      builderComplaintChannel.value === editSourceForm.channel;
    builderVisibleName.textContent = unchangedEditLabel
      ? editSourceForm.label
      : (visible || "—");

    if (editTarget) {
      builderNameHint.textContent = "Editing SR " + editTarget.srTypeId +
        " with the same choices as Add SR. Original BSS fields remain intact when unchanged.";
    } else if (!selectedAnchor && !activeStagedDestination) {
      builderNameHint.textContent = "Search an SR or choose Use for next SRs from a queued list. Fixed context is detected from that exact list.";
    } else if (complaint && !builderComplaintChannel.value) {
      builderNameHint.textContent = "Complaint selected: choose TT or SR so the searchable name can be generated.";
    } else if (builderIsFixedContext()) {
      builderNameHint.textContent = "Fixed detected automatically from the exact list containing the selected SR.";
    } else if (builderType.value === "tt") {
      builderNameHint.textContent = "TT selected. The searchable name gets only the TT marker automatically.";
    } else {
      builderNameHint.textContent = "This is the exact text that will appear in the main tool search and SR list.";
    }

  }

  function invalidateBuilderGeneration() {
    builtSr = null;
    builderMatches = [];
    builderCopyUrlBtn.disabled = true;
    saveActionBtn.disabled = true;
    builderDuplicate.hidden = true;
    builderDuplicate.innerHTML = "";
    targetSummary.textContent = "Builder changed • Generate & check ID again before saving.";
  }

  function builderRequest() {
    return {
      type: builderType.value,
      complaintChannel: isComplaintBuilderType() ? builderComplaintChannel.value : "",
      srName: String(builderName.value || "").trim(),
      srTypeId: String(builderId.value || "").trim(),
      content: String(builderContent.value || "").trim(),
      subscriberMode: activeStagedDestination || editTarget ? String(builderSubscriberMode.value || "").trim() : "",
    };
  }

  function renderBuilderDuplicates(matches = []) {
    builderMatches = Array.isArray(matches) ? matches : [];

    if (!builderMatches.length) {
      builderDuplicate.hidden = true;
      builderDuplicate.innerHTML = "";
      return;
    }

    builderDuplicate.hidden = false;
    builderDuplicate.innerHTML = `
      <div class="sr-admin-duplicate-head">
        <b>SR ID already exists in ${builderMatches.length} location${builderMatches.length === 1 ? "" : "s"}</b>
        <span>These are informational. Your save action still applies only to the exact target selected in step 1.</span>
      </div>
      <div class="sr-admin-duplicate-list">
        ${builderMatches.map((match, index) => `
          <div class="sr-admin-duplicate-item sr-admin-duplicate-readonly">
            <span>
              <b>${esc(match.name || "Unnamed SR")}</b>
              <small>Location #${Number(match.occurrence || index + 1)} • ${esc(targetPath(match))}</small>
            </span>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function generateBuilder() {
    const hasAnchorAction = !!selectedAnchor && !!selectedTarget && !!pendingOperation && pendingOperation !== "delete";
    const hasQueuedDestination = !!activeStagedDestination;
    if (!hasAnchorAction && !hasQueuedDestination) {
      setResult("Search for an SR and choose Add before / Add after / Replace, or choose a queued list destination.", "error");
      return null;
    }

    const request = builderRequest();

    if (!/^\d+$/.test(request.srTypeId)) {
      setResult("Enter a numeric SR ID.", "error");
      builderId.focus();
      return null;
    }
    if (!request.srName) {
      setResult("Enter the SR Name.", "error");
      builderName.focus();
      return null;
    }
    if (!request.content) {
      setResult("Enter the Content.", "error");
      builderContent.focus();
      return null;
    }
    if (isComplaintBuilderType() && !request.complaintChannel) {
      setResult("Complaint SR: choose whether it appears as TT or SR.", "error");
      builderComplaintChannel.focus();
      return null;
    }
    if ((hasQueuedDestination || editTarget) && !["fbb", "landline"].includes(request.subscriberMode)) {
      setResult("Choose whether the SR uses FBB or landline without FBB.", "error");
      builderSubscriberMode.focus();
      return null;
    }

    try {
      setResult("Generating SR and checking the current catalog…");
      const data = await srApi({
        action: "build",
        builder: request,
        editMode: !!editTarget,
        ...(hasAnchorAction
          ? { target: selectedTarget }
          : { context: { ...activeStagedDestination, mode: activeStagedDestination.mode === "standalone" ? "standalone" : "staged_structure" } }),
      });
      fileSha = data.fileSha;
      builtSr = editTarget ? composeGuidedEdit(data.built, request) : data.built;
      builderVisibleName.textContent = builtSr.displayName;
      builderCopyUrlBtn.disabled = false;
      saveActionBtn.disabled = false;
      saveActionBtn.textContent = editTarget ? "Save edited SR to Change Set" : "Add to Change Set";
      renderBuilderDuplicates(data.matches || []);

      const destination = hasAnchorAction
        ? operationLabel(pendingOperation) + " • " + targetPath(selectedAnchor)
        : "Inside queued " + activeStagedDestination.label;

      const subscriberMode = String(data?.context?.subscriberMode || builtSr?.subscriberMode || "");
      const subscriberInference = data?.context?.subscriberModeInference || {};
      const subscriberSource =
        subscriberInference?.source === "same_exact_list"
          ? " • inferred from SR " + String(subscriberInference?.sourceSrTypeId || "neighbor") + " in the same exact list"
          : subscriberInference?.source === "target_fallback"
            ? " • preserved from the only SR in this list"
            : " • selected for the new list";

      targetSummary.textContent =
        "Ready: " + destination +
        " • generated name: " + builtSr.displayName +
        " • number: " + subscriberModeLabel(subscriberMode) +
        subscriberSource;

      setResult(
        (data.matches || []).length
          ? "SR generated. Existing ID locations are shown; queueing it will require explicit duplicate confirmation."
          : "SR generated and ready to add to the Change Set.",
        (data.matches || []).length ? "warn" : "success"
      );
      return data;
    } catch (error) {
      builtSr = null;
      builderCopyUrlBtn.disabled = true;
      saveActionBtn.disabled = true;
      setResult(error.message, "error");
      return null;
    }
  }

  function resetBuilderFieldsForNext() {
    builderName.value = "";
    builderId.value = "";
    builderContent.value = "";
    builtSr = null;
    builderMatches = [];
    builderCopyUrlBtn.disabled = true;
    saveActionBtn.disabled = true;
    builderDuplicate.hidden = true;
    builderDuplicate.innerHTML = "";
    renderBuilderPreview();

    if (activeSequenceSourceId) {
      const source = changeSet.find((entry) => entry.id === activeSequenceSourceId);
      targetSummary.textContent = source
        ? "Sequence kept: next SR will be directly after “" + sequenceItemLabel(source) + "”. Add another or Publish."
        : "Sequence target is no longer available.";
    } else if (activeStagedDestination) {
      targetSummary.textContent = "Destination kept: " + activeStagedDestination.label + ". Add the next SR or Publish.";
    } else if (selectedAnchor && pendingOperation) {
      targetSummary.textContent =
        "Action kept: " + operationLabel(pendingOperation) + " • " + targetPath(selectedAnchor) +
        ". Add the next SR or Publish.";
    } else {
      targetSummary.textContent = "No target action selected.";
    }
    builderName.focus();
  }

  async function savePendingAction() {
    if (!builtSr?.block) {
      return setResult("Generate & check the SR first.", "error");
    }

    let payload;
    let summary;
    let detail;
    let dependsOn = activeSequenceSourceId || null;
    let nextSrContext = null;

    if (activeStagedDestination) {
      const d = activeStagedDestination;
      payload = {
        operation: d.operation,
        block: builtSr.block,
        ...(d.menu ? { menu: { ...d.menu } } : {}),
        ...(d.operation === "append_to_tab" ? { tabId: d.tabId, placement: { ...(d.placement || { mode: "last" }) } } : {}),
        ...(d.submenu ? { submenu: { ...d.submenu } } : {}),
      };
      if (!dependsOn) dependsOn = d.queueId || null;
      summary = "Add SR " + builtSr.srTypeId + " • " + builtSr.displayName;
      detail = activeSequenceSourceId
        ? "Sequential add • " + d.label
        : "Inside queued " + d.label;
      nextSrContext = {
        destination: { ...d },
        structureQueueId: d.queueId || null,
        label: d.label,
        subscriberMode: String(builderSubscriberMode.value || ""),
      };
    } else {
      if (!selectedAnchor || !selectedTarget || !pendingOperation || pendingOperation === "delete") {
        return setResult("Choose Add before / Add after / Replace from the search result first.", "error");
      }
      payload = {
        operation: pendingOperation,
        target: { ...selectedTarget },
        block: builtSr.block,
      };
      summary = (editTarget ? "Edit existing SR" : operationLabel(pendingOperation)) +
        " • SR " + builtSr.srTypeId + " • " + builtSr.displayName;
      detail = activeSequenceSourceId
        ? "Sequential add • " + targetPath(selectedAnchor)
        : targetPath(selectedAnchor);
      nextSrContext = {
        anchor: { ...selectedAnchor },
        label: targetPath(selectedAnchor),
      };
    }

    if (payload.operation !== "replace") {
      const existingMatches = Array.isArray(builderMatches) ? builderMatches : [];
      const queuedMatches = queuedSrMatches(builtSr.srTypeId);

      if (existingMatches.length || queuedMatches.length) {
        const sections = [];

        if (existingMatches.length) {
          sections.push(
            "Already in catalog:\n" +
            existingMatches.map((match, index) =>
              (index + 1) + ". " + (match.name || "Unnamed SR") +
              "\n   Path: " + targetPath(match)
            ).join("\n")
          );
        }

        if (queuedMatches.length) {
          sections.push(
            "Already in this Change Set:\n" +
            queuedMatches.map(({ item, index }) =>
              (index + 1) + ". Item #" + (index + 1) + " • " +
              (item?.srMeta?.name || "Unnamed SR") +
              "\n   Path: " + (item?.srMeta?.path || item?.detail || "Queued destination")
            ).join("\n")
          );
        }

        const ok = window.confirm(
          "SR ID " + builtSr.srTypeId + " is already added.\n\n" +
          sections.join("\n\n") +
          "\n\nAdd another copy intentionally?"
        );
        if (!ok) {
          const firstExisting = existingMatches[0];
          if (firstExisting) {
            searchId.value = builtSr.srTypeId;
            setResult(
              "SR " + builtSr.srTypeId + " already exists as “" +
              (firstExisting.name || "Unnamed SR") + "” • " + targetPath(firstExisting) +
              ". Nothing was added.",
              "warn"
            );
          } else {
            const firstQueued = queuedMatches[0];
            setResult(
              "SR " + builtSr.srTypeId + " is already queued as “" +
              (firstQueued?.item?.srMeta?.name || "Unnamed SR") + "” • " +
              (firstQueued?.item?.srMeta?.path || firstQueued?.item?.detail || "Queued destination") +
              ". Nothing was added.",
              "warn"
            );
          }
          return;
        }
        payload.allowDuplicate = true;
      }
    }

    const item = stageChange(payload, summary, detail, {
      dependsOn,
      insertAfterId: activeSequenceSourceId || null,
      sequenceContext: nextSrContext || {},
      srMeta: {
        srTypeId: builtSr.srTypeId,
        name: builtSr.displayName,
        path: detail,
      },
    });
    if (!item) return;
    if (editTarget) {
      hideSrEditor();
      selectedTarget = null;
      selectedAnchor = null;
      pendingOperation = "";
      actionContext.dataset.ready = "false";
      actionContext.textContent = "Edited SR queued • Publish the Change Set after reviewing it.";
    }
    if (activeSequenceSourceId) {
      activeSequenceSourceId = item.id;
      renderChangeSet();
      persistChangeSetDraft();
    }
    resetBuilderFieldsForNext();
  }

  function clearSmartBuilder() {
    builderName.value = "";
    builderId.value = "";
    builderContent.value = "";
    builtSr = null;
    builderMatches = [];
    builderCopyUrlBtn.disabled = true;
    saveActionBtn.disabled = true;
    builderDuplicate.hidden = true;
    builderDuplicate.innerHTML = "";
    if (!activeStagedDestination) {
      builderSubscriberMode.value = "";
      syncSrChoiceControl(builderSubscriberMode);
    }
    const sequenceSource = activeSequenceSourceId
      ? changeSet.find((entry) => entry.id === activeSequenceSourceId)
      : null;
    targetSummary.textContent = sequenceSource
      ? "Sequence: next SR after “" + sequenceItemLabel(sequenceSource) + "”. Fill the SR fields and Generate."
      : activeStagedDestination
        ? "Destination: " + activeStagedDestination.label + ". Fill the SR fields and Generate."
        : selectedAnchor
        ? "Selected action: " + operationLabel(pendingOperation) + " • " + targetPath(selectedAnchor) + ". Fill the SR fields and Generate."
        : "No target action selected.";
    renderBuilderPreview();
    builderName.focus();
  }

  function renderDeleteControls({ resetSelection = false, message = "" } = {}) {
    const tabs = Array.isArray(overview?.tabs) ? overview.tabs : [];
    const oldTab = resetSelection ? "" : deleteTab.value;
    deleteTab.innerHTML =
      '<option value="">Choose Topic / Tab…</option>' +
      tabs.map((tab) => '<option value="' + esc(tab.id) + '">' + esc(tab.id) + "</option>").join("");
    if (oldTab && tabs.some((tab) => tab.id === oldTab)) deleteTab.value = oldTab;

    const tab = currentTab(deleteTab.value);
    const menus = Array.isArray(tab?.menus) ? tab.menus : [];
    const oldMenu = resetSelection ? "" : deleteMenu.value;
    const oldMenuOcc = resetSelection ? 1 : Number(deleteMenu.selectedOptions[0]?.dataset.occ || 1);

    deleteMenu.innerHTML =
      '<option value="">Choose internal list…</option>' +
      menus.map((menu) =>
        '<option value="' + esc(menu.label) + '" data-occ="' + Number(menu.occurrence || 1) + '">' +
        esc(menu.label || "(unnamed)") +
        (Number(menu.occurrence || 1) > 1 ? " #" + Number(menu.occurrence) : "") +
        " • " + Number(menu.srCount || 0) + " SR" + (Number(menu.srCount || 0) === 1 ? "" : "s") +
        "</option>"
      ).join("");

    const sameMenu = [...deleteMenu.options].find(
      (o) => o.value && o.value === oldMenu && Number(o.dataset.occ || 1) === oldMenuOcc
    );
    if (sameMenu) sameMenu.selected = true;

    const menu = selectedMenuFrom(deleteTab, deleteMenu);
    const subs = Array.isArray(menu?.submenus) ? menu.submenus : [];
    const oldSub = resetSelection ? "" : deleteSub.value;
    const oldSubOcc = resetSelection ? 1 : Number(deleteSub.selectedOptions[0]?.dataset.occ || 1);

    deleteSub.innerHTML =
      '<option value="">Choose sub-list…</option>' +
      subs.map((sub) =>
        '<option value="' + esc(sub.label) + '" data-occ="' + Number(sub.occurrence || 1) + '">' +
        esc(sub.label || "(unnamed)") +
        (Number(sub.occurrence || 1) > 1 ? " #" + Number(sub.occurrence) : "") +
        " • " + Number(sub.srCount || 0) + " SR" + (Number(sub.srCount || 0) === 1 ? "" : "s") +
        "</option>"
      ).join("");

    const sameSub = [...deleteSub.options].find(
      (o) => o.value && o.value === oldSub && Number(o.dataset.occ || 1) === oldSubOcc
    );
    if (sameSub) sameSub.selected = true;

    const deletingSub = deleteType.value === "submenu";
    deleteSubWrap.hidden = !deletingSub;
    refreshSrChoiceControls(panel);

    if (message) {
      deleteSummary.textContent = message;
      deleteStructureBtn.disabled = true;
      return;
    }

    if (!deleteTab.value) {
      deleteSummary.textContent = "Choose a Topic / Tab first. Nothing is selected for deletion.";
      deleteStructureBtn.disabled = true;
      return;
    }

    if (!menu) {
      deleteSummary.textContent = "Choose the exact internal list you want to delete.";
      deleteStructureBtn.disabled = true;
      return;
    }

    if (deletingSub) {
      const sub = selectedSubFrom(deleteTab, deleteMenu, deleteSub);
      if (!sub) {
        deleteSummary.textContent = "Choose the exact nested sub-list you want to delete.";
        deleteStructureBtn.disabled = true;
        return;
      }
      deleteSummary.textContent =
        "Selected for deletion: sub-list “" + sub.label + "” inside “" + menu.label + "” • " +
        Number(sub.srCount || 0) + " contained SR(s).";
      deleteStructureBtn.disabled = false;
      return;
    }

    deleteSummary.textContent =
      "Selected for deletion: internal list “" + menu.label + "” • includes all nested sub-lists and " +
      Number(menu.srCount || 0) + " contained SR(s).";
    deleteStructureBtn.disabled = false;
  }


  function renderRenameControls() {
    const type = renameType.value;
    const menuVisible = type !== "tab";
    const subVisible = type === "submenu";
    panel.querySelector("#srAdminRenameMenuWrap").hidden = !menuVisible;
    panel.querySelector("#srAdminRenameSubWrap").hidden = !subVisible;
    const previousMenu = renameMenu.value;
    const previousOcc = Number(renameMenu.selectedOptions[0]?.dataset.occ || 1);
    renameMenu.innerHTML = menuOptions(renameTab.value);
    selectIdentity(renameMenu, previousMenu, previousOcc);
    const menu = selectedMenuFrom(renameTab, renameMenu);
    const previousSub = renameSub.value;
    const previousSubOcc = Number(renameSub.selectedOptions[0]?.dataset.occ || 1);
    renameSub.innerHTML = subMenuOptions(menu);
    selectIdentity(renameSub, previousSub, previousSubOcc);
    refreshSrChoiceControls(panel);
  }

  function stageRename() {
    const type = renameType.value;
    const tabId = renameTab.value;
    const label = String(renameName.value || "").replace(/\s+/g, " ").trim();
    if (!tabId || !label || label.length > 100) {
      return setResult("Choose a Topic and enter a valid new name (up to 100 characters).", "error");
    }
    let operation, payload, oldName, path;
    if (type === "tab") {
      const tab = currentTab(tabId);
      if (!tab) return setResult("Topic is no longer available. Refresh.", "error");
      operation = "rename_tab";
      oldName = tab.displayName || tab.id;
      payload = { operation, tabId, newLabel: label };
      path = tabId;
    } else {
      const menu = selectedMenuFrom(renameTab, renameMenu);
      if (!menu) return setResult("Select the exact internal list to rename.", "error");
      const identity = { tabId, label: menu.label, occurrence: Number(menu.occurrence || 1) };
      if (type === "menu") {
        operation = "rename_menu";
        oldName = menu.label;
        payload = { operation, menu: identity, newLabel: label };
        path = tabId + " / " + menu.label;
      } else {
        const sub = selectedSubFrom(renameTab, renameMenu, renameSub);
        if (!sub) return setResult("Select the exact nested list to rename.", "error");
        operation = "rename_submenu";
        oldName = sub.label;
        payload = { operation, menu: identity, submenu: { label: sub.label, occurrence: Number(sub.occurrence || 1) }, newLabel: label };
        path = tabId + " / " + menu.label + " / " + sub.label;
      }
    }
    if (oldName === label) return setResult("The new name matches the current name.", "warn");
    const added = stageChange(payload, operationLabel(operation) + " • " + oldName + " → " + label, path);
    if (added) {
      renameName.value = "";
      setResult("Rename queued. The SR links and internal IDs remain unchanged until Publish.", "success");
    }
  }

  function renderMenus() {
    const tabs = Array.isArray(overview?.tabs) ? overview.tabs : [];
    const oldNewMenuTab = newMenuTab.value;
    const oldSubTab = subTab.value;

    const options = tabs.map((tab) =>
      '<option value="' + esc(tab.id) + '">' +
      esc(tab.displayName || tab.id) +
      "</option>"
    ).join("");

    const oldDirectTab = directTab.value;
    const oldRenameTab = renameTab.value;
    newMenuTab.innerHTML = options;
    subTab.innerHTML = options;
    directTab.innerHTML = options;
    renameTab.innerHTML = options;
    if (oldDirectTab && tabs.some((tab) => tab.id === oldDirectTab)) directTab.value = oldDirectTab;
    renderDirectReferenceControls();
    if (directReference && directReference.tabId !== directTab.value) {
      directReference = null;
      directReferenceResults.innerHTML = "";
    }
    if (oldRenameTab && tabs.some((tab) => tab.id === oldRenameTab)) renameTab.value = oldRenameTab;

    if (oldNewMenuTab && tabs.some((tab) => tab.id === oldNewMenuTab)) newMenuTab.value = oldNewMenuTab;
    if (oldSubTab && tabs.some((tab) => tab.id === oldSubTab)) subTab.value = oldSubTab;

    renderNewMenuReference();
    renderSubParent();
    renderRenameControls();
    renderMoveMenuControls();
    renderMoveSubControls();
    if (moveSourceMatch) renderMoveSrDestination();
    renderDeleteControls();
    renderBuilderPreview();
    refreshSrChoiceControls(panel);
  }

  async function loadOverview() {
    setResult("Loading SR catalog…");
    const data = await srApi({ action: "overview" });
    fileSha = data.fileSha;
    overview = data.overview;
    renderMenus();
    badge.textContent = data.branch === "main" ? "GitHub • Production" : "GitHub • Preview";
    badge.dataset.mode = data.branch === "main" ? "production" : "preview";
    const runtime = data.runtime || {};
    badge.title = [
      runtime.version || "",
      runtime.cacheHit === true ? "warm snapshot" : "fresh snapshot",
      runtime.catalogBytes ? Math.round(Number(runtime.catalogBytes) / 1024) + " KB catalog" : "",
    ].filter(Boolean).join(" • ");
    showNotice("");
    setResult(
      "Ready • " + Number(overview?.srCount || 0) + " SRs • " +
      Number(overview?.tabs?.length || 0) + " tabs • " +
      (runtime.cacheHit === true ? "snapshot reused" : "snapshot verified"),
      "success"
    );
    await restoreChangeSetDraft();
  }

  async function loadStatus() {
    try {
      const status = await srApi({ action: "status" });
      badge.textContent = status.configured
        ? (status.mode === "production" ? "GitHub • Production" : "GitHub • Preview")
        : "GitHub setup required";
      badge.dataset.mode = status.configured ? status.mode : "missing";
      if (!status.configured) {
        if (status.branchInvalid) {
          badge.textContent = "GitHub • Invalid branch";
          showNotice("SR Manager branch configuration is invalid. Publishing is locked until the deployment branch is corrected.", "error");
        } else if (status.branchMismatch) {
          badge.textContent = "GitHub • Branch mismatch";
          showNotice(
            "SR Manager branch does not match this Cloudflare deployment (" +
            String(status.branch || "unset") + " vs " + String(status.buildBranch || "unknown") +
            "). Publishing is locked.",
            "error"
          );
        } else if (!status.branch) {
          badge.textContent = "GitHub • Branch setup required";
          showNotice("Configure SR_GITHUB_BRANCH for this deployment. Publishing is locked until the target branch is explicit.", "warn");
        } else {
          showNotice("One-time setup required: configure the GitHub server credential. No GitHub credential is sent to the browser.", "warn");
        }
        return false;
      }
      await loadOverview();
      return true;
    } catch (error) {
      badge.textContent = "Unavailable";
      showNotice(error.message, "error");
      return false;
    }
  }

  function targetPath(match) {
    return [match?.tabId, match?.menuLabel, match?.subMenuLabel].filter(Boolean).join(" / ") || "Unmapped";
  }

  function operationLabel(operation) {
    if (operation === "insert_above") return "Add before";
    if (operation === "insert_below") return "Add after";
    if (operation === "append_to_tab") return "Add directly to Topic";
    if (operation === "append_to_menu" || operation === "append_to_submenu") return "Add inside";
    if (operation === "replace") return "Replace";
    if (operation === "delete") return "Delete";
    if (operation === "move_before") return "Move before";
    if (operation === "move_after") return "Move after";
    if (operation === "move_to_start") return "Move to first";
    if (operation === "move_to_end") return "Move to last";
    if (operation === "move_menu") return "Move list";
    if (operation === "move_submenu") return "Move sub-list";
    if (operation === "rename_tab") return "Rename Topic";
    if (operation === "rename_menu") return "Rename internal list";
    if (operation === "rename_submenu") return "Rename sub-list";
    return "Action";
  }

  function setPendingAction(match, operation, card) {
    hideSrEditor();
    selectedTarget = {
      srTypeId: match.srTypeId,
      occurrence: Number(match.occurrence || 1),
      fingerprint: match.fingerprint,
    };
    selectedAnchor = match;
    pendingOperation = operation;
    activeStagedDestination = null;
    activeSequenceSourceId = null;

    invalidateBuilderGeneration();
    renderBuilderPreview();

    searchResult.querySelectorAll(".sr-admin-match").forEach((item) => item.classList.remove("selected"));
    searchResult.querySelectorAll("[data-target-op]").forEach((button) => button.classList.remove("active"));
    card?.classList.add("selected");
    card?.querySelector('[data-target-op="' + operation + '"]')?.classList.add("active");

    const fixed = [match.subMenuLabel, match.menuLabel].some(labelHasFixed)
      ? " • Fixed naming detected from this list"
      : "";
    const label = operationLabel(operation);
    actionContext.dataset.ready = "true";
    actionContext.textContent =
      label + " • " + (match.name || "SR") + " • " + targetPath(match) + fixed;
    targetSummary.textContent =
      "Selected action: " + label + " • exact occurrence #" + Number(match.occurrence || 1) +
      " • " + targetPath(match);

    saveActionBtn.textContent = "Add " + label + " to Change Set";
    saveActionBtn.disabled = true;
  }


  function hideSrEditor() {
    editTarget = null;
    editSourceBlock = "";
    editSourceType = "";
    editSourceForm = null;
    editPanel.hidden = true;
    editPath.textContent = "";
  }

  function beginEditSr(match, card) {
    hideSrEditor();
    const raw = String(match?.block || "");
    const node = document.createElement("template");
    node.innerHTML = raw;
    const anchor = node.content.querySelector('a[href*="BMEBusiness=srNewSrPage"]');
    if (!anchor || !/<\/a\s*>/i.test(raw)) {
      return setResult("The original SR link cannot be safely parsed. Nothing changed.", "error");
    }
    let url;
    try {
      url = new URL(anchor.getAttribute("href") || "");
      if (url.hostname.toLowerCase() !== "bss.te.eg" || !/^https?:$/.test(url.protocol)) throw Error("Bad BSS URL");
    } catch {
      return setResult("Invalid BSS link. No changes have been queued.", "error");
    }

    const family = String(url.searchParams.get("serviceInfoChar107") || "");
    const subtype = String(url.searchParams.get("serviceInfoChar112") || "");
    const type = family === "1" ? "tt" :
      family === "3" ? (subtype === "1" ? "complaint_tech" :
        subtype === "2" ? "complaint_nontech" : "") :
        family === "2" ? "inquiry_offer" : "";
    const visibleLabel = anchor.textContent.trim();
    const channel = type.startsWith("complaint_")
      ? (/^(?:Fixed\s+)?TT(?:\s|:)/i.test(visibleLabel) ? "tt" : "sr")
      : "";
    const srName = url.searchParams.get("srTypeName") || "";
    const content = url.searchParams.get("serviceContent") || "";
    const mode = /^openLinkk\s*\(\s*event\s*\)/i.test(anchor.getAttribute("onclick") || "")
      ? "landline" : /^openLink\s*\(\s*event\s*\)/i.test(anchor.getAttribute("onclick") || "")
        ? "fbb" : "";

    editTarget = { ...match };
    editSourceBlock = raw;
    editSourceType = type;
    editSourceForm = {
      type, srName, content, srTypeId: match.srTypeId,
      channel, mode, label: visibleLabel,
    };
    selectedTarget = targetFromMatch(match);
    selectedAnchor = { ...match };
    activeStagedDestination = null;
    activeSequenceSourceId = null;
    pendingOperation = "replace";
    resetMovePanel();

    // One source of truth: the SAME Add SR form owns editing and generation.
    builderType.value = type;
    builderComplaintChannel.value = channel;
    builderName.value = srName;
    builderId.value = match.srTypeId;
    builderContent.value = content;
    builderSubscriberMode.value = mode;
    builtSr = null;
    builderMatches = [];
    builderCopyUrlBtn.disabled = true;
    saveActionBtn.disabled = true;
    builderDuplicate.hidden = true;
    builderDuplicate.innerHTML = "";
    editPanel.hidden = true;

    searchResult.querySelectorAll(".sr-admin-match").forEach(n => n.classList.remove("selected"));
    card?.classList.add("selected");
    card?.querySelector('[data-target-op="edit"]')?.classList.add("active");
    actionContext.dataset.ready = "true";
    actionContext.textContent = "Edit SR " + match.srTypeId + " • " + targetPath(match);
    targetSummary.textContent = "Original SR loaded into the Add SR form below. " +
      "Any field that cannot be identified stays empty. Generate, review then add to Change Set.";
    saveActionBtn.textContent = "Save edited SR to Change Set";
    renderBuilderPreview();
    builderName.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setResult("Edit mode ready. Update any of the Add SR choices; the original BSS link is preserved.", "success");
  }

  function composeGuidedEdit(generated, request) {
    if (!editTarget || !editSourceForm || !editSourceBlock) {
      throw new Error("Original edit context expired. Search the SR again.");
    }
    const host = document.createElement("template");
    host.innerHTML = editSourceBlock;
    const anchor = host.content.querySelector('a[href*="BMEBusiness=srNewSrPage"]');
    if (!anchor) throw new Error("Original SR block cannot be recovered.");
    const existingHref = anchor.getAttribute("href") || "";
    const generatedUrl = new URL(generated.href);
    const existingUrl = new URL(existingHref);
    const typeChanged = request.type !== editSourceType;
    // Detect edits from actual form values, not trim-normalized builder
    // output. Old BSS URLs may intentionally carry trailing whitespace.
    const nameChanged = builderName.value !== editSourceForm.srName;
    const channelChanged = request.complaintChannel !== editSourceForm.channel;
    let href = existingHref;

    if (typeChanged) {
      // BSS type families need different known fields. Use the same canonical
      // Add-SR template for those fields and retain unrelated custom params.
      for (const [key, value] of existingUrl.searchParams) {
        if (generatedUrl.searchParams.has(key) ||
            /^(?:BMEBusiness|srTypeId|srTypeName|serviceContent|serviceTitle|subsNumber|t|tabId|topUrl|custid|BMEWebToken|serviceInfoChar\d+)$/i.test(key)) continue;
        generatedUrl.searchParams.append(key, value);
      }
      href = generatedUrl.href;
    } else {
      const changed = [
        ["srTypeId", request.srTypeId !== editSourceForm.srTypeId],
        ["srTypeName", nameChanged],
        ["serviceContent", builderContent.value !== editSourceForm.content],
        ["serviceTitle", nameChanged],
        ["serviceInfoChar282", nameChanged],
      ];
      for (const [key, enabled] of changed) {
        if (!enabled || !generatedUrl.searchParams.has(key)) continue;
        if (!existingUrl.searchParams.has(key) &&
            key !== "srTypeId" && key !== "srTypeName" && key !== "serviceContent") continue;
        href = updateBssQueryField(href, key, generatedUrl.searchParams.get(key));
      }
    }

    if (href !== existingHref) anchor.setAttribute("href", href);
    if (request.subscriberMode && request.subscriberMode !== editSourceForm.mode) {
      anchor.setAttribute("onclick", request.subscriberMode === "landline"
        ? "openLinkk(event)" : "openLink(event)");
    }
    const displayName = typeChanged || nameChanged || channelChanged
      ? generated.displayName
      : editSourceForm.label;
    if (displayName !== anchor.textContent.trim()) anchor.textContent = displayName;
    const prefix = editSourceBlock.slice(0, editSourceBlock.search(/<a\b/i));
    return {
      ...generated,
      href,
      displayName,
      block: prefix + anchor.outerHTML,
    };
  }

  function updateBssQueryField(url, key, value) {
    // Preserve all unknown parameters (including legacy && separators) exactly.
    const keyPattern = new RegExp("([?&])" + key + "=[^&#]*", "i");
    const encoded = encodeURIComponent(String(value ?? ""));
    if (keyPattern.test(url)) return url.replace(keyPattern, (_match, sep) => sep + key + "=" + encoded);
    const hashIndex = url.indexOf("#");
    const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : url.slice(hashIndex);
    return base + (base.includes("?") ? "&" : "?") + key + "=" + encoded + fragment;
  }

  async function stageEditedSr() {
    if (!editTarget || !editSourceBlock) return setResult("Select an SR to edit first.", "error");
    const label = editLabel.value.trim();
    const srTypeId = editId.value.trim();
    const typeName = editTypeName.value.trim();
    if (!label || label.length > 300 || !/^\d+$/.test(srTypeId) || !typeName) {
      return setResult("A valid visible name, numeric SR ID and BSS SR Type Name are required.", "error");
    }
    const host = document.createElement("template");
    host.innerHTML = editSourceBlock;
    const anchor = host.content.querySelector('a[href*="BMEBusiness=srNewSrPage"]');
    if (!anchor) return setResult("Original SR could not be reconstructed. Refresh first.", "error");
    let href = editUrl.value.trim();
    try {
      const parsed = new URL(href);
      if (parsed.hostname.toLowerCase() !== "bss.te.eg" || !/^https?:$/.test(parsed.protocol) ||
          parsed.searchParams.get("BMEBusiness") !== "srNewSrPage") throw new Error("Invalid BSS SR route");
    } catch {
      return setResult("Advanced URL must be a valid bss.te.eg SR creation link.", "error");
    }
    const originalUrl = new URL(anchor.getAttribute("href") || "");
    const changedUrl = new URL(href);
    for (const [key, value] of [
      ["srTypeId", srTypeId], ["srTypeName", typeName], ["serviceContent", editContent.value],
    ]) {
      if (originalUrl.searchParams.get(key) !== value ||
          changedUrl.searchParams.get(key) !== value) {
        href = updateBssQueryField(href, key, value);
      }
    }
    if (href !== anchor.getAttribute("href")) anchor.setAttribute("href", href);
    anchor.setAttribute("onclick", editMode.value === "landline" ? "openLinkk(event)" : "openLink(event)");
    if (label !== anchor.textContent.trim()) anchor.textContent = label;
    const prefix = editSourceBlock.slice(0, editSourceBlock.search(/<a\b/i));
    const block = prefix + anchor.outerHTML;
    const payload = { operation: "replace", target: targetFromMatch(editTarget), block };
    // Changing the ID to one in another SR is exceptional. Require explicit
    // operator acknowledgement before the server's exact duplicate validation.
    if (srTypeId !== editTarget.srTypeId) {
      try {
        const found = await srApi({ action: "find", srTypeId });
        if (found.matches?.length) {
          const ok = window.confirm(
            "SR ID " + srTypeId + " already exists at " + found.matches.length +
            " location(s). Intentionally assign this duplicate ID to the edited SR?"
          );
          if (!ok) return;
          payload.allowDuplicate = true;
        }
      } catch (error) {
        return setResult("Could not verify new ID against the catalog: " + error.message, "error");
      }
    }
    const staged = stageChange(payload, "Edit SR " + editTarget.srTypeId + " • " + label,
      targetPath(editTarget), {
        srMeta: { srTypeId, name: label, path: targetPath(editTarget) },
      });
    if (staged) {
      hideSrEditor();
      setResult("Edited SR queued with all unmodified BSS parameters preserved. Publish after reviewing changes.", "success");
    }
  }

  async function search() {
    const id = String(searchId.value || "").trim();
    if (!/^\d+$/.test(id)) {
      setResult("Enter a numeric SR ID.", "error");
      return;
    }

    try {
      setResult("Searching…");
      const data = await srApi({ action: "find", srTypeId: id });
      fileSha = data.fileSha;
      overview = data.overview;

      selectedTarget = null;
      selectedAnchor = null;
      pendingOperation = "";
      activeStagedDestination = null;
      activeSequenceSourceId = null;
      resetMovePanel();
      hideSrEditor();
      builtSr = null;
      builderMatches = [];
      renderMenus();

      builderDuplicate.hidden = true;
      builderDuplicate.innerHTML = "";
      saveActionBtn.disabled = true;
      actionContext.dataset.ready = "false";
      actionContext.textContent = "Choose an action from one exact SR location below.";
      targetSummary.textContent = "No target action selected.";

      const matches = Array.isArray(data.matches) ? data.matches : [];
      if (!matches.length) {
        searchResult.innerHTML = '<div class="sr-admin-empty">No SR found with ID ' + esc(id) + ".</div>";
        setResult("No SR found.", "warn");
        return;
      }

      searchResult.innerHTML = matches.map((match, index) => `
        <article class="sr-admin-match sr-admin-match-compact" data-match-index="${index}">
          <div class="sr-admin-match-top">
            <b>${esc(match.name || "Unnamed SR")}</b>
            <span>ID ${esc(match.srTypeId)}${matches.length > 1 ? " • location #" + Number(match.occurrence || index + 1) : ""}</span>
          </div>
          <div class="sr-admin-meta">
            ${esc(targetPath(match))}
          </div>
          <div class="sr-admin-target-actions">
            <button type="button" data-target-op="insert_above">Add before</button>
            <button type="button" data-target-op="insert_below">Add after</button>
            <button type="button" data-target-op="move" class="secondary">Move</button>
            <button type="button" data-target-op="edit" class="secondary">Edit SR</button>
            <button type="button" data-target-op="replace" class="warning">Replace</button>
            <button type="button" data-target-op="delete" class="danger">Delete</button>
          </div>
        </article>
      `).join("");

      [...searchResult.querySelectorAll(".sr-admin-match")].forEach((card) => {
        const match = matches[Number(card.dataset.matchIndex)];
        card.querySelectorAll("[data-target-op]").forEach((button) => {
          button.addEventListener("click", async () => {
            const operation = button.dataset.targetOp;

            if (operation === "edit") {
              beginEditSr(match, card);
              return;
            }
            if (operation === "move") {
              startMove(match, card);
              return;
            }

            resetMovePanel();
            setPendingAction(match, operation, card);

            if (operation === "delete") {
              const queued = stageChange(
                {
                  operation: "delete",
                  target: { ...selectedTarget },
                  block: "",
                },
                "Delete SR " + match.srTypeId + " • " + (match.name || "SR"),
                targetPath(match)
              );
              if (queued) {
                button.textContent = "Delete queued";
                button.disabled = true;
                actionContext.dataset.ready = "true";
                actionContext.textContent = "Delete queued • " + targetPath(match) + " • publish when ready";
              }
              return;
            }

            builderName.focus();
            setResult(
              operationLabel(operation) + " selected. Fill the SR fields, then Generate & check ID.",
              "success"
            );
          });
        });
      });

      setResult(
        matches.length === 1
          ? "SR found. Choose Edit SR / Add before / Add after / Move / Replace / Delete."
          : matches.length + " locations found. Choose the exact location and action.",
        "success"
      );
    } catch (error) {
      setResult(error.message, "error");
    }
  }

  async function mutate(payload, confirmation = "") {
    if (confirmation && !window.confirm(confirmation)) return;
    let committedData = null;

    try {
      await requireLiveBaseline();
      setResult("Validating and saving to GitHub…");
      // One authoritative two-phase write path for BOTH individual edits and
      // Change Sets. Never bypass prepared catalog SHA or drop deletion proof.
      let operation = { ...payload };
      const prepareSingle = (item) => srApi({
        action: "batch_prepare", expectedSha: fileSha, operations: [item],
      });
      let prepared;

      try {
        prepared = await prepareSingle(operation);
      } catch (error) {
        if (error.code !== "DUPLICATE_SR") throw error;

        const duplicates = Array.isArray(error.data?.duplicates) ? error.data.duplicates : [];
        const locations = duplicates.map((item, index) => {
          const path = [item.tabId, item.menuLabel, item.subMenuLabel]
            .filter(Boolean).join(" / ") || "Unmapped";
          return (index + 1) + ". " + path;
        }).join("\n");

        const duplicateQuestion = payload.operation === "replace"
          ? "\n\nContinue replacing only the selected exact target?"
          : "\n\nAdd another copy intentionally?";
        const ok = window.confirm(
          error.message +
          (locations ? "\n\nExisting locations:\n" + locations : "") +
          duplicateQuestion
        );

        if (!ok) {
          const duplicateId = duplicates[0]?.srTypeId;
          if (duplicateId) {
            searchId.value = duplicateId;
            await search();
            setResult(
              duplicates.length + " existing location" + (duplicates.length === 1 ? "" : "s") +
              " shown above. Choose the exact one you need. Nothing was changed.",
              "warn"
            );
          } else {
            setResult("Duplicate save cancelled. Nothing was changed.", "warn");
          }
          return;
        }

        operation = { ...operation, allowDuplicate: true };
        prepared = await prepareSingle(operation);
      }

      if (!prepared?.prepareToken) {
        throw new Error("SR validation completed without a publish token. Nothing was written.");
      }

      setResult("Validated • committing the exact prepared SR change to GitHub…");
      const rawData = await srApi({
        action: "batch_commit",
        expectedSha: fileSha,
        operations: [operation],
        prepareToken: prepared.prepareToken,
      });
      const single = Array.isArray(rawData?.results) ? rawData.results[0] || {} : {};
      const data = {
        ...rawData,
        added: single.added || null,
        target: single.target || null,
        removedStructure: single.removedStructure || null,
      };
      committedData = data;
      // Exactly one tracking call: preserve server-derived add AND delete
      // proofs, even when the next UI refresh fails.
      trackPublication(data, [operation]);

      fileSha = "";
      selectedTarget = null;
      searchResult.innerHTML = "";
      targetSummary.textContent = "Saved. Search again before another position-based change.";
      setResult(
        "Saved to GitHub • not confirmed visible yet • " + Number(data?.before?.srCount || 0) + " → " + Number(data?.after?.srCount || 0) + " SRs",
        "warn",
        commitLink(data)
      );

      try {
        await loadOverview();
      } catch (refreshError) {
        showNotice("GitHub save succeeded, but refreshing the catalog failed: " + refreshError.message + ". Refresh manually.", "warn");
      }

      const srMutation = ["append_to_menu", "append_to_submenu", "replace", "insert_above", "insert_below", "delete"].includes(payload.operation);
      if (srMutation) {
        builtSr = null;
        builderMatches = [];
            builderCopyUrlBtn.disabled = true;
                    builderDuplicate.hidden = true;
        builderDuplicate.innerHTML = "";
        selectedTarget = null;
            selectedAnchor = null;
        pendingOperation = "";
        saveActionBtn.disabled = true;
        actionContext.dataset.ready = "false";
        actionContext.textContent = "Search for an SR above, then choose Add before / Add after / Replace.";
        targetSummary.textContent = "Saved successfully. Choose a new target action for the next SR change.";
      }

      if (data?.removedStructure) {
        const removed = data.removedStructure;
        const kind = removed.type === "submenu" ? "sub-list" : "internal list";
        const label = String(removed.label || "");
        renderDeleteControls({
          resetSelection: true,
          message:
            "Deleted " + kind + " “" + label + "” successfully. " +
            "No other list is selected. Choose a new target only if you want another deletion.",
        });
        setResult(
          "Deleted " + kind + " “" + label + "” • " + Number(removed.srCount || 0) +
          " contained SR(s) removed",
          "warn",
          commitLink(data)
        );
      } else if (!srMutation && searchId.value.trim()) {
        await search();
      }

      if (srMutation) {
        setResult(
          "Saved to GitHub • " + Number(data?.before?.srCount || 0) + " → " + Number(data?.after?.srCount || 0) + " SRs",
          "warn",
          commitLink(data)
        );
      }
    } catch (error) {
      if (committedData) {
        setResult("Saved to GitHub, but refreshing the admin view failed. Verify live status above before editing again.", "warn", commitLink(committedData));
        return;
      }
      if (error.code === "STALE_CATALOG") {
        setResult("Catalog changed before save. Refresh/search again; no overwrite was performed.", "error");
      } else {
        setResult(error.message, "error");
      }
    }
  }

  function placementFrom(positionEl, referenceEl) {
    const mode = String(positionEl?.value || "last");
    const placement = { mode };
    if (mode === "before" || mode === "after") {
      const option = referenceEl?.selectedOptions?.[0];
      if (!option) return null;
      placement.label = option.value;
      placement.occurrence = Number(option.dataset.occ || 1);
    }
    return placement;
  }

  function activateThisTab(){
    const central = window.__srActivateAdminTab;
    if (typeof central === "function" && central(btn)) return;

    // Standalone scoped SR workspace fallback: this module can run without admin.js.
    document.querySelectorAll("#adminPanel .admin-tab").forEach((item) => {
      const active = item === btn;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("#adminPanel .admin-tab-panel").forEach((item) => {
      const active = item === panel;
      item.style.display = active ? "block" : "none";
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  btn.addEventListener("click", async () => {
    activateThisTab();
    if (!overview) await loadStatus();
  });

  searchBtn.addEventListener("click", search);
  searchId.addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
  refreshBtn.addEventListener("click", loadOverview);

  moveTopBtn.addEventListener("click", () => stageMove("move_to_start"));
  moveBottomBtn.addEventListener("click", () => stageMove("move_to_end"));
  moveCancelBtn.addEventListener("click", resetMovePanel);
  moveDestinationSearch.addEventListener("click", findMoveDestination);
  moveDestinationId.addEventListener("keydown", (event) => {
    if (event.key === "Enter") findMoveDestination();
  });
  moveTargetTab.addEventListener("change", () => renderMoveSrDestination());
  moveTargetMenu.addEventListener("change", () => renderMoveSrDestination());
  moveTargetSub.addEventListener("change", () => {
    moveToListBtn.disabled = !selectedMoveSrContext();
    refreshSrChoiceControls(panel);
  });
  moveTargetPosition.addEventListener("change", () => {
    if (["before_menu", "after_menu"].includes(moveTargetPosition.value)) {
      // A dropdown is a sibling of a standalone SR, never its parent.
      moveTargetMenu.value = "";
    }
    renderMoveSrDestination();
  });
  moveSrMenuRef.addEventListener("change", () => {
    moveToListBtn.disabled = !selectedMoveSrContext() ||
      (["before_menu", "after_menu"].includes(moveTargetPosition.value) &&
       !selectedMenuFrom(moveTargetTab, moveSrMenuRef));
  });
  moveToListBtn.addEventListener("click", () => {
    const context = selectedMoveSrContext();
    if (!context) return setResult("Choose a destination Topic, list or sub-list.", "error");
    const pos = moveTargetPosition.value;
    if (["before_menu", "after_menu"].includes(pos)) {
      if (context.menuLabel) return setResult("Choose Directly in Topic for top-level list placement.", "error");
      const ref = selectedMenuFrom(moveTargetTab, moveSrMenuRef);
      if (!ref) return setResult("Choose the exact reference list.", "error");
      context.placement = {mode:pos === "before_menu" ? "before" : "after",
        referenceMenu:{tabId:context.tabId, label:ref.label, occurrence:Number(ref.occurrence || 1)}};
    }
    stageMove(
      pos === "first" || pos === "before_menu" ? "move_to_start" : "move_to_end",
      null,
      context
    );
  });
  publishBatchBtn.addEventListener("click", publishChangeSet);
  clearBatchBtn.addEventListener("click", clearChangeSet);

  directTab.addEventListener("change", () => {
    resetDirectReference();
    directMenuRef.innerHTML = menuOptions(directTab.value);
    renderDirectReferenceControls();
  });
  directRefKind.addEventListener("change", renderDirectReferenceControls);
  directPosition.addEventListener("change", renderDirectReferenceControls);
  directReferenceId.addEventListener("input", resetDirectReferenceSelection);
  directReferenceFind.addEventListener("click", findDirectReference);
  directReferenceId.addEventListener("keydown", event => {
    if (event.key === "Enter") findDirectReference();
  });
  renderDirectReferenceControls();

  useDirectBtn.addEventListener("click", () => {
    const tab = currentTab(directTab.value);
    if (!tab) return setResult("Choose an existing Topic / Tab.", "error");
    const mode = directPosition.value;
    const relative = ["before", "after"].includes(mode);
    const listReference = relative && directRefKind.value === "menu"
      ? selectedMenuFrom(directTab, directMenuRef) : null;
    if (relative && directRefKind.value === "menu" && !listReference) {
      return setResult("Choose the exact reference internal list first.", "error");
    }
    if (relative && directRefKind.value === "sr" &&
        (!directReference || directReference.tabId !== tab.id ||
          String(directReferenceId.value || "").trim() !== String(directReference.srTypeId || ""))) {
      return setResult("Find and select the exact standalone SR first.", "error");
    }
    const placement = !relative ? {mode} : listReference
      ? {mode, referenceMenu: {tabId:tab.id, label:listReference.label,
          occurrence:Number(listReference.occurrence || 1)}}
      : {mode, reference:targetFromMatch(directReference)};
    hideSrEditor();
    activeStagedDestination = {
      placement,
      mode: "standalone",
      operation: "append_to_tab",
      tabId: tab.id,
      menuLabel: "",
      subMenuLabel: "",
      label: (tab.displayName || tab.id) + " • direct SR • " + mode +
        (listReference ? " " + listReference.label :
          directReference && directRefKind.value === "sr" ? " " + directReference.srTypeId : ""),
    };
    activeSequenceSourceId = null;
    selectedTarget = null;
    selectedAnchor = null;
    pendingOperation = "append_to_tab";
    actionContext.dataset.ready = "true";
    actionContext.textContent = "Direct SR • " + (tab.displayName || tab.id) + " • no menu";
    targetSummary.textContent = "Direct Topic placement: " + mode +
      (listReference ? " list " + listReference.label :
        directReference && directRefKind.value === "sr" ? " SR " + directReference.srTypeId : "") +
      ". The new SR is an independent sibling BETWEEN dropdowns, like 099008001.";
    clearSmartBuilder();
    syncSubscriberModeControl({ reset: true });
    builderName.focus();
    setResult("Direct SR destination selected. Choose FBB or landline, then Generate & check ID.", "success");
  });

  panel.querySelector("#srAdminEditSave").addEventListener("click", stageEditedSr);
  panel.querySelector("#srAdminEditClose").addEventListener("click", hideSrEditor);
  renameType.addEventListener("change", renderRenameControls);
  renameTab.addEventListener("change", renderRenameControls);
  renameMenu.addEventListener("change", renderRenameControls);
  panel.querySelector("#srAdminRenameAdd").addEventListener("click", stageRename);

  const builderInputs = [builderType, builderComplaintChannel, builderName, builderId, builderContent, builderSubscriberMode];
  builderInputs.forEach((control) => {
    const eventName = control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      invalidateBuilderGeneration();
      renderBuilderPreview();
    });
  });

  builderGenerateBtn.addEventListener("click", generateBuilder);
  builderCopyUrlBtn.addEventListener("click", async () => {
    if (!builtSr?.href) return;
    await copyText(builtSr.href);
    setResult("Generated BSS URL copied.", "success");
  });
  saveActionBtn.addEventListener("click", savePendingAction);

  newMenuTab.addEventListener("change", renderNewMenuReference);
  newMenuPosition.addEventListener("change", () => { newMenuSr.reset(); renderNewMenuReference(); });

  subTab.addEventListener("change", renderSubParent);
  subParent.addEventListener("change", renderSubReference);
  subPosition.addEventListener("change", renderSubReference);

  moveMenuSourceTab.addEventListener("change", renderMoveMenuControls);
  moveMenuSource.addEventListener("change", renderMoveMenuControls);
  moveMenuDestTab.addEventListener("change", renderMoveMenuControls);
  moveMenuPosition.addEventListener("change", () => { moveMenuSr.reset(); renderMoveMenuControls(); });
  moveMenuRef.addEventListener("change", renderMoveMenuControls);

  moveSubSourceTab.addEventListener("change", renderMoveSubControls);
  moveSubSourceParent.addEventListener("change", renderMoveSubControls);
  moveSubSource.addEventListener("change", renderMoveSubControls);
  moveSubDestTab.addEventListener("change", renderMoveSubControls);
  moveSubDestParent.addEventListener("change", renderMoveSubControls);
  moveSubPosition.addEventListener("change", () => { moveSubSr.reset(); renderMoveSubControls(); });
  moveSubRef.addEventListener("change", renderMoveSubControls);

  deleteType.addEventListener("change", renderDeleteControls);
  deleteTab.addEventListener("change", renderDeleteControls);
  deleteMenu.addEventListener("change", renderDeleteControls);
  deleteSub.addEventListener("change", renderDeleteControls);

  panel.querySelector("#srAdminClearEditor").addEventListener("click", () => {
    if (editTarget) {
      hideSrEditor();
      selectedTarget = null;
      selectedAnchor = null;
      pendingOperation = "";
      actionContext.dataset.ready = "false";
      actionContext.textContent = "Edit cancelled. Choose an SR or a direct destination.";
    }
    clearSmartBuilder();
  });

  moveMenuBtn.addEventListener("click", () => {
    const source = selectedMenuFrom(moveMenuSourceTab, moveMenuSource);
    if (!source || !moveMenuDestTab.value) {
      return setResult("Choose the source list and destination Topic.", "error");
    }

    const placement = ["before_sr", "after_sr"].includes(moveMenuPosition.value)
      ? moveMenuSr.placement(moveMenuPosition.value)
      : placementFrom(moveMenuPosition, moveMenuRef);
    if (!placement) {
      return setResult("Find and select the reference list or direct SR for Before / After placement.", "error");
    }

    const destinationTab = currentTab(moveMenuDestTab.value);
    const sameTab = moveMenuSourceTab.value === moveMenuDestTab.value;
    const duplicateName = !sameTab && (destinationTab?.menus || []).some((menu) =>
      String(menu.label || "").toLowerCase() === String(source.label || "").toLowerCase()
    );
    if (duplicateName) {
      return setResult("Destination Topic already contains another internal list with the same name.", "error");
    }

    if (sameTab && placement.mode === "first" && Number(source.index || 1) === 1) {
      return setResult("This internal list is already first in that Topic.", "warn");
    }
    if (
      sameTab &&
      placement.mode === "last" &&
      Number(source.index || 1) === Number((currentTab(moveMenuSourceTab.value)?.menus || []).length)
    ) {
      return setResult("This internal list is already last in that Topic.", "warn");
    }

    const detail =
      moveMenuSourceTab.value + " / " + source.label +
      " → " + moveMenuDestTab.value + " / " + placement.mode;

    stageChange(
      {
        operation: "move_menu",
        menu: {
          tabId: moveMenuSourceTab.value,
          label: source.label,
          occurrence: Number(source.occurrence || 1),
        },
        destination: {
          tabId: moveMenuDestTab.value,
          placement,
        },
      },
      "Move internal list • " + source.label,
      detail
    );
  });

  moveSubBtn.addEventListener("click", () => {
    const sourceParent = selectedMenuFrom(moveSubSourceTab, moveSubSourceParent);
    const sourceSub = selectedSubFrom(moveSubSourceTab, moveSubSourceParent, moveSubSource);
    const destParent = selectedMenuFrom(moveSubDestTab, moveSubDestParent);
    if (!sourceParent || !sourceSub || !destParent) {
      return setResult("Choose the exact source sub-list and destination parent list.", "error");
    }

    const placement = ["before_sr", "after_sr"].includes(moveSubPosition.value)
      ? moveSubSr.placement(moveSubPosition.value)
      : placementFrom(moveSubPosition, moveSubRef);
    if (!placement) {
      return setResult(["before_sr", "after_sr"].includes(moveSubPosition.value)
        ? "Find the SR ID and select a matching reference inside the destination parent list."
        : "Choose the reference sub-list for Before / After placement.", "error");
    }

    const sameParent =
      moveSubSourceTab.value === moveSubDestTab.value &&
      sourceParent.label === destParent.label &&
      Number(sourceParent.occurrence || 1) === Number(destParent.occurrence || 1);

    const duplicateName = !sameParent && (destParent.submenus || []).some((sub) =>
      String(sub.label || "").toLowerCase() === String(sourceSub.label || "").toLowerCase()
    );
    if (duplicateName) {
      return setResult("Destination parent already contains another sub-list with the same name.", "error");
    }

    if (sameParent && placement.mode === "first" && Number(sourceSub.index || 1) === 1) {
      return setResult("This sub-list is already first under that parent.", "warn");
    }
    if (
      sameParent &&
      placement.mode === "last" &&
      Number(sourceSub.index || 1) === Number((sourceParent.submenus || []).length)
    ) {
      return setResult("This sub-list is already last under that parent.", "warn");
    }

    const detail =
      moveSubSourceTab.value + " / " + sourceParent.label + " / " + sourceSub.label +
      " → " + moveSubDestTab.value + " / " + destParent.label + " / " + placement.mode;

    stageChange(
      {
        operation: "move_submenu",
        menu: {
          tabId: moveSubSourceTab.value,
          label: sourceParent.label,
          occurrence: Number(sourceParent.occurrence || 1),
        },
        submenu: {
          label: sourceSub.label,
          occurrence: Number(sourceSub.occurrence || 1),
        },
        destination: {
          menu: {
            tabId: moveSubDestTab.value,
            label: destParent.label,
            occurrence: Number(destParent.occurrence || 1),
          },
          placement,
        },
      },
      "Move sub-list • " + sourceSub.label,
      detail
    );
  });

  panel.querySelector("#srAdminCreateMenu").addEventListener("click", () => {
    const nameInput = panel.querySelector("#srAdminNewMenuName");
    const name = String(nameInput.value || "").replace(/\s+/g, " ").trim();

    if (!newMenuTab.value || !name) {
      return setResult("Choose the parent Topic / Tab and enter the new list name.", "error");
    }

    const placement = ["before_sr", "after_sr"].includes(newMenuPosition.value)
      ? newMenuSr.placement(newMenuPosition.value)
      : placementFrom(newMenuPosition, newMenuRef);
    if (!placement) {
      return setResult("Find and select the reference list or direct SR for Before / After placement.", "error");
    }

    const payload = {
      operation: "create_menu",
      block: "",
      menu: {
        tabId: newMenuTab.value,
        newLabel: name,
        placement,
      },
    };
    const destination = {
      mode: "staged_structure",
      operation: "append_to_menu",
      tabId: newMenuTab.value,
      menuLabel: name,
      subMenuLabel: "",
      menu: {
        tabId: newMenuTab.value,
        label: name,
        occurrence: 1,
      },
      label: newMenuTab.value + " / " + name,
    };

    const queued = stageChange(
      payload,
      "Create internal list • " + name,
      newMenuTab.value,
      { destination }
    );
    if (!queued) return;

    activeStagedDestination = { ...destination, queueId: queued.id };
    persistChangeSetDraft();
    selectedAnchor = null;
    selectedTarget = null;
    pendingOperation = "append_to_menu";
    actionContext.dataset.ready = "true";
    actionContext.textContent = "Queued new list • " + destination.label + " • ready for its SRs";
    targetSummary.textContent = "Add all SRs for this new list now; they will publish together in one deploy.";
    nameInput.value = "";
    clearSmartBuilder();
    renderSubParent();
  });

  panel.querySelector("#srAdminCreateSub").addEventListener("click", () => {
    const parentOption = subParent.selectedOptions[0];
    const nameInput = panel.querySelector("#srAdminSubName");
    const name = String(nameInput.value || "").replace(/\s+/g, " ").trim();

    if (!subTab.value || !parentOption || !name) {
      return setResult("Choose the parent list and enter the new sub-list name.", "error");
    }

    const stagedParentId = Number(parentOption.dataset.stagedId || 0);
    const placement = stagedParentId ? { mode: "last" } : placementFrom(subPosition, subRef);
    if (!placement) {
      return setResult("Choose the reference sub-list for Before / After placement.", "error");
    }

    const parentLabel = parentOption.value;
    const parentOccurrence = Number(parentOption.dataset.occ || 1);
    const payload = {
      operation: "create_submenu",
      block: "",
      menu: {
        tabId: subTab.value,
        label: parentLabel,
        occurrence: parentOccurrence,
      },
      submenu: {
        newLabel: name,
        placement,
      },
    };
    const destination = {
      mode: "staged_structure",
      operation: "append_to_submenu",
      tabId: subTab.value,
      menuLabel: parentLabel,
      subMenuLabel: name,
      menu: {
        tabId: subTab.value,
        label: parentLabel,
        occurrence: parentOccurrence,
      },
      submenu: {
        label: name,
        occurrence: 1,
      },
      label: subTab.value + " / " + parentLabel + " / " + name,
    };

    const queued = stageChange(
      payload,
      "Create sub-list • " + name,
      subTab.value + " / " + parentLabel,
      { dependsOn: stagedParentId || null, destination }
    );
    if (!queued) return;

    activeStagedDestination = { ...destination, queueId: queued.id };
    persistChangeSetDraft();
    selectedAnchor = null;
    selectedTarget = null;
    pendingOperation = "append_to_submenu";
    actionContext.dataset.ready = "true";
    actionContext.textContent = "Queued new sub-list • " + destination.label + " • ready for its SRs";
    targetSummary.textContent = "Add all SRs for this new sub-list now; they will publish together in one deploy.";
    nameInput.value = "";
    clearSmartBuilder();
  });

  panel.querySelector("#srAdminDeleteStructure").addEventListener("click", () => {
    const menu = selectedMenuFrom(deleteTab, deleteMenu);
    if (!menu) return setResult("Choose an internal list to delete.", "error");

    if (deleteType.value === "submenu") {
      const sub = selectedSubFrom(deleteTab, deleteMenu, deleteSub);
      if (!sub) return setResult("Choose a nested sub-list to delete.", "error");

      const count = Number(sub.srCount || 0);
      const queued = stageChange(
        {
          operation: "delete_submenu",
          expectedContainedSrCount: count,
          menu: {
            tabId: deleteTab.value,
            label: menu.label,
            occurrence: Number(menu.occurrence || 1),
          },
          submenu: {
            label: sub.label,
            occurrence: Number(sub.occurrence || 1),
          },
        },
        "Delete sub-list • " + sub.label,
        deleteTab.value + " / " + menu.label + " • " + count + " contained SR(s)"
      );
      if (queued) {
        renderDeleteControls({
          resetSelection: true,
          message: "Delete queued for sub-list “" + sub.label + "”. Nothing is deployed until Publish.",
        });
      }
      return;
    }

    const count = Number(menu.srCount || 0);
    const queued = stageChange(
      {
        operation: "delete_menu",
        expectedContainedSrCount: count,
        menu: {
          tabId: deleteTab.value,
          label: menu.label,
          occurrence: Number(menu.occurrence || 1),
        },
      },
      "Delete internal list • " + menu.label,
      deleteTab.value + " • includes " + count + " contained SR(s)"
    );
    if (queued) {
      renderDeleteControls({
        resetSelection: true,
        message: "Delete queued for internal list “" + menu.label + "”. Nothing is deployed until Publish.",
      });
    }
  });

}

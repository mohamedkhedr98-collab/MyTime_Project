/* Step 5.1 - Lightweight Support & Suggestions UX layer
   Front-end only. No sort/reorder, no polling. */
(function(){
  "use strict";

  const D = document;
  const SUPPORT_RUNTIME_VERSION = "20260923-account-auth-bridge-v1";
  const TARGETED_SUPPORT_MODULE = `./support-chat-v6-stable2.js?v=${SUPPORT_RUNTIME_VERSION}`;
  let targetedSupportModulePromise = null;
  const state = {
    supportSearch: "",
    suggestionSearch: "",
    presenceSnapshot: window.__srPresenceSnapshot || null,
    toastLast: new Map(),
    observersStarted: false,
    applyTimer: 0
  };

  function $(sel, root = D){ return root.querySelector(sel); }
  function $all(sel, root = D){ return Array.from(root.querySelectorAll(sel)); }
  function clean(s){ return String(s || "").replace(/\s+/g, " ").trim(); }
  function lower(s){ return clean(s).toLocaleLowerCase("ar-EG"); }

  function ensureReplyVisibilityStyles(){
    if(D.getElementById("srux-targeted-reply-visibility")) return;
    const style = D.createElement("style");
    style.id = "srux-targeted-reply-visibility";
    style.textContent = `
      #supportMessagesList .support-msg-interactions{display:flex!important;visibility:visible!important;opacity:1!important}
      #supportMessagesList .support-reply-btn{display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;position:relative!important;z-index:3!important}
    `;
    D.head.appendChild(style);
  }

  function loadTargetedSupportModule(){
    if(!targetedSupportModulePromise){
      targetedSupportModulePromise = import(TARGETED_SUPPORT_MODULE).catch((error) => {
        targetedSupportModulePromise = null;
        throw error;
      });
    }
    return targetedSupportModulePromise;
  }

  function installTargetedSupportLoader(){
    if(D.documentElement.dataset.srTargetedSupportLoader === "1") return;
    D.documentElement.dataset.srTargetedSupportLoader = "1";
    ensureReplyVisibilityStyles();

    D.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("#supportToggleBtn");
      if(!btn) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      loadTargetedSupportModule()
        .then(() => {
          ensureReplyVisibilityStyles();
          if(typeof window.__srOpenSupportChat === "function"){
            window.__srOpenSupportChat();
          }
        })
        .catch((error) => {
          console.error("targeted support module load failed", error);
          toast("تعذر تحميل تحديث الدعم. حدّث الصفحة وحاول مرة أخرى.", "error");
        });
    }, true);
  }

  function ensureToastRoot(){
    let root = $(".srux-toast-root");
    if(!root){
      root = D.createElement("div");
      root.className = "srux-toast-root";
      D.body.appendChild(root);
    }
    return root;
  }

  function toast(message, type = "info"){
    const msg = clean(message);
    if(!msg) return;
    const key = type + ":" + msg;
    const now = Date.now();
    if((state.toastLast.get(key) || 0) + 1800 > now) return;
    state.toastLast.set(key, now);

    const root = ensureToastRoot();
    const el = D.createElement("div");
    el.className = "srux-toast";
    el.dataset.type = type || "info";
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-show"));
    setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => el.remove(), 220);
    }, type === "error" ? 5200 : 3300);
  }

  function statusType(node){
    const t = String(node?.dataset?.type || "info").toLowerCase();
    if(t.includes("error")) return "error";
    if(t.includes("warn")) return "warn";
    if(t.includes("success")) return "success";
    return "info";
  }

  function watchStatusNode(node){
    if(!node || node.dataset.sruxWatched === "1") return;
    node.dataset.sruxWatched = "1";
    let last = clean(node.textContent);
    const show = () => {
      const text = clean(node.textContent);
      if(text && text !== last){
        last = text;
        toast(text, statusType(node));
      } else {
        last = text;
      }
    };
    new MutationObserver(show).observe(node, {
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      attributeFilter:["data-type"]
    });
  }

  function enhanceStatuses(){
    ["#suggestionStatus", "#supportChatStatus", "#adminStatus", "#adminAuthStatus"].forEach((sel) => watchStatusNode($(sel)));
  }

  function stabilizeSupportComposer(textarea){
    if(!textarea || textarea.dataset.sruxComposerStable === "1") return;
    textarea.dataset.sruxComposerStable = "1";
    textarea.dataset.sruxGrow = "fixed";
    textarea.style.removeProperty("field-sizing");
    textarea.style.removeProperty("height");
    textarea.style.overflowY = "auto";
  }

  function addAutoGrow(textarea){
    if(!textarea || textarea.dataset.sruxGrow === "1") return;
    textarea.dataset.sruxGrow = "1";
    if(window.CSS?.supports?.("field-sizing", "content")){
      textarea.style.setProperty("field-sizing", "content");
      textarea.style.height = "auto";
      return;
    }

    let frame = 0;
    let lastHeight = 0;
    const grow = () => {
      frame = 0;
      const previous = lastHeight || Math.round(textarea.getBoundingClientRect().height) || 44;
      textarea.style.height = "1px";
      const next = Math.min(160, Math.max(44, textarea.scrollHeight));
      lastHeight = next;
      textarea.style.height = next + "px";
      textarea.style.overflowY = next >= 160 ? "auto" : "hidden";
      if(Math.abs(previous - next) < 1) textarea.style.height = previous + "px";
    };
    const scheduleGrow = () => {
      if(frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(grow);
    };
    textarea.addEventListener("input", scheduleGrow, { passive:true });
    setTimeout(scheduleGrow, 0);
  }

  function ensureCounter(input, max){
    if(!input || input.dataset.sruxCounter === "1") return;
    input.dataset.sruxCounter = "1";
    const counter = D.createElement("span");
    counter.className = "srux-char-counter";
    const update = () => {
      const len = String(input.value || "").length;
      const limit = Number(input.getAttribute("maxlength") || max || 0);
      counter.textContent = limit ? `${len}/${limit}` : String(len);
      counter.classList.toggle("is-warn", !!limit && len >= limit * .85 && len < limit);
      counter.classList.toggle("is-max", !!limit && len >= limit);
    };
    const parent = input.parentElement;
    if(parent) parent.appendChild(counter);
    input.addEventListener("input", update);
    update();
  }

  function enhanceTextareas(){
    stabilizeSupportComposer($("#supportMessageInput"));
    ["#suggestionInput", ".sug-reply-input"].forEach((sel) => $all(sel).forEach(addAutoGrow));
    ensureCounter($("#supportMessageInput"), 5000);
    ensureCounter($("#suggestionInput"), 1200);
    $all(".sug-reply-input").forEach((el) => ensureCounter(el, 1200));
  }

  function ensureSupportToolbar(){
    const container = $(".support-users");
    const title = $(".support-users-title", container || D);
    const list = $("#supportUsersList");
    if(!container || !title || !list) return;

    if(!$("#sruxSupportStats")){
      const stats = D.createElement("div");
      stats.id = "sruxSupportStats";
      stats.className = "srux-mini-stats";
      title.insertAdjacentElement("afterend", stats);
    }

    if(!$("#sruxSupportSearch")){
      const bar = D.createElement("div");
      bar.className = "srux-toolbar srux-compact";
      bar.innerHTML = `<input id="sruxSupportSearch" class="srux-search" type="search" autocomplete="off" placeholder="Search people…" aria-label="Search people">`;
      $("#sruxSupportStats")?.insertAdjacentElement("afterend", bar);
      $("#sruxSupportSearch")?.addEventListener("input", (e) => {
        state.supportSearch = lower(e.target.value);
        applySupportFilter();
      });
    }

    if(!$("#sruxSupportEmpty")){
      const empty = D.createElement("div");
      empty.id = "sruxSupportEmpty";
      empty.className = "srux-empty-filter";
      empty.style.display = "none";
      empty.textContent = "No people match this search.";
      list.insertAdjacentElement("afterend", empty);
    }
  }

  function updateSupportStats(){
    const rows = $all("#supportUsersList .support-user");
    const snapshot = state.presenceSnapshot || window.__srPresenceSnapshot || null;
    const connected = snapshot?.status === "connected";
    const onlineIds = new Set(snapshot?.onlineUserIds || []);
    const online = connected && Number.isFinite(snapshot?.count) ? snapshot.count : null;
    const total = rows.length;
    const stats = $("#sruxSupportStats");
    if(stats){
      const presenceText = connected
        ? `<span><span class="srux-online-dot"></span><strong>${online}</strong> online</span>`
        : snapshot?.status === "connecting"
          ? `<span><span class="srux-online-dot is-connecting"></span><strong>…</strong> connecting</span>`
          : `<span><span class="srux-online-dot is-unknown"></span><strong>—</strong> unknown</span>`;
      stats.innerHTML = `${presenceText}<span><strong>${total}</strong> people</span>`;
    }
    rows.forEach((row) => {
      const name = clean($(".support-user-name", row)?.textContent);
      const id = clean(row.getAttribute("data-user-id"));
      const onlineText = connected ? (id && onlineIds.has(id) ? "Online" : "Offline") : "Unknown";
      if(name) row.title = `${name} • ${onlineText}`;
    });
  }

  function applySupportFilter(){
    ensureSupportToolbar();
    const q = state.supportSearch;
    const rows = $all("#supportUsersList .support-user");
    let visible = 0;
    rows.forEach((row) => {
      const text = lower(row.textContent);
      const show = !q || text.includes(q);
      row.classList.toggle("srux-hidden-by-filter", !show);
      // Support Desktop Pro owns row layout with display:grid!important.
      // Hide filtered rows decisively, then return layout ownership to Support CSS.
      if(show){
        row.style.removeProperty("display");
        visible += 1;
      }else{
        row.style.setProperty("display", "none", "important");
      }
    });
    const empty = $("#sruxSupportEmpty");
    if(empty) empty.style.display = rows.length && visible === 0 ? "block" : "none";
    updateSupportStats();
  }

  function ensureSuggestionsToolbar(){
    const panel = $("#sharedSuggestions") || $(".suggestions-panel");
    const list = $("#suggestionsList");
    const form = $(".suggestions-form");
    if(!panel || !list) return;

    if(!$("#sruxSuggestionsToolbar")){
      const bar = D.createElement("div");
      bar.id = "sruxSuggestionsToolbar";
      bar.className = "srux-toolbar srux-toolbar-light";
      bar.innerHTML = `
        <input id="sruxSuggestionsSearch" class="srux-search" type="search" autocomplete="off" placeholder="Search suggestions…" aria-label="Search suggestions">
        <span id="sruxSuggestionsCount" class="srux-pill">0 items</span>
      `;
      list.insertAdjacentElement("beforebegin", bar);
      $("#sruxSuggestionsSearch")?.addEventListener("input", (e) => {
        state.suggestionSearch = lower(e.target.value);
        applySuggestionsUx();
      });
    } else {
      $("#sruxSuggestionsSort")?.remove();
    }

    if(form && !$("#sruxSuggestionHint")){
      const hint = D.createElement("div");
      hint.id = "sruxSuggestionHint";
      hint.className = "srux-mini-stats";
      hint.innerHTML = `<span>Enter to send • Shift+Enter for new line</span><span>Shared with everyone</span>`;
      form.insertAdjacentElement("afterend", hint);
    }

    if(!$("#sruxSuggestionsEmpty")){
      const empty = D.createElement("div");
      empty.id = "sruxSuggestionsEmpty";
      empty.className = "srux-empty-filter";
      empty.style.display = "none";
      empty.textContent = "No suggestions match this search.";
      list.insertAdjacentElement("afterend", empty);
    }
  }

  function getReplyCount(card){
    const badge = $(".sug-replies-badge", card);
    const btn = $(".sug-replies-toggle", card);
    const raw = badge?.textContent || btn?.dataset?.replyCount || "0";
    const n = parseInt(String(raw).replace(/\D+/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function markOwnSuggestions(cards){
    const currentNames = [
      localStorage.getItem("sr_display_name"),
      localStorage.getItem("sr_user_name"),
      localStorage.getItem("supportUserName"),
      localStorage.getItem("sr_nickname")
    ].filter(Boolean).map(lower);
    cards.forEach((card) => {
      const name = lower($(".suggestion-name", card)?.textContent);
      const own = !!name && currentNames.includes(name);
      card.classList.toggle("srux-own-suggestion", own);
      card.classList.toggle("srux-top-replies", getReplyCount(card) >= 3);
    });
  }

  function applySuggestionsUx(){
    ensureSuggestionsToolbar();
    const list = $("#suggestionsList");
    if(!list) return;
    const cards = $all(".suggestion-item", list);
    markOwnSuggestions(cards);

    const q = state.suggestionSearch;
    let visible = 0;
    cards.forEach((card) => {
      const text = lower(card.textContent);
      const show = !q || text.includes(q);
      card.classList.toggle("srux-hidden-by-filter", !show);
      if(show) visible += 1;
    });
    const count = $("#sruxSuggestionsCount");
    if(count) count.textContent = `${visible}/${cards.length} items`;
    const empty = $("#sruxSuggestionsEmpty");
    if(empty) empty.style.display = cards.length && visible === 0 ? "block" : "none";
  }

  function applyEmptyStates(){
    const msgList = $("#supportMessagesList");
    if(msgList && !msgList.querySelector(".support-msg") && !msgList.querySelector(".srux-empty-state")){
      const empty = D.createElement("div");
      empty.className = "srux-empty-state";
      empty.textContent = "No messages here yet.";
      msgList.appendChild(empty);
    } else if(msgList && msgList.querySelector(".support-msg")){
      msgList.querySelectorAll(".srux-empty-state").forEach((e) => e.remove());
    }
  }

  function applyAll(){
    ensureReplyVisibilityStyles();
    enhanceStatuses();
    enhanceTextareas();
    ensureSupportToolbar();
    applySupportFilter();
    ensureSuggestionsToolbar();
    applySuggestionsUx();
    applyEmptyStates();
  }

  function scheduleApply(){
    clearTimeout(state.applyTimer);
    state.applyTimer = setTimeout(() => requestAnimationFrame(applyAll), 120);
  }

  function observeIfExists(selector, options){
    const el = $(selector);
    if(!el || el.dataset.sruxObserved === "1") return false;
    el.dataset.sruxObserved = "1";
    new MutationObserver(scheduleApply).observe(el, options);
    return true;
  }

  function startObservers(){
    if(state.observersStarted) return;
    state.observersStarted = true;

    observeIfExists("#suggestionsList", { childList:true, subtree:true });
    observeIfExists("#supportUsersList", { childList:true, subtree:true, attributes:true, attributeFilter:["class"] });
    observeIfExists("#supportMessagesList", { childList:true, subtree:true });

    window.addEventListener("sr:suggestions-rendered", scheduleApply);
    window.addEventListener("sr:support-users-updated", scheduleApply);
    window.addEventListener("sr:presence-changed", (event) => {
      state.presenceSnapshot = event.detail || window.__srPresenceSnapshot || null;
      scheduleApply();
    });
    window.addEventListener("sr:nickname-updated", scheduleApply);
  }

  function init(){
    installTargetedSupportLoader();
    applyAll();
    startObservers();
    setTimeout(applyAll, 600);
    setTimeout(applyAll, 1600);
  }

  if(D.readyState === "loading") D.addEventListener("DOMContentLoaded", init, { once:true });
  else init();
})();

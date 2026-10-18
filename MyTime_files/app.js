/* DOM readiness broker is owned by runtime/dom-ready-broker.js. */

/* Header/tab visuals are static CSS-owned.
 * Keeping styles out of JS prevents visual refactors from breaking app parsing.
 */

/* Search stacking is owned by header-core.css and search-results-stability-guard.js. */

/*
 * Retired legacy search auto-nudge: it repeatedly changed the search
 * container top/position/transform from transient viewport measurements on
 * BFCache restore, resize and font load. The existing structural header CSS
 * owns placement; event-driven search recovery only detects real failures.
 */


/* === ONLY INPUTS LOGIC (STRONG) ===
- If landline (bottom) is cleared -> clear FBB (top) automatically.
- Also wraps convertNumber() so even if it refills FBB after clearing, we wipe it.
*/
(function(){
  const landlineId = "arabicNumber";   // bottom
  const fbbId      = "arabiccNumber";  // top
  const get = (id)=>document.getElementById(id);

  function isEmpty(v){
    return (v == null) || (String(v).replace(/\s+/g,'') === "");
  }

  function fbbHasRealNumber(v){
    // treat "FBB" alone (or "FBB " / "FBB\t") as empty
    const s = String(v || "");
    const stripped = s.replace(/\s+/g,'');
    if(stripped === "") return false;
    if(/^FBB$/i.test(stripped)) return false;
    if(/^FBB\d*$/i.test(stripped)) return stripped.length > 3; // has digits
    return true;
  }

  function enforceClear(){
    const l = get(landlineId);
    const t = get(fbbId);
    if(!l || !t) return;

    const landEmpty = isEmpty(l.value);

    /*
      Updated FBB field policy:
      - When ADSL Number is empty, number With FBB must remain manually editable.
      - When ADSL Number has a value, the dedicated mirror-sync module locks and mirrors FBB.
      This function no longer clears FBB on an empty ADSL field, because that prevented
      manual FBB entry.
    */
    if(landEmpty){
      try{ t.readOnly = false; }catch(e){}
      try{ t.removeAttribute("readonly"); }catch(e){}
      try{ t.setAttribute("aria-readonly", "false"); }catch(e){}
      try{ t.style.cursor = "text"; }catch(e){}
    }
  }

  function bind(){
    const l = get(landlineId);
    const t = get(fbbId);
    if(!l || !t) return false;

    const afterTick = ()=>setTimeout(enforceClear, 0); // run after inline handlers
    ["input","keyup","change","blur"].forEach(evt=>{
      l.addEventListener(evt, afterTick, {passive:true});
    });

    // Wrap convertNumber if exists (it's the function that sets FBB = "FBB" + englishNumber)
    function tryWrap(){
      const fn = window.convertNumber;
      if(typeof fn === "function" && !fn.__mndoWrapped){
        const wrapped = function(){
          try{ return fn.apply(this, arguments); }
          finally{ enforceClear(); }
        };
        wrapped.__mndoWrapped = true;
        window.convertNumber = wrapped;
      }
    }
    tryWrap();

    // Event-driven after binding. The old 60/200ms perpetual watchdogs kept
    // waking the CPU for the whole shift even when the fields were idle.
    enforceClear();
    return true;
  }

  // Bind immediately in the normal path. Retry only while the legacy DOM is
  // genuinely unavailable, then stop completely.
  if(!bind()){
    window.__srWaitForDom(bind, 8000);
  }
})();



/* TT + SR buttons next to Copy (no layout changes, no tool logic changes) */
(function(){
  const BASE_TT = "https://bss.te.eg:12900/csp/pbh/business.action?BMEBusiness=pbhRelativeProcess&subsNumber=";
  const BASE_SR = "https://bss.te.eg:12900/csp/pbh/business.action?BMEBusiness=srQueryAction&subsNumber=";

  function openLink(base, val){
    const v = (val || "").trim();
    window.open(base + encodeURIComponent(v), "_blank");
  }

  function fmtDDMMYYYY(d){
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }

  function startTimeSevenMonthsBack(){
    const d = new Date();
    d.setMonth(d.getMonth() - 7);
    return fmtDDMMYYYY(d);
  }

  function ensureBtn(id, label, base, getVal){
    if(document.getElementById(id)) return true;

    const btn = document.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.className = "toolsStyle"; // same style as Copy
    btn.textContent = label;

    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(id === "mndoSRTop" && base === BASE_SR){
        const v = (getVal() || "").trim();
        const start = startTimeSevenMonthsBack();
        const url = base + encodeURIComponent(v) + "&startTime=" + encodeURIComponent(start);
        window.open(url, "_blank");
      }else{
        openLink(base, getVal());
      }
    });

    document.body.appendChild(btn);
    return true;
  }

  function bind(){
    const topCopy = document.getElementById("copyBtn");   // upper copy
    const botCopy = document.getElementById("copyBtn1");  // lower copy
    const fbbInp  = document.getElementById("arabiccNumber"); // top input (FBB)
    const fvInp   = document.getElementById("arabicNumber");  // bottom input (FV/landline)

    if(!topCopy || !botCopy || !fbbInp || !fvInp) return false;

    ensureBtn("mndoTTTop", "TT", BASE_TT, ()=> fbbInp.value || "");
    ensureBtn("mndoSRTop", "SR", BASE_SR, ()=> fbbInp.value || "");

    ensureBtn("mndoTTBottom", "FV tt", BASE_TT, ()=> fvInp.value || "");
    ensureBtn("mndoSRBottom", "sr v", BASE_SR, ()=> fvInp.value || "");

    return true;
  }

  if(!bind()){
    window.__srWaitForDom(bind, 8000);
  }
})();



/* === Query Timer (8 min warning) ===
   Starts on number input, resets on change, stays 00:00 when empty.
   Placed next to Tags using the SAME positioning rules as Tags (no scroll tracking).
*/
(function(){
  "use strict";

  var timerEl = null;
  var timerTimeEl = null;
  var intervalId = null;
  var startTs = 0;
  var lastVal = "";
  var activeInput = null;
  var CAUTION_AT = 7 * 60; // seconds
  var DANGER_AT  = 8 * 60; // seconds

  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function formatMMSS(totalSec){
    totalSec = Math.max(0, totalSec|0);
    var mm = Math.floor(totalSec / 60);
    var ss = totalSec % 60;
    return pad2(mm) + ":" + pad2(ss);
  }

  function getInputs(){
    var a = document.getElementById("arabicNumber");
    var b = document.getElementById("arabiccNumber");
    var out = [];
    if(a) out.push(a);
    if(b && b !== a) out.push(b);
    return out;
  }

  function ensureEl(){
    timerEl = document.getElementById("mndoQueryTimer");
    if(!timerEl) return null;
    timerTimeEl = timerEl.querySelector(".mndoTimerTime");
    return timerEl;
  }

  function setState(sec){
    if(!timerEl) return;
    var danger = sec >= DANGER_AT;
    var warn = (!danger && sec >= CAUTION_AT);
    timerEl.classList.toggle("mndoDanger", danger);
    timerEl.classList.toggle("mndoWarn", warn);
  }

  function setTime(sec){
    if(!timerEl) return;
    if(!timerTimeEl){ timerTimeEl = timerEl.querySelector(".mndoTimerTime"); }
    if(timerTimeEl) timerTimeEl.textContent = formatMMSS(sec);
    else timerEl.textContent = formatMMSS(sec);
    setState(sec);
  }

  function stop(){
    if(intervalId){ clearInterval(intervalId); intervalId = null; }
    startTs = 0;
    setTime(0);
  }

  function start(){
    if(intervalId) clearInterval(intervalId);
    intervalId = setInterval(function(){
      if(!startTs) return;
      var now = Date.now();
      var sec = Math.floor((now - startTs)/1000);
      setTime(sec);
    }, 1000);
  }

  function resetFromInput(inp){
    ensureEl();
    activeInput = inp;
    lastVal = (inp.value || "").trim();

    if(!lastVal){
      stop();
      return;
    }
    startTs = Date.now();
    setTime(0);
    start();
  }

  function onInput(e){
    var inp = e && e.target ? e.target : null;
    if(!inp) return;

    var val = (inp.value || "").trim();

    // If empty => keep 00:00
    if(!val){
      ensureEl();
      stop();
      lastVal = "";
      activeInput = inp;
      return;
    }

    // First non-empty or changed => reset + start
    if(activeInput !== inp || val !== lastVal){
      resetFromInput(inp);
    }
  }

  function anyNonEmpty(){
    var ins = getInputs();
    for(var i=0;i<ins.length;i++){
      if((ins[i].value || "").trim()) return ins[i];
    }
    return null;
  }

  function bind(){
    var ins = getInputs();
    if(!ins.length) return false;

    ensureEl();
    if(!timerEl) return false;

    for(var i=0;i<ins.length;i++){
      ins[i].addEventListener("input", onInput, true);
      ins[i].addEventListener("keyup", onInput, true);
      ins[i].addEventListener("change", onInput, true);
    }

    var pre = anyNonEmpty();
    if(pre) resetFromInput(pre);
    else stop();
    return true;
  }

  // Normal production DOM is already present by the time app.js runs.
  // Retry only as a compatibility fallback for legacy document.write timing.
  if(!bind()){
    window.__srWaitForDom(bind, 9000);
  }

})();



/* Apply luxury class to requested buttons if they exist (non-breaking) */
(function(){
  try{
    var ids = ["copyBtn","copyBtn1","mndoTTTop","mndoSRTop","mndoTTBottom","mndoSRBottom","bat2","mndoQueryTimer"];
    ids.forEach(function(id){
      var el=document.getElementById(id);
      if(el) el.classList.add("mndoLuxuryBtn");
    });

    var labels = new Set(["sRV","sR","TT","FV tt","fvTT","Tags","Copy","sr v","srv","SR"]);
    var nodes = document.querySelectorAll("button,a,input[type='button'],input[type='submit']");
    nodes.forEach(function(el){
      var t = (el.tagName==="INPUT" ? (el.value||"") : (el.textContent||"")).trim();
      if(labels.has(t)) el.classList.add("mndoLuxuryBtn");
    });

    ["arabicNumber","arabiccNumber"].forEach(function(id){
      var el=document.getElementById(id);
      if(el) el.classList.add("mndoLuxuryInput");
    });
  }catch(e){}
})();



(function(){
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  // v10: Keep the timer ANCHORED to page/scroll-container AND prevent the base timer
  // auto-positioner from snapping it back to the top by using CSS variables + !important.
  var STATE_KEY = "mndoQTState_v9";      // keep key to preserve existing saved positions
  var LEGACY_POS_KEY = "mndoQTPos";
  var V8_KEY = "mndoQTState_v8";

  var host = null;

  function isScrollable(el){
    try{
      var cs = getComputedStyle(el);
      var oy = cs.overflowY, ox = cs.overflowX;
      var scrollY = (oy === "auto" || oy === "scroll" || oy === "overlay");
      var scrollX = (ox === "auto" || ox === "scroll" || ox === "overlay");
      return (scrollY && el.scrollHeight > el.clientHeight + 2) || (scrollX && el.scrollWidth > el.clientWidth + 2);
    }catch(_){ return false; }
  }

  function findPrimaryScrollHost(){
    var se = document.scrollingElement || document.documentElement;
    if(se && (se.scrollHeight > se.clientHeight + 2 || se.scrollWidth > se.clientWidth + 2)) return se;

    // Find the largest scrollable container (common in single-page tools where BODY is overflow:hidden)
    var best = null;
    var bestScore = 0;
    var nodes = document.body ? document.body.querySelectorAll("*") : [];
    var limit = 2500;

    for(var i=0;i<nodes.length && i<limit;i++){
      var el = nodes[i];
      if(!(el instanceof HTMLElement)) continue;
      if(el.offsetParent === null) continue;
      if(!isScrollable(el)) continue;

      var score = (el.scrollHeight - el.clientHeight) + (el.scrollWidth - el.clientWidth);
      if(score > bestScore){
        bestScore = score;
        best = el;
      }
    }
    return best || se || document.body || document.documentElement;
  }

  function normalizeHost(h){
    if(!h) return null;
    if(h === document.body) return document.body;
    if(h === document.documentElement) return document.documentElement;
    if(h === document.scrollingElement) return document.scrollingElement;
    return h;
  }

  function ensureRelativeContainer(el){
    try{
      if(!el || el === document.body || el === document.documentElement) return;
      var cs = getComputedStyle(el);
      if(cs.position === "static"){
        el.style.position = "relative";
      }
    }catch(_){}
  }

  function pageScrollX(){
    return window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
  }
  function pageScrollY(){
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function getMaxDocSize(){
    var d = document.documentElement;
    var b = document.body || d;
    return {
      w: Math.max(d.scrollWidth, b.scrollWidth, d.clientWidth, b.clientWidth),
      h: Math.max(d.scrollHeight, b.scrollHeight, d.clientHeight, b.clientHeight)
    };
  }

  // ===== User-pinned coords (CSS vars) =====
  function getPinnedNumber(panel, varName, fallback){
    try{
      var cs = getComputedStyle(panel);
      var raw = cs.getPropertyValue(varName);
      if(raw){
        var n = parseFloat(String(raw).trim());
        if(isFinite(n)) return n;
      }
    }catch(_){}
    return fallback;
  }

  function getPinnedLeft(panel){
    var n = parseFloat(panel.style.left);
    if(!isFinite(n)) n = panel.offsetLeft || 0;
    return getPinnedNumber(panel, "--mndoQTLeft", n);
  }

  function getPinnedTop(panel){
    var n = parseFloat(panel.style.top);
    if(!isFinite(n)) n = panel.offsetTop || 0;
    return getPinnedNumber(panel, "--mndoQTTop", n);
  }

  function setPinned(panel, left, top){
    left = (isFinite(left) ? left : 0);
    top  = (isFinite(top)  ? top  : 0);

    panel.classList.add("mndoQTUserPos");
    panel.style.setProperty("--mndoQTLeft", left + "px");
    panel.style.setProperty("--mndoQTTop",  top  + "px");

    // keep inline values as fallback, but CSS !important wins
    panel.style.left = left + "px";
    panel.style.top  = top  + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function readState(){
    function normalizeObj(o){
      if(!o || typeof o !== "object") return null;

      var left = (o.left != null ? o.left : "");
      var top  = (o.top  != null ? o.top  : "");

      var ln = parseFloat(left);
      var tn = parseFloat(top);

      // Support numbers too
      if(typeof o.left === "number" && isFinite(o.left)) ln = o.left;
      if(typeof o.top  === "number" && isFinite(o.top))  tn = o.top;

      var out = {};
      if(isFinite(ln)) out.left = ln;
      if(isFinite(tn)) out.top  = tn;

      if(o.width) out.width = String(o.width);
      if(o.height) out.height = String(o.height);

      return (isFinite(out.left) && isFinite(out.top)) ? out : null;
    }

    try{
      var raw = localStorage.getItem(STATE_KEY);
      if(raw) return normalizeObj(JSON.parse(raw));
    }catch(_){}

    try{
      var raw8 = localStorage.getItem(V8_KEY);
      if(raw8) return normalizeObj(JSON.parse(raw8));
    }catch(_){}

    try{
      var raw2 = localStorage.getItem(LEGACY_POS_KEY);
      if(raw2) return normalizeObj(JSON.parse(raw2));
    }catch(_){}

    return null;
  }

  function saveState(panel){
    try{
      var s = {
        v: 10,
        mode: "page",
        left: getPinnedLeft(panel),
        top:  getPinnedTop(panel),
        width: panel.style.width || "",
        height: panel.style.height || ""
      };
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
    }catch(_){}
  }

  function clampIntoHost(panel){
    var left = getPinnedLeft(panel);
    var top  = getPinnedTop(panel);

    var w = panel.offsetWidth;
    var h = panel.offsetHeight;

    var maxLeft = 0, maxTop = 0;

    if(!host || host === document.body || host === document.documentElement){
      var doc = getMaxDocSize();
      maxLeft = Math.max(0, doc.w - w);
      maxTop  = Math.max(0, doc.h - h);
    }else{
      maxLeft = Math.max(0, host.scrollWidth  - w);
      maxTop  = Math.max(0, host.scrollHeight - h);
    }

    setPinned(panel, clamp(left, 0, maxLeft), clamp(top, 0, maxTop));
  }

  function attachToHost(panel){
    host = normalizeHost(findPrimaryScrollHost());
    if(!host) host = document.body || document.documentElement;

    if(host !== document.body && host !== document.documentElement){
      ensureRelativeContainer(host);
    }

    // Move panel into host if it's not already there, preserving visual position
    if(panel.parentNode !== host){
      var pr = panel.getBoundingClientRect();
      var newLeft = 0, newTop = 0;

      if(host === document.body || host === document.documentElement){
        newLeft = pr.left + pageScrollX();
        newTop  = pr.top  + pageScrollY();
      }else{
        var hr = host.getBoundingClientRect();
        newLeft = pr.left - hr.left + host.scrollLeft;
        newTop  = pr.top  - hr.top  + host.scrollTop;
      }

      host.appendChild(panel);
      panel.style.position = "absolute";
      panel.style.margin = "0";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      setPinned(panel, newLeft, newTop);
    }
  }

  function ensureHandles(panel){
    // Drag handle
    var dragHandle = panel.querySelector(".mndoQTDragHandle");
    if(!dragHandle){
      dragHandle = document.createElement("div");
      dragHandle.className = "mndoQTDragHandle";
      dragHandle.title = "Drag";
      dragHandle.textContent = "⋮⋮";
      panel.appendChild(dragHandle);
    }

    // Resize handle
    var resizeHandle = panel.querySelector(".mndoQTResizeHandle");
    if(!resizeHandle){
      resizeHandle = document.createElement("div");
      resizeHandle.className = "mndoQTResizeHandle";
      resizeHandle.title = "Resize";
      panel.appendChild(resizeHandle);
    }

    return { dragHandle: dragHandle, resizeHandle: resizeHandle };
  }

  function install(panel){
    attachToHost(panel);

    // Apply saved state if available; otherwise pin current position immediately
    var st = readState();
    if(st && isFinite(st.left) && isFinite(st.top)){
      if(st.width) panel.style.width = st.width;
      if(st.height) panel.style.height = st.height;
      setPinned(panel, st.left, st.top);
    }else{
      setPinned(panel, panel.offsetLeft || 0, panel.offsetTop || 0);
    }

    clampIntoHost(panel);
    saveState(panel);

    var handles = ensureHandles(panel);
    var dragHandle = handles.dragHandle;
    var resizeHandle = handles.resizeHandle;

    // ===== Drag logic =====
    (function(){
      var dragging = false;
      var startX = 0, startY = 0;
      var startLeft = 0, startTop = 0;
      var startScrollLeft = 0, startScrollTop = 0;

      function onDown(e){
        if(e.button != null && e.button !== 0) return;
        e.preventDefault();

        dragging = true;
        panel.classList.add("mndoQTDragging");

        startX = e.clientX;
        startY = e.clientY;
        startLeft = getPinnedLeft(panel);
        startTop  = getPinnedTop(panel);

        startScrollLeft = (host && typeof host.scrollLeft === "number") ? host.scrollLeft : pageScrollX();
        startScrollTop  = (host && typeof host.scrollTop === "number")  ? host.scrollTop  : pageScrollY();

        document.addEventListener("mousemove", onMove, {passive:false});
        document.addEventListener("mouseup", onUp, {passive:true});
      }

      function onMove(e){
        if(!dragging) return;
        e.preventDefault();

        var dx = (e.clientX - startX);
        var dy = (e.clientY - startY);

        var curScrollLeft = (host && typeof host.scrollLeft === "number") ? host.scrollLeft : pageScrollX();
        var curScrollTop  = (host && typeof host.scrollTop === "number")  ? host.scrollTop  : pageScrollY();

        var newLeft = startLeft + dx + (curScrollLeft - startScrollLeft);
        var newTop  = startTop  + dy + (curScrollTop  - startScrollTop);

        setPinned(panel, newLeft, newTop);
        clampIntoHost(panel);
      }

      function onUp(){
        if(!dragging) return;
        dragging = false;
        panel.classList.remove("mndoQTDragging");

        document.removeEventListener("mousemove", onMove, {passive:false});
        document.removeEventListener("mouseup", onUp, {passive:true});

        saveState(panel);
      }

      dragHandle.addEventListener("mousedown", onDown, {passive:false});
      // Prevent accidental selection/clicks inside panel from starting drag
      dragHandle.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); }, {passive:false});
    })();

    // ===== Resize logic =====
    (function(){
      var resizing = false;
      var startX = 0, startY = 0;
      var startW = 0, startH = 0;

      function maxWH(){
        if(!host || host === document.body || host === document.documentElement){
          return { w: Math.max(260, window.innerWidth - 10), h: Math.max(80, window.innerHeight - 10) };
        }
        return { w: Math.max(260, host.clientWidth - 10), h: Math.max(80, host.clientHeight - 10) };
      }

      function onDown(e){
        if(e.button != null && e.button !== 0) return;
        e.preventDefault();

        resizing = true;
        panel.classList.add("mndoQTResizing");

        startX = e.clientX;
        startY = e.clientY;
        startW = panel.offsetWidth;
        startH = panel.offsetHeight;

        document.addEventListener("mousemove", onMove, {passive:false});
        document.addEventListener("mouseup", onUp, {passive:true});
      }

      function onMove(e){
        if(!resizing) return;
        e.preventDefault();

        var dx = e.clientX - startX;
        var dy = e.clientY - startY;

        var minW = 220, minH = 54;
        var mx = maxWH();

        var newW = clamp(startW + dx, minW, mx.w);
        var newH = clamp(startH + dy, minH, mx.h);

        panel.style.width = Math.round(newW) + "px";
        panel.style.height = Math.round(newH) + "px";

        clampIntoHost(panel);
      }

      function onUp(){
        if(!resizing) return;
        resizing = false;
        panel.classList.remove("mndoQTResizing");

        document.removeEventListener("mousemove", onMove, {passive:false});
        document.removeEventListener("mouseup", onUp, {passive:true});

        // Let height auto-fit when not needed
        panel.style.height = "";
        clampIntoHost(panel);
        saveState(panel);
      }

      resizeHandle.addEventListener("mousedown", onDown, {passive:false});
      resizeHandle.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); }, {passive:false});
    })();

    // Keep inside bounds on viewport resize
    window.addEventListener("resize", function(){
      clampIntoHost(panel);
      saveState(panel);
    }, {passive:true});
  }

  // Install immediately when available; otherwise use a short bounded retry.
  var initialPanel = document.getElementById("mndoQuickTimerPanel");
  if(initialPanel){
    install(initialPanel);
  }else{
    window.__srWaitForDom(function(){
      var panel = document.getElementById("mndoQuickTimerPanel");
      if(!panel) return false;
      install(panel);
      return true;
    }, 12000);
  }
})();



(function(){
  "use strict";
  // ONE is deliberately session-only, single-use, and disabled by default.
  var ONE_HOME_TTL_MS = 120000;
  var oneHomeTimer = null;
  window.__mndoWeOneHomeMode = false;

  function oneHomeIsActive(){ return window.__mndoWeOneHomeMode === true; }

  function syncOneHomeButton(btn){
    if(!btn) return;
    var active = oneHomeIsActive();
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute("aria-label", active
      ? "WE One Home mode active for the next SR only. Auto-off after use or 2 minutes."
      : "WE One Home mode off. Click to use landline without FBB for one SR.");
    var mark = btn.querySelector(".mndo-one-mark");
    if(mark) mark.textContent = active ? "✓" : "";
  }

  function setOneHomeActive(active, reason){
    if(oneHomeTimer !== null){
      clearTimeout(oneHomeTimer);
      oneHomeTimer = null;
    }
    window.__mndoWeOneHomeMode = active === true;
    if(oneHomeIsActive()){
      oneHomeTimer = setTimeout(function(){
        setOneHomeActive(false, "timeout");
      }, ONE_HOME_TTL_MS);
    }
    syncOneHomeButton(document.getElementById("mndoOneHomeToggle"));
    try{
      window.dispatchEvent(new CustomEvent("mndo:we-one-home-change", {
        detail:{ active: oneHomeIsActive(), reason: reason }
      }));
    }catch(error){}
  }

  // Called only after an ONE-mode SR launch has been attempted.
  // The next SR must use the normal FBB subscriber-number logic.
  window.__mndoConsumeWeOneHomeMode = function(){
    if(!oneHomeIsActive()) return false;
    setOneHomeActive(false, "used");
    return true;
  };

  function bind(){
    var btn = document.getElementById("mndoOneHomeToggle");
    if(!btn) return false;
    syncOneHomeButton(btn);
    if(btn.dataset.mndoOneBound === "1") return true;
    btn.dataset.mndoOneBound = "1";
    btn.addEventListener("click", function(event){
      event.preventDefault();
      event.stopPropagation();
      setOneHomeActive(!oneHomeIsActive(), "manual");
    });
    return true;
  }
  if(!bind() && typeof window.__srWaitForDom === "function"){
    window.__srWaitForDom(bind, 5000);
  }
})();


(function(){
  "use strict";

  var PANEL_ID = "mndoQuickTimerPanel";

  function pad2(n){ n = Math.max(0, Math.floor(n)); return (n<10?("0"+n):(""+n)); }

  function clampTotal(t){
    // allow up to 99:59
    t = Math.max(0, Math.floor(t));
    var max = (99*60) + 59;
    if(t > max) t = max;
    return t;
  }

  function split(total){
    total = clampTotal(total);
    return { m: Math.floor(total/60), s: total%60 };
  }

  function setup(panel){
    if(!panel || panel.getAttribute("data-mndo-qt-v10") === "1") return;

    panel.setAttribute("data-mndo-qt-v10", "1");

    // Replace UI completely (remove old 15/30/input)
    panel.innerHTML = ''
      + '<div class="mndoQTTime" id="mndoQTTimeV10">'
      +   '<span id="mndoQTIconV10"><i class="fa-regular fa-clock"></i></span>'
      +   '<span id="mndoQTTextV10">00:00</span>'
      + '</div>'
      + '<div class="mndoQTControls">'
      +   '<div class="mndoQTStep">'
      +     '<button type="button" class="mndoQTBtn mndoQTValueBtn" id="mndoQTMinBtnV10" title="Minutes">MIN: 30</button>'
      +     '<div class="mndoQTArrows">'
      +       '<button type="button" class="mndoQTBtn mndoQTArrowBtn" id="mndoQTMinUpV10" title="+1 minute"><i class="fa-solid fa-chevron-up"></i></button>'
      +       '<button type="button" class="mndoQTBtn mndoQTArrowBtn" id="mndoQTMinDownV10" title="-1 minute"><i class="fa-solid fa-chevron-down"></i></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="mndoQTStep">'
      +     '<button type="button" class="mndoQTBtn mndoQTValueBtn" id="mndoQTSecBtnV10" title="Seconds">SEC: 15</button>'
      +     '<div class="mndoQTArrows">'
      +       '<button type="button" class="mndoQTBtn mndoQTArrowBtn" id="mndoQTSecUpV10" title="+1 second"><i class="fa-solid fa-chevron-up"></i></button>'
      +       '<button type="button" class="mndoQTBtn mndoQTArrowBtn" id="mndoQTSecDownV10" title="-1 second"><i class="fa-solid fa-chevron-down"></i></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="mndoQTActionRow">'
      +     '<button type="button" class="mndoQTBtn mndoQTActionBtn" id="mndoQTStartPauseV10" title="Start / Pause"><i class="fa-solid fa-play"></i></button>'
      +     '<button type="button" class="mndoQTBtn mndoQTActionBtn" id="mndoQTResetV10" title="Reset"><i class="fa-solid fa-rotate-left"></i></button>'
      +   '</div>'
      + '</div>';

    var iconEl = document.getElementById("mndoQTIconV10");
    var textEl = document.getElementById("mndoQTTextV10");

    var minBtn  = document.getElementById("mndoQTMinBtnV10");
    var secBtn  = document.getElementById("mndoQTSecBtnV10");
    var minUp   = document.getElementById("mndoQTMinUpV10");
    var minDown = document.getElementById("mndoQTMinDownV10");
    var secUp   = document.getElementById("mndoQTSecUpV10");
    var secDown = document.getElementById("mndoQTSecDownV10");

    var startPauseBtn = document.getElementById("mndoQTStartPauseV10");
    var resetBtn      = document.getElementById("mndoQTResetV10");

    var st = {
      running:false,
      alarm:false,
      endAt:0,
      total: (30*60) + 15, // default: 30:15
      tickId:null,
      beepId:null,
      ctx:null
    };

    function setIcon(mode){
      if(!iconEl) return;
      if(mode === "run"){
        iconEl.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>';
      }else if(mode === "alarm"){
        iconEl.innerHTML = '<i class="fa-solid fa-bell"></i>';
      }else{
        iconEl.innerHTML = '<i class="fa-regular fa-clock"></i>';
      }
    }

    function renderSet(){
      var p = split(st.total);
      if(minBtn) minBtn.textContent = "MIN: " + p.m;
      if(secBtn) secBtn.textContent = "SEC: " + p.s;
      if(!st.running && textEl){
        textEl.textContent = pad2(p.m) + ":" + pad2(p.s);
      }
    }

    function renderLeft(ms){
      if(!textEl) return;
      var total = Math.max(0, Math.floor(ms/1000));
      var p = split(total);
      textEl.textContent = pad2(p.m) + ":" + pad2(p.s);
    }

    function getCtx(){
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      if(!st.ctx) st.ctx = new AC();
      return st.ctx;
    }

    function beepOnce(){
      var ctx = getCtx();
      if(!ctx) return;
      try{ if(ctx.state === "suspended") ctx.resume(); }catch(e){}
      try{
        var now = ctx.currentTime;

        var osc1 = ctx.createOscillator();
        var osc2 = ctx.createOscillator();
        osc1.type = "square";
        osc2.type = "square";
        osc1.frequency.value = 880;
        osc2.frequency.value = 1320;

        var gain = ctx.createGain();
        // "as loud as possible" in code: ramp close to 1.0 (real volume depends on device volume)
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.95, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        var comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-18, now);
        comp.knee.setValueAtTime(18, now);
        comp.ratio.setValueAtTime(12, now);
        comp.attack.setValueAtTime(0.003, now);
        comp.release.setValueAtTime(0.25, now);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(comp);
        comp.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.24);
        osc2.stop(now + 0.24);
      }catch(e){}
    }

    function beepStart(){
      if(st.beepId) return;
      beepOnce();
      st.beepId = setInterval(beepOnce, 380);
    }

    function beepStop(){
      if(st.beepId){
        clearInterval(st.beepId);
        st.beepId = null;
      }
    }

    function alarmStart(){
      st.alarm = true;
      panel.classList.add("mndoQTAlarm");
      setIcon("alarm");
      beepStart();
      try{ if(navigator && navigator.vibrate) navigator.vibrate([200,100,200,100,200]); }catch(e){}
    }

    function alarmStop(){
      st.alarm = false;
      panel.classList.remove("mndoQTAlarm");
      beepStop();
      if(!st.running) setIcon("idle");
    }

    function stopTick(){
      if(st.tickId){
        clearInterval(st.tickId);
        st.tickId = null;
      }
    }

    function finish(){
      st.running = false;
      stopTick();
      renderLeft(0);
      alarmStart();
      startPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function tick(){
      var left = st.endAt - Date.now();
      if(left <= 0){
        finish();
      }else{
        renderLeft(left);
      }
    }

    function start(){
      if(st.total <= 0) return;
      alarmStop();
      st.running = true;
      setIcon("run");
      st.endAt = Date.now() + (st.total*1000);
      stopTick();
      tick();
      st.tickId = setInterval(tick, 200);
      startPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }

    function pause(){
      if(!st.running) return;
      st.running = false;
      stopTick();
      setIcon("idle");
      // keep remaining time as the new set value
      var left = Math.max(0, Math.floor((st.endAt - Date.now())/1000));
      st.total = clampTotal(left);
      renderSet();
      startPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function reset(){
      alarmStop();
      st.running = false;
      stopTick();
      // reset to 00:00
      st.total = 0;
      setIcon("idle");
      renderSet();
      startPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function adjust(delta){
      if(st.running) return; // don't adjust while running
      alarmStop();
      st.total = clampTotal(st.total + delta);
      renderSet();
    }

    // Events
    startPauseBtn.addEventListener("click", function(){
      if(st.alarm){ alarmStop(); }
      if(st.running) pause(); else start();
    });

    resetBtn.addEventListener("click", function(){
      reset();
    });

    // Clicking the time display stops alarm or toggles start/pause
    var timeBox = document.getElementById("mndoQTTimeV10");
    if(timeBox){
      timeBox.style.cursor = "pointer";
      timeBox.addEventListener("click", function(){
        if(st.alarm){ alarmStop(); return; }
        if(st.running) pause(); else start();
      });
    }

    // Arrow steppers
    minUp.addEventListener("click", function(){ adjust(60); });
    minDown.addEventListener("click", function(){ adjust(-60); });
    secUp.addEventListener("click", function(){ adjust(1); });
    secDown.addEventListener("click", function(){ adjust(-1); });

    // Clicking value buttons: quick set focus-like + stop alarm
    minBtn.addEventListener("click", function(){ if(st.alarm) alarmStop(); });
    secBtn.addEventListener("click", function(){ if(st.alarm) alarmStop(); });

    // Initial render
    setIcon("idle");
    renderSet();
  }

  function boot(){
    var panel = document.getElementById(PANEL_ID);
    if(panel){
      setup(panel);
      return true;
    }
    return false;
  }

  function watch(){
    if(boot()) return;
    if(typeof window.__srWaitForDom === "function"){
      window.__srWaitForDom(boot, 8000);
      return;
    }
    setTimeout(boot, 120);
    setTimeout(boot, 700);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", watch, {once:true});
  }else{
    watch();
  }
  window.addEventListener("load", watch, {once:true});
})();



(function(){
  "use strict";

  var PANEL_ID = "mndoQuickTimerPanel";

  function pad2(n){
    n = Math.max(0, Math.floor(n));
    return (n < 10 ? ("0"+n) : (""+n));
  }

  function clampTotalSec(total){
    total = Math.max(0, Math.floor(total));
    var max = (99*60) + 59;
    if(total > max) total = max;
    return total;
  }

  function normalize(min, sec){
    min = isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
    sec = isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;

    if(sec >= 60){
      min += Math.floor(sec/60);
      sec = sec % 60;
    }
    if(min > 99){
      min = 99;
      sec = Math.min(sec, 59);
    }
    return { m:min, s:sec, total: clampTotalSec(min*60 + sec) };
  }

  function getCtx(state){
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    if(!state.ctx) state.ctx = new AC();
    return state.ctx;
  }

  function setup(panel){
    if(!panel || panel.getAttribute("data-mndo-qt-v13") === "1") return;
    panel.setAttribute("data-mndo-qt-v13", "1");

    panel.innerHTML = ''
      + '<div class="mndoQTHeaderV13">'
      +   '<div class="mndoQTIconV13" id="mndoQTIconV13"><i class="fa-regular fa-clock"></i></div>'
      +   '<div class="mndoQTInputsV13">'
      +     '<input class="mndoQTInputV13" id="mndoQTMinInV13" type="number" inputmode="numeric" min="0" max="99" placeholder="MM" />'
      +     '<span class="mndoQTColonV13">:</span>'
      +     '<input class="mndoQTInputV13" id="mndoQTSecInV13" type="number" inputmode="numeric" min="0" max="59" placeholder="SS" />'
      +   '</div>'
      +   '<div class="mndoQTBtnsV13">'
      +     '<button type="button" class="mndoQTBtn mndoQTBtnV13" id="mndoQTStartPauseV13" title="Start / Pause"><i class="fa-solid fa-play"></i></button>'
      +     '<button type="button" class="mndoQTBtn mndoQTBtnV13" id="mndoQTResetV13" title="Reset"><i class="fa-solid fa-rotate-left"></i></button>'
      +   '</div>'
      + '</div>';

    var iconEl = document.getElementById("mndoQTIconV13");
    var minIn  = document.getElementById("mndoQTMinInV13");
    var secIn  = document.getElementById("mndoQTSecInV13");
    var spBtn  = document.getElementById("mndoQTStartPauseV13");
    var rsBtn  = document.getElementById("mndoQTResetV13");

    var st = {
      running:false,
      alarm:false,
      endAt:0,
      total: (30*60)+15,
      tickId:null,
      beepId:null,
      ctx:null
    };

    function setIcon(mode){
      if(!iconEl) return;
      if(mode === "run"){
        iconEl.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>';
      }else if(mode === "alarm"){
        iconEl.innerHTML = '<i class="fa-solid fa-bell"></i>';
      }else{
        iconEl.innerHTML = '<i class="fa-regular fa-clock"></i>';
      }
    }

    function setInputs(m,s){
      minIn.value = (m === 0 && st.running === false && minIn.value === "" ? "" : pad2(m));
      secIn.value = (s === 0 && st.running === false && secIn.value === "" ? "" : pad2(s));
    }

    function setInputsFromTotal(total){
      total = clampTotalSec(total);
      var m = Math.floor(total/60);
      var s = total%60;
      minIn.value = pad2(m);
      secIn.value = pad2(s);
    }

    function readInputs(){
      var m = parseInt(minIn.value, 10);
      var s = parseInt(secIn.value, 10);
      if(!isFinite(m)) m = 0;
      if(!isFinite(s)) s = 0;
      var n = normalize(m,s);
      // reflect normalized (two digits)
      minIn.value = pad2(n.m);
      secIn.value = pad2(n.s);
      st.total = n.total;
      return n;
    }

    function inputsEnable(on){
      minIn.disabled = !on;
      secIn.disabled = !on;
    }

    function beepOnce(){
      var ctx = getCtx(st);
      if(!ctx) return;
      try{ if(ctx.state === "suspended") ctx.resume(); }catch(e){}
      try{
        var now = ctx.currentTime;

        var osc1 = ctx.createOscillator();
        var osc2 = ctx.createOscillator();
        osc1.type = "square";
        osc2.type = "square";
        osc1.frequency.value = 880;
        osc2.frequency.value = 1320;

        var gain = ctx.createGain();
        // as loud as possible (within WebAudio); device volume still matters
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.98, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        var comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-18, now);
        comp.knee.setValueAtTime(18, now);
        comp.ratio.setValueAtTime(12, now);
        comp.attack.setValueAtTime(0.003, now);
        comp.release.setValueAtTime(0.25, now);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(comp);
        comp.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.24);
        osc2.stop(now + 0.24);
      }catch(e){}
    }

    function beepStart(){
      if(st.beepId) return;
      beepOnce();
      st.beepId = setInterval(beepOnce, 380);
    }

    function beepStop(){
      if(st.beepId){
        clearInterval(st.beepId);
        st.beepId = null;
      }
    }

    function alarmStart(){
      st.alarm = true;
      panel.classList.add("mndoQTAlarm");
      setIcon("alarm");
      beepStart();
      try{ if(navigator && navigator.vibrate) navigator.vibrate([200,100,200,100,200]); }catch(e){}
    }

    function alarmStop(){
      st.alarm = false;
      panel.classList.remove("mndoQTAlarm");
      beepStop();
      if(!st.running) setIcon("idle");
    }

    function stopTick(){
      if(st.tickId){
        clearInterval(st.tickId);
        st.tickId = null;
      }
    }

    function renderLeft(ms){
      var total = Math.max(0, Math.floor(ms/1000));
      setInputsFromTotal(total);
    }

    function finish(){
      st.running = false;
      stopTick();
      inputsEnable(true);
      setInputsFromTotal(0);
      alarmStart();
      spBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function tick(){
      var left = st.endAt - Date.now();
      if(left <= 0){
        finish();
      }else{
        renderLeft(left);
      }
    }

    function start(){
      alarmStop();
      readInputs();
      if(st.total <= 0) return;
      st.running = true;
      inputsEnable(false);
      setIcon("run");
      st.endAt = Date.now() + (st.total*1000);
      stopTick();
      tick();
      st.tickId = setInterval(tick, 200);
      spBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }

    function pause(){
      if(!st.running) return;
      st.running = false;
      stopTick();
      inputsEnable(true);
      setIcon("idle");
      var left = Math.max(0, Math.floor((st.endAt - Date.now())/1000));
      st.total = clampTotalSec(left);
      setInputsFromTotal(st.total);
      spBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    function reset(){
      alarmStop();
      st.running = false;
      stopTick();
      inputsEnable(true);
      st.total = 0;
      setIcon("idle");
      setInputsFromTotal(st.total);
      spBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }

    // Events
    spBtn.addEventListener("click", function(){
      if(st.alarm){ alarmStop(); return; }
      if(st.running) pause(); else start();
    });

    rsBtn.addEventListener("click", function(){
      reset();
    });

    // Typing updates time (only when not running)
    function onTyped(){
      if(st.running) return;
      if(st.alarm) alarmStop();
      // normalize softly (do not jump cursor on every keystroke) -> normalize on blur/change
    }

    function onCommit(){
      if(st.running) return;
      if(st.alarm) alarmStop();
      readInputs();
    }

    minIn.addEventListener("input", onTyped);
    secIn.addEventListener("input", onTyped);
    minIn.addEventListener("change", onCommit);
    secIn.addEventListener("change", onCommit);
    minIn.addEventListener("blur", onCommit);
    secIn.addEventListener("blur", onCommit);

    // Clicking icon stops alarm quickly
    iconEl.addEventListener("click", function(){
      if(st.alarm) alarmStop();
    });

    // Initial
    setIcon("idle");
    inputsEnable(true);
    setInputsFromTotal(st.total);
  }

  function boot(){
    var panel = document.getElementById(PANEL_ID);
    if(panel){
      setup(panel);
      return true;
    }
    return false;
  }

  function watch(){
    if(boot()) return;
    if(typeof window.__srWaitForDom === "function"){
      window.__srWaitForDom(boot, 8000);
      return;
    }
    setTimeout(boot, 120);
    setTimeout(boot, 700);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", watch, {once:true});
  }else{
    watch();
  }
  window.addEventListener("load", watch, {once:true});
})();



(function(){
  "use strict";

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function getXY(e){
    if(e.touches && e.touches.length){
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function persist(panel){
    try{
      var key = "mndoQTState_v9"; // نفس المفتاح المستخدم في patch السحب/التكبير
      var st = {};
      try{ st = JSON.parse(localStorage.getItem(key) || "{}") || {}; }catch(_){ st = {}; }

      // خزن المقاسات الحالية (strings مثل "240px")
      if(panel.style.width)  st.width  = panel.style.width;
      if(panel.style.height) st.height = panel.style.height;

      localStorage.setItem(key, JSON.stringify(st));
    }catch(_){}
  }

  function install(){
    var panel = document.getElementById("mndoQuickTimerPanel");
    if(!panel) return false;

    var handle = panel.querySelector(".mndoQTResizeHandle");
    if(!handle) return false;

    // Prevent double-install
    if(handle.getAttribute("data-mndo-resize-fix") === "1") return true;
    handle.setAttribute("data-mndo-resize-fix", "1");

    var resizing = false;
    var startX = 0, startY = 0;
    var startW = 0, startH = 0;

    function onDown(e){
      // left click only
      if(e.button != null && e.button !== 0) return;

      // IMPORTANT: stop the old handler that couldn't override !important widths
      e.preventDefault();
      e.stopImmediatePropagation();

      resizing = true;
      panel.classList.add("mndoQTResizing");

      var p = getXY(e);
      startX = p.x;
      startY = p.y;

      var r = panel.getBoundingClientRect();
      startW = r.width;
      startH = r.height;

      document.addEventListener("mousemove", onMove, {passive:false});
      document.addEventListener("mouseup", onUp, {passive:true});
      document.addEventListener("touchmove", onMove, {passive:false});
      document.addEventListener("touchend", onUp, {passive:true});
      document.addEventListener("touchcancel", onUp, {passive:true});
    }

    function onMove(e){
      if(!resizing) return;
      e.preventDefault();

      var p = getXY(e);
      var dx = p.x - startX;
      var dy = p.y - startY;

      // Min sizes (keep usable)
      var minW = 190;
      var minH = 40;

      // Max sizes (avoid overflow)
      var maxW = Math.max(minW, window.innerWidth - 10);
      var maxH = Math.max(minH, window.innerHeight - 10);

      var newW = clamp(startW + dx, minW, maxW);
      var newH = clamp(startH + dy, minH, maxH);

      // KEY FIX: set with IMPORTANT so it actually changes even if CSS uses !important
      panel.style.setProperty("width",  Math.round(newW) + "px", "important");
      panel.style.setProperty("height", Math.round(newH) + "px", "important");
    }

    function onUp(){
      if(!resizing) return;
      resizing = false;
      panel.classList.remove("mndoQTResizing");

      document.removeEventListener("mousemove", onMove, {passive:false});
      document.removeEventListener("mouseup", onUp, {passive:true});
      document.removeEventListener("touchmove", onMove, {passive:false});
      document.removeEventListener("touchend", onUp, {passive:true});
      document.removeEventListener("touchcancel", onUp, {passive:true});

      persist(panel);
    }

    // capture=true so we run BEFORE old listener
    handle.addEventListener("mousedown", onDown, true);
    handle.addEventListener("touchstart", onDown, {capture:true, passive:false});

    return true;
  }

  function boot(){
    if(install()) return;
    if(typeof window.__srWaitForDom === "function"){
      window.__srWaitForDom(install, 8000);
      return;
    }
    setTimeout(install, 120);
    setTimeout(install, 700);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, {once:true});
  }else{
    boot();
  }
  window.addEventListener("load", boot, {once:true});
})();



(function(){
  "use strict";

  var STATE_KEY = "mndoQTState_v9";

  function fixState(){
    try{
      var st = {};
      try{ st = JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}; }catch(_){ st = {}; }
      // remove any saved width/height so it can't resize on refresh
      if(st && typeof st === "object"){
        delete st.width;
        delete st.height;
        localStorage.setItem(STATE_KEY, JSON.stringify(st));
      }
    }catch(_){}
  }

  function apply(){
    var panel = document.getElementById("mndoQuickTimerPanel");
    if(!panel) return;

    // enforce fixed size (inline IMPORTANT wins against other rules)
    panel.style.setProperty("width", "210px", "important");
    panel.style.setProperty("height", "auto", "important");

    // remove resize handle if it exists
    var rh = panel.querySelector(".mndoQTResizeHandle");
    if(rh) rh.remove();

    // If any code tries to re-add resize handle, remove it
    if(!panel.__mndoNoResizeObs){
      var obs = new MutationObserver(function(){
        var h = panel.querySelector(".mndoQTResizeHandle");
        if(h) h.remove();
      });
      obs.observe(panel, {childList:true, subtree:true});
      panel.__mndoNoResizeObs = obs;
    }
  }

  function run(){
    fixState();
    apply();
    setTimeout(apply, 120);
    setTimeout(apply, 400);
    setTimeout(apply, 900);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run, {once:true});
  }else{
    run();
  }
  window.addEventListener("load", run, {once:true});
  window.addEventListener("resize", function(){ setTimeout(apply, 80); });
})();



(function(){
  "use strict";

  function ensureLogo(){
    return document.getElementById("MNDO_UA07_LOGO3");
  }

  function ensureSecretModal(){
    var existing = document.getElementById("UA07_SECRET_MODAL");
    if(existing) return existing;

    var modal = document.createElement("div");
    modal.id = "UA07_SECRET_MODAL";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="ua07-secret-backdrop" data-ua07-close="1"></div>
      <div class="ua07-secret-card" role="document" dir="rtl">
        <div class="ua07-secret-head">
          <div class="ua07-secret-icon" aria-hidden="true">🚨</div>
          <div class="ua07-secret-title">تحذير</div>
        </div>
        <div class="ua07-secret-body">
          <div class="ua07-secret-lead">تنبيه هام</div>
          <div class="ua07-secret-text">دي أداة سرّية وحساسة جدًا. استخدمها بحذر شديد فقط.</div>
          <div class="ua07-secret-text">لان استخدامها بعلم احد قد يؤدي إلى إجراء فوري — أقلها HR.</div>
        </div>
        <div class="ua07-secret-actions">
          <button class="ua07-btn ua07-primary" type="button" data-ua07-ok="1">فهمت</button>
          <button class="ua07-btn ua07-ghost" type="button" data-ua07-close="1">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  

function ensureUpdateModal(){
  var existing = document.getElementById("UA07_UPDATE_MODAL");
  if(existing) return existing;

  var modal = document.createElement("div");
  modal.id = "UA07_UPDATE_MODAL";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="ua07-secret-backdrop" data-ua07-update-close="1"></div>
    <div class="ua07-secret-card" role="document" dir="rtl">
      <div class="ua07-secret-head">
        <div class="ua07-secret-icon" aria-hidden="true">
          <span class="ua07-chip ua07-chip-new">NEW</span>
          <span class="ua07-chip ua07-chip-last">LAST UPDATE</span>
        </div>
        <div class="ua07-secret-title">آخر التحديثات</div>
      </div>
      <div class="ua07-secret-body">
        <ul class="ua07-secret-list">
          <li><b>UA07:</b> إضافة أيقونة تحذير + نافذة تحذير (Modal) بنص معتمد وزري “فهمت / إلغاء”.</li>
          <li><b>SR Technical:</b> تحديث أسماء وروابط الأدوات + تحديث كامل اسفل الصفحه عند Ticket Maker<br>بروابط فعاله</li>
          <li><b>SR Sales:</b> تعديل أسماء وروابط أزرار الصف الأول: IVR / BSS / we app / Tech Concession.</li>
          <li><b>Mobile:</b> إضافة أدوات جديدة بنفس تنسيق SR Sales (UNMS / ADM Tooltip / REMEDY / Verification / WE Air zone) مع إبقاء All Tools آخر زر.</li>
          <li><b>Tags & Timer:</b> تعديل الـ tags، والـ Timer أصبح يعد حتى 24 ساعة (بالدقائق: اكتب 180 = 3 ساعات وهكذا) + منبه بصيغة 24 ساعة (بعد الظهر: اكتب 13 = 1 مساءً، و00 = 12 صباحًا)، مع إمكانية تصغيره/إرجاعه من النقطة بجانب Timer.</li>
          <li><b>Control Panel:</b> داخل وحدة تحكم ال tags إضافة مود “IVR” لإدارة وإضافة canned messages للـ IVR حسب (Technical / Sales / Mobile).</li>
          <li><b>Timer &amp; Control Panel:</b> بقوا Sticky/Responsive مع الـScroll — بعد حوالي 8 سم بيتصغّروا لفوق تلقائي لزوم الدلع، وبضغطة على مكان التكبير/التصغير يرجعوا Full.<br>كمان تم دعم وضعين للتايمر: ساعة أو Timer بيحسب الوقت المحدد علشان يرن حتى لو شكلو ساعه بيكون التايمر شغال لو انت مشغله. واتضاف هوت كى زر * تقدر تضغط عليه بنفس منطق زر Reset ال فى التايمر ↻ يوقف التايمر ويرجّعه لضبط المصنع.</li>
          <li><b>UI:</b> ضبط وتحسين الألوان بشكل عام.</li>
        </ul>
      </div>
      <div class="ua07-secret-actions">
        <button class="ua07-btn ua07-primary" type="button" data-ua07-update-ok="1">فهمت</button>
        <button class="ua07-btn ua07-ghost" type="button" data-ua07-update-close="1">إغلاق</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Ensure close buttons work reliably even if other handlers stop propagation
  try {
    var closeEls = modal.querySelectorAll('[data-ua07-update-close], [data-ua07-update-ok]');
    closeEls.forEach(function(el){
      el.addEventListener('click', function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        closeUpdateModal();
      });
    });
  } catch(e){}
  return modal;
}

function openUpdateModal(){
  var modal = ensureUpdateModal();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeUpdateModal(){
  var modal = document.getElementById("UA07_UPDATE_MODAL");
  if(!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}
function openSecretModal(){
    var modal = ensureSecretModal();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeSecretModal(){
    var modal = document.getElementById("UA07_SECRET_MODAL");
    if(!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function bindSecretWarning(){
    var logo = ensureLogo();
    if(!logo) return;
    var btn = logo.querySelector("#UA07_SECRET_ENVELOPE");
    if(!btn || btn.dataset.ua07Bound) return;
    btn.dataset.ua07Bound = "1";

    btn.addEventListener("click", function(e){
      e.preventDefault();
      e.stopPropagation();
      openSecretModal();
    });

    // Delegate close actions
    document.addEventListener("click", function(e){
      var t = e.target;
      if(!t) return;
      if(t.closest && t.closest("#UA07_SECRET_MODAL")){
        if(t.matches("[data-ua07-close]") || (t.closest && t.closest("[data-ua07-close]"))){
          closeSecretModal();
          return;
        }
        if(t.matches("[data-ua07-ok]") || (t.closest && t.closest("[data-ua07-ok]"))){
          closeSecretModal();
          return;
        }
      }
    }, true);

    document.addEventListener("keydown", function(e){
      if(e.key === "Escape") closeSecretModal();
    });
  }

function bindUpdateNotes(){
  var logo = ensureLogo();
  if(!logo) return;
  var btn = logo.querySelector("#UA07_UPDATE_ICON");
  if(!btn || btn.dataset.ua07Bound) return;
  btn.dataset.ua07Bound = "1";

  btn.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    openUpdateModal();
  });

  document.addEventListener("click", function(e){
    var t = e.target;
    if(!t) return;
    if(t.closest && t.closest("[data-ua07-update-close]")){
      closeUpdateModal();
    }
    if(t.closest && t.closest("[data-ua07-update-ok]")){
      closeUpdateModal();
    }
  }, true);

  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ closeUpdateModal(); }
  });
}


  function findSearch(){
    return document.getElementById("searchInput")
      || document.querySelector("input.search-input")
      || document.querySelector(".search-container input")
      || document.querySelector("input[type='search']")
      || document.querySelector("input[id*='search' i], input[class*='search' i]");
  }

  function findAht(){
    return document.getElementById("mndoQueryTimer")
      || document.querySelector("#MNDO_AHT_TAGS_STACK #mndoQueryTimer");
  }

  function place(){
    var logo = ensureLogo();
    var s = findSearch();
    if(!s) return false;

    var a = findAht();

    var sx = (window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0);
    var sy = (window.pageYOffset || document.documentElement.scrollTop  || document.body.scrollTop  || 0);

    var sr = s.getBoundingClientRect();
    var ar = a ? a.getBoundingClientRect() : null;

    // align with search input (page coordinates so it scrolls with the page)
    var top = Math.round(sy + sr.top + (sr.height - logo.offsetHeight)/2) - 1;
    if(top < (sy + 6)) top = sy + 6;

    // center in the gap between search and AHT, else left of search
    var left;
    if(ar && (ar.left > sr.right + 12)){
      var gapL = sx + sr.right + 10;
      var gapR = sx + ar.left - 10 - logo.offsetWidth;
      left = Math.round((gapL + gapR) / 2);
      if(left < gapL) left = gapL;
      if(left > gapR) left = gapR;
    }else{
      left = Math.round(sx + sr.left - logo.offsetWidth - 12);
    }

    // clamp
    var minL = sx + 6;
    var maxL = sx + Math.max(6, (window.innerWidth - logo.offsetWidth - 6));
    if(left < minL) left = minL;
    if(left > maxL) left = maxL;

    logo.style.top = top + "px";
    logo.style.left = left + "px";
    return true;
  }

  function boot(){
    // One immediate layout pass. Retry only if the target is not ready yet.
    var ok = place();
    bindSecretWarning();
    bindUpdateNotes();

    if(!ok){
      window.__srWaitForDom(function(){
        var placed = place();
        if(placed){
          bindSecretWarning();
          bindUpdateNotes();
        }
        return placed;
      }, 8000);
    }

    setTimeout(place, 350);
    setTimeout(bindSecretWarning, 420);

    // Re-place on resize ONLY (no scroll listener -> it will scroll away like Tags)
    window.addEventListener("resize", function(){ setTimeout(place, 40); setTimeout(bindSecretWarning, 60); }, {passive:true});
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, {once:true});
  }else{
    boot();
  }
  window.addEventListener("load", boot, {once:true});
})();



                                                function updateInput() {

                                                        var ip_count = document.getElementById("ip_count").value;

                                                        var ip = document.getElementById("original_ip").value;

                                                        var base = ip.split(".");

                                                        var last = parseInt(base[3]);

                                                        var ips = "";

                                                        var cpe_ip = "";

                                                        if (ip_count == 2) {

                                                                ips = ip + "\n";

                                                                cpe_ip = base[0] + "." + base[1] + "." + base[2] + "." + (1);

                                                        } else if (ip_count == 3) {

                                                                ips = base[0] + "." + base[1] + "." + base[2] + "." + (last + 2) + "\n";

                                                                cpe_ip = base[0] + "." + base[1] + "." + base[2] + "." + (last + 1);

                                                        } else if (ip_count == 2 || ip_count == 4) {

                                                                ips = ip + "\n";

                                                                cpe_ip = base[0] + "." + base[1] + "." + base[2] + "." + (last + 1);

                                                        } else {

                                                                for (var i = 2; i <= ip_count; i++) {

                                                                        ips += base[0] + "." + base[1] + "." + base[2] + "." + (last + i) + "\n";

                                                                }

                                                                cpe_ip = base[0] + "." + base[1] + "." + base[2] + "." + (last + 1);

                                                        }

                                                        if (ip_count == 2) {

                                                                document.getElementById("ip_list").value = ip + "\n";

                                                        } else if (ip_count == 3) {

                                                                document.getElementById("ip_list").value = base[0] + "." + base[1] + "." + base[2] + "." + (last + 2) + "\n";

                                                        } else {

                                                                document.getElementById("ip_list").value = ips;

                                                        }

                                                        // check if option is "Option New Solution" and the last number of the IP is 1
                                                        if (ip_count == 2 && base[3] == "1") {

                                                                cpe_ip = base[0] + "." + base[1] + "." + base[2] + "." + (254);

                                                        }

                                                        document.getElementById("Cpe-IP").value = cpe_ip;

                                                }
                                        


                                                function subNet() {
                                                        var subnet_mask = "";
                                                        var ip_count = document.getElementById("ip_count").value;
                                                        if (ip_count == "3" || ip_count == "Option Pack 1") {
                                                                subnet_mask = "255.255.255.252";
                                                        } else if (ip_count == "6" || ip_count == "Option Pack 2") {
                                                                subnet_mask = "255.255.255.248";
                                                        } else if (ip_count == "14" || ip_count == "Option Pack 3") {
                                                                subnet_mask = "255.255.255.240";
                                                        } else if (ip_count == "2" || ip_count == "Option New Solution") {
                                                                subnet_mask = "255.255.255.0";
                                                        }
                                                        document.getElementById("subnet_mask").value = subnet_mask;
                                                }
                                        


                                                function subNet() {
                                                        var subnet_mask = "";
                                                        var ip_count = document.getElementById("ip_count").value;
                                                        if (ip_count == "3" || ip_count == "Option Pack 1") {
                                                                subnet_mask = "255.255.255.252";
                                                        } else if (ip_count == "6" || ip_count == "Option Pack 2") {
                                                                subnet_mask = "255.255.255.248";
                                                        } else if (ip_count == "14" || ip_count == "Option Pack 3") {
                                                                subnet_mask = "255.255.255.240";
                                                        } else if (ip_count == "2" || ip_count == "Option New Solution") {
                                                                subnet_mask = "255.255.255.0";
                                                        }
                                                        document.getElementById("subnet_mask").value = subnet_mask;
                                                }
                                        


                                // نفس سكريبتك مع حساب تلقائي عند الإدخال
                                document.getElementById("myDayy").addEventListener("input", function () {
                                        var myDays = document.getElementById("myDayy").value;
                                        var result = myDays / 60;
                                        document.getElementById("myGg").value = result.toString(); // بدون فواصل
                                });
                        


                                function calculatePrice() {
                                        // Parse selected package price as a number. Default to 0 if not a number
                                        var productValue = parseFloat(document.getElementById("products").value);
                                        if (isNaN(productValue)) productValue = 0;
                                        var services = 0;
                                        var discounts = 0;
                                        var Extra = 0;
                                        var OptionP = 0;
                                        var paly = 0;

                                        // الحصول على الأزرار المفعلة
                                        if (document.getElementById("service1").classList.contains("active")) {
                                                services += 5;
                                        }
                                        if (document.getElementById("service2").classList.contains("active")) {
                                                services += 10;
                                        }
                                        if (document.getElementById("service3").classList.contains("active")) {
                                                services += 20;
                                        }
                                        if (document.getElementById("service4").classList.contains("active")) {
                                                services += 50;
                                        }

                                        if (document.getElementById("discount1").classList.contains("active")) {
                                                discounts += 0.25;
                                        }
                                        if (document.getElementById("discount2").classList.contains("active")) {
                                                discounts += 0.50;
                                        }

                                        if (document.getElementById("extra30").classList.contains("active")) {
                                                Extra += 60;
                                        }
                                        if (document.getElementById("extra50").classList.contains("active")) {
                                                Extra += 120;
                                        }
                                        if (document.getElementById("extra100").classList.contains("active")) {
                                                Extra += 190;
                                        }
                                        if (document.getElementById("gigaTank400").classList.contains("active")) {
                                                Extra += 500;
                                        }
                                        if (document.getElementById("gigaTank2000").classList.contains("active")) {
                                                Extra += 2000;
                                        }
                                        if (document.getElementById("gameOn400").classList.contains("active")) {
                                                Extra += 40;
                                        }

                                        if (document.getElementById("op10").classList.contains("active")) {
                                                OptionP += 67;
                                        }
                                        if (document.getElementById("op20").classList.contains("active")) {
                                                OptionP += 330;
                                        }
                                        if (document.getElementById("op30").classList.contains("active")) {
                                                OptionP += 750;
                                        }

                                        if (document.getElementById("add1").classList.contains("active")) {
                                                paly += 120;
                                        }
                                        if (document.getElementById("add2").classList.contains("active")) {
                                                paly += 240;
                                        }

                                        var balanceVal = parseFloat(document.getElementById("balance").value);
                                        if (isNaN(balanceVal)) balanceVal = 0;
                                        var priceWithoutTax = productValue * (1 - discounts) + services + OptionP + paly + Extra - balanceVal;
                                        var priceWithTax = priceWithoutTax * 1.14;

                                        document.getElementById("priceWithTax").value = priceWithTax.toFixed(2);
                                        document.getElementById("priceWithoutTax").value = priceWithoutTax.toFixed(2);
                                }

                                function resetForm() {
                                        document.getElementById("products").value = "0";
                                        document.getElementById("balance").value = "0.00";
                                        document.getElementById("priceWithTax").value = "0.00";
                                        document.getElementById("priceWithoutTax").value = "0.00";

                                        document.querySelectorAll('.service-btn, .discount-btn, .extra-btn, .op-btn, .add-btn').forEach(function (btn) {
                                                btn.classList.remove('active');
                                        });

                                        calculatePrice();
                                }

                                function toggleButton(button) {
                                        button.classList.toggle('active');
                                        calculatePrice();
                                }

                        


                                const tax = 0.14;
                                let currentMode = 'with';

                                function selectMode(mode) {
                                        currentMode = mode;
                                        document.getElementById("shamel1").classList.remove("active");
                                        document.getElementById("shamel2").classList.remove("active");
                                        if (mode === "with") {
                                                document.getElementById("shamel1").classList.add("active");
                                        } else {
                                                document.getElementById("shamel2").classList.add("active");
                                        }
                                        getNum();
                                }

                                function getNum() {
                                        const input = parseFloat(document.getElementById("nom1").value);
                                        if (!isNaN(input)) {
                                                let result = currentMode === "with" ? input / (1 + tax) : input * (1 + tax);
                                                document.getElementById("nom2").value = result.toFixed(2);
                                        } else {
                                                document.getElementById("nom2").value = "";
                                        }
                                }

function remove() {
                                        document.getElementById("nom1").value = "";
                                        document.getElementById("nom2").value = "";
                                }
                        


function resetAllPackages() {
                                        document.getElementById("service1").checked = false;
                                        document.getElementById("service2").checked = false;
                                        document.getElementById("service3").checked = false;
                                        document.getElementById("service4").checked = false;
                                        document.getElementById("discount1").checked = false;
                                        document.getElementById("discount2").checked = false;
                                        document.getElementById("extra30").checked = false;
                                        document.getElementById("extra50").checked = false;
                                        document.getElementById("extra100").checked = false;
                                        document.getElementById("op10").checked = false;
                                        document.getElementById("op20").checked = false;
                                        document.getElementById("op30").checked = false;
                                        document.getElementById("add1").checked = false;
                                        document.getElementById("add2").checked = false;
                                        document.getElementById("balance").value = "0.00";
                                        document.getElementById("priceWithoutTax").value = "0.00";
                                        document.getElementById("priceWithTax").value = "0.00";
                                        document.getElementById("products").value = "0";
                                        document.getElementById("nom1").value = "";
                                        document.getElementById("nom2").value = "";


                                }
                        


                                function truncateToTwoDecimals(num) {
                                        return Math.floor(num * 100) / 100;
                                }

                                function convertBytes() {
                                        // Get the input values
                                        const bytesStr1 = document.getElementById('bytesInput1').value.trim();
                                        const bytesStr2 = document.getElementById('bytesInput2').value.trim();
                                        const bytesStr3 = document.getElementById('bytesInput3').value.trim();

                                        // Initialize total bytes
                                        let totalBytes = 0;

                                        // Array to hold the input values
                                        const bytesArray = [bytesStr1, bytesStr2, bytesStr3];

                                        // Loop through the array and add up the bytes
                                        for (const bytesStr of bytesArray) {
                                                if (bytesStr) {
                                                        const bytesNum = parseFloat(bytesStr);
                                                        if (isNaN(bytesNum) || bytesNum < 0) {
                                                                document.getElementById('resultGB').innerText = 'Please enter valid positive numeric values.';
                                                                document.getElementById('resultMB').innerText = '';
                                                                return;
                                                        }
                                                        totalBytes += bytesNum;
                                                }
                                        }

                                        if (totalBytes === 0) {
                                                document.getElementById('resultGB').innerText = 'Please enter some data to convert.';
                                                document.getElementById('resultMB').innerText = '';
                                                return;
                                        }

                                        // Calculate the value in GB and MB
                                        const gbValue = truncateToTwoDecimals(totalBytes / 1024 / 1024 / 1024);
                                        const mbValue = truncateToTwoDecimals(totalBytes / 1024 / 1024);

                                        // Display the results
                                        document.getElementById('resultGB').innerText = `Total data is: ${gbValue} GB`;
                                        document.getElementById('resultMB').innerText = `Total data is: ${mbValue} MB`;
                                }

                                // Add event listeners to each input field to call convertBytes on input change
                                document.getElementById('bytesInput1').addEventListener('input', convertBytes);
                                document.getElementById('bytesInput2').addEventListener('input', convertBytes);
                                document.getElementById('bytesInput3').addEventListener('input', convertBytes);
                        


                                                                //variables
                                                                var pkg = 0;
                                                                var cp = 0;
                                                                var rq = 0;



                                                                function clearall() {

                                                                        $("#pq,#cq,#rq,#dstatus,#other_pkg").html('');
                                                                        $("#error").hide();
                                                                        renderQuotaSummary();
                                                                }



                                                                function getQuotaSummaryNodes() {
                                                                        return {
                                                                                card: document.getElementById('quotaSummaryCard'),
                                                                                packageValue: document.getElementById('quotaSummaryPackage'),
                                                                                remainingValue: document.getElementById('quotaSummaryRemaining'),
                                                                                consumedValue: document.getElementById('quotaSummaryConsumed'),
                                                                                copyBtn: document.getElementById('quotaSummaryCopyBtn')
                                                                        };
                                                                }

                                                                function getQuotaRawBytes() {
                                                                        var remainingInput = document.getElementById('bss_pkg');
                                                                        var packageLabel = document.getElementById('pq');
                                                                        var BYTES_PER_GB = 1073741824;
                                                                        var remainingBytes = Number(remainingInput && remainingInput.value ? remainingInput.value.trim() : '');
                                                                        var packageGb = Number(packageLabel && packageLabel.textContent ? packageLabel.textContent.trim() : '');

                                                                        if (!isFinite(remainingBytes) || remainingBytes < 0) remainingBytes = null;
                                                                        if (!isFinite(packageGb) || packageGb < 0) packageGb = null;

                                                                        var packageBytes = packageGb == null ? null : Math.round(packageGb * BYTES_PER_GB);
                                                                        var consumedBytes = (packageBytes == null || remainingBytes == null) ? null : Math.max(packageBytes - remainingBytes, 0);

                                                                        return {
                                                                                packageBytes: packageBytes,
                                                                                remainingBytes: remainingBytes,
                                                                                consumedBytes: consumedBytes
                                                                        };
                                                                }

                                                                function getApproximateQuotaTextFromBytes(rawBytes) {
                                                                        var numericBytes = Number(rawBytes);
                                                                        if (!isFinite(numericBytes) || numericBytes < 0) return '';

                                                                        var BYTES_PER_GB = 1073741824;
                                                                        var BYTES_PER_MB = 1048576;
                                                                        var wholeGb = Math.floor(numericBytes / BYTES_PER_GB);
                                                                        var remainingBytes = numericBytes - (wholeGb * BYTES_PER_GB);
                                                                        var megaBytes = Math.round(remainingBytes / BYTES_PER_MB);

                                                                        if (megaBytes >= 1024) {
                                                                                wholeGb += 1;
                                                                                megaBytes = 0;
                                                                        }

                                                                        if (megaBytes <= 0) return '';
                                                                        if (wholeGb <= 0) return '≈ ' + megaBytes + ' ميجا';
                                                                        return '≈ ' + wholeGb + ' جيجا و' + megaBytes + ' ميجا';
                                                                }

                                                                function roundQuotaToHundredth(value) {
                                                                        var numericValue = Number(value);
                                                                        if (!isFinite(numericValue)) return null;
                                                                        return Math.round((numericValue + Number.EPSILON) * 100) / 100;
                                                                }

                                                                function formatQuotaExactNumber(value) {
                                                                        var roundedValue = roundQuotaToHundredth(value);
                                                                        if (roundedValue == null) return '';
                                                                        if (Number.isInteger(roundedValue)) return String(roundedValue);
                                                                        return roundedValue.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
                                                                }

                                                                function getQuotaDisplayData(rawValue, approxBytes) {
                                                                        var cleanValue = String(rawValue == null ? '' : rawValue).trim();
                                                                        if (cleanValue === '') {
                                                                                return { exact: '—', approx: '', htmlText: '—' };
                                                                        }

                                                                        var numericValue = Number(cleanValue);
                                                                        if (!isFinite(numericValue)) {
                                                                                return { exact: cleanValue, approx: '', htmlText: cleanValue };
                                                                        }

                                                                        var exactNumberText = formatQuotaExactNumber(numericValue);
                                                                        var exactText = exactNumberText + ' جيجا';
                                                                        var approxText = getApproximateQuotaTextFromBytes(approxBytes);
                                                                        return { exact: exactText, approx: approxText, htmlText: exactText };
                                                                }

                                                                function setQuotaSummaryValue(targetNode, rawValue, approxBytes) {
                                                                        if (!targetNode) return;
                                                                        var displayData = getQuotaDisplayData(rawValue, approxBytes);
                                                                        targetNode.textContent = displayData.exact;
                                                                        var oldApprox = targetNode.querySelector('.quota-approx');
                                                                        if (oldApprox) oldApprox.remove();
                                                                        if (displayData.approx) {
                                                                                var approxNode = document.createElement('span');
                                                                                approxNode.className = 'quota-approx';
                                                                                approxNode.textContent = displayData.approx;
                                                                                targetNode.appendChild(approxNode);
                                                                        }
                                                                }

                                                                function getSelectedQuotaPackageName() {
                                                                        var selectedOption = document.querySelector('#pkgs option:checked');
                                                                        if (!selectedOption || selectedOption.value === 'other' || selectedOption.value === '') return 'الباقه الاساسيه';
                                                                        var quota = selectedOption.getAttribute('data-quota');
                                                                        var label = selectedOption.textContent.trim();
                                                                        if (quota) {
                                                                                label = label.replace(quota, '').trim();
                                                                        }
                                                                        return label || 'الباقه الاساسيه';
                                                                }

                                                                function buildQuotaSummaryHtml() {
                                                                        var packageText = document.getElementById('pq') ? document.getElementById('pq').textContent.trim() : '';
                                                                        var remainingText = document.getElementById('rq') ? document.getElementById('rq').textContent.trim() : '';
                                                                        var consumedText = document.getElementById('cq') ? document.getElementById('cq').textContent.trim() : '';
                                                                        var packageDisplay = getQuotaDisplayData(packageText, null).exact;
                                                                        var remainingDisplay = getQuotaDisplayData(remainingText, null).exact;
                                                                        var consumedDisplay = getQuotaDisplayData(consumedText, null).exact;
                                                                        var packageLabel = getSelectedQuotaPackageName();
                                                                        return `${packageLabel} :	${packageDisplay}<br>
المتبقى  :	${remainingDisplay}<br>
الاستهلاك  :	${consumedDisplay}`;
                                                                }

                                                                function renderQuotaSummary() {
                                                                        var nodes = getQuotaSummaryNodes();
                                                                        if (!nodes.card || !nodes.packageValue || !nodes.remainingValue || !nodes.consumedValue) return;
                                                                        var rawBytes = getQuotaRawBytes();
                                                                        var packageText = document.getElementById('pq') ? document.getElementById('pq').textContent.trim() : '';
                                                                        var remainingText = document.getElementById('rq') ? document.getElementById('rq').textContent.trim() : '';
                                                                        var consumedText = document.getElementById('cq') ? document.getElementById('cq').textContent.trim() : '';
                                                                        var hasVisibleData = packageText !== '' || remainingText !== '' || consumedText !== '';
                                                                        nodes.card.hidden = !hasVisibleData;
                                                                        if (!hasVisibleData) return;
                                                                        var packageLabelNode = nodes.packageValue.parentElement ? nodes.packageValue.parentElement.querySelector('.quota-label') : null;
                                                                        if (packageLabelNode) packageLabelNode.textContent = getSelectedQuotaPackageName();
                                                                        setQuotaSummaryValue(nodes.packageValue, packageText, null);
                                                                        setQuotaSummaryValue(nodes.remainingValue, remainingText, rawBytes.remainingBytes);
                                                                        setQuotaSummaryValue(nodes.consumedValue, consumedText, rawBytes.consumedBytes);
                                                                }

                                                                function copyQuotaSummaryHtml() {
                                                                        var htmlText = buildQuotaSummaryHtml();
                                                                        var nodes = getQuotaSummaryNodes();
                                                                        var copyBtn = nodes.copyBtn;
                                                                        function markCopied() {
                                                                                if (!copyBtn) return;
                                                                                var originalText = copyBtn.getAttribute('data-original-text') || copyBtn.textContent;
                                                                                copyBtn.setAttribute('data-original-text', originalText);
                                                                                copyBtn.textContent = 'تم النسخ';
                                                                                copyBtn.classList.add('is-copied');
                                                                                clearTimeout(copyBtn._quotaCopyTimer);
                                                                                copyBtn._quotaCopyTimer = setTimeout(function () {
                                                                                        copyBtn.textContent = originalText;
                                                                                        copyBtn.classList.remove('is-copied');
                                                                                }, 1500);
                                                                        }
                                                                        if (navigator.clipboard && navigator.clipboard.writeText) {
                                                                                navigator.clipboard.writeText(htmlText).then(markCopied).catch(function () {
                                                                                        var tempArea = document.createElement('textarea');
                                                                                        tempArea.value = htmlText;
                                                                                        document.body.appendChild(tempArea);
                                                                                        tempArea.select();
                                                                                        document.execCommand('copy');
                                                                                        document.body.removeChild(tempArea);
                                                                                        markCopied();
                                                                                });
                                                                        } else {
                                                                                var tempArea = document.createElement('textarea');
                                                                                tempArea.value = htmlText;
                                                                                document.body.appendChild(tempArea);
                                                                                tempArea.select();
                                                                                document.execCommand('copy');
                                                                                document.body.removeChild(tempArea);
                                                                                markCopied();
                                                                        }
                                                                }

                                                                function calculate(now, config) {


                                                                        var pq = (config);
                                                                        var rq = (((now / 1024) / 1024) / 1024);
                                                                        rq = (Number(Math.round(parseFloat(rq + 'e' + 2)) + 'e-' + 2));

                                                                        $("#pq").html(pq).css("color", "#D0FA58");
                                                                        $("#rq").html(rq).css("color", "#D0FA58");

                                                                        (rq > pq) ? $("#cq").html("0") : $("#cq").html(pq - rq).css("color", "#D0FA58");

                                                                        if (now != 0) {
                                                                                if (rq == 0) {
                                                                                        $("#dstatus").html("تم انتهاء الباقه ").css("color", "D0FA58");
                                                                                } else {
                                                                                        $("#dstatus").html("الباقه لم تنتهى ").css("color", "#D0FA58");
                                                                                }
                                                                        } else {
                                                                                $("#dstatus").html("").css("color", "#D0FA58");
                                                                        }
                                                                        renderQuotaSummary();
                                                                }

                                                                function bindQuotaSummaryReset() {
                                                                        var nodes = getQuotaSummaryNodes();
                                                                        var quotaForm = nodes.card && nodes.card.closest ? nodes.card.closest('form') : null;
                                                                        if (!quotaForm || quotaForm.dataset.quotaSummaryResetBound === 'true') return;
                                                                        quotaForm.dataset.quotaSummaryResetBound = 'true';
                                                                        quotaForm.addEventListener('reset', function () {
                                                                                setTimeout(function () {
                                                                                        clearall();
                                                                                        var copyBtn = getQuotaSummaryNodes().copyBtn;
                                                                                        if (copyBtn) {
                                                                                                clearTimeout(copyBtn._quotaCopyTimer);
                                                                                                copyBtn.textContent = copyBtn.getAttribute('data-original-text') || 'نسخ HTML';
                                                                                                copyBtn.classList.remove('is-copied');
                                                                                        }
                                                                                }, 0);
                                                                        });
                                                                }


                                                                function isnum(x) {
                                                                        var num = true;
                                                                        for (var i = 0; i < x.length; i++) {
                                                                                var number = (x[i]);

                                                                                if (isNaN(number) || number < 0)
                                                                                        num = false
                                                                        }
                                                                        return num;
                                                                }



                                                                $(document).ready(function () {

                                                                        // Hiding 

                                                                        $("#other_pkg,#error").hide();
                                                                        renderQuotaSummary();

                                                                        var quotaCopyBtn = document.getElementById('quotaSummaryCopyBtn');
                                                                        if (quotaCopyBtn && !quotaCopyBtn.dataset.bound) {
                                                                                quotaCopyBtn.dataset.bound = 'true';
                                                                                quotaCopyBtn.addEventListener('click', copyQuotaSummaryHtml);
                                                                        }
                                                                        bindQuotaSummaryReset();

                                                                        $("#pkgs").change(function () {

                                                                                $("#bss_pkg").val("");

                                                                                var selectedOption = $("#pkgs option:selected");
                                                                                var selected = selectedOption.text().trim();
                                                                                var selectedQuota = selectedOption.data('quota');

                                                                                console.log(selected)

                                                                                if (selected.toLowerCase() == "other") {
                                                                                        clearall();

                                                                                        $("#other_pkg").show();

                                                                                } else if (selected.toLowerCase() == "please select" || selectedOption.val() === "") {
                                                                                        $("#other_pkg").hide();

                                                                                        clearall();

                                                                                        pkg = 0;
                                                                                        cp = 0;
                                                                                        rq = 0;
                                                                                } else {
                                                                                        $("#other_pkg").hide();

                                                                                        clearall();

                                                                                        pkg = selectedQuota || selected;

                                                                                        var pq = pkg

                                                                                        $("#pq").html(pq);
                                                                                        renderQuotaSummary();


                                                                                }
                                                                        });

                                                                });

                                                                $("#other_pkg").bind("input", function () {

                                                                        clearall();

                                                                        pkg = $("#other_pkg").val().trim();

                                                                        $("#pq").html(pkg);
                                                                        renderQuotaSummary();

                                                                        $("#bss_pkg").val("");

                                                                })



                                                                $("#bss_pkg").bind("input change", function () {

                                                                        if ($(this).val().trim() != "") {

                                                                                var curr_real = $("#bss_pkg").val().trim();
                                                                                var arr = [curr_real];

                                                                                if (pkg > 0 && isnum([pkg])) {

                                                                                        if (isnum(arr)) {
                                                                                                $("#error").hide();

                                                                                                calculate(curr_real, pkg);

                                                                                        } else if (curr_real != '') {
                                                                                                $("#error").html("Please Enter valid number").show();
                                                                                                $("#rq,#dstatus").html('');
                                                                                                renderQuotaSummary();
                                                                                        }

                                                                                } else {
                                                                                        $("#error").html("Please Define CST Quota").show();
                                                                                        renderQuotaSummary();
                                                                                }

                                                                        } else {
                                                                                clearall();
                                                                        }

                                                                });
                                                        


                                                                const myDayInput = document.getElementById("myDay");
                                                                const myGInput = document.getElementById("myG");

                                                                myDayInput.addEventListener("input", () => {
                                                                        let myDays = parseFloat(myDayInput.value);
                                                                        if (!isNaN(myDays) && myDays >= 0) {
                                                                                let result = myDays * 1024 * 1024 * 1024;
                                                                                myGInput.value = result.toString();
                                                                        } else {
                                                                                myGInput.value = "";
                                                                        }
                                                                });
                                                        


                                                                function clearDorm() {
                                                                        window.location.href = window.location.pathname;

                                                                }
                                                        


                                                                        //variables
                                                                        var speed = 0;
                                                                        var method = '';
                                                                        var current = 0;



                                                                        function clear() {
                                                                                $("#reall,#manual").find("input").each(function () {

                                                                                        $(this).val('');

                                                                                });

                                                                                $("#minn,#maxx,#current,#dstattus").html('');
                                                                                $("#error").hide();
                                                                        }

                                                                        function clearboth() {
                                                                                $("#reall,#manual").find("input").each(function () {

                                                                                        $(this).val('');

                                                                                });

                                                                                $("#current,#dstattus").html('');
                                                                                $("#error").hide();
                                                                        }



                                                                        function calculatee(now, config) {


                                                                                var minn = config * 0.078125;
                                                                                var maxx = config * 0.1171875;

                                                                                $("#minn").html(minn);
                                                                                $("#maxx").html(maxx);
                                                                                $("#currentt").html(now);

                                                                                if (now != 0) {
                                                                                        if (now >= minn) {
                                                                                                $("#dstattus").html("Accepted").css("color", "green");
                                                                                        } else if (now < minn) {
                                                                                                $("#dstattus").html("Not Accepted").css("color", "red");
                                                                                        }
                                                                                } else {
                                                                                        $("#dstattus").html("");
                                                                                }
                                                                        }


                                                                        function isnum(x) {
                                                                                var num = true;
                                                                                for (var i = 0; i < x.length; i++) {
                                                                                        var number = (x[i]);

                                                                                        if (isNaN(number) || number < 0)
                                                                                                num = false
                                                                                }
                                                                                return num;
                                                                        }



                                                                        $(document).ready(function () {

                                                                                // Hiding 

                                                                                $("#other_speed,#reall,#manual,#error").hide();



                                                                                $("#speeds").change(function () {

                                                                                        var selected = $("#speeds").val();

                                                                                        if (selected == "other") {
                                                                                                clear();

                                                                                                $("#other_speed").show();

                                                                                        } else if (selected == "please select") {
                                                                                                $("#other_speed").hide();

                                                                                                clear();
                                                                                        } else {
                                                                                                $("#other_speed").hide();

                                                                                                clear();

                                                                                                speed = selected;

                                                                                                var minn = speed * 0.078125;
                                                                                                var maxx = speed * 0.1171875;

                                                                                                $("#minn").html(minn);
                                                                                                $("#maxx").html(maxx);;

                                                                                        }
                                                                                });

                                                                        });

                                                                        $("#other_speed").bind("change", function () {

                                                                                clear();

                                                                                speed = $("#other_speed").val().trim();

                                                                                var minn = speed * 0.078125;
                                                                                var maxx = speed * 0.1171875;

                                                                                $("#minn").html(minn);
                                                                                $("#maxx").html(maxx);


                                                                        })



                                                                        $('#ry,#rn').change(function () {

                                                                                clearboth();
                                                                                $("#reall,#manual,#error").hide();


                                                                                var tool = $("#tool input[type='radio']:checked").attr("id");


                                                                                if (tool == "rn") {
                                                                                        method = "manual";
                                                                                        $("#reall").hide();
                                                                                        $("#manual").show();
                                                                                } else {
                                                                                        method = "reall";
                                                                                        $("#manual").hide();
                                                                                        $("#reall").show();
                                                                                }


                                                                        });






                                                                        $("#assia_speed").bind("change keypress keyup paste", function () {


                                                                                if (method == "reall") {
                                                                                        var curr_reall = $("#assia_speed").val().trim();
                                                                                        var arr = [curr_reall];

                                                                                        if (speed > 0 && isnum([speed])) {
                                                                                                if (isnum(arr)) {
                                                                                                        $("#error").hide();

                                                                                                        current = curr_reall / 8;

                                                                                                        calculatee(current, speed);

                                                                                                } else if (curr_reall != '') {
                                                                                                        $("#error").html("Please Enter valid number").show();
                                                                                                        $("#current,#dstattus").html('');
                                                                                                }

                                                                                        } else {
                                                                                                $("#error").html("Please Define the configured speed").show();

                                                                                        }

                                                                                }
                                                                        });






                                                                        $("#f1,#f2,#f3").bind("change keypress keyup paste", function () {

                                                                                if (method == "manual") {
                                                                                        var f1 = $("#f1").val().trim();
                                                                                        var f2 = $("#f2").val().trim();
                                                                                        var f3 = $("#f3").val().trim();

                                                                                        var total = [];


                                                                                        if (f1 != '') total.push(f1);
                                                                                        if (f2 != '') total.push(f2);
                                                                                        if (f3 != '') total.push(f3);


                                                                                        if (speed > 0 && isnum([speed])) {

                                                                                                if (isnum(total)) {
                                                                                                        $("#error").hide();

                                                                                                        var curr_total = 0;

                                                                                                        for (var i = 0; i < total.length; i++) {
                                                                                                                curr_total = curr_total + parseFloat(total[i]);

                                                                                                        }


                                                                                                        current = curr_total;

                                                                                                        calculatee(current, speed);

                                                                                                } else if (total.length != 0) {
                                                                                                        $("#error").html("Please Enter valid numbers").show();
                                                                                                        $("#current,#dstattus").html('');
                                                                                                }

                                                                                        } else {
                                                                                                $("#error").html("Please Define the configured speed").show();

                                                                                        }
                                                                                }
                                                                        });
                                                                


                        function openCity(evt, cityName) {
                                var i, tabcontent, tablinks;
                                tabcontent = document.getElementsByClassName("tabcontent");
                                for (i = 0; i < tabcontent.length; i++) {
                                        tabcontent[i].style.display = "none";
                                }
                                tablinks = document.getElementsByClassName("tablinks");
                                for (i = 0; i < tablinks.length; i++) {
                                        tablinks[i].className = tablinks[i].className.replace(" active", "");
                                }
                                document.getElementById(cityName).style.display = "block";
                                evt.currentTarget.className += " active";
                                const root = document.getElementById(cityName);
                                root.setAttribute('aria-busy', 'true');
                                window.__srCatalog.mountTab(cityName).catch(() => {})
                                        .finally(() => root.removeAttribute('aria-busy'));
                        }
                


                        // Lightweight direct access for the existing CPE Config view.
                        // The CPE markup/data stays in the canonical SR catalog; this only selects
                        // that existing tab when /index.html?view=cpe-config opens in a new tab.
                        function isolateStandaloneToolView(panel) {
                                var existing = document.getElementById("standaloneToolViewport");
                                if (existing) {
                                        existing.appendChild(panel);
                                        return;
                                }

                                var bodyStyle = window.getComputedStyle(document.body);
                                var viewport = document.createElement("div");
                                viewport.id = "standaloneToolViewport";
                                viewport.setAttribute("data-standalone-tool", panel.id || "tool");

                                var backgroundColor = bodyStyle.backgroundColor;
                                if (!backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent") {
                                        backgroundColor = "#000";
                                }

                                [
                                        ["position", "fixed"],
                                        ["inset", "0"],
                                        ["z-index", "calc(var(--sr-layer-admin, 12000) + 1000)"],
                                        ["overflow", "auto"],
                                        ["box-sizing", "border-box"],
                                        ["display", "block"],
                                        ["visibility", "visible"],
                                        ["opacity", "1"],
                                        ["margin", "0"],
                                        ["padding", "0"],
                                        ["background-color", backgroundColor],
                                        ["background-image", bodyStyle.backgroundImage],
                                        ["background-repeat", bodyStyle.backgroundRepeat],
                                        ["background-position", bodyStyle.backgroundPosition],
                                        ["background-size", bodyStyle.backgroundSize],
                                        ["background-attachment", bodyStyle.backgroundAttachment]
                                ].forEach(function (entry) {
                                        viewport.style.setProperty(entry[0], entry[1], "important");
                                });

                                panel.classList.add("standalone-tool-panel");
                                panel.style.setProperty("display", "block", "important");
                                panel.style.setProperty("margin-top", "0", "important");
                                viewport.appendChild(panel);
                                document.body.appendChild(viewport);

                                document.documentElement.style.setProperty("overflow", "hidden", "important");
                                document.body.style.setProperty("overflow", "hidden", "important");

                                // Keep the standalone viewport visually above any late runtime UI
                                // without deleting or disconnecting the main tool DOM underneath.
                                if (window.MutationObserver) {
                                        var observer = new MutationObserver(function () {
                                                if (!viewport.isConnected) {
                                                        document.body.appendChild(viewport);
                                                        return;
                                                }
                                                if (document.body.lastElementChild !== viewport) {
                                                        document.body.appendChild(viewport);
                                                }
                                                viewport.style.setProperty("display", "block", "important");
                                                viewport.style.setProperty("visibility", "visible", "important");
                                        });
                                        observer.observe(document.body, { childList: true });
                                        window.__standaloneToolViewportObserver = observer;
                                }
                        }

                        function openRequestedToolView() {
                                var view = new URLSearchParams(window.location.search).get("view");
                                var requested = view === "cpe-config"
                                        ? { panelId: "CPE Config", cityName: "CPE Config" }
                                        : view === "option-pack"
                                                ? { panelId: "GSM", cityName: "GSM" }
                                                : null;
                                if (!requested) return;

                                var panel = document.getElementById(requested.panelId);
                                if (!panel) return;

                                window.__srLastOpenCity = requested.cityName;
                                var proxyTab = document.createElement("button");
                                proxyTab.className = "tablinks";
                                openCity({ currentTarget: proxyTab }, requested.cityName);
                                isolateStandaloneToolView(panel);
                                window.scrollTo(0, 0);
                        }

                        if (document.readyState === "loading") {
                                document.addEventListener("DOMContentLoaded", openRequestedToolView, { once: true });
                        } else {
                                openRequestedToolView();
                        }


                        //Get the button
                        var mybutton = document.getElementById("myBtn");
                        // When the user scrolls down 20px from the top of the document, show the button
                        window.onscroll = function () {
                                scrollFunction()
                        };

                        function scrollFunction() {
                                if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
                                        mybutton.style.display = "block";
                                } else {
                                        mybutton.style.display = "none";
                                }
                        }

                        // When the user clicks on the button, scroll to the top of the document
                        function topFunction() {
                                document.body.scrollTop = 0;
                                document.documentElement.scrollTop = 0;
                        }
                


                        function mndoWeOneHomeActive() {
                                return window.__mndoWeOneHomeMode === true;
                        }

                        function mndoWeOneHomeLandlineNumber() {
                                var landline = ((document.getElementById("arabicNumber") || {}).value || "").trim();
                                if (landline) return landline.replace(/^FBB\s*/i, "").trim();

                                var fbb = ((document.getElementById("arabiccNumber") || {}).value || "").trim();
                                return fbb.replace(/^FBB\s*/i, "").trim();
                        }


                        function openLink(event) {
                                event.preventDefault(); //منع فتح الرابط الأصلي والذهاب إلى الرابط الذي يتم إنشاؤه بدلا من ذلك
                                var link = event.target.href; //الحصول على رابط العنصر الذي تم النقر عليه
                                var oneHomeMode = mndoWeOneHomeActive();
                                var myVariable = oneHomeMode
                                        ? mndoWeOneHomeLandlineNumber()
                                        : (document.getElementById("arabiccNumber").value || "").trim(); // إنشاء المتغير
                                if (!oneHomeMode && !myVariable) {
                                        var adslForFbb = ((document.getElementById("arabicNumber") || {}).value || "").trim().replace(/\D/g, "");
                                        if (adslForFbb) myVariable = "FBB" + adslForFbb;
                                }
                                // Special case: SR Technical - BLQ → BLQ CPE Problem (srTypeId=102040017)
                                // This SR requires subsNumber to be populated before BMEWebToken to open correctly.
                                // Replace the subsNumber parameter with the full FBB value and do NOT append it at the end.
                                if (link && link.indexOf("srTypeId=102040017") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)[^&]*/i, "$1" + myVariable);
                                        myVariable = "";
                                }
                                // Special case: SR Sales - Payment Not Clear → Aggregators Payment Within SLA (srTypeId=103010007)
                                // This SR requires subsNumber to be populated before BMEWebToken to open correctly.
                                // Replace the subsNumber parameter with the full FBB value and do NOT append it at the end.
                                if (link && link.indexOf("srTypeId=103010007") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)[^&]*/i, "$1" + myVariable);
                                        myVariable = "";
                                }
                                // Special case: SR Sales - Payment Not Clear → Aggregators Payment After SLA (srTypeId=103010008)
                                // This SR requires subsNumber to be populated before BMEWebToken to open correctly.
                                // Replace the subsNumber parameter with the full FBB value and do NOT append it at the end.
                                if (link && link.indexOf("srTypeId=103010008") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)[^&]*/i, "$1" + myVariable);
                                        myVariable = "";
                                }
                                // Special case: SR Technical - Wireless Problem → No WLAN detected-CPE Configuration (srTypeId=102002061)
                                // Some SR templates come with subsNumber as ADSL only (e.g., 23123) even when the intended value is FBB23123.
                                // For this SR, replace the subsNumber parameter with the full value (including the FBB prefix) and do NOT append it at the end.
                                if (link && link.indexOf("srTypeId=102002061") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)[^&]*/i, "$1" + myVariable);
                                        myVariable = "";
                                }
                                // Special case: SR Sales - Recharge By Mistake (srTypeId=100034005)
                                // This SR needs the subsNumber value in the first (middle) parameter to populate ADSL Number correctly.
                                if (link && link.indexOf("srTypeId=100034005") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)FBB(&BMEWebToken=)/, "$1" + myVariable + "$2");
                                }
                                // Special case: SR Technical - Outage -> Proactive maintenance notification (srTypeId=102094003)
                                // This SR needs the subsNumber value before BMEWebToken to populate ADSL Number correctly.
                                // Do NOT append the number at the end.
                                if (link && link.indexOf("srTypeId=102094003") !== -1) {
                                        link = link.replace(/([?&]subsNumber=)(&BMEWebToken=)/, "$1" + myVariable + "$2");
                                        myVariable = "";
                                }
                                // Special case: SR Sales - Refund - the amount to the card → Refund bank within SLA (srTypeId=103038004)
if (link && link.indexOf("srTypeId=103038004") !== -1) {
        link = link.replace(/([?&]subsNumber=)[^&]*/i, "$1" + myVariable);
        myVariable = "";
}
if (link && link.indexOf("srTypeId=100047001") !== -1) {
                                        var fbbAdslNumber = (document.getElementById("arabicNumber").value || "").trim();
                                        var fbbServiceContent = "FBB Num (" + fbbAdslNumber + ") Accepted (3) GB for (2) days related tts - outage - ir  id (xxx) on mobile (xxx) ";
                                        link = link.replace(/([?&]serviceContent=)[^&]*/i, "$1" + encodeURIComponent(fbbServiceContent));
                                }
if (link && link.indexOf("srTypeId=100047021") !== -1) {
                                        var fbbAdslNumber = (document.getElementById("arabicNumber").value || "").trim();
                                        var fbbServiceContent = "FBB Num (" + fbbAdslNumber + ") Accepted (3) GB for (5) days related Zero SELT tts  id (xxx) on mobile (xxx) ";
                                        link = link.replace(/([?&]serviceContent=)[^&]*/i, "$1" + encodeURIComponent(fbbServiceContent));
                                }

                                link += myVariable; // إضافة المتغير إلى الرابط
                                try {
                                        window.open(link); // Open with the ONE value already resolved, if enabled.
                                } finally {
                                        // ONE affects only this SR; the following SR uses the default FBB logic.
                                        // Also disarm if the browser blocks/throws during the open attempt.
                                        if (oneHomeMode && typeof window.__mndoConsumeWeOneHomeMode === "function") {
                                                window.__mndoConsumeWeOneHomeMode();
                                        }
                                }
                        }
                


                        function openLinkk(event) {
                                event.preventDefault(); // منع فتح الرابط الأصلي
                                var link = event.target.href; // رابط العنصر
                                var myVariable = (document.getElementById("arabicNumber").value || "").trim(); // الرقم

                                // استبدال 222 بالرقم لو موجودة
                                if (/([?&]subsNumber=)222\b/.test(link)) {
                                        link = link.replace(/([?&]subsNumber=)222\b/, '$1' + encodeURIComponent(myVariable));
                                }
                                // لو subsNumber فاضي (subsNumber=) ضيف الرقم بعد =
                                else if (/([?&]subsNumber=)$/.test(link)) {
                                        link = link + encodeURIComponent(myVariable);
                                }
                                // لو مفيش subsNumber خالص، ضيفه
                                else if (!/[?&]subsNumber=/.test(link)) {
                                        link = link + (link.indexOf('?') === -1 ? '?' : '&') + 'subsNumber=' + encodeURIComponent(myVariable);
                                }

                                window.open(link, "_blank");
                        }
                


                        window.onload = function () {
                                document.addEventListener("contextmenu", function (e) {
                                        e.preventDefault();
                                }, false);
                                document.addEventListener("keydown", function (e) {
                                        //document.onkeydown = function(e) {
                                        // "I" key
                                        if (e.ctrlKey && e.shiftKey && e.keyCode == 73) {
                                                disabledEvent(e);
                                        }
                                        // "J" key
                                        if (e.ctrlKey && e.shiftKey && e.keyCode == 74) {
                                                disabledEvent(e);
                                        }
                                        // "S" key + macOS
                                        if (e.keyCode == 83 && (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey)) {
                                                disabledEvent(e);
                                        }
                                        // "U" key
                                        if (e.ctrlKey && e.keyCode == 85) {
                                                disabledEvent(e);
                                        }
                                        // "F12" key
                                        if (event.keyCode == 123) {
                                                disabledEvent(e);
                                        }
                                }, false);

                                function disabledEvent(e) {
                                        if (e.stopPropagation) {
                                                e.stopPropagation();
                                        } else if (window.event) {
                                                window.event.cancelBubble = true;
                                        }
                                        e.preventDefault();
                                        return false;
                                }
                        }
                


                        document.onkeypress = function (event) {
                                event = (event || window.event);
                                if (event.keyCode == 123) {
                                        return false;
                                }
                        }
                        document.onmousedown = function (event) {
                                event = (event || window.event);
                                if (event.keyCode == 123) {
                                        return false;
                                }
                        }
                        document.onkeydown = function (event) {
                                event = (event || window.event);
                                if (event.keyCode == 123) {
                                        return false;
                                }
                        }
                


                        // تعيين النص المحدد مسبقًا لكل زر
                        const text1 = " R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب \n Ping 192.168.1.1 هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده   \n Enter بعد كده هتضغط  \n هيظهر امام حضرتك اربع سطور تحت بعض ممكن توضحلى اول كلمه فى الاربع سطور ؟ ";

                        const text2 = "R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه  \n CMD هنكتب \n Ping 192.168.1.1 –t هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده  \n Enter بعد كده هتضغط  \n بعد كده هتنتظر حضرتك 60 ثانيه وتضغط فى الكيبورد زر كنترول مع حرف c \n وهستأذن حضرتك تبعتلى اسكرين شوت من الى هيظهرلك على اللينك ده ";
                        const text3 = " R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب \n Ping google.com هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده    \n Enter بعد كده هتضغط  \n وهستأذن حضرتك تبعتلى اسكرين شوت من الى هيظهرلك على اللينك ده ";
                        const text4 = " R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب \n Ping 172.217.19.142 هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده   \n Enter بعد كده هتضغط  \n وهستأذن حضرتك تبعتلى اسكرين شوت من الى هيظهرلك على اللينك ده ";
                        const text5 = "R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب \n Netstat -n –o هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده   \n Enter بعد كده هتضغط  \n وهستأذن حضرتك تبعتلى اسكرين شوت من الى هيظهرلك على اللينك ده  ";





                        const text6 = "R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب \n Tracert google.com هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده   \n Enter بعد كده هتضغط   \n وهستأذن حضرتك تبعتلى اسكرين شوت من الى هيظهرلك على اللينك ده  ";

                        const text7 = " R حاليا هستأذن حضرتك نضغط علي علامه الويندوز و حرف ال \n RUN هتظهر لحضرتك قائمه \n CMD هنكتب  \n ipconfig/flushdns  هتظهر شاشه لونها اسود ممكن نكتب فيها الامر ده   \n Enter بعد كده هتضغط  \n successfully flushed the DNS Resolver Cache   هى دى النتيجه الى ظهرت لحضرتك ولا لا يا فندم ؟  ";

                        const button1 = document.getElementById("button1");
                        const button2 = document.getElementById("button2");
                        const button3 = document.getElementById("button3");
                        const button4 = document.getElementById("button4");
                        const button5 = document.getElementById("button5");
                        const button6 = document.getElementById("button6");
                        const button7 = document.getElementById("button7");


                        // الحصول على عنصر الإشعار باستخدام الـ ID
                        const notification = document.getElementById("notification");

                        // إضافة معالج الحدث لكل زر
                        button1.addEventListener("click", function () {
                                copyToClipboard1(text1, button1);
                        });

                        button2.addEventListener("click", function () {
                                copyToClipboard1(text2, button2);
                        });

                        button3.addEventListener("click", function () {
                                copyToClipboard1(text3, button3);
                        });

                        button4.addEventListener("click", function () {
                                copyToClipboard1(text4, button4);
                        });

                        button5.addEventListener("click", function () {
                                copyToClipboard1(text5, button5);
                        });
                        button6.addEventListener("click", function () {
                                copyToClipboard1(text6, button6);
                        });
                        button7.addEventListener("click", function () {
                                copyToClipboard1(text7, button7);
                        });

                        // دالة النسخ إلى الحافظة
                        function copyToClipboard1(text, button) {
                                navigator.clipboard.writeText(text)
                                        .then(() => {
                                                console.log(`تم نسخ النص: ${text}`);
                                                // إظهار رسالة الإشعار وتخفيفها تدريجيًا بعد فترة زمنية محددة
                                                notification.textContent = " copied successfully ";
                                                notification.style.opacity = 1;
                                                setTimeout(function () {
                                                        notification.style.opacity = 0;
                                                }, 1000);
                                        })
                                        .catch((error) => {
                                                console.error(`حدث خطأ: ${error}`);
                                        });
                        }
                


                


                        const notification3 = document.getElementById("notification3");


                        function copyToClipboard(element) {
                                var $temp = $("<input>");
                                $("body").append($temp);
                                $temp.val($(element).text()).select();
                                document.execCommand("copy");
                                $temp.remove();




                                notification3.textContent = " copied successfully ";
                                notification3.style.opacity = 1;
                                setTimeout(function () {
                                        notification3.style.opacity = 0;
                                }, 1000);

                        }
                


                                                        function convertNumber() {
                                                                // Get the input value
                                                                var arabicNumber = document.getElementById("arabicNumber").value;

                                                                // Map the Arabic numbers to English numbers
                                                                var numbers = {
                                                                        '٠': '0',
                                                                        '١': '1',
                                                                        '٢': '2',
                                                                        '٣': '3',
                                                                        '٤': '4',
                                                                        '٥': '5',
                                                                        '٦': '6',
                                                                        '٧': '7',
                                                                        '٨': '8',
                                                                        '٩': '9'
                                                                };
                                                                //٠٤٤٤٤٤٤٤

                                                                var englishNumber = arabicNumber.replace(/[٠-٩]/g, function (match) {
                                                                        return numbers[match];
                                                                });

                                                                // Display the English number
                                                                var hasFBB = /fbb/i.test(englishNumber);
                                                                var digitsOnly = (englishNumber || "").replace(/\D/g, "");

                                                                var fbbInput = document.getElementById("arabiccNumber");
                                                                document.getElementById("arabicNumber").value = digitsOnly;
                                                                if (digitsOnly !== "") {
                                                                        fbbInput.value = "FBB" + digitsOnly;
                                                                } else {
                                                                        /*
                                                                          ADSL Number is empty: keep number With FBB free for manual entry.
                                                                          Do not clear or overwrite the top field while the user is typing there.
                                                                        */
                                                                        try {
                                                                                fbbInput.readOnly = false;
                                                                                fbbInput.removeAttribute("readonly");
                                                                                fbbInput.setAttribute("aria-readonly", "false");
                                                                                fbbInput.style.cursor = "text";
                                                                        } catch (err) {}
                                                                }
                                                        }
                                                        // برمجه الانبوت الخاص بالرقم 
                                                        function removeLeadingZero() {
                                                                const arabicNumber = document.getElementById("arabicNumber");

                                                                let numberValue = arabicNumber.value;

                                                                // إزالة كل الحروف (عربية وإنجليزية) والرموز، والاحتفاظ بالأرقام فقط (عربية + إنجليزية)
                                                                numberValue = numberValue.replace(/[^\d\u0660-\u0669]/g, '');

                                                                // إزالة الأصفار الأولية سواء كانت 0 (إنجليزي) أو ٠ (عربي)
                                                                while (/^[0\u0660]/.test(numberValue)) {
                                                                        numberValue = numberValue.substring(1);
                                                                }

                                                                // تحديث القيمة في input
                                                                arabicNumber.value = numberValue;
                                                        }

                                                


                                                                                                // ✅ دالة لتطبيع النص (إزالة الأحرف غير المرئية وتوحيد المسافات)
                                                                                                const normalizeText = str => str
                                                                                                        .toLowerCase()
                                                                                                        .replace(/[\u200B-\u200D\uFEFF]/g, '') // إزالة الأحرف غير المرئية
                                                                                                        .replace(/\s+/g, ' ')                  // تحويل المسافات المتعددة إلى واحدة
                                                                                                        .trim();

                                                                                                // ✅ يظهر في البحث روابط التنفيذ الحقيقية فقط، وليس عناوين القوائم الداخلية.
                                                                                                // هذا يمنع ظهور مسارات مثل: Fixed Voice - Billing - ... داخل مربع البحث.
                                                                                                const isRealSearchResultLink = link => {
                                                                                                        if (!link || link.classList.contains('no-search')) return false;
                                                                                                        if (link.closest && link.closest('#searchResults')) return false;

                                                                                                        const rawHref = (link.getAttribute('href') || '').trim();
                                                                                                        if (!rawHref || rawHref === '#' || rawHref.charAt(0) === '#') return false;
                                                                                                        if (/^javascript\s*:/i.test(rawHref)) return false;

                                                                                                        // روابط الهيدر/القوائم الداخلية يكون بعدها sub-dropdown-content وليست SR حقيقي.
                                                                                                        if (link.nextElementSibling && link.nextElementSibling.classList && link.nextElementSibling.classList.contains('sub-dropdown-content')) return false;

                                                                                                        return true;
                                                                                                };

                                                                                                const searchInput = document.getElementById('searchInput');
                                                                                                const searchResults = document.getElementById('searchResults');

                                                                // 🌿 Compute a human‑readable path (tab → section → sub‑section) for a given link
                                                                function getLinkPath(link) {
                                                                        // Find the tab content that wraps this link
                                                                        let tab = link.closest('.tabcontent');
                                                                        let tabName = '';
                                                                        if (tab) {
                                                                                tabName = tab.getAttribute('id') || '';
                                                                                tabName = tabName.trim();
                                                                        }
                                                                        // Find the nearest dropdown button that precedes this link
                                                                        let dropText = '';
                                                                        const dropdown = link.closest('.dropdown');
                                                                        if (dropdown) {
                                                                                const btn = dropdown.querySelector('button.dropbtn');
                                                                                if (btn) {
                                                                                        // Extract only the button’s text without icons
                                                                                        dropText = (btn.childNodes[0] ? btn.childNodes[0].textContent : btn.textContent).trim();
                                                                                }
                                                                        }
                                                                        // Find a sub‑header (previous sibling with class no-search) if inside a sub‑dropdown
                                                                        let header = '';
                                                                        const sub = link.closest('.sub-dropdown-content');
                                                                        if (sub && sub.previousElementSibling && sub.previousElementSibling.classList.contains('no-search')) {
                                                                                header = sub.previousElementSibling.textContent.trim();
                                                                        }
                                                                        // Assemble the path segments, skipping empty ones
                                                                        const segments = [];
                                                                        if (tabName) segments.push(tabName);
                                                                        if (dropText) segments.push(dropText);
                                                                        if (header) segments.push(header);
                                                                        return segments.join(' - ');
                                                                }



// Search keeps the full matching set in catalog order, but only draws one page.
const SR_SEARCH_PAGE_SIZE = 50;
let srSearchIndex = null;
let srSearchFrame = 0;
let srSearchMatches = [];
let srSearchPage = 0;
let srSearchRequest = 0;

function getSearchIndex() {
  if (!srSearchIndex) {
    const data = window.__srCatalog.peek();
    if (!data?.compatibilityNormalized) throw new Error('SR search normalization is not ready.');
    // Entries retain identical path strings instead of thousands of separately
    // constructed copies. This temporary pool is released after index creation.
    const paths = new Map();
    srSearchIndex = Array.from(data.doc.querySelectorAll(
      '.dropdown-content a, .sub-dropdown-content a, a#singlelink, a[href*="BMEBusiness=srNewSrPage"]'
    )).filter(isRealSearchResultLink).map(link => {
      const label = (link.textContent || '').trim();
      const path = getLinkPath(link);
      if (!paths.has(path)) paths.set(path, path);
      return { link, label, normalized: normalizeText(label), path: paths.get(path) };
    });
  }
  return srSearchIndex;
}
window.addEventListener('sr:catalog-labels-changed', event => {
  if (!event.detail?.changedLinks) { srSearchIndex = null; return; }
  for (const entry of srSearchIndex || []) {
    if (event.detail.changedLinks.includes(entry.link)) {
      entry.label = (entry.link.textContent || '').trim();
      entry.normalized = normalizeText(entry.label);
    }
  }
});
async function waitForSearchNormalization() {
  const data = await window.__srCatalog.get();
  if (!data.compatibilityNormalized) {
    await new Promise((resolve, reject) => {
      const cleanup = () => window.removeEventListener('sr:catalog-normalized', normalized);
      const normalized = () => { cleanup(); resolve(); };
      const failed = error => { cleanup(); reject(error); };
      window.addEventListener('sr:catalog-normalized', normalized, { once: true });
      window.__srCompatibilityReady?.catch(failed);
    });
  }
}
window.addEventListener('sr:catalog-ready', () => {
  waitForSearchNormalization().then(getSearchIndex).catch(() => {});
});

function setSearchVisible(visible) {
  searchResults.style.display = visible ? 'block' : 'none';
  searchInput.setAttribute('aria-expanded', String(visible));
}

function renderSearchPage(focusPage = false) {
  const fragment = document.createDocumentFragment();
  const start = srSearchPage * SR_SEARCH_PAGE_SIZE;
  const end = Math.min(start + SR_SEARCH_PAGE_SIZE, srSearchMatches.length);
  if (srSearchMatches.length > SR_SEARCH_PAGE_SIZE) {
    const controls = document.createElement('nav');
    controls.className = 'sr-search-pagination';
    controls.setAttribute('dir', 'rtl');
    controls.setAttribute('aria-label', 'صفحات نتائج البحث');
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    const range = document.createElement('bdi');
    range.dir = 'ltr';
    range.textContent = (start + 1) + '–' + end;
    const total = document.createElement('bdi');
    total.textContent = String(srSearchMatches.length);
    status.append(range, ' من ', total);
    function pageButton(label, delta, disabled) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.dataset.srSearchPage = String(delta);
      button.setAttribute('aria-label', label + ' من نتائج البحث');
      button.addEventListener('click', (event) => {
        // The pager is replaced below. Do not let its detached button look like
        // an outside click to the document's dismiss handler.
        event.stopPropagation();
        // Ignore stale controls while a newer input is waiting for its frame.
        if (srSearchFrame) return;
        const next = srSearchPage + delta;
        if (next < 0 || next * SR_SEARCH_PAGE_SIZE >= srSearchMatches.length) return;
        srSearchPage = next;
        renderSearchPage(true);
      });
      return button;
    }
    controls.append(pageButton('السابق', -1, start === 0), status,
      pageButton('التالي', 1, end >= srSearchMatches.length));
    fragment.appendChild(controls);
  }
  for (let i = start; i < end; i += 1) {
    const entry = srSearchMatches[i];
    const resultLink = document.createElement('a');
    resultLink.href = entry.link.href;
    resultLink.textContent = entry.label;
    if (entry.path === undefined) entry.path = getLinkPath(entry.link);
    resultLink.title = entry.path ? (entry.path + ' → ' + entry.label) : entry.label;
    resultLink.onclick = function (e) {
      e.preventDefault();
      // Import only the selected action so its existing inline handler executes
      // in this document, preserving openLink/openLinkk and target semantics.
      document.importNode(entry.link, true).click();
    };
    resultLink.classList.add('highlight');
    fragment.appendChild(resultLink);
  }
  searchResults.replaceChildren(fragment);
  searchResults.scrollTop = 0;
  setSearchVisible(srSearchMatches.length > 0);
  if (focusPage) searchResults.querySelector('a')?.focus({ preventScroll: true });
}

async function renderSearchResults(searchTerm) {
  const request = ++srSearchRequest;
  try {
    await waitForSearchNormalization();
  } catch (error) {
    if (request === srSearchRequest && normalizeText(searchInput.value) === searchTerm) {
      searchResults.textContent = "تعذّر تحميل القوائم. أعد فتح التول.";
      setSearchVisible(true);
    }
    return;
  }
  if (request !== srSearchRequest || normalizeText(searchInput.value) !== searchTerm) return;
  srSearchMatches = getSearchIndex().filter(entry => entry.normalized.includes(searchTerm));
  srSearchPage = 0;
  renderSearchPage();
}

searchInput.setAttribute('aria-label', 'البحث عن SR');
searchInput.setAttribute('aria-controls', 'searchResults');
searchInput.setAttribute('aria-expanded', 'false');
searchResults.setAttribute('aria-label', 'نتائج البحث');

searchInput.addEventListener('input', function () {
  const searchTerm = normalizeText(this.value);
  if (srSearchFrame) {
    cancelAnimationFrame(srSearchFrame);
    srSearchFrame = 0;
  }
  if (searchTerm === '') {
    srSearchRequest += 1;
    srSearchMatches = [];
    srSearchPage = 0;
    searchResults.replaceChildren();
    setSearchVisible(false);
    return;
  }
  srSearchFrame = requestAnimationFrame(function () {
    srSearchFrame = 0;
    renderSearchResults(searchTerm);
  });
});

function dismissSearchResults() {
  srSearchRequest += 1;
  if (srSearchFrame) cancelAnimationFrame(srSearchFrame);
  srSearchFrame = 0;
  setSearchVisible(false);
}

document.addEventListener('click', function (e) {
  if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
    dismissSearchResults();
  }
});

searchInput.addEventListener('focus', function () {
  if (this.value.trim() !== '' && srSearchMatches.length) setSearchVisible(true);
});

searchInput.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown' && srSearchMatches.length && !srSearchFrame) {
    e.preventDefault();
    setSearchVisible(true);
    searchResults.querySelector('a')?.focus({ preventScroll: true });
  } else if (e.key === 'Escape') {
    dismissSearchResults();
  }
});

searchResults.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    searchInput.focus({ preventScroll: true });
    dismissSearchResults();
    return;
  }
  if (srSearchFrame || !e.target.matches('a') ||
      (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  const links = Array.from(searchResults.querySelectorAll('a'));
  const index = links.indexOf(e.target);
  const next = index + (e.key === 'ArrowDown' ? 1 : -1);
  e.preventDefault();
  if (links[next]) links[next].focus();
  else if (next < 0) searchInput.focus({ preventScroll: true });
  else searchResults.querySelector('[data-sr-search-page="1"]:not(:disabled)')?.focus();
});

// Geometry listeners are installed once, including newly mounted submenus.
function srMenuTrigger(menu) {
  if (menu.matches('.dropdown')) return menu.querySelector(':scope > button.dropbtn');
  return Array.from(menu.children).find(child =>
    child.matches('a') && child.nextElementSibling?.classList.contains('sub-dropdown-content')
  ) || null;
}

function setSrMenuOpen(menu, open) {
  menu.classList.toggle('open', open);
  if (!open) menu.classList.remove('active');
  menu.classList.toggle('sr-menu-dismissed', !open);
  srMenuTrigger(menu)?.setAttribute('aria-expanded', String(open));
  if (!open) {
    menu.querySelectorAll('.sub-dropdown.open, .sub-dropdown.active').forEach(subMenu => {
      subMenu.classList.remove('open', 'active');
      subMenu.classList.add('sr-menu-dismissed');
      srMenuTrigger(subMenu)?.setAttribute('aria-expanded', 'false');
    });
  }
}

function closeSrMenus(except) {
  document.querySelectorAll('.dropdown.open, .dropdown.active, .sub-dropdown.open, .sub-dropdown.active')
    .forEach(menu => {
      if (except && (menu === except || menu.contains(except))) return;
      setSrMenuOpen(menu, false);
    });
}

function srMenuUsesClick(event) {
  return event.detail === 0 || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
}

function releaseSrMenuDismissal(event) {
  for (let menu = event.target?.closest?.('.sub-dropdown, .dropdown'); menu;
       menu = menu.parentElement?.closest('.sub-dropdown, .dropdown')) {
    menu.classList.remove('sr-menu-dismissed');
  }
}

document.querySelectorAll('.dropdown > button.dropbtn').forEach(button => {
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
});
document.querySelectorAll('.sub-dropdown > a').forEach(link => {
  if (link.nextElementSibling?.classList.contains('sub-dropdown-content')) {
    link.setAttribute('aria-expanded', 'false');
  }
});

document.addEventListener('click', event => {
  const button = event.target?.closest?.('.dropdown > button.dropbtn');
  if (button && srMenuUsesClick(event)) {
    event.preventDefault();
    const dropdown = button.parentElement;
    const open = !dropdown.classList.contains('open');
    closeSrMenus(dropdown);
    setSrMenuOpen(dropdown, open);
    return;
  }

  const link = event.target?.closest?.('.sub-dropdown > a');
  const subMenu = link?.nextElementSibling;
  if (link && subMenu?.classList.contains('sub-dropdown-content')) {
    event.preventDefault();
    if (srMenuUsesClick(event)) {
      const dropdown = link.parentElement;
      const open = !dropdown.classList.contains('open');
      closeSrMenus(dropdown);
      setSrMenuOpen(dropdown, open);
    }
    return;
  }

  if (!event.target?.closest?.('.dropdown')) closeSrMenus();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openMenu = document.querySelector('.dropdown.open, .sub-dropdown.open');
  if (!openMenu) return;
  event.preventDefault();
  const trigger = srMenuTrigger(openMenu);
  closeSrMenus();
  if (trigger) {
    trigger.focus({ preventScroll: true });
    trigger.closest('.sub-dropdown, .dropdown')?.classList.add('sr-menu-dismissed');
  }
});

document.addEventListener('pointerover', releaseSrMenuDismissal, true);
document.addEventListener('focusin', releaseSrMenuDismissal, true);

function bindSrDropdownGeometry(root) {
  const dropdown = root.querySelector('.dropdown');
  if (dropdown && !dropdown.__srGeometryBound) {
    dropdown.__srGeometryBound = true;
    dropdown.__srUpdateGeometry = () => {
      const content = dropdown.querySelector('.dropdown-content');
      if (!content) return;
      content.classList.remove('open-left');
      if (content.getBoundingClientRect().right > window.innerWidth) content.classList.add('open-left');
    };
    dropdown.addEventListener('mouseenter', dropdown.__srUpdateGeometry);
  }
  root.querySelectorAll('.sub-dropdown').forEach(subDropdown => {
    if (subDropdown.__srGeometryBound) return;
    subDropdown.__srGeometryBound = true;
    subDropdown.addEventListener('mouseenter', () => {
      const subMenu = subDropdown.querySelector('.sub-dropdown-content');
      if (!subMenu) return;
      subMenu.classList.remove('open-left');
      if (subMenu.getBoundingClientRect().right > window.innerWidth) subMenu.classList.add('open-left');
    });
  });
}
bindSrDropdownGeometry(document);
window.addEventListener('sr:catalog-prepared', event => bindSrDropdownGeometry(event.detail.root));
window.addEventListener('sr:catalog-mounted', () => {
  const dropdown = document.querySelector('.dropdown');
  if (dropdown?.matches(':hover')) dropdown.__srUpdateGeometry?.();
});

                                                        const numStars = 200; // legacy decoration only
                                                        const body = document.body;
                                                        let legacyStarsCreated = false;

                                                        function legacyStarsNeeded() {
                                                                const root = document.documentElement;
                                                                if (!root || root.classList.contains('mndo-low-power')) return false;
                                                                if (root.classList.contains('egypt-worldcup-theme-live')) return false;
                                                                if (root.classList.contains('ahly-premium-theme-live')) return false;
                                                                return true;
                                                        }

                                                        function ensureLegacyStars() {
                                                                if (legacyStarsCreated || !legacyStarsNeeded()) return;
                                                                legacyStarsCreated = true;
                                                                const fragment = document.createDocumentFragment();

                                                                for (let i = 0; i < numStars; i++) {
                                                                        const star = document.createElement('div');
                                                                        star.className = 'star';
                                                                        star.style.left = Math.random() * 100 + 'vw';
                                                                        star.style.top = Math.random() * 100 + 'vh';
                                                                        star.style.opacity = Math.random();
                                                                        fragment.appendChild(star);
                                                                }
                                                                body.appendChild(fragment);
                                                        }

                                                        ensureLegacyStars();
                                                        if (!legacyStarsCreated && window.MutationObserver) {
                                                                const themeObserver = new MutationObserver(function () {
                                                                        ensureLegacyStars();
                                                                        if (legacyStarsCreated) themeObserver.disconnect();
                                                                });
                                                                themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
                                                        }

                                                        // إزالة القمر بعد انتهاء الحركة
                                                        const moon = document.querySelector('.moon');
                                                        if (moon) {
                                                                moon.addEventListener('animationend', () => {
                                                                        moon.style.display = 'none';
                                                                }, { once: true });
                                                        }
                                                


                                                        function splitNumbers() {
                                                                const input1 = document.getElementById("arabicNumber");
                                                                const input2 = document.getElementById("input2");
                                                                const input3 = document.getElementById("input3");
                                                                
                                                                // Safety guard: some pages may not include input2/input3.
                                                                if (!input1 || !input2 || !input3) {
                                                                        return;
                                                                }
let numberValue = input1.value;

                                                                // Get the value of input1
                                                                const value = input1.value.trim();

                                                                // Check if the value is empty
                                                                if (value === "") {
                                                                        input2.value = "";
                                                                        input3.value = "";
                                                                        return;
                                                                }

                                                                // Determine the number of digits to take based on the condition
                                                                let numDigits = 1;
                                                                if (value.startsWith("2") || value.startsWith("3")) {
                                                                        numDigits = 1;
                                                                } else {
                                                                        numDigits = 2;
                                                                }

                                                                // Get the first digit(s) from the value
                                                                const firstDigits = value.slice(0, numDigits);

                                                                // Get the rest of the digits from the value
                                                                const restOfDigits = value.slice(numDigits);

                                                                // Set the first digit(s) to input2 and the rest of the digits to input3
                                                                input2.value = firstDigits;
                                                                input3.value = restOfDigits;
                                                        }

                                                        document.getElementById("arabicNumber").addEventListener("input", splitNumbers);
                                                


                                                        var arabicNumber = document.querySelector('#arabicNumber');
                                                        var copyBtn1 = document.querySelector('#copyBtn1');
                                                        var copyNotification = document.querySelector('#copyNotification');

                                                        copyBtn1.addEventListener('click', function () {
                                                                arabicNumber.select(); /* تحديد نص الإدخال */
                                                                document.execCommand('copy'); /* نسخ النص المحدد */
                                                                copyNotification.style.display = 'inline-block'; /* إظهار الاشعار */
                                                                setTimeout(function () {
                                                                        copyNotification.classList.add('fade-out'); /* تطبيق الانتقال التدريجي للإخفاء */
                                                                        setTimeout(function () {
                                                                                copyNotification.style.display = 'none'; /* إخفاء الاشعار بعد انتهاء الانتقال التدريجي */
                                                                                copyNotification.classList.remove('fade-out'); /* إعادة تعيين قيمة الفصل الدرجي (animation) إلى القيمة الأصلية */
                                                                        }, 1000); /* مدة الانتقال التدريجي */
                                                                }, 1000); /* مدة عرض الاشعار */
                                                        });
                                                


                                                        var arabiccNumber = document.querySelector('#arabiccNumber');
                                                        var copyBtn = document.querySelector('#copyBtn');
                                                        var copyNotification1 = document.querySelector('#copyNotification1');

                                                        copyBtn.addEventListener('click', function () {
                                                                arabiccNumber.select(); /* تحديد نص الإدخال */
                                                                document.execCommand('copy'); /* نسخ النص المحدد */
                                                                copyNotification1.style.display = 'inline-block'; /* إظهار الاشعار */
                                                                setTimeout(function () {
                                                                        copyNotification1.classList.add('fade-out'); /* تطبيق الانتقال التدريجي للإخفاء */
                                                                        setTimeout(function () {
                                                                                copyNotification1.style.display = 'none'; /* إخفاء الاشعار بعد انتهاء الانتقال التدريجي */
                                                                                copyNotification1.classList.remove('fade-out'); /* إعادة تعيين قيمة الفصل الدرجي (animation) إلى القيمة الأصلية */
                                                                        }, 1000); /* مدة الانتقال التدريجي */
                                                                }, 1000); /* مدة عرض الاشعار */
                                                        });
                                                
// Provide stub for move1 used by onmousemove attribute in HTML
if (typeof move1 !== "function") {
  function move1() {
    // no operation
  }
}

// Tags overlay moved to public/features/tags-overlay-v11.js (v11 intent-loaded).
// -----------------------------------------------------------------------------
// Additional converters for the Mobile section
// These functions replicate the behaviour of the standalone converter tool
// provided by the company. They convert between Bytes and Megabytes and
// calculate net and tax-inclusive balances. The logic uses the same
// conversion factors as the provided tool: 1 MB = 1024*1024 Bytes and
// a tax multiplier of 1.4286 for converting between net and tax-inclusive
// amounts. These functions are invoked from the HTML via button onclick
// attributes in the Mobile tab.

function performByteMbConversion() {
  const inputEl = document.getElementById('convertDataInput');
  const typeEl = document.getElementById('convertDataType');
  const resultEl = document.getElementById('convertDataResult');
  if (!inputEl || !typeEl || !resultEl) return;

  const inputValue = parseFloat(inputEl.value);
  if (isNaN(inputValue) || inputValue < 0) {
    resultEl.innerText = 'الرجاء إدخال رقم موجب صالح.';
    return;
  }

  const type = typeEl.value;
  if (type === 'byteToMb') {
    const mb = (inputValue / (1024 * 1024)).toFixed(4);
    resultEl.innerText = `متبقى معاك ${mb} ميجا`;
  } else {
    const bytes = Math.round(inputValue * 1024 * 1024);
    resultEl.innerText = `متبقى معاك ${bytes} بايت`;
  }
}

function performBalanceConversion() {
  const inputEl = document.getElementById('balanceInputMobile');
  const typeEl = document.getElementById('balanceTypeMobile');
  const resultEl = document.getElementById('balanceResultMobile');
  if (!inputEl || !typeEl || !resultEl) return;

  const inputValue = parseFloat(inputEl.value);
  if (isNaN(inputValue) || inputValue < 0) {
    resultEl.innerText = 'الرجاء إدخال رقم موجب صالح.';
    return;
  }

  // Company policy conversion factor (approx 42.86% tax)
  const factor = 1.4286;
  const type = typeEl.value;

  if (type === 'netToTotal') {
    const total = (inputValue * factor).toFixed(2);
    resultEl.innerText = `الرصيد شامل الضريبة سيكون ${total} جنيه`;
  } else {
    const net = (inputValue / factor).toFixed(2);
    resultEl.innerText = `الرصيد صافي سيكون ${net} جنيه`;
  }
}




/* Call Back OCR is owned by public/features/callback-ocr-v11.js
   and loaded through the v11 feature registry on user intent. */

;/* Device intelligence is event-driven only.
Login/account bridge enrolls or validates devices. No page-load Worker learning call. */

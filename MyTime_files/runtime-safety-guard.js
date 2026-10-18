/*
  My Time Runtime Safety Guard v11
  Targeted critical-DOM protection with no network calls and no document-wide
  perpetual observer. Critical nodes are watched at their actual parent boundary.
*/
(function(){
  "use strict";

  if(window.__SR_RUNTIME_SAFETY_GUARD_V11) return;
  window.__SR_RUNTIME_SAFETY_GUARD_V11 = true;

  var VERSION = "20260924-architecture-v11";
  var warnings = [];
  var protectedNodes = Object.create(null);
  var parentObservers = new Map();
  var urgentTickerObserver = null;
  var lateScanTimer = 0;

  var CORE_SCRIPT_ORDER = [
    "app.js",
    "haya-karima-smart-helper.js",
    "safe-tool-upgrade.js",
    "outage-by-mail.js",
    "admin-message-client.js",
    "runtime-safety-guard.js",
    "bootstrap-v11.js"
  ];

  var CRITICAL_IDS = [
    "arabicNumber",
    "arabiccNumber",
    "copyBtn",
    "copyBtn1",
    "tabs",
    "MNDO_UA07_LOGO3",
    "UA07_SECRET_ENVELOPE",
    "UA07_SECRET_MODAL",
    "adminOverlay",
    "adminTabAnnouncements",
    "SR_URGENT_TICKER",
    "SR_URGENT_MARQUEE",
    "SR_URGENT_VOICE_STATUS",
    "SR_URGENT_ACK"
  ];

  function now(){ return new Date().toISOString(); }

  function warn(code, detail){
    var item = { time:now(), code:code, detail:String(detail || "") };
    warnings.push(item);
    if(warnings.length > 80) warnings.shift();
    try{ console.warn("[SR Safety Guard]", code, detail || ""); }catch{}
  }

  function connected(node){
    if(!node) return false;
    if(typeof node.isConnected === "boolean") return node.isConnected;
    return !!document.documentElement?.contains(node);
  }

  function createElement(tag, id, className, text){
    var el = document.createElement(tag);
    if(id) el.id = id;
    if(className) el.className = className;
    if(typeof text === "string") el.textContent = text;
    return el;
  }

  function restoreRecord(rec){
    if(!rec?.el) return false;
    if(connected(rec.el)) return true;
    if(!rec.parent || !connected(rec.parent)) return false;
    try{
      var next = rec.next && rec.next.parentNode === rec.parent ? rec.next : null;
      rec.parent.insertBefore(rec.el, next);
      warn("restored-critical-node", rec.id);
      return true;
    }catch(error){
      warn("restore-failed", rec.id + ": " + String(error?.message || error));
      return false;
    }
  }

  function watchParent(parent){
    if(!parent || parentObservers.has(parent) || !window.MutationObserver) return;
    try{
      var observer = new MutationObserver(function(){
        for(var id in protectedNodes){
          var rec = protectedNodes[id];
          if(rec?.parent === parent && !connected(rec.el)) restoreRecord(rec);
        }
      });
      observer.observe(parent, { childList:true });
      parentObservers.set(parent, observer);
    }catch(error){
      warn("parent-observer-failed", error?.message || error);
    }
  }

  function rememberNode(id){
    var el = document.getElementById(id);
    if(!el) return false;
    var current = protectedNodes[id];
    if(current?.el === el){
      restoreRecord(current);
      return true;
    }
    var rec = {
      id:id,
      el:el,
      parent:el.parentNode || null,
      next:el.nextSibling || null,
    };
    protectedNodes[id] = rec;
    watchParent(rec.parent);
    return true;
  }

  function ensureUrgentTicker(){
    var wrap = document.getElementById("SR_URGENT_TICKER");
    if(!wrap) return;

    rememberNode("SR_URGENT_TICKER");

    var bar = wrap.querySelector(".sr-urgent-bar");
    var marquee = document.getElementById("SR_URGENT_MARQUEE");
    var ack = document.getElementById("SR_URGENT_ACK");
    var status = document.getElementById("SR_URGENT_VOICE_STATUS");

    if(!bar){
      bar = createElement("div", "", "sr-urgent-bar", "");
      try{ wrap.insertBefore(bar, wrap.firstChild || null); }catch{ wrap.appendChild(bar); }
      warn("recreated-urgent-bar", "sr-urgent-bar");
    }
    if(!marquee){
      marquee = createElement("div", "SR_URGENT_MARQUEE", "sr-urgent-marquee", "");
      bar.appendChild(marquee);
      warn("recreated-urgent-marquee", "SR_URGENT_MARQUEE");
    }
    if(!ack){
      ack = createElement("button", "SR_URGENT_ACK", "sr-urgent-ack", "فهمت");
      ack.type = "button";
      ack.onclick = function(){
        var ticker = document.getElementById("SR_URGENT_TICKER");
        if(ticker) ticker.style.display = "none";
      };
      bar.appendChild(ack);
      warn("recreated-urgent-ack", "SR_URGENT_ACK");
    }
    if(!status){
      status = createElement("div", "SR_URGENT_VOICE_STATUS", "", "");
      status.style.cssText = "font-size:11px;opacity:.9;margin:4px 8px 0";
      wrap.appendChild(status);
      warn("recreated-urgent-voice-status", "SR_URGENT_VOICE_STATUS");
    }

    rememberNode("SR_URGENT_MARQUEE");
    rememberNode("SR_URGENT_ACK");
    rememberNode("SR_URGENT_VOICE_STATUS");

    try{
      var active = !!wrap.dataset?.urgentActiveKey;
      var hasText = !!String(marquee.textContent || "").replace(/\s+/g, "");
      if(wrap.style.display && wrap.style.display !== "none" && wrap.style.display !== "block"){
        wrap.style.display = "block";
      }else if(wrap.style.display === "" && (active || hasText)){
        wrap.style.display = "block";
      }
    }catch{}

    if(!urgentTickerObserver && window.MutationObserver){
      try{
        urgentTickerObserver = new MutationObserver(function(){ ensureUrgentTicker(); });
        urgentTickerObserver.observe(wrap, { childList:true });
      }catch(error){
        warn("urgent-observer-failed", error?.message || error);
      }
    }
  }

  function checkDuplicateCriticalIds(){
    for(var i = 0; i < CRITICAL_IDS.length; i += 1){
      var id = CRITICAL_IDS[i];
      var count = 0;
      try{ count = document.querySelectorAll('[id="' + id + '"]').length; }catch{}
      if(count > 1) warn("duplicate-critical-id", id + " x" + count);
    }
  }

  function scriptName(src){
    var clean = String(src || "").split("#")[0].split("?")[0];
    var parts = clean.split("/");
    return parts[parts.length - 1] || clean;
  }

  function checkScriptOrder(){
    var scripts = Array.from(document.scripts || []).map(function(node){
      return scriptName(node.getAttribute("src") || "");
    }).filter(Boolean);

    var last = -1;
    for(var i = 0; i < CORE_SCRIPT_ORDER.length; i += 1){
      var expected = CORE_SCRIPT_ORDER[i];
      var idx = scripts.indexOf(expected);
      if(idx === -1){
        warn("missing-core-script", expected);
        continue;
      }
      if(idx < last) warn("core-script-order-risk", expected);
      last = idx;
    }
  }

  function scan(){
    for(var i = 0; i < CRITICAL_IDS.length; i += 1) rememberNode(CRITICAL_IDS[i]);
    ensureUrgentTicker();
    checkDuplicateCriticalIds();
    if(window.__SR_SAFE_STATUS__) window.__SR_SAFE_STATUS__.lastCheck = now();
  }

  function boot(){
    window.__SR_SAFE_STATUS__ = {
      version:VERSION,
      warnings:warnings,
      protectedNodes:protectedNodes,
      parentObservers:parentObservers,
      lastCheck:"",
      check:scan,
    };

    scan();
    checkScriptOrder();

    // Bounded late scans only; no document-wide observer and no perpetual timer.
    setTimeout(scan, 900);
    lateScanTimer = setTimeout(scan, 3200);
  }

  window.addEventListener("pagehide", function(){
    if(lateScanTimer) clearTimeout(lateScanTimer);
    parentObservers.forEach(function(observer){ try{ observer.disconnect(); }catch{} });
    parentObservers.clear();
    try{ urgentTickerObserver?.disconnect(); }catch{}
    urgentTickerObserver = null;
  }, { once:true });

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  }else{
    boot();
  }
})();

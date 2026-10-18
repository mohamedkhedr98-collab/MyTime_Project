/* Event-driven DOM readiness broker.
 * Shared runtime primitive for legacy modules that may mount after app startup.
 * Replaces high-frequency startup polling with one MutationObserver.
 */
(function(){
  "use strict";
  if(window.__srWaitForDom) return;

  var waiters = new Set();
  var observer = null;
  var flushQueued = false;

  function stopIfIdle(){
    if(waiters.size || !observer) return;
    observer.disconnect();
    observer = null;
  }

  function finish(entry){
    if(!entry || !waiters.has(entry)) return;
    waiters.delete(entry);
    if(entry.timeoutId) clearTimeout(entry.timeoutId);
    stopIfIdle();
  }

  function flush(){
    flushQueued = false;
    Array.from(waiters).forEach(function(entry){
      var ready = false;
      try{ ready = !!entry.test(); }catch(_){}
      if(ready) finish(entry);
    });
    stopIfIdle();
  }

  function scheduleFlush(){
    if(flushQueued) return;
    flushQueued = true;
    if(typeof queueMicrotask === "function") queueMicrotask(flush);
    else Promise.resolve().then(flush);
  }

  function ensureObserver(){
    if(observer || !document.documentElement) return;
    observer = new MutationObserver(scheduleFlush);
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }

  window.__srWaitForDom = function(test, timeoutMs){
    if(typeof test !== "function") return function(){};
    try{ if(test()) return function(){}; }catch(_){}

    var entry = {test:test, timeoutId:0};
    waiters.add(entry);
    ensureObserver();

    entry.timeoutId = setTimeout(function(){ finish(entry); }, Math.max(1000, Number(timeoutMs) || 12000));
    return function(){ finish(entry); };
  };

  window.addEventListener("pagehide", function(event){
    if(event.persisted) return;
    Array.from(waiters).forEach(finish);
    if(observer) observer.disconnect();
    observer = null;
  });
})();

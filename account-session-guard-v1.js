// Realtime is a wake-up hint, never authority to log a user out. This guard
// checks the browser's current HttpOnly lease so SR/MyTime on the winner stay open.
export function installAccountSessionGuard(){
  if(window.__srAccountSessionGuard) return window.__srAccountSessionGuard;
  let pending=null,leaving=false,recheck=false;
  function check(options = {}){
    if(leaving) return pending;
    if(pending){recheck=recheck || options.force === true;return pending;}
    pending=(async()=>{
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try{
        const response=await fetch("/api/account/session-status",{
          credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"},
          signal:controller.signal,
        });
        const state=await response.json().catch(()=>({}));
        if(response.status!==401 || !state.session_revoked) return;
        leaving=true;
        const target="/login?"+(state.session_transferred ? "session_transferred" : "session_expired")+"=1";
        // Replace a same-origin wrapper as well as the tool iframe.
        try{
          if(window.top.location.origin===window.location.origin){window.top.location.replace(target);return;}
        }catch{}
        window.location.replace(target);
      }catch{}finally{ clearTimeout(timeout); }
    })().finally(()=>{
      pending=null;
      // A push arriving while an earlier check was in flight must not get lost.
      if(recheck){recheck=false;check();}
    });
    return pending;
  }
  window.addEventListener("sr:account-updated",()=>check({force:true}));
  window.addEventListener("pageshow",check);
  window.addEventListener("online",check);
  window.addEventListener("focus",check);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible") check();});
  window.__srAccountSessionGuard={check};
  return window.__srAccountSessionGuard;
}

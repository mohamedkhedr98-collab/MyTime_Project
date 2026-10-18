const VERSION = "20261005-catalog-fast-start-v1";
const RETRY_DELAYS = [350, 900];
let installPromise = null;

async function status(){
  const res = await fetch("/api/sr-admin-access", {
    method:"POST",
    credentials:"same-origin",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ action:"status" }),
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error("SR admin access check failed");
  return data?.authorized ? data : null;
}

function installStyles(){
  if(document.getElementById("srScopedAdminEntryStyles")) return;
  const style = document.createElement("style");
  style.id = "srScopedAdminEntryStyles";
  style.textContent = `
    .sr-scope-fab{border:1px solid rgba(111,190,255,.35)!important;background:linear-gradient(180deg,rgba(45,126,210,.96),rgba(29,88,157,.96))!important;color:#fff!important}
    .sr-scope-fab[data-sr-access="loading"]{opacity:.76!important;cursor:progress!important}
    .sr-scope-fab[data-sr-access="retry"]{opacity:.9!important;cursor:pointer!important}
    .sr-scope-overlay{position:fixed;inset:0;z-index:2147483645;background:radial-gradient(900px 520px at 14% 8%,rgba(42,126,226,.18),transparent 62%),radial-gradient(760px 480px at 88% 16%,rgba(68,218,181,.10),transparent 60%),rgba(2,7,15,.82);backdrop-filter:blur(18px) saturate(130%);display:grid;place-items:center;padding:12px}
    .sr-scope-shell{position:relative;width:min(1220px,calc(100vw - 24px));height:min(900px,calc(100dvh - 24px));border:0;border-radius:24px;overflow:hidden;background:transparent;box-shadow:none}
    .sr-scope-frame{width:100%;height:100%;border:0;background:transparent}
    .sr-scope-close{position:absolute;z-index:3;top:16px;right:20px;width:34px;height:34px;border-radius:11px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.035);color:#9fb5cc;font-size:20px;line-height:1;cursor:pointer;box-shadow:none}
    .sr-scope-close:hover{border-color:rgba(116,181,243,.25);background:rgba(255,255,255,.065);color:#eef7ff}
  `;
  document.head.appendChild(style);
}

function openWorkspace(){
  installStyles();
  let overlay = document.getElementById("srScopedAdminOverlay");
  if(!overlay){
    overlay = document.createElement("div");
    overlay.id = "srScopedAdminOverlay";
    overlay.className = "sr-scope-overlay";
    overlay.innerHTML = '<div class="sr-scope-shell"><button class="sr-scope-close" type="button" aria-label="Close">×</button><iframe class="sr-scope-frame" title="SR Management" src="/sr-admin-workspace.html?v=' + VERSION + '"></iframe></div>';
    document.body.appendChild(overlay);
    const close = ()=>{ overlay.style.display = "none"; };
    overlay.querySelector(".sr-scope-close")?.addEventListener("click", close);
    overlay.addEventListener("click", (event)=>{ if(event.target === overlay) close(); });
  }
  overlay.style.display = "grid";
}

function ensureButton(){
  let button=document.getElementById("srScopedAdminFab");
  if(button)return button;
  const host=document.querySelector(".floating-actions");
  if(!host)return null;
  installStyles();
  button=document.createElement("button");
  button.id="srScopedAdminFab";
  button.className="support-fab sr-scope-fab";
  button.type="button";
  button.textContent="SR Admin…";
  button.title="Checking SR Management access";
  button.dataset.srAccess="loading";
  button.setAttribute("aria-busy","true");
  button.addEventListener("click",()=>{
    if(button.dataset.srAccess==="ready")openWorkspace();
    else ensureInstall({force:true,showPending:true});
  });
  host.prepend(button);
  return button;
}

function setReady(button){
  if(!button)return;
  button.dataset.srAccess="ready";
  button.textContent="SR Admin";
  button.title="Scoped SR Management";
  button.removeAttribute("aria-busy");
}

function setRetry(button){
  if(!button)return;
  button.dataset.srAccess="retry";
  button.textContent="SR Admin ↻";
  button.title="تعذر التحقق مؤقتًا — اضغط لإعادة المحاولة";
  button.removeAttribute("aria-busy");
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function checkAccess(force){
  if(!force&&window.__srAdminAccessWarm){
    const warm=window.__srAdminAccessWarm;
    try{return await warm;}finally{
      if(window.__srAdminAccessWarm===warm)window.__srAdminAccessWarm=null;
    }
  }
  return status();
}

async function ensureInstall({force=false,showPending=true}={}){
  const existing=document.getElementById("srScopedAdminFab");
  if(existing?.dataset?.srAccess==="ready")return true;
  if(installPromise)return installPromise;

  const button=showPending?ensureButton():existing;
  if(button&&showPending){
    button.dataset.srAccess="loading";
    button.textContent="SR Admin…";
    button.title="Checking SR Management access";
    button.setAttribute("aria-busy","true");
  }

  const task=(async()=>{
    let explicitDenied=false;
    for(let attempt=0;attempt<=RETRY_DELAYS.length;attempt++){
      try{
        const access=await checkAccess(force||attempt>0);
        if(!access){explicitDenied=true;break;}
        setReady(button||ensureButton());
        return true;
      }catch(_){
        if(attempt<RETRY_DELAYS.length)await sleep(RETRY_DELAYS[attempt]);
      }
    }
    const current=document.getElementById("srScopedAdminFab");
    if(explicitDenied){current?.remove();return false;}
    setRetry(current||ensureButton());
    return false;
  })();

  installPromise=task;
  task.finally(()=>{if(installPromise===task)installPromise=null;});
  return task;
}

window.__srEnsureSrAdminEntry=ensureInstall;
ensureInstall();

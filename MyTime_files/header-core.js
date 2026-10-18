/* SR Header Core v3.1 — structural header behavior, no theme ownership duplication. */
(function(){
  "use strict";
  if(window.__srHeaderCore)return;

  const modes=["ivory","ivoryDark","eid","legacy","ahly","egypt","off"];
  const WORK_HELPER_URL="https://mytime.wk07.workers.dev/sr-pip-connect";
  const WORK_HELPER_ORIGIN="https://mytime.wk07.workers.dev";
  const WORK_HELPER_FALLBACK_TARGET="mndo-mytime-work-helper-v2";
  // Only these reviewed static bytes have an anonymous same-origin proxy path.
  // All other MyTime assets and APIs retain the existing session checks.
  const WORK_HELPER_PIP_ASSET="/mytime/assets/sr-pip-bridge.7ecaf4a579cf.js";
  const WORK_HELPER_PIP_INTEGRITY="sha384-FjzLmT/zrjPmz5xTOJxyd2XdzFvRKakueJnwGQM8hBemJZ23LZAcvQ5+RoO4xYpI";
  const WORK_HELPER_SNAPSHOT_KEY="mndo_mytime_sr_pip_snapshot_v1";
  // A valid reply is the readiness acknowledgement. Allow slow login/app startup;
  // retry only messages to the known helper, never network requests or endless polling.
  const WORK_HELPER_SNAPSHOT_RETRY_DELAYS=[450,1100,2200,4500,8000,15000,30000];
  const HEADER_UTILITY_STYLE_ID="srHeaderUtilityDockLink";
  const HEADER_UTILITY_STYLE_HREF="./header-utility-dock.css?v=20261009-desktop-dock-center-v2";
  const HEADER_UTILITY_COLLAPSE_KEY="mndo_header_utility_collapsed_v2";
  let switching=false;
  let workHelperWindow=null;
  let workHelperSnapshot=null;
  let pipBridgePromise=null;
  let snapshotRetryTimers=[];
  // Local counters only. Never retain message contents, credentials or URLs.
  const pipConnection={opens:0,openFailures:0,requests:0,sendFailures:0,replies:0,rejectedSource:0,rejectedPayload:0,library:"idle"};

  function controller(){return window.__srThemeController||null;}
  function mode(){
    const c=controller();
    return c&&typeof c.getMode==="function"
      ? c.getMode()
      : (document.documentElement.dataset.srVisualTheme||"ivory");
  }
  function update(){
    const current=mode();
    const logo=document.getElementById("MNDO_HEADER_BRAND_LOGO");
    if(logo){
      const isIvory=current==="ivory";
      const isIvoryDark=current==="ivoryDark";
      const usesMyTimeLogo=isIvory||isIvoryDark;
      const nextSrc=usesMyTimeLogo?logo.dataset.ivorySrc:logo.dataset.defaultSrc;
      if(nextSrc&&logo.getAttribute("src")!==nextSrc)logo.setAttribute("src",nextSrc);
      logo.alt=usesMyTimeLogo?"mytime.":"UWK07";
    }
    const btn=document.getElementById("EID_TOGGLE_BTN");
    if(!btn)return !!logo;
    btn.dataset.themeMode=current;
    btn.setAttribute("aria-pressed",current==="off"?"false":"true");
    const titles={
      ivory:"الثيم العاجي الذهبي مفعل - اضغط لتشغيل الدارك الذهبي",
      ivoryDark:"الدارك الذهبي مفعل - اضغط لتشغيل ثيم العيد",
      eid:"ثيم العيد مفعل - اضغط لتشغيل ثيم الزمالك 20",
      legacy:"ثيم الزمالك 20 مفعل - اضغط لتشغيل ثيم الأهلي الفاخر",
      ahly:"ثيم الأهلي الفاخر مفعل - اضغط لتشغيل ثيم مصر كأس العالم",
      egypt:"ثيم مصر كأس العالم مفعل - اضغط لإيقاف الثيم",
      off:"الثيم متوقف - اضغط لتشغيل الثيم العاجي الذهبي"
    };
    const title=titles[current]||titles.ivory;
    btn.title=title;
    btn.setAttribute("aria-label",title);
    return true;
  }
  function next(){
    const current=mode(),index=modes.indexOf(current);
    return modes[(index+1+modes.length)%modes.length];
  }
  function warmNext(){
    const c=controller();
    if(c&&typeof c.preload==="function")c.preload(next()).catch(()=>{});
  }
  async function switchTheme(event){
    event.preventDefault();
    event.stopPropagation();
    if(switching)return;
    const c=controller();
    if(!c||typeof c.setMode!=="function")return;
    const btn=document.getElementById("EID_TOGGLE_BTN");
    switching=true;
    if(btn){btn.disabled=true;btn.setAttribute("aria-busy","true");}
    try{
      await c.setMode(next());
    }catch(_){
      update();
    }finally{
      switching=false;
      if(btn){btn.disabled=false;btn.removeAttribute("aria-busy");}
      update();
    }
  }
  function bindBreakPresentation(){
    const breakBtn=document.getElementById("breakAlarmButton");
    if(!document.getElementById("mndoBreakContrastStyle")){
      const link=document.createElement("link");
      link.id="mndoBreakContrastStyle";
      link.rel="stylesheet";
      link.href="./work-break-alarm-menu-contrast.css?v=20261001-contrast-v1";
      (document.head||document.documentElement).appendChild(link);
    }
    if(!breakBtn||breakBtn.dataset.srBreakPresentationBound==="1")return;
    breakBtn.dataset.srBreakPresentationBound="1";
    const advertiseWake=()=>{
      if(breakBtn.getAttribute("aria-pressed")==="true")return;
      const title="Break Alarm • 15 / 30 • Wake Lock: الشاشة تفضل شغالة أثناء البريك";
      breakBtn.title=title;
      breakBtn.setAttribute("aria-label",title);
    };
    breakBtn.addEventListener("pointerenter",advertiseWake,{passive:true});
    breakBtn.addEventListener("focus",advertiseWake,{passive:true});
    queueMicrotask(advertiseWake);
  }
  function workHelperOwner(){
    try{
      if(window.top&&window.top!==window){
        void window.top.location.href;
        return window.top;
      }
    }catch(_){}
    return window;
  }
  function workHelperTarget(owner){
    try{
      const key="mndo_mytime_owner_id_v1";
      let id=owner.sessionStorage.getItem(key);
      if(!id){
        const raw=owner.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
        id=String(raw).replace(/[^a-z0-9_-]/gi,"").slice(0,48);
        owner.sessionStorage.setItem(key,id);
      }
      return "mndo-mytime-work-helper-"+id;
    }catch(_){
      return WORK_HELPER_FALLBACK_TARGET;
    }
  }
  function helperUrl(){
    try{const u=new URL(WORK_HELPER_URL);u.searchParams.set("srOrigin",location.origin);return u.toString();}catch(_){return WORK_HELPER_URL;}
  }
  function helperToast(message,tone="warn"){
    let box=document.getElementById("MNDO_WORK_HELPER_NOTICE");
    if(!box){
      box=document.createElement("div");
      box.id="MNDO_WORK_HELPER_NOTICE";
      box.setAttribute("role","status");
      box.style.cssText="position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483600;max-width:min(520px,calc(100vw - 30px));padding:9px 14px;border-radius:11px;border:1px solid rgba(245,197,95,.36);background:rgba(12,20,31,.96);color:#f4dfaa;font:700 13px/1.45 'Segoe UI',Tahoma,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.34);direction:rtl;text-align:center;pointer-events:none;opacity:0;transition:opacity .16s ease";
      document.body.appendChild(box);
    }
    box.textContent=message;
    box.style.color=tone==="bad"?"#ffb0b7":tone==="ok"?"#9ce4c4":"#f4dfaa";
    box.style.opacity="1";
    clearTimeout(box.__mndoTimer);
    box.__mndoTimer=setTimeout(()=>{box.style.opacity="0";},3200);
  }
  function validSnapshot(snapshot){
    return !!snapshot&&Array.isArray(snapshot.combos)&&Number.isFinite(Number(snapshot.updatedAt||0));
  }
  function saveSnapshot(snapshot){
    if(!validSnapshot(snapshot))return false;
    workHelperSnapshot=snapshot;
    try{localStorage.setItem(WORK_HELPER_SNAPSHOT_KEY,JSON.stringify(snapshot));}catch(_){}
    try{window.MyTimeSrPip?.setSnapshot?.(snapshot);}catch(_){}
    const pip=document.getElementById("MNDO_WORK_HELPER_PIP");
    if(pip){pip.dataset.ready="1";pip.title="فتح عايم MyTime — اختصارات + تصوير + تايمر (بدون Break)";}
    return true;
  }
  function loadSnapshot(){
    if(validSnapshot(workHelperSnapshot))return workHelperSnapshot;
    try{
      const parsed=JSON.parse(localStorage.getItem(WORK_HELPER_SNAPSHOT_KEY)||"null");
      if(validSnapshot(parsed)){workHelperSnapshot=parsed;return parsed;}
    }catch(_){}
    return null;
  }
  function requestSnapshot(ref=workHelperWindow){
    if(!ref||ref!==workHelperWindow||ref.closed)return false;
    try{ref.postMessage({type:"MNDO_SR_PIP_SNAPSHOT_REQUEST"},WORK_HELPER_ORIGIN);pipConnection.requests++;return true;}catch(_){pipConnection.sendFailures++;return false;}
  }
  function pipConnectionReport(){
    let helper="no_window_reference";
    if(workHelperWindow){
      try{helper=workHelperWindow.closed?"closed_or_isolated":"open";}catch(_){helper="unavailable";}
    }
    // Explicit field allowlist: do not serialize Window, Error, Snapshot or storage.
    return {
      version:"sr-pip-diagnostic-v1",origin:location.origin,helper,
      snapshotReady:!!loadSnapshot(),library:window.MyTimeSrPip?"ready":pipConnection.library,
      documentPipSupported:typeof window.documentPictureInPicture?.requestWindow==="function",
      opens:pipConnection.opens,openFailures:pipConnection.openFailures,
      requests:pipConnection.requests,sendFailures:pipConnection.sendFailures,
      replies:pipConnection.replies,rejectedSource:pipConnection.rejectedSource,
      rejectedPayload:pipConnection.rejectedPayload,
    };
  }
  function showPipConnectionReport(){
    let dialog=document.getElementById("MNDO_PIP_CONNECTION_REPORT");
    if(!dialog){
      dialog=document.createElement("dialog");
      dialog.id="MNDO_PIP_CONNECTION_REPORT";
      dialog.setAttribute("aria-labelledby","MNDO_PIP_CONNECTION_TITLE");
      dialog.style.cssText="width:min(520px,calc(100vw - 40px));max-height:85vh;overflow:auto;box-sizing:border-box;padding:20px;border:1px solid #8e7648;border-radius:14px;background:#101b2a;color:#f4dfaa;font:14px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl";
      const title=document.createElement("h2");title.id="MNDO_PIP_CONNECTION_TITLE";title.textContent="حالة اتصال العايم";
      const note=document.createElement("p");note.textContent="تقرير اتصال فقط، بدون اختصارات أو بيانات تسجيل دخول. لا يُرسل تلقائيًا. انسخه وأرسله للمراجعة.";
      const field=document.createElement("textarea");field.id="MNDO_PIP_CONNECTION_DATA";field.readOnly=true;field.rows=16;field.dir="ltr";field.setAttribute("aria-label","تقرير اتصال العايم");field.style.cssText="width:100%;box-sizing:border-box;resize:vertical;background:#08111b;color:#e6edf7;font:12px/1.5 monospace";
      const refresh=document.createElement("button");refresh.type="button";refresh.textContent="تحديث الحالة";
      refresh.addEventListener("click",()=>{field.value=JSON.stringify(pipConnectionReport(),null,2);});
      const select=document.createElement("button");select.type="button";select.textContent="تحديد التقرير للنسخ";
      select.addEventListener("click",()=>{field.focus();field.select();});
      const close=document.createElement("button");close.type="button";close.textContent="إغلاق";
      close.addEventListener("click",()=>{if(typeof dialog.close==="function")dialog.close();else dialog.removeAttribute("open");});
      dialog.append(title,note,field,refresh,select,close);document.body.appendChild(dialog);
    }
    dialog.querySelector("textarea").value=JSON.stringify(pipConnectionReport(),null,2);
    if(!dialog.open){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");}
  }
  function stopSnapshotSync(){
    for(const timer of snapshotRetryTimers)clearTimeout(timer);
    snapshotRetryTimers=[];
  }
  function syncSnapshot(){
    stopSnapshotSync();
    const ref=workHelperWindow;
    if(!requestSnapshot(ref))return;
    for(const delay of WORK_HELPER_SNAPSHOT_RETRY_DELAYS){
      snapshotRetryTimers.push(setTimeout(()=>{
        if(ref!==workHelperWindow)return;
        if(!requestSnapshot(ref))stopSnapshotSync();
      },delay));
    }
  }
  function bindSnapshotBridge(){
    if(window.__mndoSrSnapshotBridgeBound)return;
    window.__mndoSrSnapshotBridgeBound=true;
    window.addEventListener("message",event=>{
      if(event.origin!==WORK_HELPER_ORIGIN)return;
      if(event.data?.type!=="MNDO_MYTIME_PIP_SNAPSHOT")return;
      pipConnection.replies++;
      if(!workHelperWindow||workHelperWindow.closed||event.source!==workHelperWindow){pipConnection.rejectedSource++;return;}
      if(saveSnapshot(event.data.snapshot))stopSnapshotSync();
      else pipConnection.rejectedPayload++;
    });
    // A later return from MyTime can retry after the bounded startup window.
    window.addEventListener("focus",syncSnapshot);
    window.addEventListener("pageshow",syncSnapshot);
    window.addEventListener("pagehide",stopSnapshotSync);
    loadSnapshot();
  }
  function warmPipBridge(){
    if(window.MyTimeSrPip){pipConnection.library="ready";return Promise.resolve(window.MyTimeSrPip);}
    if(pipBridgePromise)return pipBridgePromise;
    pipConnection.library="loading";
    pipBridgePromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=WORK_HELPER_PIP_ASSET;
      script.integrity=WORK_HELPER_PIP_INTEGRITY;
      script.async=true;
      script.crossOrigin="anonymous";
      script.dataset.mndoSrPipBridge="1";
      script.onload=()=>{
        if(window.MyTimeSrPip){pipConnection.library="ready";resolve(window.MyTimeSrPip);}
        else{script.remove();reject(new Error("PiP bridge API missing"));}
      };
      script.onerror=()=>{script.remove();reject(new Error("PiP bridge load failed"));};
      (document.head||document.documentElement).appendChild(script);
    }).catch(error=>{pipConnection.library="failed";pipBridgePromise=null;throw error;});
    return pipBridgePromise;
  }
  const MICRO_PIP_STYLESHEET="/sr-pip-micro-224-v1.css";
  function applyMicroPipLayout(){
    try{
      const pipWindow=window.documentPictureInPicture?.window;
      const doc=pipWindow?.document;
      if(!pipWindow||pipWindow.closed||!doc?.getElementById("grid"))return;
      const resize=()=>{
        try{
          if(pipWindow.closed||pipWindow.innerWidth>350)return;
          const timerVisible=!doc.getElementById("timerPane")?.hidden;
          pipWindow.resizeTo(timerVisible?224:170,46);
        }catch(_){}
      };
      if(doc.getElementById("mndoSrMicroPipCss")){resize();return;}
      const link=doc.createElement("link");
      link.id="mndoSrMicroPipCss";
      link.rel="stylesheet";
      link.href=location.origin+MICRO_PIP_STYLESHEET;
      link.addEventListener("load",resize,{once:true});
      link.addEventListener("error",()=>{link.remove();helperToast("تعذر تحميل تصميم العايم المضغوط","warn");},{once:true});
      doc.head.appendChild(link);
      doc.getElementById("focus")?.addEventListener("click",()=>setTimeout(resize,0),{passive:true});
    }catch(_){}
  }
  function ensurePipButton(link){
    const host=link?.parentElement;
    if(!host)return null;
    let btn=document.getElementById("MNDO_WORK_HELPER_PIP");
    if(btn)return btn;
    if(!document.getElementById("MNDO_WORK_HELPER_PIP_STYLE")){
      const style=document.createElement("style");
      style.id="MNDO_WORK_HELPER_PIP_STYLE";
      style.textContent="#MNDO_UA07_LOGO3 > #MNDO_WORK_HELPER_PIP{right:-75px !important}#MNDO_UA07_LOGO3 > #MNDO_WORK_HELPER_PIP[data-ready='1']{color:var(--sr-theme-switch-edge-b) !important;border-color:color-mix(in srgb,var(--sr-theme-switch-edge-b) 58%,rgba(255,255,255,.2)) !important}#MNDO_UA07_LOGO3 > #MNDO_WORK_HELPER_PIP svg{width:17px !important;height:17px !important}";
      (document.head||document.documentElement).appendChild(style);
    }
    btn=document.createElement("button");
    btn.id="MNDO_WORK_HELPER_PIP";
    btn.type="button";
    btn.className="mndo-work-helper-link";
    btn.title="فتح عايم MyTime — افتح الأساسي مرة أولًا لمزامنة الاختصارات";
    btn.setAttribute("aria-label",btn.title);
    btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="12" rx="2.2"/><rect x="11.5" y="10" width="8.5" height="7.5" rx="1.7"/><path d="M6.5 19.5h6"/></svg>';
    host.appendChild(btn);
    if(loadSnapshot())btn.dataset.ready="1";
    btn.addEventListener("pointerenter",()=>{warmPipBridge().catch(()=>{});},{passive:true});
    btn.addEventListener("focus",()=>{warmPipBridge().catch(()=>{});});
    btn.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();
      if(event.shiftKey){showPipConnectionReport();return;}
      const snapshot=loadSnapshot();
      if(!snapshot){
        syncSnapshot();
        helperToast("اختصارات MyTime لم تصل للعايم بعد — اضغط Shift مع زر العايم لعرض حالة الاتصال");
        try{link.animate([{transform:"scale(1)"},{transform:"scale(1.12)"},{transform:"scale(1)"}],{duration:520,easing:"ease-out"});}catch(_){}
        return;
      }
      const api=window.MyTimeSrPip;
      if(!api){
        helperToast("العايم بيتجهز — اضغط زر العايم مرة تانية");
        warmPipBridge().catch(()=>helperToast("تعذر تحميل مكوّن العايم","bad"));
        return;
      }
      try{
        Promise.resolve(api.open({
          snapshot,
          onNeedPrimary:()=>helperToast("افتح MyTime الأساسي مرة علشان يتم تحميل اختصارات العايم"),
          onUnsupported:()=>helperToast("المتصفح لا يدعم النافذة العائمة هنا","bad")
        })).then(opened=>{if(opened)applyMicroPipLayout();}).catch(()=>helperToast("تعذر فتح العايم","bad"));
      }catch(_){helperToast("تعذر فتح العايم","bad");}
    });
    return btn;
  }
  function bindWorkHelper(){
    const link=document.getElementById("MNDO_WORK_HELPER_LINK");
    if(!link||link.dataset.srWorkHelperBound==="1")return;
    link.dataset.srWorkHelperBound="1";
    link.href=helperUrl();
    link.rel="opener";
    ensurePipButton(link);
    warmPipBridge().catch(()=>{});
    link.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      try{
        const owner=workHelperOwner();
        const target=workHelperTarget(owner);
        link.target=target;
        pipConnection.opens++;
        const ref=owner.open(helperUrl(),target);
        if(!ref)return;
        workHelperWindow=ref;
        try{ref.focus();}catch(_){}
        syncSnapshot();
      }catch(_){pipConnection.openFailures++;}
    });
  }

  function ensureHeaderUtilityStyles(){
    if(document.getElementById(HEADER_UTILITY_STYLE_ID))return;
    const link=document.createElement("link");
    link.id=HEADER_UTILITY_STYLE_ID;
    link.rel="stylesheet";
    link.href=HEADER_UTILITY_STYLE_HREF;
    (document.head||document.documentElement).appendChild(link);
  }

  function utilityCollapsed(){
    try{
      const saved=sessionStorage.getItem(HEADER_UTILITY_COLLAPSE_KEY);
      if(saved!==null)return saved==="1";
    }catch(_){}
    try{return !!window.matchMedia?.("(max-width:1150px)")?.matches;}catch(_){return false;}
  }

  function setUtilityCollapsed(panel,button,collapsed){
    const value=collapsed===true;
    panel.dataset.collapsed=value?"true":"false";
    button.setAttribute("aria-expanded",value?"false":"true");
    button.setAttribute("aria-label",value?"إظهار أدوات الهيدر":"إخفاء أدوات الهيدر");
    button.title=value?"إظهار أدوات الهيدر":"إخفاء أدوات الهيدر";
    try{sessionStorage.setItem(HEADER_UTILITY_COLLAPSE_KEY,value?"1":"0");}catch(_){}
  }

  function installHeaderUtilityDock(){
    ensureHeaderUtilityStyles();
    const metrics=document.getElementById("MNDO_AHT_TAGS_STACK");
    const host=metrics?.parentElement;
    if(!metrics||!host)return false;

    let panel=document.getElementById("MNDO_HEADER_UTILITY_PANEL");
    if(!panel){
      panel=document.createElement("section");
      panel.id="MNDO_HEADER_UTILITY_PANEL";
      panel.className="mndo-header-utility-panel";
      panel.setAttribute("aria-label","Header utility panel");
      panel.innerHTML='\
        <button id="MNDO_HEADER_UTILITY_COLLAPSE" type="button" aria-controls="MNDO_HEADER_UTILITY_BODY" aria-expanded="true">\
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3.5 5 4.5-5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>\
        </button>\
        <div id="MNDO_HEADER_UTILITY_BODY">\
          <div id="MNDO_HEADER_UTILITY_GROUP" role="group" aria-label="gsm pro, One Home, break alarm, floating helper and work helper">\
            <a id="MNDO_CHATPRO_LINK" data-sr-header-utility="chatpro" href="/api/chatpro-sso" target="_blank" rel="noopener noreferrer" aria-label="Open GSM Pro in new tab" title="Open GSM Pro">GSM</a>\
          </div>\
        </div>';
      host.insertBefore(panel,metrics);
      const collapse=panel.querySelector("#MNDO_HEADER_UTILITY_COLLAPSE");
      if(collapse){
        setUtilityCollapsed(panel,collapse,utilityCollapsed());
        collapse.addEventListener("click",()=>{
          setUtilityCollapsed(panel,collapse,panel.dataset.collapsed!=="true");
        });
      }
    }

    const group=document.getElementById("MNDO_HEADER_UTILITY_GROUP");
    const utilityItems=[
      ["MNDO_WORK_HELPER_LINK","helper"],
      ["MNDO_WORK_HELPER_PIP","floating"],
      ["MNDO_BREAK_ALARM_HOST","alarm"],
      ["mndoOneHomeToggle","one"]
    ];
    if(group){
      for(const [id,slot] of utilityItems){
        const node=document.getElementById(id);
        if(!node)continue;
        node.dataset.srHeaderUtility=slot;
        if(node.parentElement!==group)group.appendChild(node);
      }
    }

    // Keep Tags directly below AHT in the existing right-hand metrics column.
    const tags=document.getElementById("bat2");
    if(tags){
      delete tags.dataset.srHeaderUtility;
      if(tags.parentElement!==metrics)metrics.appendChild(tags);
    }
    document.getElementById("MNDO_HEADER_CLOCK")?.remove();
    metrics.classList.add("sr-header-metrics-dock");
    return true;
  }

  function bind(){
    bindBreakPresentation();
    bindSnapshotBridge();
    bindWorkHelper();
    installHeaderUtilityDock();
    const btn=document.getElementById("EID_TOGGLE_BTN");
    if(!btn)return;
    if(btn.dataset.srHeaderThemeBound!=="1"){
      btn.dataset.srHeaderThemeBound="1";
      btn.addEventListener("click",switchTheme);
      btn.addEventListener("pointerenter",warmNext,{passive:true});
      btn.addEventListener("focus",warmNext);
    }
    update();
  }
  window.addEventListener("sr:themechange",update,{passive:true});
  window.__srHeaderCore=Object.freeze({version:"3.2.0-ivory-dark",update:update,installUtilityDock:installHeaderUtilityDock});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});
  else bind();
})();

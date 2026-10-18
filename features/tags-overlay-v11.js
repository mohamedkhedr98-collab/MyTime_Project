/* My Time Architecture v11 — Tags overlay.
   Fast path: direct iframe navigation; no parent-side Tags HTML cloning. */
(function(){
  "use strict";
  const TAGS_VERSION = "20261007-tags-eye-comfort-v1";
  const RELEASE_AFTER_CLOSE_MS = 60000;
  let initialized=false,tagsContainer=null,tagsPanel=null,tagsFrame=null,closeBtn=null,tagsLoader=null;
  let tagsOpen=false,currentMode="main",loadedMode="",readyMode="",closeSequence=0,releaseTimer=0,bodyOverflowBeforeTags="";

  function frameUrl(mode,retryToken){
    const url=new URL("/Tags.html",location.origin);
    url.searchParams.set("embed","1");
    url.searchParams.set("mode",mode==="ivr"?"ivr":"main");
    url.searchParams.set("v",TAGS_VERSION);
    if(retryToken) url.searchParams.set("retry",String(retryToken));
    return url.pathname+url.search;
  }

  function ensureOverlay(){
    if(tagsContainer&&tagsPanel&&tagsFrame) return;
    if(!document.getElementById("srTagsSpinStyle")){
      const style=document.createElement("style");
      style.id="srTagsSpinStyle";
      style.textContent="@keyframes srTagsSpin{to{transform:rotate(360deg)}}";
      document.head.appendChild(style);
    }

    tagsContainer=document.getElementById("tagsContainer");
    if(!tagsContainer){
      tagsContainer=document.createElement("div");
      tagsContainer.id="tagsContainer";
      Object.assign(tagsContainer.style,{
        display:"none",position:"fixed",inset:"0",width:"100%",height:"100%",zIndex:"2147483646",
        background:"radial-gradient(circle at 50% 0%,rgba(255,214,122,.13),rgba(255,214,122,0) 24%),linear-gradient(180deg,rgba(5,8,22,.98),rgba(5,5,15,.99))",
        opacity:"0",transition:"opacity .12s ease",contain:"layout paint style"
      });
      document.body.appendChild(tagsContainer);
    }

    tagsPanel=document.getElementById("tagsPanel");
    if(!tagsPanel){
      tagsPanel=document.createElement("div");
      tagsPanel.id="tagsPanel";
      Object.assign(tagsPanel.style,{position:"relative",width:"100%",height:"100%",overflow:"hidden",padding:"0",margin:"0",boxSizing:"border-box",contain:"layout paint style"});
      tagsContainer.appendChild(tagsPanel);
    }

    tagsFrame=document.getElementById("tagsFrame");
    if(!tagsFrame){
      tagsFrame=document.createElement("iframe");
      tagsFrame.id="tagsFrame";
      tagsFrame.title="Tags";
      Object.assign(tagsFrame.style,{width:"100%",height:"100%",border:"0",display:"block",background:"transparent",opacity:"0",transition:"opacity .12s ease"});
      tagsFrame.setAttribute("sandbox","allow-scripts allow-forms allow-same-origin");
      tagsFrame.setAttribute("allow","clipboard-write");
      tagsPanel.appendChild(tagsFrame);
    }

    tagsLoader=document.getElementById("tagsLoader");
    if(!tagsLoader){
      tagsLoader=document.createElement("div");
      tagsLoader.id="tagsLoader";
      Object.assign(tagsLoader.style,{
        position:"absolute",inset:"0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"12px",
        color:"#f5f7ff",fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif",
        background:"linear-gradient(180deg,rgba(7,11,28,.98),rgba(5,5,15,.99))",pointerEvents:"none"
      });
      tagsLoader.innerHTML='<div style="width:42px;height:42px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:#f7d88b;animation:srTagsSpin .8s linear infinite"></div><div style="font-size:13px;font-weight:750">جارٍ فتح Tags...</div>';
      tagsPanel.appendChild(tagsLoader);
    }

    closeBtn=document.getElementById("closeTagsBtn");
    if(!closeBtn){
      closeBtn=document.createElement("button");
      closeBtn.id="closeTagsBtn"; closeBtn.type="button"; closeBtn.textContent="×"; closeBtn.setAttribute("aria-label","Close Tags");
      Object.assign(closeBtn.style,{
        position:"absolute",top:"18px",left:"18px",zIndex:"2147483647",width:"42px",height:"42px",borderRadius:"16px",
        border:"1px solid rgba(255,240,191,.30)",background:"linear-gradient(135deg,rgba(255,240,191,.16),rgba(133,92,255,.22))",
        color:"#fff",fontSize:"26px",fontWeight:"800",lineHeight:"1",boxShadow:"0 12px 30px rgba(0,0,0,.28)",cursor:"pointer"
      });
      tagsContainer.appendChild(closeBtn);
      closeBtn.addEventListener("click",hideTags);
    }

    if(!tagsFrame.__srTagsLoadBound){
      tagsFrame.__srTagsLoadBound=true;
      tagsFrame.addEventListener("load",()=>{
        if(tagsFrame.src==="about:blank") return;
        readyMode=loadedMode;
        if(!tagsOpen) return;
        tagsFrame.style.opacity="1";
        if(tagsLoader) tagsLoader.style.display="none";
      });
    }
  }

  function clearReleaseTimer(){ if(releaseTimer){ clearTimeout(releaseTimer); releaseTimer=0; } }

  function loadMode(mode,{force=false}={}){
    ensureOverlay();
    const safeMode=mode==="ivr"?"ivr":"main";
    if(!force&&loadedMode===safeMode&&tagsFrame.src&&tagsFrame.src!=="about:blank"){
      if(readyMode===safeMode){
        tagsFrame.style.opacity="1";
        if(tagsLoader) tagsLoader.style.display="none";
      }else{
        tagsFrame.style.opacity="0";
        if(tagsLoader) tagsLoader.style.display="flex";
      }
      return;
    }
    if(tagsLoader) tagsLoader.style.display="flex";
    tagsFrame.style.opacity="0";
    loadedMode=safeMode;
    readyMode="";
    tagsFrame.src=frameUrl(safeMode,force?Date.now():0);
  }

  function canIntentPrewarm(){
    try{
      if(navigator.connection?.saveData) return false;
      if(document.documentElement.classList.contains("mndo-low-power")) return false;
    }catch{}
    return true;
  }

  function prewarmTags(){
    if(!canIntentPrewarm()) return false;
    ensureOverlay();
    clearReleaseTimer();
    loadMode(currentMode);
    return true;
  }

  function showTags(){
    ensureOverlay(); clearReleaseTimer(); tagsOpen=true; closeSequence+=1;
    tagsContainer.style.display="block";
    requestAnimationFrame(()=>{tagsContainer.style.opacity="1";});
    if(!bodyOverflowBeforeTags) bodyOverflowBeforeTags=document.body.style.overflow||"";
    document.body.style.overflow="hidden";
    loadMode(currentMode);
  }

  function hideTags(){
    if(!tagsContainer) return;
    tagsOpen=false; tagsContainer.style.opacity="0";
    const sequence=++closeSequence;
    setTimeout(()=>{ if(tagsContainer&&sequence===closeSequence) tagsContainer.style.display="none"; },130);
    document.body.style.overflow=bodyOverflowBeforeTags;
    clearReleaseTimer();
    releaseTimer=setTimeout(()=>{
      releaseTimer=0;
      if(tagsOpen||!tagsFrame) return;
      tagsFrame.src="about:blank";
      loadedMode="";
      readyMode="";
      tagsFrame.style.opacity="0";
    },RELEASE_AFTER_CLOSE_MS);
  }

  function bindBridge(){
    if(window.__srTagsBridgeBoundV2) return;
    window.__srTagsBridgeBoundV2=true;
    window.addEventListener("message",(event)=>{
      if(!tagsFrame||event.source!==tagsFrame.contentWindow||event.origin!==location.origin) return;
      const data=event.data;
      if(!data||typeof data!=="object") return;
      if(data.type==="SR_TAGS_SWITCH_MODE"){
        currentMode=data.mode==="ivr"?"ivr":"main"; loadMode(currentMode);
      }else if(data.type==="SR_TAGS_CLOSE"){
        hideTags();
      }else if(data.type==="SR_TAGS_RETRY"){
        loadMode(currentMode,{force:true});
      }
    });
  }

  function init(){
    if(initialized) return;
    initialized=true; ensureOverlay(); bindBridge();
    const button=document.getElementById("bat2");
    if(button&&!button.__srTagsOverlayBound){
      button.__srTagsOverlayBound=true;
      button.addEventListener("click",(event)=>{
        event.preventDefault();
        if(tagsOpen) hideTags(); else showTags();
      });
      ["pointerenter","focusin","touchstart"].forEach((name)=>button.addEventListener(name,prewarmTags,{once:true,passive:true}));
      if(button.matches?.(":hover")||document.activeElement===button) prewarmTags();
    }
    window.__srOpenTags=showTags;
    window.__srCloseTags=hideTags;
    window.__srTagsOverlay=Object.freeze({open:showTags,close:hideTags,retry:()=>loadMode(currentMode,{force:true}),prewarm:prewarmTags});
    window.addEventListener("sr:tags-updated",(event)=>{
      if(!tagsFrame?.contentWindow) return;
      try{ tagsFrame.contentWindow.postMessage({type:"SR_TAGS_REFRESH",revision:Number(event?.detail?.revision)||0}, location.origin); }catch{}
    });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();

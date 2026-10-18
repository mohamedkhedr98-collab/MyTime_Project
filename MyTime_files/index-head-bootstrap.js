/* SR Theme Controller v3 - atomic stylesheet lifecycle and single state owner. */
(function(){
 "use strict";
 if(window.__srThemeController)return;

 var root=document.documentElement;

 /* Shared semantic theme bridge. It is intentionally independent of any one theme
    and is moved to the end of <head> after parse/theme switches so shared controls
    always consume the active palette instead of keeping neutral legacy paint. */
 var themeComponentBridgeVersion="20261006-header-satin-polish-v2";
 function ensureThemeComponentBridge(){
  try{
   var link=document.getElementById("srThemeComponentBridgeLink");
   if(!link){
    link=document.createElement("link");
    link.id="srThemeComponentBridgeLink";
    link.rel="stylesheet";
    link.href="/theme-component-bridge-v1.css?v="+themeComponentBridgeVersion;
   }
   if(document.head)document.head.appendChild(link);
   else root.appendChild(link);
  }catch(_){}
 }
 ensureThemeComponentBridge();
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureThemeComponentBridge,{once:true});
 window.addEventListener("sr:themechange",function(){setTimeout(ensureThemeComponentBridge,0);});

 /* Mobile assets are intentionally isolated from desktop and are requested only
    when the viewport is narrow. The app shell owns mobile-only DOM reflow. */
 try{
  var mobileMq=window.matchMedia("(max-width: 820px)");
  var mobileCssVersion="20261002-mobile-layout-v5";
  var mobileShellVersion="20261002-mobile-app-shell-v6";
  var mobileSupportClarityVersion="20261002-mobile-support-clarity-v1";
  function ensureMobileLayout(){
   if(!mobileMq.matches||document.getElementById("srMobileLayoutLink"))return;
   var link=document.createElement("link");
   link.id="srMobileLayoutLink";
   link.rel="stylesheet";
   link.href="/mobile-layout.css?v="+mobileCssVersion;
   link.media="(max-width: 820px)";
   (document.head||root).appendChild(link);
  }
  function ensureMobileShell(){
   if(!mobileMq.matches)return;
   if(!document.getElementById("srMobileAppShellV6Css")){
    var css=document.createElement("link");
    css.id="srMobileAppShellV6Css";
    css.rel="stylesheet";
    css.href="/mobile-app-shell-v6.css?v="+mobileShellVersion;
    css.media="(max-width: 820px)";
    (document.head||root).appendChild(css);
   }
   if(!document.getElementById("srMobileAppShellV6Js")){
    var script=document.createElement("script");
    script.id="srMobileAppShellV6Js";
    script.src="/mobile-app-shell-v6.js?v="+mobileShellVersion;
    script.async=false;
    (document.head||root).appendChild(script);
   }
   if(!document.getElementById("srMobileSupportClarityV1Css")){
    var clarity=document.createElement("link");
    clarity.id="srMobileSupportClarityV1Css";
    clarity.rel="stylesheet";
    clarity.href="/mobile-support-clarity-v1.css?v="+mobileSupportClarityVersion;
    clarity.media="(max-width: 820px)";
    (document.head||root).appendChild(clarity);
   }
  }
  function ensureMobile(){ensureMobileLayout();ensureMobileShell();}
  ensureMobile();
  if(mobileMq.addEventListener)mobileMq.addEventListener("change",ensureMobile);
  else if(mobileMq.addListener)mobileMq.addListener(ensureMobile);
 }catch(_){}

 var MODE_KEY="sr_visual_theme_mode",OFF_KEY="sr_eid_theme_off",DEFAULT_MODE="ivoryDark";
 var ORDER=["ivory","ivoryDark","eid","legacy","ahly","egypt","off"];
 var THEMES={
  ivory:{className:"ivory-gold-theme-live",linkId:"ivoryGoldThemeLink",href:"/ivory-gold-theme.css?v=20261010-direct-sr-parity-v4",themeColor:"#eee6d9"},
  ivoryDark:{className:"ivory-gold-dark-theme-live",linkId:"ivoryGoldDarkThemeLink",href:"/ivory-gold-dark-theme.css?v=20261010-direct-sr-parity-v4",themeColor:"#100d0b"},
  eid:{className:"eid-theme-live",linkId:"eidThemeLink",href:"/eid-theme.css?v=20260929-eid-scope-v2"},
  legacy:{className:"ua07-legacy-theme-live",linkId:"ua07LegacyThemeLink",href:"/ua07-20-theme.css?v=20261010-direct-sr-parity-v4"},
  ahly:{className:"ahly-premium-theme-live",linkId:"ahlyPremiumThemeLink",href:"/ahly-premium-theme.css?v=20261010-direct-sr-parity-v4"},
  egypt:{className:"egypt-worldcup-theme-live",linkId:"egyptWorldCupThemeLink",href:"/egypt-worldcup-theme.css?v=20261010-direct-sr-parity-v4"},
  off:{className:"sr-theme-off-live",linkId:"",href:""}
 };
 var loads=Object.create(null),assetLoads=Object.create(null),switchToken=0;

 function normalize(mode){return Object.prototype.hasOwnProperty.call(THEMES,mode)?mode:DEFAULT_MODE;}
 function read(){
  var mode=DEFAULT_MODE;
  try{
   if(localStorage.getItem("sr_visual_theme_default_ivory_dark_v1")!=="1"){
    localStorage.setItem(MODE_KEY,DEFAULT_MODE);
    localStorage.setItem(OFF_KEY,"0");
    localStorage.setItem("sr_visual_theme_default_egypt_v1","1");
    localStorage.setItem("sr_visual_theme_default_ivory_v1","1");
    localStorage.setItem("sr_visual_theme_default_ivory_dark_v1","1");
   }
   mode=normalize(localStorage.getItem(MODE_KEY));
  }catch(_){}
  return mode;
 }
 function persist(mode){
  try{
   localStorage.setItem(MODE_KEY,mode);
   localStorage.setItem(OFF_KEY,mode==="off"?"1":"0");
  }catch(_){}
 }
 function existing(spec){return spec&&spec.linkId?document.getElementById(spec.linkId):null;}
 function preloadAsset(href){
  if(!href)return null;
  if(assetLoads[href])return assetLoads[href];
  var existingLink=Array.from(document.querySelectorAll('link[rel="preload"][as="image"]')).find(function(node){return node.getAttribute("href")===href;});
  if(existingLink){assetLoads[href]=existingLink;return existingLink;}
  var link=document.createElement("link");
  link.rel="preload";link.as="image";link.href=href;link.dataset.srThemeAsset="1";
  (document.head||root).appendChild(link);assetLoads[href]=link;return link;
 }
 function warmAssets(mode){
  var spec=THEMES[mode];
  if(!spec||!Array.isArray(spec.preloadImages))return;
  spec.preloadImages.forEach(preloadAsset);
 }
 function updateThemeColor(mode){
  var meta=document.querySelector('meta[name="theme-color"]');
  var color=THEMES[mode]&&THEMES[mode].themeColor;
  if(meta&&color)meta.setAttribute("content",color);
 }
 function ensure(mode){
  var spec=THEMES[mode];
  warmAssets(mode);
  if(!spec||!spec.linkId||!spec.href)return null;
  var link=existing(spec);
  if(!link){
   link=document.createElement("link");
   link.id=spec.linkId;
   link.rel="stylesheet";
   link.media="not all";
   link.href=spec.href;
   link.dataset.srThemeStyle=mode;
   (document.head||root).appendChild(link);
  }else{
   if(link.getAttribute("href")!==spec.href)link.setAttribute("href",spec.href);
   if(mode!==(root.dataset.srVisualTheme||DEFAULT_MODE))link.media="not all";
  }
  return link;
 }
 function loaded(link){
  if(!link)return Promise.resolve(null);
  if(link.sheet)return Promise.resolve(link);
  var mode=link.dataset.srThemeStyle||link.id;
  if(loads[mode])return loads[mode];
  loads[mode]=new Promise(function(resolve,reject){
   var done=false;
   function finish(ok){
    if(done)return;
    done=true;
    clearTimeout(timer);
    link.removeEventListener("load",onLoad);
    link.removeEventListener("error",onError);
    if(ok)resolve(link);else reject(new Error("Theme stylesheet failed: "+mode));
   }
   function onLoad(){finish(true);}
   function onError(){finish(false);}
   var timer=setTimeout(function(){finish(!!link.sheet);},7000);
   link.addEventListener("load",onLoad,{once:true});
   link.addEventListener("error",onError,{once:true});
  }).finally(function(){delete loads[mode];});
  return loads[mode];
 }
 function getMode(){
  var mode=root.dataset.srVisualTheme;
  if(mode&&normalize(mode)===mode)return mode;
  try{return normalize(localStorage.getItem(MODE_KEY));}catch(_){return DEFAULT_MODE;}
 }
 function setLinkState(activeMode){
  Object.keys(THEMES).forEach(function(key){
   var link=existing(THEMES[key]);
   if(link)link.media=key===activeMode?"all":"not all";
  });
 }
 function commit(next,options){
  var previous=root.dataset.srVisualTheme||DEFAULT_MODE;
  var active=existing(THEMES[next]);
  if(active)active.media="all";
  Object.keys(THEMES).forEach(function(key){
   root.classList.toggle(THEMES[key].className,key===next);
  });
  root.dataset.srVisualTheme=next;
  setLinkState(next);
  updateThemeColor(next);
  root.removeAttribute("data-sr-theme-pending");
  if(options.persist!==false)persist(next);
  if(previous!==next&&!options.silent){
    try{window.dispatchEvent(new CustomEvent("sr:themechange",{detail:{mode:next,previous:previous}}));}catch(_){}
  }
  return next;
 }
 function preload(mode){
  var next=normalize(mode);
  if(next==="off")return Promise.resolve(null);
  return loaded(ensure(next));
 }
 function apply(mode,options){
  options=options||{};
  var next=normalize(mode),current=getMode();
  if(next===current&&!root.hasAttribute("data-sr-theme-pending")){
   ensure(next);
   setLinkState(next);
   Object.keys(THEMES).forEach(function(key){root.classList.toggle(THEMES[key].className,key===next);});
   updateThemeColor(next);
   if(options.persist!==false)persist(next);
   return Promise.resolve(next);
  }
  var token=++switchToken;
  root.dataset.srThemePending=next;
  return preload(next).then(function(){
   if(token!==switchToken)return getMode();
   return commit(next,options);
  }).catch(function(error){
   if(token===switchToken){
    root.removeAttribute("data-sr-theme-pending");
    try{window.dispatchEvent(new CustomEvent("sr:themeerror",{detail:{mode:next,error:String(error&&error.message||error)}}));}catch(_){}
   }
   throw error;
  });
 }
 function setMode(mode){return apply(mode,{persist:true});}
 function nextMode(){
  var i=ORDER.indexOf(getMode());
  return ORDER[(i+1+ORDER.length)%ORDER.length];
 }

 window.__srThemeController=Object.freeze({
  version:"3.1.0-ivory-dark",
  themes:Object.freeze(THEMES),
  order:Object.freeze(ORDER.slice()),
  normalize:normalize,
  getMode:getMode,
  preload:preload,
  apply:apply,
  setMode:setMode,
  nextMode:nextMode
 });

 apply(read(),{persist:false}).catch(function(){});
 window.addEventListener("storage",function(event){
  if(event&&(event.key===MODE_KEY||event.key===OFF_KEY))apply(read(),{persist:false}).catch(function(){});
 });
 try{
  var nav=navigator||{};
  if((nav.connection&&nav.connection.saveData)||(Number(nav.deviceMemory||8)<=4&&Number(nav.hardwareConcurrency||8)<=4))root.classList.add("mndo-low-power");
 }catch(_){}
})();
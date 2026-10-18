/* SR mobile app shell v6 — isolated mobile header + support app UX. */
(function(){
  "use strict";
  if(window.__srMobileAppShellV6)return;

  const mq=matchMedia("(max-width: 820px)");
  const DOCK="SR_MOBILE_HEADER_DOCK";
  const PUB="srMobileSupportPublic";
  const SEARCH_WRAP="srMobileSupportSearchWrap";
  const SEARCH="srMobileSupportSearch";
  const EMPTY="srMobileSupportEmpty";
  let supportBound=false;
  let overlayObserver=null;
  let titleObserver=null;
  let usersObserver=null;
  let allowCoreBack=false;

  function styleLast(){
    const link=document.getElementById("srMobileAppShellV6Css");
    if(link?.parentNode)link.parentNode.appendChild(link);
  }

  function remember(node){
    if(node&&!node.__srMobileRestoreV6){
      node.__srMobileRestoreV6={parent:node.parentNode,next:node.nextSibling};
    }
  }

  function restore(node){
    const meta=node?.__srMobileRestoreV6;
    if(!node||!meta?.parent)return;
    try{
      if(meta.next&&meta.next.parentNode===meta.parent)meta.parent.insertBefore(node,meta.next);
      else meta.parent.appendChild(node);
    }catch(_){}
  }

  function header(){
    if(!mq.matches)return;
    const row=document.querySelector(".mndo-search-logo-row");
    const logo=document.getElementById("MNDO_UA07_LOGO3");
    if(!row||!logo)return;

    let dock=document.getElementById(DOCK);
    if(!dock){
      dock=document.createElement("div");
      dock.id=DOCK;
      dock.setAttribute("aria-label","Mobile header tools");
      row.after(dock);
    }
    remember(logo);
    if(logo.parentNode!==dock)dock.appendChild(logo);
    dock.dataset.ready="1";
  }

  function restoreHeader(){
    const logo=document.getElementById("MNDO_UA07_LOGO3");
    if(logo)restore(logo);
    document.getElementById(DOCK)?.remove();
  }

  function publicRow(panel,list){
    let button=document.getElementById(PUB);
    if(button)return button;
    button=document.createElement("button");
    button.id=PUB;
    button.type="button";
    button.innerHTML='<span class="avatar" aria-hidden="true">#</span><span class="copy"><strong>المحادثة العامة</strong><small>كل أعضاء الفريق</small></span><span class="chev" aria-hidden="true">›</span>';
    panel.insertBefore(button,list||null);
    return button;
  }

  function supportSearch(panel,anchor){
    let wrap=document.getElementById(SEARCH_WRAP);
    if(wrap)return wrap;
    wrap=document.createElement("div");
    wrap.id=SEARCH_WRAP;
    wrap.innerHTML='<span aria-hidden="true">⌕</span><input id="'+SEARCH+'" type="search" autocomplete="off" inputmode="search" placeholder="ابحث عن عضو…" aria-label="ابحث عن عضو"><button type="button" aria-label="مسح البحث">×</button>';
    panel.insertBefore(wrap,anchor||null);
    const input=wrap.querySelector("input");
    const clear=wrap.querySelector("button");
    input?.addEventListener("input",filterUsers,{passive:true});
    clear?.addEventListener("click",()=>{
      if(!input)return;
      input.value="";
      filterUsers();
      try{input.focus({preventScroll:true});}catch(_){input.focus?.();}
    });
    return wrap;
  }

  function initials(value){
    const parts=String(value||"").trim().split(/\s+/).filter(Boolean);
    if(!parts.length)return "U";
    const first=parts[0]?.[0]||"";
    const second=(parts.length>1?parts[parts.length-1]?.[0]:parts[0]?.[1])||"";
    return (first+second).toUpperCase().slice(0,2);
  }

  function enhanceUsers(){
    const list=document.getElementById("supportUsersList");
    if(!list)return;
    const rows=Array.from(list.querySelectorAll("button.support-user[data-user-id]"));
    rows.forEach((row)=>{
      const name=String(row.querySelector(".support-user-name")?.textContent||"User").trim();
      row.dataset.mobileInitials=initials(name);
      row.dataset.mobileName=name.toLocaleLowerCase();
      if(row.classList.contains("me"))row.setAttribute("aria-label",name+" — أنت");
      else row.setAttribute("aria-label","فتح محادثة خاصة مع "+name);
    });
    filterUsers();
  }

  function filterUsers(){
    const list=document.getElementById("supportUsersList");
    const input=document.getElementById(SEARCH);
    if(!list)return;
    const query=String(input?.value||"").trim().toLocaleLowerCase();
    let shown=0;
    list.querySelectorAll("button.support-user[data-user-id]").forEach((row)=>{
      const name=row.dataset.mobileName||String(row.querySelector(".support-user-name")?.textContent||"").trim().toLocaleLowerCase();
      const visible=!query||name.includes(query);
      row.hidden=!visible;
      if(visible)shown+=1;
    });
    let empty=document.getElementById(EMPTY);
    if(!empty){
      empty=document.createElement("div");
      empty.id=EMPTY;
      empty.textContent="لا يوجد عضو مطابق للبحث";
      list.appendChild(empty);
    }
    empty.hidden=shown>0||!query;
  }

  function listView(){
    if(!mq.matches)return;
    const overlay=document.getElementById("supportChatOverlay");
    if(!overlay)return;
    overlay.classList.add("sr-mobile-support-app","sr-mobile-support-list");
    overlay.classList.remove("sr-mobile-support-chat");
    const title=document.getElementById("supportChatTitle");
    const subtitle=document.getElementById("supportChatSubtitle");
    const people=overlay.querySelector(".support-users-title");
    if(title)title.textContent="Support";
    if(subtitle)subtitle.textContent="المحادثات والأعضاء";
    if(people)people.textContent="المحادثات";
    enhanceUsers();
    styleLast();
  }

  function chatView(){
    if(!mq.matches)return;
    const overlay=document.getElementById("supportChatOverlay");
    if(!overlay)return;
    overlay.classList.add("sr-mobile-support-app","sr-mobile-support-chat");
    overlay.classList.remove("sr-mobile-support-list");
    styleLast();
    requestAnimationFrame(()=>{
      const list=document.getElementById("supportMessagesList");
      if(list)list.scrollTop=list.scrollHeight;
    });
  }

  function bindSupport(){
    if(supportBound)return;
    const overlay=document.getElementById("supportChatOverlay");
    const panel=overlay?.querySelector(".support-users");
    const list=document.getElementById("supportUsersList");
    const back=document.getElementById("supportChatBackBtn");
    const toggle=document.getElementById("supportToggleBtn");
    const title=document.getElementById("supportChatTitle");
    if(!overlay||!panel||!list||!back)return;

    supportBound=true;
    overlay.classList.add("sr-mobile-support-app");
    const search=supportSearch(panel,list);
    const pub=publicRow(panel,list);
    if(search&&pub&&search.nextSibling!==pub)panel.insertBefore(search,pub);

    list.addEventListener("click",(event)=>{
      const button=event.target?.closest?.("button.support-user[data-user-id]");
      if(button&&!button.classList.contains("me"))setTimeout(chatView,0);
    });

    pub.addEventListener("click",()=>{
      allowCoreBack=true;
      try{back.click()}catch(_){}
      allowCoreBack=false;
      setTimeout(chatView,0);
    });

    back.addEventListener("click",(event)=>{
      if(allowCoreBack)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      listView();
    },true);

    toggle?.addEventListener("click",()=>{
      [30,180,520,1000].forEach((delay)=>setTimeout(()=>{
        if(overlay.style.display!=="none")listView();
      },delay));
    });

    overlayObserver=new MutationObserver(()=>{
      if(mq.matches&&overlay.style.display!=="none"&&overlay.getAttribute("aria-hidden")!=="true")listView();
    });
    overlayObserver.observe(overlay,{attributes:true,attributeFilter:["style","aria-hidden"]});

    if(title){
      titleObserver=new MutationObserver(()=>{
        if(mq.matches&&overlay.style.display!=="none"&&/^Chat with\s+/i.test(String(title.textContent||"").trim()))chatView();
      });
      titleObserver.observe(title,{childList:true,characterData:true,subtree:true});
    }

    usersObserver=new MutationObserver(()=>enhanceUsers());
    usersObserver.observe(list,{childList:true,subtree:true});

    addEventListener("sr:support-users-updated",()=>{
      if(!mq.matches)return;
      publicRow(panel,list);
      enhanceUsers();
      styleLast();
    },{passive:true});

    enhanceUsers();
  }

  function unbindSupport(){
    const overlay=document.getElementById("supportChatOverlay");
    overlay?.classList.remove("sr-mobile-support-app","sr-mobile-support-list","sr-mobile-support-chat");
    overlayObserver?.disconnect();
    titleObserver?.disconnect();
    usersObserver?.disconnect();
    overlayObserver=titleObserver=usersObserver=null;
    supportBound=false;
    document.getElementById(PUB)?.remove();
    document.getElementById(SEARCH_WRAP)?.remove();
    document.getElementById(EMPTY)?.remove();
  }

  function apply(){
    if(!mq.matches)return;
    header();
    bindSupport();
    styleLast();
  }

  function off(){
    restoreHeader();
    unbindSupport();
  }

  function boot(){
    if(!mq.matches)return;
    apply();
    [60,220,650,1400].forEach((delay)=>setTimeout(apply,delay));
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();

  const changed=()=>mq.matches?(apply(),setTimeout(apply,120)):off();
  if(mq.addEventListener)mq.addEventListener("change",changed);
  else if(mq.addListener)mq.addListener(changed);

  window.__srMobileAppShellV6=Object.freeze({version:"6.0.0",apply,deactivate:off,listView,chatView});
})();

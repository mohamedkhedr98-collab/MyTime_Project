// My Time Architecture v11 — isolated SR runtime compatibility.
// Keeps the verified SR catalog byte-for-byte unchanged while preserving the
// pre-v11 browser behavior for the Signal Disconnection correction.
(function(){
  "use strict";
  if(window.__SR_V11_SIGNAL_DISCONNECTION_COMPAT) return;
  window.__SR_V11_SIGNAL_DISCONNECTION_COMPAT = true;

  const NEW_ID = "102033032";
  const OLD_ID = "102002033";
  const ORIGINAL_ID = "102033004";
  const NEW_HREF = "https://bss.te.eg:12900/csp/sr/business.action?BMEBusiness=srNewSrPage&srTypeName=FBB%20Tech%20Problem->Logical%20Instability->Signal%20Disconnection&srTypeId=102033032&t=1789301442904&tabId=sr0.25009009822870165&topUrl=&custid=&&BMEWebToken=&serviceInfoChar107=2&serviceInfoChar111=1&serviceTitle=Wireless&serviceInfoChar282=Wireless&serviceInfoChar276=1&serviceInfoChar278=1&serviceInfoChar272=0&serviceContent=customer has Logical instability-No multiple login due to signal Disconnection&subsNumber=";
  const NEW_TITLE = "In case customer has Logical instability-No multiple login due to signal Disconnection";

  function apply(root = document){
    try{
      root.querySelectorAll(`a[href*="srTypeId=${OLD_ID}"]`).forEach((node) => node.remove());

      if(root.querySelector(`a[href*="srTypeId=${NEW_ID}"]`)) return true;
      const original = root.querySelector(`a[href*="srTypeId=${ORIGINAL_ID}"]`);
      if(!original?.parentNode) return false;

      const link = original.cloneNode(true);
      link.href = NEW_HREF;
      link.setAttribute("onclick", "openLink(event)");
      link.target = "_blank";
      link.title = NEW_TITLE;
      link.textContent = "Wireless Signal Disconnection";
      original.insertAdjacentElement("afterend", link);
      return true;
    }catch{
      return false;
    }
  }

  let normalizedDocument = null;
  const normalizedFragments = new WeakSet();
  window.addEventListener("sr:catalog-ready", event => {
    apply(event.detail.doc);
    normalizedDocument = event.detail.doc;
    event.detail.compatibilityNormalized = true;
    window.dispatchEvent(new CustomEvent('sr:catalog-normalized'));
  });
  window.addEventListener("sr:catalog-prepared", event => {
    if (event.detail.sourceDocument === normalizedDocument) normalizedFragments.add(event.detail.root);
  });
  window.addEventListener("sr:catalog-mounted", event => {
    // Fragments copied after this guard normalized the shared source already
    // contain its correction. Retain the global fallback for early clicks and
    // fragments prepared before the compatibility script finished loading.
    const affectedStandalone = event.detail.standaloneLinks?.some(link =>
      [OLD_ID, NEW_ID, ORIGINAL_ID].some(id => (link.getAttribute("href") || "").includes("srTypeId=" + id)));
    if (affectedStandalone ||
        !event.detail.fragments?.every(fragment => normalizedFragments.has(fragment))) apply(event.detail.root);
  });
  if (window.__srCatalog?.peek()) {
    apply(window.__srCatalog.peek().doc);
    normalizedDocument = window.__srCatalog.peek().doc;
    window.__srCatalog.peek().compatibilityNormalized = true;
    window.dispatchEvent(new CustomEvent('sr:catalog-normalized'));
    window.dispatchEvent(new CustomEvent('sr:catalog-labels-changed'));
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => apply(), { once:true });
  }else{
    apply();
  }
})();

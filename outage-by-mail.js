/*
  Outage by mail helper (SR Technical)
  - Paste impacted BRAS list (one per line)
  - Search exact match (full string after trim)
  - If matched: plays a gentle bell + shows copyable message
*/

(function(){
  function $(id){ return document.getElementById(id); }

  // Tabs (Mail / Normal) – optional; only runs if elements exist.
  const tabMail = $("outageTabMail");
  const tabNormal = $("outageTabNormal");
  const panelMail = $("outageMailPanel");
  const panelNormal = $("outageNormalPanel");

  function setOutageTab(which){
    if(!tabMail || !tabNormal || !panelMail || !panelNormal) return;
    const isMail = which === "mail";
    tabMail.classList.toggle("is-active", isMail);
    tabNormal.classList.toggle("is-active", !isMail);
    tabMail.setAttribute("aria-selected", isMail ? "true" : "false");
    tabNormal.setAttribute("aria-selected", !isMail ? "true" : "false");
    panelMail.classList.toggle("outage-panel-hidden", !isMail);
    panelNormal.classList.toggle("outage-panel-hidden", isMail);

    // Small UX nicety
    if(isMail){
      const search = $("outageBrasSearch");
      search?.focus?.();
    }
  }

  tabMail?.addEventListener?.("click", ()=> setOutageTab("mail"));
  tabNormal?.addEventListener?.("click", ()=> setOutageTab("normal"));

  const elList = $("outageImpactedBras");
  const elSearch = $("outageBrasSearch");
  const elBtn = $("outageBrasCheckBtn");
  const elResult = $("outageBrasResult");
  const elComplaint = $("outageComplaintNo");
  const elMsg = $("outageMessageBox");
  const elCopy = $("outageCopyBtn");
  const elMsgRow = $("outageMessageRow");

  if(!elList || !elSearch || !elBtn || !elResult || !elMsg || !elCopy) return;

  // Default view
  setOutageTab("mail");

  function showMessageBox(show){
    if(!elMsgRow) return;
    elMsgRow.classList.toggle("outage-mail-hidden", !show);
  }

  function normalizeLine(s){
    return String(s || "").trim();
  }

  function parseImpacted(){
    const raw = String(elList.value || "");
    const lines = raw.split(/\r?\n/).map(normalizeLine).filter(Boolean);
    // Drop a header line like "Impacted Bras"
    const filtered = lines.filter((l) => l.toLowerCase() !== "impacted bras".toLowerCase());
    // Build a case-insensitive map of exact matches.
    const map = new Map(); // keyLower -> original
    for(const l of filtered){
      const k = l.toLowerCase();
      if(!map.has(k)) map.set(k, l);
    }
    return map;
  }

  function buildMessage(){
    const complaint = normalizeLine(elComplaint?.value);
    const rep = complaint ? complaint : "XX";
    return `بعتذر لحضرتك جدا وحاليا اللي بيأثر على خدمة الانترنت الارضى في منطقتك في خلال 4 ساعات وان شاء الله المشكلة هتتحل مع حضرتك بشكل نهائي ورقم الشكوى ال عملتها لحضرتك هو ${rep}`;
  }

  function setResult(text, ok){
    elResult.textContent = text;
    elResult.classList.remove("is-ok","is-bad");
    elResult.classList.add(ok ? "is-ok" : "is-bad");
  }

  // Gentle bell (no external files)
  let bellCtx = null;
  function bell(){
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      if(!bellCtx) bellCtx = new AC();
      const ctx = bellCtx;
      if(ctx.state === "suspended") ctx.resume().catch(()=>{});

      const t0 = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1180, t0 + 0.08);
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + 0.24);
    }catch{}
  }

  async function copyText(txt){
    const text = String(txt || "");
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch{}
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly","readonly");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    }catch{
      return false;
    }
  }

  function doCheck(){
    const map = parseImpacted();
    const q = normalizeLine(elSearch.value);

    // Default: hide + clear message until a match happens
    showMessageBox(false);
    elMsg.value = "";

    if(!q){
      setResult("اكتب BRAS/IP علشان تدور عليه.", false);
      return;
    }

    const hit = map.get(q.toLowerCase());
    if(hit){
      bell();
      setResult(`🔔 متطابق بالفعل: ${hit}`, true);
      elMsg.value = buildMessage();
      showMessageBox(true);
      return;
    }

    setResult("مش موجود في قائمة الـ Impacted Bras (لازم يطابق بالكامل).", false);
  }

  elBtn.addEventListener("click", doCheck);
  elSearch.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      doCheck();
    }
  });
  elComplaint?.addEventListener("input", ()=>{
    // Only update text if message box is currently visible
    if(elMsgRow && !elMsgRow.classList.contains("outage-mail-hidden")){
      elMsg.value = buildMessage();
    }
  });

  elCopy.addEventListener("click", async ()=>{
    if(!elMsg.value){
      elMsg.value = buildMessage();
    }
    const ok = await copyText(elMsg.value);
    if(ok){
      setResult("✅ تم نسخ رسالة الاوتج.", true);
    }else{
      setResult("⚠️ مقدرتش أنسخ تلقائيًا. انسخ يدويًا من مربع الرسالة.", false);
    }
  });

  // Initialize
  showMessageBox(false);
  elMsg.value = "";
  setResult("اكتب BRAS/IP في البحث واضغط Check.", false);
})();

/* My Time Architecture v11 — Call Back OCR feature.
   Extracted intact from app.js and loaded only on Call Back intent.
   Tesseract remains engine-lazy through ocr-lazy-loader.js. */

/* =========================================================
   OCR Paste Box (Call Back) - Paste screenshot -> Copy text
   Uses ClipboardEvent.clipboardData inside paste handler:
   https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData
   ========================================================= */
/* ==========================================================
   Call Back: Paste Screenshot -> OCR (Arabic + English)
   - Premium UI hooks in styles.css (.cbOcrBox)
   - Uses tessdata_best for higher accuracy (slower first load)
   - Robust preprocessing for small text + optional auto-deskew
   ========================================================== */
(function initCallbackOcrPasteBox(){
  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(() => {
    const zone = document.getElementById('cbOcrPasteZone');
    const catcher = document.getElementById('cbOcrPasteCatcher');
    const preview = document.getElementById('cbOcrPreview');
    const status = document.getElementById('cbOcrStatus');
    const out = document.getElementById('cbOcrText');
    const extractBtn = document.getElementById('cbOcrExtractBtn');
    const hqBtn = document.getElementById('cbOcrHqBtn');
    const copyBtn = document.getElementById('cbOcrCopyBtn');
    const clearBtn = document.getElementById('cbOcrClearBtn');

    if(!zone || !catcher || !preview || !status || !out || !extractBtn || !hqBtn || !copyBtn || !clearBtn) return;

    const PLACEHOLDER_HTML = 'اضغط هنا ثم Ctrl+V للصق الصورة…<div class="ocrSubHint">Drag &amp; Drop صورة هنا</div>';
    const setStatus = (t) => { status.textContent = t; };
    const resetZoneText = () => { zone.innerHTML = PLACEHOLDER_HTML; };

    // Make sure placeholder is visible
    if(!zone.innerHTML || !zone.innerHTML.trim()) resetZoneText();
    // The big zone is visual-only; we use a hidden input to reliably receive Ctrl+V.
    // This avoids cases where overlays/selection steal focus.
    catcher.setAttribute('aria-hidden','true');
    catcher.value = '';

    let lastImageFile = null;
    let isOcrRunning = false;

    // Extract button UX
    const setExtractEnabled = (on) => {
      extractBtn.disabled = !on;
      extractBtn.style.opacity = on ? '1' : '0.6';
    };
    setExtractEnabled(false);

    // ---------- Helpers ----------
    function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

    // Rough estimate of ink density (how much "black" content exists).
    // Used to skip deskew on nearly-empty images (saves time & avoids false skew).
    function estimateInkRatio(imgData){
      try{
        const d = imgData.data;
        const totalPx = Math.max(1, (d.length / 4) | 0);

        // Sample every Nth pixel for speed.
        const step = Math.max(1, Math.floor(totalPx / 120000)); // cap ~120k samples
        let ink = 0;
        let sampled = 0;

        for(let p=0; p<totalPx; p+=step){
          const i = p * 4;
          const r = d[i], g = d[i+1], b = d[i+2];
          const lum = (0.2126*r + 0.7152*g + 0.0722*b);
          if(lum < 160) ink++; // "dark" threshold
          sampled++;
        }
        return sampled ? (ink / sampled) : 0;
      }catch(_e){
        return 0;
      }
    }

    async function fileToImageBitmap(file){
      if(window.createImageBitmap){
        return await createImageBitmap(file);
      }
      // Fallback
      const img = new Image();
      img.decoding = 'async';
      img.src = URL.createObjectURL(file);
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      return c;
    }

    function canvasFromBitmap(bm, scale){
      const w = Math.max(1, Math.round((bm.width || bm.naturalWidth || bm.videoWidth || bm.clientWidth || bm.width) * scale));
      const h = Math.max(1, Math.round((bm.height || bm.naturalHeight || bm.videoHeight || bm.clientHeight || bm.height) * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bm, 0, 0, w, h);
      return { c, ctx };
    }

    function toGrayscale(imgData){
      const d = imgData.data;
      const g = new Uint8ClampedArray(imgData.width * imgData.height);
      for(let i=0, j=0; i<d.length; i+=4, j++){
        // perceptual luminance
        g[j] = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2])|0;
      }
      return g;
    }

    function contrastStretch(gray){
      let lo=255, hi=0;
      for(let i=0;i<gray.length;i++){
        const v=gray[i];
        if(v<lo) lo=v;
        if(v>hi) hi=v;
      }
      const out = new Uint8ClampedArray(gray.length);
      const range = Math.max(10, hi-lo);
      for(let i=0;i<gray.length;i++){
        out[i] = clamp(((gray[i]-lo)*255)/range, 0, 255);
      }
      return out;
    }

    function otsuThreshold(gray){
      const hist = new Array(256).fill(0);
      for(let i=0;i<gray.length;i++) hist[gray[i]]++;
      const total = gray.length;

      let sum=0;
      for(let t=0;t<256;t++) sum += t*hist[t];

      let sumB=0, wB=0, wF=0;
      let varMax=-1, thresh=128;

      for(let t=0;t<256;t++){
        wB += hist[t];
        if(wB === 0) continue;
        wF = total - wB;
        if(wF === 0) break;
        sumB += t*hist[t];

        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const varBetween = wB*wF*(mB-mF)*(mB-mF);
        if(varBetween > varMax){
          varMax = varBetween;
          thresh = t;
        }
      }
      return thresh;
    }

    function applyBinaryToImageData(imgData, gray, thr){
      const d = imgData.data;
      for(let i=0, j=0; i<d.length; i+=4, j++){
        const v = gray[j] > thr ? 255 : 0;
        d[i]=v; d[i+1]=v; d[i+2]=v;
      }
    }

    function unsharpMask(ctx, amount){
      // Lightweight sharpen: original + amount*(original - blur)
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const src = ctx.getImageData(0,0,w,h);
      const d = src.data;

      // simple box blur (1px radius)
      const blur = new Uint8ClampedArray(d.length);
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          let r=0,g=0,b=0,a=0,count=0;
          for(let yy=Math.max(0,y-1); yy<=Math.min(h-1,y+1); yy++){
            for(let xx=Math.max(0,x-1); xx<=Math.min(w-1,x+1); xx++){
              const k=(yy*w+xx)*4;
              r+=d[k]; g+=d[k+1]; b+=d[k+2]; a+=d[k+3]; count++;
            }
          }
          const i=(y*w+x)*4;
          blur[i]= (r/count)|0;
          blur[i+1]= (g/count)|0;
          blur[i+2]= (b/count)|0;
          blur[i+3]= (a/count)|0;
        }
      }

      for(let i=0;i<d.length;i+=4){
        d[i]   = clamp(d[i]   + amount*(d[i]   - blur[i]),   0, 255);
        d[i+1] = clamp(d[i+1] + amount*(d[i+1] - blur[i+1]), 0, 255);
        d[i+2] = clamp(d[i+2] + amount*(d[i+2] - blur[i+2]), 0, 255);
      }
      ctx.putImageData(src,0,0);
    }

    // ---------- Auto-Deskew ----------
    function scoreRowsBinary(gray, w, h){
      // score = variance of row sums (higher means stronger horizontal alignment)
      const rowSums = new Float64Array(h);
      for(let y=0;y<h;y++){
        let s=0;
        const row=y*w;
        for(let x=0;x<w;x++){
          s += (gray[row+x] < 128) ? 1 : 0; // count black-ish
        }
        rowSums[y]=s;
      }
      let mean=0;
      for(let i=0;i<h;i++) mean += rowSums[i];
      mean/=h;
      let varr=0;
      for(let i=0;i<h;i++){
        const d=rowSums[i]-mean;
        varr += d*d;
      }
      return varr/h;
    }

    function rotateCanvas(srcCanvas, angleDeg){
      const ang = angleDeg * Math.PI/180;
      const w = srcCanvas.width, h = srcCanvas.height;
      const cos = Math.abs(Math.cos(ang));
      const sin = Math.abs(Math.sin(ang));
      const nw = Math.ceil(w*cos + h*sin);
      const nh = Math.ceil(w*sin + h*cos);
      const c = document.createElement('canvas');
      c.width=nw; c.height=nh;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(nw/2, nh/2);
      ctx.rotate(ang);
      ctx.drawImage(srcCanvas, -w/2, -h/2);
      return c;
    }

    function estimateDeskewAngle(binCanvas){
      // Downscale for speed
      const maxW = 700;
      const scale = Math.min(1, maxW / binCanvas.width);
      const { c, ctx } = canvasFromBitmap(binCanvas, scale);
      const img = ctx.getImageData(0,0,c.width,c.height);
      const gray = toGrayscale(img);

      const testAngles = [];
      for(let a=-8; a<=8; a+=1) testAngles.push(a);

      let bestA=0, bestS=-1;
      for(const a of testAngles){
        const rc = rotateCanvas(c, a);
        const rctx = rc.getContext('2d', { willReadFrequently: true });
        const id = rctx.getImageData(0,0,rc.width,rc.height);
        const g = toGrayscale(id);
        const s = scoreRowsBinary(g, rc.width, rc.height);
        if(s > bestS){ bestS=s; bestA=a; }
      }

      // refine around best
      let bestFine = bestA, bestFineS = bestS;
      for(let a=bestA-1; a<=bestA+1; a+=0.25){
        const rc = rotateCanvas(c, a);
        const rctx = rc.getContext('2d', { willReadFrequently: true });
        const id = rctx.getImageData(0,0,rc.width,rc.height);
        const g = toGrayscale(id);
        const s = scoreRowsBinary(g, rc.width, rc.height);
        if(s > bestFineS){ bestFineS=s; bestFine=a; }
      }

      if(Math.abs(bestFine) < 0.25) return 0;
      return clamp(bestFine, -12, 12);
    }

    // ---------- Preprocess pipeline ----------
    async function preprocessForOcr(file, mode){
      const bm = await fileToImageBitmap(file);

      // Dynamic upscale for small screenshots/text:
      // Aim for larger canvas (helps small fonts); cap to prevent huge memory.
      const baseW = bm.width || bm.naturalWidth || bm.clientWidth;
      // FAST mode: quicker preprocessing (less upscale, smarter deskew skip)
      // HQ mode: heavier preprocessing for small fonts / mixed UI text
      const isHq = mode === 'hq';
      /*
       * Use a lower upscale factor for FAST mode to maximise speed while
       * retaining sufficient detail for accurate recognition.  The values
       * below were tuned to reduce the total number of pixels processed by
       * roughly 10–15% compared to the previous version, which yields a
       * noticeable speed‑up without compromising legibility.  HQ mode
       * remains unchanged to provide maximum quality when needed.
       */
      // Slightly upscaled FAST mode improves small-font UI screenshots a lot,
      // without the heavy latency of HQ. HQ stays aggressive for maximum quality.
      let scale = isHq ? 2.2 : 1.2;
      if(baseW < 900) scale = isHq ? 3.2 : 1.5;
      if(baseW < 520) scale = isHq ? 4.2 : 1.8;
      if(baseW < 420) scale = isHq ? 5.0 : 2.0;

      // Hard caps
      const capW = 3600;
      const capScale = capW / baseW;
      scale = Math.min(scale, capScale);

      const { c, ctx } = canvasFromBitmap(bm, scale);

      // Read pixels
      let img = ctx.getImageData(0,0,c.width,c.height);
      let gray = toGrayscale(img);
      gray = contrastStretch(gray);

      // Put stretched gray back into imageData
      for(let i=0, j=0; i<img.data.length; i+=4, j++){
        const v = gray[j];
        img.data[i]=v; img.data[i+1]=v; img.data[i+2]=v;
      }
      ctx.putImageData(img,0,0);

      // Sharpen: HQ stronger. FAST gets a very light sharpen which is cheap enough
      // and significantly improves OCR on tiny UI text.
      if(isHq){
        unsharpMask(ctx, 0.6);
      } else {
        unsharpMask(ctx, 0.25);
      }

      // Binarize (Otsu)
      img = ctx.getImageData(0,0,c.width,c.height);
      const g2 = toGrayscale(img);
      // Compute Otsu's threshold for binarization, then slightly lower it
      // to preserve faint details and inter‑word spaces.  Reducing the
      // threshold by a small amount prevents overly aggressive binarization
      // which can cause narrow gaps between characters to disappear.  Use
      // Math.max() to avoid negative values on very low thresholds.
      const thrBase = otsuThreshold(g2);
      const thr = Math.max(0, thrBase - 10);
      applyBinaryToImageData(img, g2, thr);
      ctx.putImageData(img,0,0);

      // Smart deskew (no UI): detect skew and fix only if needed.
      // Deskewing is expensive, so we only perform it in HQ mode.  For FAST
      // mode, we skip deskew entirely to save time (deskewAngle stays 0).
      let deskewAngle = 0;
      if(isHq){
        try{
          // Skip deskew if image has very little ink (saves time)
          const id0 = ctx.getImageData(0,0,c.width,c.height);
          const ink = estimateInkRatio(id0);
          if(ink > 0.002){
            deskewAngle = estimateDeskewAngle(c);
            // For HQ, ignore tiny angles <1° to avoid overcorrecting
            const minAngle = 1.0;
            if(Math.abs(deskewAngle) < minAngle) deskewAngle = 0;
          }
        }catch(_e){ deskewAngle = 0; }
      }

      let finalCanvas = deskewAngle ? rotateCanvas(c, -deskewAngle) : c;
      // HQ: provide a second grayscale variant for tricky backgrounds.
      // FAST: skip alt to keep latency low.
      let altGray = null;
      if(isHq){
        const { c: grayC, ctx: grayCtx } = canvasFromBitmap(bm, scale);
        const idGray = grayCtx.getImageData(0,0,grayC.width,grayC.height);
        const g3 = contrastStretch(toGrayscale(idGray));
        for(let i=0,j=0; i<idGray.data.length; i+=4,j++){
          const v=g3[j];
          idGray.data[i]=v; idGray.data[i+1]=v; idGray.data[i+2]=v;
        }
        grayCtx.putImageData(idGray,0,0);
        unsharpMask(grayCtx, 0.45);
        altGray = grayC;
      }

      return { main: finalCanvas, altGray, scaleUsed: scale, deskewAngle, isHq };
    }

    // ---------- OCR Worker ----------
    let fastWorker = null;
    let hqWorker = null;
    let fastReady = false;
    let hqReady = false;

    async function ensureWorker(mode){
      const isHq = mode === 'hq';
      if(isHq && hqReady && hqWorker) return hqWorker;
      if(!isHq && fastReady && fastWorker) return fastWorker;
      if(!window.Tesseract || !window.Tesseract.createWorker){
        if(typeof window.__SR_LOAD_TESSERACT_ON_DEMAND === 'function'){
          await window.__SR_LOAD_TESSERACT_ON_DEMAND();
        }
      }
      if(!window.Tesseract || !window.Tesseract.createWorker){
        throw new Error('Tesseract.js not loaded');
      }

      setStatus(isHq ? 'تحميل محرك OCR HQ (أدق لكنه أبطأ) ...' : 'تحميل محرك OCR Fast ...');
      // Use high‑accuracy "best" dataset for HQ mode and faster "fast" dataset for
      // the quick mode.  The fast tessdata is smaller and loads more quickly,
      // helping the FAST OCR mode achieve a significant speed‑up.  The HQ
      // mode retains the "best" dataset for maximum accuracy.
      const langPath = isHq
        ? 'https://tessdata.projectnaptha.com/4.0.0_best/'
        : 'https://tessdata.projectnaptha.com/4.0.0_fast/';

      const w = await window.Tesseract.createWorker(['ara','eng'], 1, { langPath });

      // Parameters: keep spaces, reduce dictionary bias (helps mixed UI text), etc.
      await w.setParameters({
        preserve_interword_spaces: '1',
        // Higher DPI helps with UI screenshots & mixed Arabic/English text.
        user_defined_dpi: isHq ? '450' : '350',
        // reduce dictionary bias for UI/mixed content
        load_system_dawg: '0',
        load_freq_dawg: '0'
      });

      if(isHq){
        hqWorker = w;
        hqReady = true;
        return hqWorker;
      }
      fastWorker = w;
      fastReady = true;
      return fastWorker;
    }

    function pickBestResult(results){
      // Pick by confidence first, then text length.
      let best = null;
      for(const r of results){
        if(!r || !r.data) continue;
        const conf = typeof r.data.confidence === 'number' ? r.data.confidence : -1;
        const text = (r.data.text || '').trim();
        const score = conf + Math.min(30, text.length/30);
        if(!best || score > best.score){
          best = { score, conf, text, raw: r };
        }
      }
      return best;
    }

    
// ---------- OCR Post-Format (Port details template) ----------
function stripInvisibles(s){
  // Remove bidi controls + zero-width chars that can break Arabic/LTR parsing/output
  return (s || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .normalize('NFC');
}

function cleanOcrText(raw){
  let t = stripInvisibles(raw || '');
  // Drop obvious junk separator lines like "="
  t = t.replace(/^\s*=\s*$/gm, '');
  t = t.replace(/\r/g, '');
  // Normalize colon spacing
  t = t.replace(/\s*:\s*/g, ': ');
  // Collapse excessive blank lines
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function normalizeKey(k){
  return stripInvisibles(k || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseKeyValues(ocrText){
  const t = cleanOcrText(ocrText);
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);

  // Aliases to handle OCR variants (Portno/Port no, vel vs VCI, etc.)
  const aliases = {
    'customer number': 'Customer number',
    'phone': 'Phone',
    'fv customer number': 'FV customer number',
    'pop name': 'POP name',
    'arabic pop': 'Arabic pop',
    'card no': 'Card no',
    'cardno': 'Card no',
    'cabin code': 'Cabin code',
    'fcc code': 'FCC code',
    'dslam host name': 'DSLAM host name',
    'dslam hostname': 'DSLAM host name',
    'dslam type': 'DSLAM type',
    'dslam number': 'DSLAM number',
    'english pop': 'English pop',
    'adsl username': 'ADSL username',
    'iptv status': 'IPTV status',
    'has iptv': 'Has IPTV',
    'pop type': 'POP type',
    'card type': 'Card type',
    'port no': 'Port no',
    'portno': 'Port no',
    'frame': 'Frame',
    'vpi': 'VPI',
    'vci': 'VCI',
    'vel': 'VCI',
    'contracted speed': 'Contracted speed',
    'nas port id': 'Nas port id',

    'congested status': 'Congested status',
    'congested date': 'Congested date',
    'copper cabin number': 'Copper cabin number',
    'box number': 'Box number',
    'cpe type': 'CPE type',
    'box coordinates': 'Box coordinates',
    'local loop': 'Local loop',
    'cpe virtual ip': 'CPE virtual ip',
    'has option pack': 'Has option pack',
  };

  const kv = {};

  for(const line of lines){
    const idx = line.indexOf(':');
    if(idx === -1) continue;

    const kRaw = line.slice(0, idx).trim();
    let vRaw = line.slice(idx + 1).trim();

    const nk = normalizeKey(kRaw);
    const canon = aliases[nk];
    if(!canon) continue;

    vRaw = stripInvisibles(vRaw);

    if(canon === 'Arabic pop'){
      vRaw = vRaw
        .replace(/[•·]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    kv[canon] = vRaw;
  }

  return kv;
}

function formatPortDetails(ocrText){
  const kv = parseKeyValues(ocrText);

  const ordered = [
    ['Customer number', 'Customer number:'],
    ['Phone', 'Phone:'],
    ['FV customer number', 'FV customer number:'],
    ['POP name', 'POP name:'],
    ['Arabic pop', 'Arabic pop:'],
    ['Card no', 'Card no:'],
    ['Cabin code', 'Cabin code:'],
    ['FCC code', 'FCC code:'],
    ['DSLAM host name', 'DSLAM host name:'],
    ['DSLAM type', 'DSLAM type:'],
    ['DSLAM number', 'DSLAM number:'],
    ['English pop', 'English pop:'],
    ['ADSL username', 'ADSL username:'],
    ['IPTV status', 'IPTV status:'],
    ['Has IPTV', 'Has IPTV:'],
    ['POP type', 'POP type:'],
    ['Card type', 'Card type:'],
    ['Port no', 'Port no:'],
    ['Frame', 'Frame:'],
    ['VPI', 'VPI:'],
    ['VCI', 'VCI:'],
    ['Contracted speed', 'Contracted speed:'],
    ['Nas port id', 'Nas port id:'],
  ];

  const logs = [
    ['Congested status', 'Congested status:'],
    ['Congested date', 'Congested date:'],
    ['Copper cabin number', 'Copper cabin number:'],
    ['Box number', 'Box number:'],
    ['CPE type', 'CPE type:'],
    ['Box coordinates', 'Box coordinates:'],
    ['Local loop', 'Local loop:'],
    ['CPE virtual ip', 'CPE virtual ip:'],
    ['Has option pack', 'Has option pack:'],
  ];

  const outLines = [];
  outLines.push('Port details');

  function pushField(key, label){
    outLines.push(label);
    outLines.push('');
    outLines.push(kv[key] ?? '');
  }

  for(const [k, label] of ordered){
    pushField(k, label);
  }

  outLines.push('Subscriber database logs');

  for(const [k, label] of logs){
    pushField(k, label);
  }

  return outLines.join('\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
}

    async function runOcr(mode){
      if(!lastImageFile) return;
      if(isOcrRunning) return;

      isOcrRunning = true;
      out.value = '';
      const isHq = mode === 'hq';
      setStatus(isHq ? 'HQ: تحضير الصورة للاستخراج (تحسين أعلى)...' : 'FAST: تحضير الصورة للاستخراج...');
      extractBtn.disabled = true;
      hqBtn.disabled = true;

      try{
        const { main, altGray, deskewAngle } = await preprocessForOcr(lastImageFile, mode);

        // Preview should show the actual processed image for clarity
        preview.src = main.toDataURL('image/png');
        preview.style.display = 'block';

        const w = await ensureWorker(mode);

        // Try multiple PSMs (segmentation modes), pick best
        // psm 6: single uniform block, psm 11: sparse text (UI/labels)
        // For HQ mode, try multiple page segmentation modes for maximum accuracy.
        // In FAST mode, restrict to a single mode (6: uniform block) to speed
        // up recognition dramatically.
        const psmList = isHq ? ['6','11','4'] : ['6'];
        const images = isHq && altGray
          ? [{ tag:'bin', img: main }, { tag:'gray', img: altGray }]
          : [{ tag:'bin', img: main }];

        setStatus(deskewAngle
          ? `${isHq ? 'HQ' : 'FAST'}: OCR جاري... (تم تصحيح الميل ${deskewAngle.toFixed(2)}°)`
          : `${isHq ? 'HQ' : 'FAST'}: OCR جاري...`);

        const allResults = [];
        for(const im of images){
          for(const psm of psmList){
            await w.setParameters({ tessedit_pageseg_mode: psm });
            const res = await w.recognize(im.img);
            allResults.push(res);
            // If already very confident, stop early
            if(res?.data?.confidence >= 85 && (res?.data?.text||'').trim().length >= 20){
              break;
            }
          }
          const last = allResults[allResults.length-1];
          if(last?.data?.confidence >= 88) break;
        }

        const best = pickBestResult(allResults);
        const text = (best?.text || '').trim();

        // IMPORTANT: user wants RAW OCR only (no templates / no fixed formatting)
        out.value = text ? cleanOcrText(text) : '';
        setStatus(text ? `تم ✅ (${isHq ? 'HQ' : 'FAST'}) (Confidence: ${Math.round(best.conf)}%)` : 'لم يتم العثور على نص واضح — جرّب صورة أوضح/أكبر');
        return { text, confidence: (best && typeof best.conf === 'number') ? best.conf : -1 };
      } catch (e){
        console.error(e);
        setStatus('حصل خطأ أثناء OCR — افتح Console للتفاصيل');
        return { text: '', confidence: -1 };
      } finally{
        isOcrRunning = false;
        setExtractEnabled(!!lastImageFile);
        extractBtn.disabled = false;
        hqBtn.disabled = false;
      }
    }

    // ---------- Events ----------
    async function onNewImageFile(file){
      lastImageFile = file;
      setExtractEnabled(true);
      setStatus('جاهز — Extract (Fast) سريع أو HQ أدق');
      // Auto-run FAST by default, then auto-fallback to HQ if the result looks weak.
      const fastRes = await runOcr('fast');
      const fastText = (fastRes?.text || '').trim();
      const fastConf = typeof fastRes?.confidence === 'number' ? fastRes.confidence : -1;
      // Heuristics tuned for UI screenshots: low confidence or very short output.
      if(fastText && fastConf >= 80) return;
      if(fastText.length >= 35 && fastConf >= 70) return;
      await runOcr('hq');
    }


// Detect whether Call Back tab is currently visible
function isCallBackActive(){
  const cb = document.getElementById('Call Back');
  if(!cb) return true;
  // Some layouts make offsetParent null even when visible; rely on computed display + client rects.
  const style = window.getComputedStyle(cb);
  if(style.display === 'none' || style.visibility === 'hidden') return false;
  return cb.getClientRects().length > 0;
}

function extractImageFileFromClipboardEvent(e){
  const cd = e.clipboardData;
  if(!cd) return null;

  // Prefer files list (works well on document-level listeners too)
  if(cd.files && cd.files.length){
    for(const f of cd.files){
      if(f && f.type && f.type.startsWith('image/')) return f;
    }
  }

  // Fallback to items
  if(cd.items && cd.items.length){
    for(const item of cd.items){
      if(item.type && item.type.startsWith('image/')){
        const f = item.getAsFile();
        if(f) return f;
      }
    }
  }

  // Extra fallback: some tools put the image as a data-URL inside text/html.
  // If we can extract it, convert to a File and process it.
  try{
    if(cd.types && Array.from(cd.types).includes('text/html')){
      const html = cd.getData('text/html') || '';
      const m = html.match(/src\s*=\s*"(data:image\/[a-zA-Z0-9.+-]+;base64,[^"]+)"/i);
      if(m && m[1]){
        const file = dataUrlToFile(m[1], 'pasted-image.png');
        if(file) return file;
      }
    }
  }catch(_e){ /* ignore */ }
  return null;
}

function dataUrlToFile(dataUrl, filename){
  try{
    const parts = dataUrl.split(',');
    if(parts.length < 2) return null;
    const mimeMatch = parts[0].match(/data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const b64 = parts.slice(1).join(',');
    const bin = atob(b64);
    const len = bin.length;
    const u8 = new Uint8Array(len);
    for(let i=0;i<len;i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], filename, { type: mime });
  }catch(_e){
    return null;
  }
}

function handlePasteForOcr(e){
  // If an image is present, ALWAYS hijack the paste and route it into the OCR tool.
  // This prevents the browser from pasting it into some other focused element.
  if(!isCallBackActive()) return;
  const file = extractImageFileFromClipboardEvent(e);
  if(file){
    e.preventDefault();
    e.stopPropagation();
    onNewImageFile(file);
  }
}

    // Paste image (reliable catcher + direct zone paste)
    catcher.addEventListener('paste', handlePasteForOcr);
    zone.addEventListener('paste', handlePasteForOcr);

    // Also bind to the big zone itself (contenteditable) so pasting works even if catcher focus fails.
    zone.addEventListener('paste', handlePasteForOcr);

    // Also listen at document level so Ctrl+V works even if the zone isn't focused
    // (as long as the user is currently on Call Back tab).
    document.addEventListener('paste', handlePasteForOcr, true);

    // Drag & Drop
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.opacity = '0.9'; });
    zone.addEventListener('dragleave', () => { zone.style.opacity = '1'; });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.opacity = '1';
      const file = e.dataTransfer?.files?.[0];
      if(file && file.type && file.type.startsWith('image/')) onNewImageFile(file);
    });

    // Click focus: always focus the hidden paste catcher
    const focusCatcher = () => {
      try{ catcher.focus({ preventScroll: true }); }catch{ catcher.focus(); }
    };
    zone.addEventListener('pointerdown', focusCatcher);
    zone.addEventListener('click', focusCatcher);
    // Also focus catcher when mouse enters the tool (helps quick Ctrl+V)
    zone.addEventListener('mouseenter', () => { if(document.activeElement !== catcher) focusCatcher(); });

    // Keep catcher clean (no visible typing anyway)
    catcher.addEventListener('input', () => { catcher.value = ''; });

    extractBtn.addEventListener('click', () => runOcr('fast'));
    hqBtn.addEventListener('click', () => runOcr('hq'));

    copyBtn.addEventListener('click', async () => {
      const text = (out.value || '').trim();
      if(!text){ setStatus('مفيش نص يتنسخ'); return; }
      try{
        await navigator.clipboard.writeText(text);
        setStatus('Copied ✅');
      }catch(_e){
        out.select();
        document.execCommand('copy');
        setStatus('Copied ✅');
      }
    });

    clearBtn.addEventListener('click', () => {
      lastImageFile = null;
      out.value = '';
      preview.src = '';
      preview.style.display = 'none';
      resetZoneText();
      setExtractEnabled(false);
      setStatus('جاهز');
      zone.focus();
    });

    // Performance-safe behavior for weak devices:
    // keep OCR fully on-demand instead of warming it during page load.
    // The first OCR run may take a little longer, but normal page entry
    // becomes noticeably lighter and avoids background CPU/memory work.

    setStatus('جاهز (اضغط داخل المربع ثم Ctrl+V)');
  });
})();

/*
 * SR OCR lazy loader.
 * Keeps the Tesseract OCR engine fully on-demand. The public API remains
 * window.Tesseract.createWorker()/recognize(), so existing OCR logic is not
 * reordered or rewritten.
 */
(function(){
  'use strict';
  if (window.__SR_OCR_LAZY_LOADER_V1) return;
  window.__SR_OCR_LAZY_LOADER_V1 = true;

  var TESSERACT_SRC = 'https://unpkg.com/tesseract.js@5.0.5/dist/tesseract.min.js';
  var TESSDATA_ORIGIN = 'https://tessdata.projectnaptha.com';
  var loadPromise = null;
  var shim = null;
  var hinted = false;
  var imageTuneTimer = 0;

  function onIdle(fn, timeout){
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: timeout || 1200 });
    } else {
      setTimeout(fn, Math.min(timeout || 800, 1200));
    }
  }

  function addHint(rel, href, crossOrigin){
    try {
      if (document.querySelector('link[rel="' + rel + '"][href="' + href + '"]')) return;
      var link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (crossOrigin) link.crossOrigin = 'anonymous';
      (document.head || document.documentElement).appendChild(link);
    } catch (_) {}
  }

  function ensureResourceHints(){
    if (hinted) return;
    hinted = true;
    addHint('preconnect', 'https://unpkg.com', true);
    addHint('preconnect', TESSDATA_ORIGIN, true);
  }

  function tuneImages(){
    try {
      var imgs = document.images || [];
      var viewportH = window.innerHeight || 0;
      for (var i = 0; i < imgs.length; i += 1) {
        var img = imgs[i];
        if (!img) continue;
        if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
        if (!img.hasAttribute('loading') && viewportH) {
          var rect = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
          if (rect && rect.top > viewportH * 1.25) img.setAttribute('loading', 'lazy');
        }
      }
    } catch (_) {}
  }

  function scheduleImageTune(){
    if (imageTuneTimer) return;
    imageTuneTimer = setTimeout(function(){
      imageTuneTimer = 0;
      onIdle(tuneImages, 1400);
    }, 120);
  }

  function realReady(){
    return !!(window.Tesseract && window.Tesseract !== shim && typeof window.Tesseract.createWorker === 'function');
  }

  function load(){
    if (realReady()) return Promise.resolve(window.Tesseract);
    if (loadPromise) return loadPromise;
    ensureResourceHints();

    loadPromise = new Promise(function(resolve, reject){
      try {
        var existing = document.querySelector('script[data-sr-real-tesseract="1"],script[src*="tesseract.min.js"]');
        if (existing) {
          if (realReady()) return resolve(window.Tesseract);
          existing.addEventListener('load', function(){
            existing.dataset.srLoaded = '1';
            realReady() ? resolve(window.Tesseract) : reject(new Error('Tesseract loaded but unavailable'));
          }, { once: true });
          existing.addEventListener('error', function(){ reject(new Error('Tesseract load failed')); }, { once: true });
          return;
        }

        var script = document.createElement('script');
        script.src = TESSERACT_SRC;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.dataset.srRealTesseract = '1';
        script.onload = function(){
          script.dataset.srLoaded = '1';
          realReady() ? resolve(window.Tesseract) : reject(new Error('Tesseract loaded but unavailable'));
        };
        script.onerror = function(){ reject(new Error('Tesseract load failed')); };
        (document.head || document.documentElement).appendChild(script);
      } catch (err) {
        reject(err);
      }
    }).catch(function(err){
      loadPromise = null;
      throw err;
    });

    return loadPromise;
  }

  if (!realReady()) {
    shim = {
      __srLazyShim: true,
      createWorker: function(){
        var args = arguments;
        return load().then(function(T){ return T.createWorker.apply(T, args); });
      },
      recognize: function(){
        var args = arguments;
        return load().then(function(T){ return T.recognize.apply(T, args); });
      },
      detect: function(){
        var args = arguments;
        return load().then(function(T){ return T.detect ? T.detect.apply(T, args) : Promise.reject(new Error('Tesseract.detect unavailable')); });
      }
    };
    window.Tesseract = shim;
  }

  window.__SR_LOAD_TESSERACT_ON_DEMAND = load;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleImageTune, { once: true });
  } else {
    scheduleImageTune();
  }
  window.addEventListener('load', scheduleImageTune, { once: true });
})();

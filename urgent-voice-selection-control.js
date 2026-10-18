/*
 * Urgent voice selection controller.
 * Scope: #SR_URGENT_TICKER voice button only.
 * Goal: keep Arabic TTS natural by playing the MP3 exactly as generated.
 * Avoid WebAudio decoding/playbackRate changes because they distort Arabic voices
 * and can fail on fallback MP3 streams.
 */
(function(){
  if (window.__UA07_URGENT_VOICE_SELECTION_CONTROL_V3) return;
  window.__UA07_URGENT_VOICE_SELECTION_CONTROL_V3 = true;

  // Let this controller own the urgent voice button and prevent the older helper
  // from double-handling the same click.
  window.__UA07_URGENT_VOICE_AUTO_ACTIVATION_V10 = true;
  window.__UA07_URGENT_VOICE_AUTO_ACTIVATION_V9 = true;

  var PLAY_SELECTOR = 'button[data-sr-urgent-voice-button="1"]';
  var DEFAULT_VOICE = 'ar-EG-SalmaNeural';
  var activeAudio = null;
  var activeUrl = '';
  var activeKey = '';
  var lastLaunchKey = '';
  var lastLaunchAt = 0;

  function urgentWrap(){ return document.getElementById('SR_URGENT_TICKER'); }
  function urgentStatus(){ return document.getElementById('SR_URGENT_VOICE_STATUS'); }
  function isVisibleUrgent(){
    var wrap = urgentWrap();
    return !!wrap && wrap.style.display === 'block';
  }
  function getButton(){
    var wrap = urgentWrap();
    return wrap ? wrap.querySelector(PLAY_SELECTOR) : null;
  }
  function isVoiceButtonTarget(target){
    try { return !!(target && target.closest && target.closest(PLAY_SELECTOR)); } catch { return false; }
  }
  function isAckTarget(target){
    try { return !!(target && target.closest && target.closest('#SR_URGENT_ACK')); } catch { return false; }
  }
  function getText(btn){
    return String((btn && btn.dataset && btn.dataset.urgentText) || '').replace(/\s+/g, ' ').trim();
  }
  function getVoice(btn){
    var wrap = urgentWrap();
    return String(
      (wrap && wrap.dataset && wrap.dataset.urgentVoice) ||
      (btn && btn.dataset && btn.dataset.urgentVoice) ||
      DEFAULT_VOICE
    ).trim() || DEFAULT_VOICE;
  }
  function voiceLabel(voice){
    var v = String(voice || '').toLowerCase();
    var m = String(voice || '').match(/ar-([A-Z]{2})-([A-Za-z]+)Neural/i);
    var name = m ? m[2] : String(voice || DEFAULT_VOICE);
    var gender = /shakir|hamed|hamdan|taim|fahed|moaz|ali|bassel|rami|jamal|abdullah|laith|hedi|saleh/i.test(v) ? 'رجالي' : 'نسائي';
    return name + ' / ' + gender;
  }
  function keyFor(btn){ return getVoice(btn) + '\n' + getText(btn); }
  function setStatus(message){
    var status = urgentStatus();
    if (!status) return;
    var btn = getButton();
    status.textContent = String(message || '');
    if (btn) status.appendChild(btn);
  }
  function showButton(btn){
    if (!btn || !isVisibleUrgent()) return;
    btn.style.display = 'inline-flex';
    btn.setAttribute('aria-hidden', 'false');
  }
  function hideButton(btn){
    if (!btn) return;
    btn.style.display = 'none';
    btn.setAttribute('aria-hidden', 'true');
  }
  function stopActive(){
    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.removeAttribute('src');
        activeAudio.load && activeAudio.load();
      }
    } catch {}
    try { if (activeUrl) URL.revokeObjectURL(activeUrl); } catch {}
    activeAudio = null;
    activeUrl = '';
    activeKey = '';
  }
  function isAutoplayBlocked(error){
    var name = String((error && error.name) || '');
    var message = String((error && error.message) || '');
    return /NotAllowedError/i.test(name) || /autoplay|user gesture|user activation|not allowed/i.test(message);
  }
  async function fetchTtsBlob(text, voice, allowGoogleFallback){
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try { controller.abort(); } catch {} }, 12000) : null;
    try {
      var res = await fetch('/api/urgent-tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          text: String(text || ''),
          voice: String(voice || DEFAULT_VOICE),
          allowGoogleFallback: !!allowGoogleFallback
        }),
        signal: controller && controller.signal
      });
      var provider = String(res.headers.get('x-ua07-tts-provider') || 'unknown');
      var actualVoice = String(res.headers.get('x-ua07-tts-voice') || voice || DEFAULT_VOICE);
      var contentType = String(res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok) throw new Error('TTS HTTP ' + res.status);
      if (contentType && contentType.indexOf('audio') === -1 && contentType.indexOf('mpeg') === -1 && contentType.indexOf('octet-stream') === -1) {
        throw new Error('TTS invalid content: ' + contentType);
      }
      var blob = await res.blob();
      if (!blob || blob.size < 128) throw new Error('TTS empty audio');
      return { blob: blob, provider: provider, actualVoice: actualVoice };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function fetchTtsBlobRobust(text, voice){
    try {
      return await fetchTtsBlob(text, voice, false);
    } catch (edgeError) {
      // Last resort only. It may sound less natural, but it keeps the message playable
      // when Edge blocks or times out.
      var fallback = await fetchTtsBlob(text, voice, true);
      fallback.edgeError = edgeError;
      return fallback;
    }
  }
  function createAudioFromBlob(blob){
    if (activeUrl) {
      try { URL.revokeObjectURL(activeUrl); } catch {}
    }
    activeUrl = URL.createObjectURL(blob);
    var audio = new Audio(activeUrl);
    audio.preload = 'auto';
    audio.autoplay = false;
    audio.setAttribute('playsinline', '');
    audio.playsInline = true;
    // Keep the natural pitch/rate from the generated Arabic voice.
    try { audio.playbackRate = 1; } catch {}
    try { audio.preservesPitch = true; } catch {}
    try { audio.mozPreservesPitch = true; } catch {}
    try { audio.webkitPreservesPitch = true; } catch {}
    activeAudio = audio;
    return audio;
  }
  async function playSelectedVoice(btn){
    var text = getText(btn);
    var requestedVoice = getVoice(btn);
    var key = keyFor(btn);
    if (!text || !isVisibleUrgent()) return;

    var now = Date.now();
    if (lastLaunchKey === key && now - lastLaunchAt < 650) return;
    lastLaunchKey = key;
    lastLaunchAt = now;

    stopActive();
    activeKey = key;
    hideButton(btn);
    setStatus('جاري تجهيز الصوت العربي: ' + voiceLabel(requestedVoice));

    var result = await fetchTtsBlobRobust(text, requestedVoice);
    if (!isVisibleUrgent() || activeKey !== key) return;

    var audio = createAudioFromBlob(result.blob);
    var providerText = /fallback|google/i.test(result.provider) ? 'صوت احتياطي' : 'صوت Edge طبيعي';

    audio.onplaying = function(){
      if (!isVisibleUrgent() || activeKey !== key) return;
      setStatus('جاري القراءة: ' + voiceLabel(requestedVoice) + ' - ' + providerText);
      hideButton(getButton());
    };
    audio.onended = function(){
      if (!isVisibleUrgent() || activeKey !== key) return;
      setStatus('انتهت القراءة - آخر صوت: ' + voiceLabel(requestedVoice));
      showButton(getButton());
    };
    audio.onerror = function(){
      if (!isVisibleUrgent() || activeKey !== key) return;
      setStatus('تعذر تشغيل الصوت - اضغط لإعادة المحاولة');
      showButton(getButton());
    };

    try {
      await audio.play();
    } catch (error) {
      if (!isVisibleUrgent() || activeKey !== key) return;
      if (isAutoplayBlocked(error)) {
        setStatus('المتصفح منع التشغيل التلقائي - اضغط تشغيل الصوت');
      } else {
        setStatus('تعذر تشغيل الصوت: ' + String((error && error.message) || error || 'unknown'));
      }
      showButton(getButton());
    }
  }

  function shouldHandleKey(event){
    if (event.type !== 'keydown') return true;
    var key = String(event.key || '');
    return key === 'Enter' || key === ' ' || key === 'Spacebar';
  }
  function handleVoiceIntent(event){
    if (!isVisibleUrgent()) return;
    if (isAckTarget(event.target)) {
      stopActive();
      return;
    }
    if (!isVoiceButtonTarget(event.target)) return;
    if (!shouldHandleKey(event)) return;

    var btn = getButton();
    if (!btn) return;
    try {
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch {}

    playSelectedVoice(btn).catch(function(error){
      if (!isVisibleUrgent()) return;
      setStatus('تعذر تشغيل الصوت المختار: ' + String((error && error.message) || error || 'unknown'));
      showButton(getButton());
    });
  }

  ['pointerdown','mousedown','touchstart','keydown','click'].forEach(function(evt){
    document.addEventListener(evt, handleVoiceIntent, true);
  });
})();

/*
  Notification sound (gentle) for new incoming messages.

  IMPORTANT (autoplay restrictions):
  Modern browsers block audio until a user gesture happens.
  To avoid console warnings (and to be correct), we DO NOT create
  an AudioContext until after the first user interaction.
*/

const LS_KEY = "sr_tool_sound_enabled";

let enabled = true;
try {
  // default: enabled, unless explicitly disabled
  enabled = localStorage.getItem(LS_KEY) !== "0";
} catch {}

let ctx = null;
let unlocked = false;
let lastPlayedAt = 0;

function canUseWebAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  return !!AC;
}

function createCtxAfterGesture() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

export function setSoundEnabled(v) {
  enabled = !!v;
  try {
    localStorage.setItem(LS_KEY, enabled ? "1" : "0");
  } catch {}
}

export function isSoundEnabled() {
  return enabled;
}

export async function unlockSound() {
  if (!enabled) return;
  if (!canUseWebAudio()) return;

  const c = createCtxAfterGesture();
  if (!c) return;

  try {
    if (c.state === "suspended") {
      await c.resume();
    }
  } catch {
    // ignore
  }

  unlocked = (c.state === "running");
}

// A clear but still gentle notification chime.
// الهدف: يبقى أوضح من النسخة القديمة من غير ما يكون مزعج أو حاد.
export async function playSoftNotification() {
  if (!enabled) return;
  if (!ctx || !unlocked) return; // do not create AudioContext before gesture

  const nowMs = Date.now();
  // Slightly longer cooldown so repeated inserts never feel noisy.
  if (nowMs - lastPlayedAt < 1200) return;
  lastPlayedAt = nowMs;

  if (ctx.state !== "running") return;

  const t0 = ctx.currentTime;

  // A tiny dynamics chain keeps the chime audible without harsh peaks.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.85, t0);

  let finalNode = master;
  try {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-22, t0);
    comp.knee.setValueAtTime(14, t0);
    comp.ratio.setValueAtTime(2.2, t0);
    comp.attack.setValueAtTime(0.004, t0);
    comp.release.setValueAtTime(0.10, t0);
    master.connect(comp);
    comp.connect(ctx.destination);
    finalNode = master;
  } catch {
    master.connect(ctx.destination);
  }

  function note({ freq = 880, type = "triangle", start = 0, dur = 0.18, vol = 0.06, harmonic = 0.02 }) {
    const gain = ctx.createGain();
    const when = t0 + start;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    gain.connect(finalNode);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.028, when + dur * 0.45);
    osc.connect(gain);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * 2, when);
    gain2.gain.setValueAtTime(0.0001, when);
    gain2.gain.exponentialRampToValueAtTime(Math.max(0.00015, harmonic), when + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.14, dur - 0.01));
    osc2.connect(gain2);
    gain2.connect(finalNode);

    try {
      osc.start(when);
      osc.stop(when + dur + 0.02);
      osc2.start(when);
      osc2.stop(when + dur);
    } catch {
      // ignore
    }
  }

  // Two-note upward chime: clearer recognition, still soft.
  note({ freq: 784, type: "triangle", start: 0.00, dur: 0.16, vol: 0.050, harmonic: 0.012 });
  note({ freq: 1046, type: "triangle", start: 0.12, dur: 0.22, vol: 0.070, harmonic: 0.018 });
}


// A slightly richer chime dedicated to the urgent moving banner.
// الهدف: يبقى ملفت وجذاب، لكن يظل مهني ومش مزعج.
export async function playUrgentBannerNotification() {
  if (!enabled) return;
  if (!ctx || !unlocked) return;
  if (ctx.state !== "running") return;

  const nowMs = Date.now();
  if (nowMs - lastPlayedAt < 1800) return;
  lastPlayedAt = nowMs;

  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, t0);
  master.connect(ctx.destination);

  function note({ freq = 880, start = 0, dur = 0.16, vol = 0.05, type = "triangle" }) {
    const when = t0 + start;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    gain.connect(master);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.02, when + dur * 0.5);
    osc.connect(gain);

    try {
      osc.start(when);
      osc.stop(when + dur + 0.02);
    } catch {}
  }

  note({ freq: 659, start: 0.00, dur: 0.13, vol: 0.040, type: "triangle" });
  note({ freq: 880, start: 0.10, dur: 0.16, vol: 0.052, type: "triangle" });
  note({ freq: 1174, start: 0.22, dur: 0.24, vol: 0.062, type: "sine" });
}

// Auto unlock on first user gesture (this is where we create the AudioContext)
(function armAutoUnlock() {
  const handler = () => {
    unlockSound();
  };
  try {
    window.addEventListener("pointerdown", handler, { once: true, capture: true });
    window.addEventListener("keydown", handler, { once: true, capture: true });
  } catch {
    // ignore
  }
})();

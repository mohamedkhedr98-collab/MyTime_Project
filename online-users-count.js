/*
 * Single owner for tool-wide Supabase Presence plus the header counter UI.
 *
 * Every tab tracks under its own key. The published snapshot is deduplicated by
 * payload.user_id, so multiple tabs belonging to one user still count once.
 */

import { supabase } from "./supabase-client.js";
import { getStableUserId, getStablePresenceLabel, aliasForUserId } from "./stable-user-identity.js";
import { createPresenceSnapshot, hasPresenceSession } from "./presence-snapshot.js?v=20260710-presence-store-v2";

const CHANNEL_NAME = "sr_tool_online";
const TAB_ID_KEY = "sr_tool_presence_tab_id";
const OWNER_VERSION = 3;
const USER_ID = getStableUserId();
function createTabId() {
  let id = "";
  try {
    id = globalThis.crypto?.randomUUID?.() || "";
  } catch {}
  if (!id) id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  id = `tab-${id}`;

  // Always replace a copied sessionStorage value. Browsers may clone
  // sessionStorage when a tab is duplicated, but each live document needs its
  // own Presence key.
  try { sessionStorage.setItem(TAB_ID_KEY, id); } catch {}
  return id;
}

function createPresenceOwner() {
  const tabId = createTabId();
  const presenceKey = `${USER_ID}:${tabId}`;
  let channel = null;
  let subscribed = false;
  let generation = 0;
  let starting = null;
  let stopping = null;
  let trackQueue = Promise.resolve();
  let reconnectTimer = 0;
  let intentionallyStopped = false;

  function publish(snapshot) {
    window.__srPresenceSnapshot = snapshot;
    window.dispatchEvent(new CustomEvent("sr:presence-changed", { detail: snapshot }));
    return snapshot;
  }

  function publishUnavailable(status) {
    return publish(createPresenceSnapshot(null, status, Date.now()));
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }

  function syncFromChannel(expectedGeneration) {
    if (!channel || expectedGeneration !== generation || !subscribed) return;
    let state = {};
    try { state = channel.presenceState() || {}; } catch {}

    // A SUBSCRIBED socket alone is not proof that this tab is present. Keep an
    // unknown/connecting snapshot until our tracked meta appears in state.
    if (!hasPresenceSession(state, USER_ID, tabId, presenceKey)) {
      publishUnavailable(navigator.onLine === false ? "reconnecting" : "connecting");
      return;
    }
    publish(createPresenceSnapshot(state, "connected", Date.now()));
  }

  async function performTrack(expectedGeneration) {
    const activeChannel = channel;
    if (!activeChannel || !subscribed || expectedGeneration !== generation) return;
    try {
      const result = await activeChannel.track({
        user_id: USER_ID,
        tab_id: tabId,
        presence_key: presenceKey,
        display_name: getStablePresenceLabel(),
        alias: aliasForUserId(USER_ID),
        online_at: new Date().toISOString(),
      });
      if (activeChannel !== channel || expectedGeneration !== generation) return;
      if (result && result !== "ok") {
        publishUnavailable("reconnecting");
        return;
      }
      syncFromChannel(expectedGeneration);
    } catch {
      if (activeChannel === channel && expectedGeneration === generation) {
        publishUnavailable("reconnecting");
      }
    }
  }

  function trackCurrentPresence(expectedGeneration = generation) {
    trackQueue = trackQueue
      .catch(() => {})
      .then(() => performTrack(expectedGeneration));
    return trackQueue;
  }

  async function teardown({ publishStatus = "" } = {}) {
    clearReconnectTimer();
    const oldChannel = channel;
    const wasSubscribed = subscribed;
    channel = null;
    subscribed = false;
    generation += 1;
    if (publishStatus) publishUnavailable(publishStatus);
    if (!oldChannel) return;

    try {
      if (wasSubscribed) await oldChannel.untrack();
    } catch {}
    try { await supabase.removeChannel(oldChannel); } catch {}
  }

  function scheduleCleanReconnect(delay = 6000) {
    if (reconnectTimer || intentionallyStopped) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = 0;
      if (intentionallyStopped || subscribed || document.visibilityState === "hidden") return;
      await teardown();
      start();
    }, delay);
  }

  async function start() {
    if (channel || starting) return starting;
    if (stopping) await stopping;
    intentionallyStopped = false;
    publishUnavailable(navigator.onLine === false ? "reconnecting" : "connecting");

    const expectedGeneration = ++generation;
    starting = Promise.resolve().then(() => {
      if (intentionallyStopped || expectedGeneration !== generation) return;
      const nextChannel = supabase.channel(CHANNEL_NAME, {
        config: { presence: { key: presenceKey } },
      });
      channel = nextChannel;

      nextChannel
        .on("presence", { event: "sync" }, () => syncFromChannel(expectedGeneration))
        .on("presence", { event: "join" }, () => syncFromChannel(expectedGeneration))
        .on("presence", { event: "leave" }, () => syncFromChannel(expectedGeneration))
        .subscribe((status) => {
          if (nextChannel !== channel || expectedGeneration !== generation) return;
          if (status === "SUBSCRIBED") {
            clearReconnectTimer();
            subscribed = true;
            publishUnavailable("connecting");
            trackCurrentPresence(expectedGeneration);
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            subscribed = false;
            publishUnavailable("reconnecting");
            // Supabase normally rejoins this same channel. The delayed clean
            // restart is only a watchdog and removes the old channel first.
            scheduleCleanReconnect();
            return;
          }
          if (status === "CLOSED" && !intentionallyStopped) {
            subscribed = false;
            publishUnavailable("reconnecting");
            scheduleCleanReconnect(1200);
          }
        });
    }).catch(() => {
      publishUnavailable("reconnecting");
      scheduleCleanReconnect(1200);
    }).finally(() => {
      starting = null;
    });
    return starting;
  }

  function stop() {
    intentionallyStopped = true;
    if (stopping) return stopping;
    stopping = teardown({ publishStatus: "unknown" }).finally(() => {
      stopping = null;
    });
    return stopping;
  }

  function retrack() {
    if (!subscribed) return Promise.resolve();
    return trackCurrentPresence(generation);
  }

  const owner = Object.freeze({
    version: OWNER_VERSION,
    getSnapshot: () => window.__srPresenceSnapshot || createPresenceSnapshot(null, "unknown", Date.now()),
    start,
    stop,
    retrack,
  });

  window.addEventListener("sr:nickname-updated", retrack);
  window.addEventListener("offline", () => {
    subscribed = false;
    publishUnavailable("reconnecting");
  });
  window.addEventListener("online", () => {
    if (!channel) start();
    else scheduleCleanReconnect(3000);
  });
  window.addEventListener("pagehide", () => {
    stop();
  });
  window.addEventListener("beforeunload", stop);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted || !channel) start();
  });

  return owner;
}

function ensureCountPill() {
  return document.getElementById("UA07_ONLINE_COUNT") || null;
}

function connectedTitle(snapshot) {
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const names = users.map((user) => user.display_name || user.alias || "User");
  const shown = names.slice(0, 12);
  let title = `Online: ${snapshot.count}`;
  if (shown.length) title += `\n${shown.join(", ")}`;
  if (names.length > shown.length) title += `\n+${names.length - shown.length} more`;
  return title;
}

function renderCountPill(pill, snapshot) {
  if (!pill || !snapshot) return;
  const number = pill.querySelector(".ua07-online-num");
  let text = "—";
  let title = "Online count unknown";
  if (snapshot.status === "connected") {
    text = String(snapshot.count);
    title = connectedTitle(snapshot);
  } else if (snapshot.status === "connecting") {
    text = "…";
    title = "Connecting…";
  } else if (snapshot.status === "reconnecting") {
    title = "Reconnecting · Online count unknown";
  }
  if (number) number.textContent = text;
  pill.dataset.presenceStatus = snapshot.status || "unavailable";
  pill.title = title;
  pill.setAttribute("aria-label", title.replace(/\s+/g, " "));
}

function bindCounterConsumer(owner) {
  if (window.__srPresenceCounterBound) return;
  window.__srPresenceCounterBound = true;
  let pill = null;

  const render = (snapshot) => {
    pill = pill || ensureCountPill();
    if (pill) renderCountPill(pill, snapshot || owner.getSnapshot());
  };
  window.addEventListener("sr:presence-changed", (event) => render(event.detail));

  pill = ensureCountPill();
  if (pill) {
    render(owner.getSnapshot());
    return;
  }

  // The header may be injected after this module. Observe that structural
  // change instead of waking the CPU every 250ms. Non-DOM test/SSR contexts
  // simply skip this optional UI binding; Presence ownership still works.
  if (typeof MutationObserver !== "function" || !document.documentElement) return;

  const observer = new MutationObserver(() => {
    pill = ensureCountPill();
    if (!pill) return;
    observer.disconnect();
    render(owner.getSnapshot());
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener("pagehide", () => observer.disconnect(), { once:true });
}

let owner = window.__srPresenceOwner;
if (!owner) {
  owner = createPresenceOwner();
  window.__srPresenceOwner = owner;
  owner.start();
}
bindCounterConsumer(owner);

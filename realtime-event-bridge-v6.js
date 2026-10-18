// Supabase push-only transport for My Time.
// v11 ownership rule: this module owns realtime subscriptions only.
// Request coalescing/cache lives exclusively in runtime/kernel-v11.js.

import { invalidateRuntimeCache } from "./runtime/kernel-v11.js";
import { skipLegacyDmFallback } from "./runtime/realtime-dm-fallback.mjs";
import { installAccountSessionGuard } from "./account-session-guard-v1.js?v=20261004-transfer-v1";

const VERSION = "20260924-architecture-v11";
const GROUP_SUPPORT = "support";
const GROUP_SUGGESTIONS = "suggestions";
const BUS_TOPIC_KEY = "sr_realtime_bus_topic_v2";
const USER_TOPIC_KEY = "sr_realtime_user_topic_v2";
const TAGS_TOPIC_KEY = "sr_realtime_tags_topic_v1";

function safeStorageGet(storage, key){
  try { return String(storage?.getItem?.(key) || ""); } catch { return ""; }
}

function safeStorageSet(storage, key, value){
  try { if(value) storage?.setItem?.(key, String(value)); } catch {}
}

async function resolveTopics(stats, signal){
  let topic = safeStorageGet(localStorage, BUS_TOPIC_KEY) || safeStorageGet(sessionStorage, BUS_TOPIC_KEY);
  let userTopic = safeStorageGet(sessionStorage, USER_TOPIC_KEY);
  let tagsTopic = safeStorageGet(sessionStorage, TAGS_TOPIC_KEY);

  if(/^sr-bus-[a-f0-9]{32,}$/i.test(topic) && /^sr-user-[a-f0-9]{64}$/i.test(userTopic) && /^sr-tags-[a-f0-9]{64}$/i.test(tagsTopic)){
    return { topic, userTopic, tagsTopic };
  }

  try{
    stats.bootstrapWorkerCalls += 1;
    const response = await fetch("/api/realtime-bootstrap", {
      method:"GET",
      credentials:"same-origin",
      headers:{ accept:"application/json" },
      cache:"no-store",
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if(response.ok && data?.ok){
      topic = String(data?.topic || topic || "");
      userTopic = String(data?.user_topic || userTopic || "");
      tagsTopic = String(data?.tags_topic || tagsTopic || "");
      if(/^sr-bus-[a-f0-9]{32,}$/i.test(topic)){
        safeStorageSet(localStorage, BUS_TOPIC_KEY, topic);
        safeStorageSet(sessionStorage, BUS_TOPIC_KEY, topic);
      }
      if(/^sr-user-[a-f0-9]{64}$/i.test(userTopic)){
        safeStorageSet(sessionStorage, USER_TOPIC_KEY, userTopic);
      }
      if(/^sr-tags-[a-f0-9]{64}$/i.test(tagsTopic)){
        safeStorageSet(sessionStorage, TAGS_TOPIC_KEY, tagsTopic);
      }
    }
  }catch{}

  return { topic, userTopic, tagsTopic };
}

function dispatch(name, detail){
  try{ window.dispatchEvent(new CustomEvent(name, { detail })); }catch{}
}

function installBridge(){
  if(typeof window === "undefined") return null;
  if(window.__srRealtimeEventBridgeState) return window.__srRealtimeEventBridgeState;
  const sessionGuard=installAccountSessionGuard();
  sessionGuard.check();

  const stats = {
    version:VERSION,
    invalidations:0,
    realtimeEvents:0,
    realtimeStatus:"starting",
    bootstrapWorkerCalls:0,
    realtimePayloadBytes:0,
    realtimeMaxPayloadBytes:0,
    redundantFallbacksDropped:0,
  };

  const state = {
    version:VERSION,
    stats,
    channels:[],
    globalTopic:"",
    userTopic:"",
    tagsTopic:"",
  };
  let generation = 0, connecting = null, stopping = Promise.resolve();
  let client = null, controller = null, active = true, hadGlobalSubscription = false;
  let retryTimer = 0, closedAttempts = 0, lastCloseAt = 0, closed = false;
  const subscribedTopics = new Set();

  function invalidate(group = "all", meta = {}){
    stats.invalidations += 1;
    invalidateRuntimeCache(group, meta);

    dispatch("sr:realtime-invalidated", {
      group:String(group || "all"),
      table:String(meta?.table || ""),
      op:String(meta?.op || ""),
      targeted:meta?.targeted === true,
      notification_kind:String(meta?.notification_kind || ""),
      notification_user_id:String(meta?.notification_user_id || ""),
      row:meta?.row && typeof meta.row === "object" ? meta.row : null,
      message_id:Number(meta?.message_id) || null,
      reader_user_id:String(meta?.reader_user_id || ""),
      read_count:Number.isFinite(Number(meta?.read_count)) ? Number(meta.read_count) : null,
      actor_user_id:String(meta?.actor_user_id || ""),
      old_reaction:String(meta?.old_reaction || ""),
      new_reaction:String(meta?.new_reaction || ""),
      reply:meta?.reply && typeof meta.reply === "object" ? meta.reply : null,
      mention:meta?.mention && typeof meta.mention === "object" ? meta.mention : null,
      mention_id:Number(meta?.mention_id) || null,
      transport:String(meta?.transport || ""),
      source:String(meta?.source || ""),
    });
  }
  state.invalidate = invalidate;

  function handleBroadcast(message, source){
    stats.realtimeEvents += 1;
    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
    try{
      const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      stats.realtimePayloadBytes += bytes;
      stats.realtimeMaxPayloadBytes = Math.max(stats.realtimeMaxPayloadBytes, bytes);
    }catch{}
    if(skipLegacyDmFallback(source, payload, state.userTopic, subscribedTopics)){
      stats.redundantFallbacksDropped += 1;
      return;
    }
    const kind = String(payload?.kind || "all");

    if(kind === "profile"){
      dispatch("sr:profile-updated", {
        user_id:String(payload?.user_id || ""),
        display_name:String(payload?.display_name || ""),
        source,
      });
      return;
    }

    if(kind === "account"){
      dispatch("sr:account-updated", { ...payload, source });
      return;
    }

    if(kind === "suggestions_public"){
      invalidateRuntimeCache(GROUP_SUGGESTIONS, { ...payload, source });
      dispatch("sr:suggestions-public-event", { ...payload, source });
      return;
    }

    if(kind === "suggestion_reaction"){
      invalidateRuntimeCache(GROUP_SUGGESTIONS, { ...payload, source });
      dispatch("sr:suggestion-reaction-event", { ...payload, source });
      return;
    }

    if(kind === "tags"){
      dispatch("sr:tags-updated", { ...payload, source });
      if(payload?.event && typeof payload.event === "object"){
        dispatch("sr:tags-notification", { ...payload.event, revision:Number(payload?.revision)||0, source });
      }
      return;
    }

    if(kind === "notification"){
      invalidateRuntimeCache("notifications", { ...payload, source });
      dispatch("sr:admin-notification-broadcast", { ...payload, source });
      return;
    }

    invalidate(
      kind === GROUP_SUPPORT || kind === GROUP_SUGGESTIONS ? kind : "all",
      { ...payload, source }
    );
  }

  async function performConnect(expectedGeneration, signal){
    try{
      await stopping;
      const { topic, userTopic, tagsTopic } = await resolveTopics(stats, signal);
      if(!/^sr-bus-[a-f0-9]{32,}$/i.test(topic)){
        stats.realtimeStatus = "fallback-cache";
        return;
      }

      const { supabase } = await import("./supabase-client.js");
      if(!active || expectedGeneration !== generation || signal.aborted) return;
      if(!supabase?.channel){
        stats.realtimeStatus = "fallback-cache";
        return;
      }

      state.globalTopic = topic;
      client = supabase;
      state.userTopic = /^sr-user-[a-f0-9]{64}$/i.test(userTopic) ? userTopic : "";
      state.tagsTopic = /^sr-tags-[a-f0-9]{64}$/i.test(tagsTopic) ? tagsTopic : "";

      const specs = [
        { topic, source:"global" },
        ...(state.userTopic ? [{ topic:state.userTopic, source:"user" }] : []),
        ...(state.tagsTopic ? [{ topic:state.tagsTopic, source:"tags" }] : []),
      ];

      for(const spec of specs){
        const channel = supabase
          .channel(spec.topic)
          .on("broadcast", { event:"invalidate" }, (message) => {
            if(active && expectedGeneration === generation) handleBroadcast(message, spec.source);
          })
          .subscribe((status) => {
            if(expectedGeneration !== generation || !active) return;
            if(status === "SUBSCRIBED"){
              if(spec.source === "user") sessionGuard.check();
              const joined = subscribedTopics.has(spec.topic);
              subscribedTopics.add(spec.topic);
              stats.realtimeStatus = subscribedTopics.size >= specs.length ? "subscribed" : "connecting";
              if(subscribedTopics.size === specs.length){closed = false; clearTimeout(retryTimer); retryTimer = 0;}
              if(spec.source === "global" && !joined){
                if(hadGlobalSubscription || window.__srNotificationStartupWasCached){
                  window.__srNotificationStartupWasCached = false;
                  invalidate("all", { source:"reconnect" });
                }
                hadGlobalSubscription = true;
              }
            }else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"){
              subscribedTopics.delete(spec.topic);
              stats.realtimeStatus = String(status || "reconnecting");
              if(status === "CLOSED") recoverClosedChannel();
            }
          });
        state.channels.push(channel);
      }
    }catch{
      stats.realtimeStatus = "fallback-cache";
    }
  }

  function retireChannels(){
    generation += 1; controller?.abort(); subscribedTopics.clear();
    stopping = Promise.allSettled(state.channels.splice(0).map(channel => client?.removeChannel?.(channel)));
  }
  function recoverClosedChannel(){
    closed = true;
    if(retryTimer || !active) return;
    if(Date.now() - lastCloseAt > 60000) closedAttempts = 0;
    lastCloseAt = Date.now();
    if(closedAttempts >= 5){stats.realtimeStatus = "closed-retry-exhausted";return;}
    const delay = Math.min(60000, 1200 * 2 ** closedAttempts++) * (.8 + Math.random() * .4);
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      if(!active || navigator.onLine === false) return;
      retireChannels();
      Promise.resolve(connecting).then(connectRealtime).catch(()=>{});
    }, delay);
  }

  function connectRealtime(){
    if(!active || state.channels.length || connecting) return connecting;
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 15000);
    const pending = performConnect(generation, controller.signal).finally(() => {
      clearTimeout(timer);
      if(connecting === pending) connecting = null;
    });
    connecting = pending;
    return pending;
  }

  window.addEventListener("pagehide", () => {
    hadGlobalSubscription = true;
    active = false; clearTimeout(retryTimer); retryTimer = 0;
    retireChannels();
    stats.realtimeStatus = "suspended";
  });
  function resume(){
    active = true;
    if(closed && !retryTimer){closedAttempts = 0;retireChannels();}
    Promise.resolve(connecting).then(connectRealtime).catch(()=>{});
  }
  window.addEventListener("pageshow", event => { if(event.persisted) resume(); });
  window.addEventListener("online", () => { if(active && (!state.channels.length || closed)) resume(); });
  state.reconnect = () => { if(active && (closed || !state.channels.length) && !retryTimer) resume(); };

  window.__srRealtimeEventBridgeState = state;
  connectRealtime();
  return state;
}

installBridge();

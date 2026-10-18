/*
 * Pure Presence state helpers.
 *
 * Supabase Presence is keyed per tab, while the UI count is per unique user.
 * Keeping this normalization free of DOM/Realtime side effects makes every
 * Presence consumer use the exact same definition of "online".
 */

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function metaTime(meta) {
  const value = Date.parse(meta?.online_at || meta?.updated_at || "");
  return Number.isFinite(value) ? value : 0;
}

export function collectPresenceUsers(state) {
  const byUserId = new Map();

  for (const [presenceKey, rawMetas] of Object.entries(state || {})) {
    const metas = Array.isArray(rawMetas) ? rawMetas : [];
    for (const meta of metas) {
      const userId = clean(meta?.user_id);
      if (!userId) continue;

      let user = byUserId.get(userId);
      if (!user) {
        user = {
          user_id: userId,
          display_name: "",
          alias: "",
          sessionCount: 0,
          latestOnlineAt: "",
          _latestTime: -1,
          _sessionKeys: new Set(),
        };
        byUserId.set(userId, user);
      }

      const sessionKey = clean(meta?.tab_id || meta?.presence_key || presenceKey);
      if (sessionKey) user._sessionKeys.add(sessionKey);

      const nextTime = metaTime(meta);
      const displayName = clean(meta?.display_name || meta?.name);
      const alias = clean(meta?.alias);
      if (nextTime >= user._latestTime) {
        user._latestTime = nextTime;
        if (displayName) user.display_name = displayName;
        if (alias) user.alias = alias;
        if (meta?.online_at) user.latestOnlineAt = String(meta.online_at);
      } else {
        if (!user.display_name && displayName) user.display_name = displayName;
        if (!user.alias && alias) user.alias = alias;
      }
    }
  }

  return Array.from(byUserId.values())
    .map((user) => ({
      user_id: user.user_id,
      display_name: user.display_name || user.alias || "User",
      alias: user.alias || "",
      sessionCount: user._sessionKeys.size || 1,
      latestOnlineAt: user.latestOnlineAt || "",
    }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
}

export function hasPresenceSession(state, userId, tabId, presenceKey) {
  const expectedUserId = clean(userId);
  const expectedTabId = clean(tabId);
  const expectedPresenceKey = clean(presenceKey);

  for (const [key, rawMetas] of Object.entries(state || {})) {
    const metas = Array.isArray(rawMetas) ? rawMetas : [];
    for (const meta of metas) {
      if (clean(meta?.user_id) !== expectedUserId) continue;
      const metaTabId = clean(meta?.tab_id);
      const metaPresenceKey = clean(meta?.presence_key);
      if (
        (expectedTabId && metaTabId === expectedTabId) ||
        (expectedPresenceKey && (metaPresenceKey === expectedPresenceKey || key === expectedPresenceKey))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function createPresenceSnapshot(state, status = "connected", updatedAt = Date.now()) {
  if (status !== "connected") {
    return Object.freeze({
      status,
      count: null,
      onlineUserIds: Object.freeze([]),
      users: Object.freeze([]),
      updatedAt,
    });
  }

  const users = collectPresenceUsers(state).map((user) => Object.freeze(user));
  const onlineUserIds = users.map((user) => user.user_id);
  return Object.freeze({
    status: "connected",
    count: onlineUserIds.length,
    onlineUserIds: Object.freeze(onlineUserIds),
    users: Object.freeze(users),
    updatedAt,
  });
}

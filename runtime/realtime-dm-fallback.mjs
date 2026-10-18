/**
 * Only legacy, content-free global DM fallback notices are redundant.
 * Never suppress messages if the private user topic has not subscribed.
 * Never suppress account revocations or ordinary public notifications.
 */
export function skipLegacyDmFallback(source, payload, userTopic, subscribedTopics) {
  return source === "global"
    && payload?.kind === "support"
    && payload?.table === "support_messages"
    && payload?.transport === "fallback"
    && /^sr-user-[a-f0-9]{64}$/i.test(String(userTopic || ""))
    && subscribedTopics?.has?.(userTopic) === true;
}

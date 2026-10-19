/*
 * The two things a reply must leave behind for the very next message, on every channel:
 *   - last_intent:     what was just answered or asked ("catalog_browse_ask", "shipping_fee", …)
 *   - catalog_browse:  the browse slots still open (type / size / grade / audience / brand), or null
 *
 * WhatsApp keeps memory in ai_conversation_memories.preferences (snake_case); Messenger and
 * Instagram in the in-process runtime memory (camelCase: lastIntent / catalogBrowse). Readers go
 * through readDecisionFlowMemory so they see the same values whichever store the channel uses.
 */

const text = (value = "") => String(value ?? "").trim();

export const decisionFlowMemoryPatch = (decision = {}) => {
  const updates = decision?.memory_updates || decision?.memoryUpdates || decision?.ai_memory_patch?.preferences || {};
  const lastIntent = text(updates.last_intent || decision?.detected_intent || decision?.intent);
  return {
    ...(lastIntent ? { last_intent: lastIntent } : {}),
    catalog_browse: updates.catalog_browse && typeof updates.catalog_browse === "object" ? updates.catalog_browse : null,
  };
};

export const readDecisionFlowMemory = (memory = {}) => {
  const preferences = memory?.preferences && typeof memory.preferences === "object" ? memory.preferences : {};
  const browse = preferences.catalog_browse ?? memory?.catalogBrowse ?? memory?.catalog_browse ?? null;
  return {
    lastIntent: text(preferences.last_intent || memory?.lastIntent || memory?.last_intent),
    catalogBrowse: browse && typeof browse === "object" ? browse : null,
  };
};

export default { decisionFlowMemoryPatch, readDecisionFlowMemory };

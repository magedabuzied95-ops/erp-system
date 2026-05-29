const memory = new Map();

export function updateConversationMemory(conversationId, data = {}) {
  if (!conversationId) return null;

  const current = memory.get(conversationId) || {};
  const next = {
    ...current,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  memory.set(conversationId, next);
  return next;
}

export function getConversationMemory(conversationId) {
  if (!conversationId) return null;
  return memory.get(conversationId) || null;
}

export function clearConversationMemory(conversationId) {
  if (!conversationId) return false;
  return memory.delete(conversationId);
}

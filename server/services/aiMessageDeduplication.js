const processedMessages = new Map();

const TTL_MS = 30 * 1000;

export function isDuplicateMessage(messageId) {
  if (!messageId) return false;

  const now = Date.now();

  for (const [key, value] of processedMessages.entries()) {
    if (now - value > TTL_MS) {
      processedMessages.delete(key);
    }
  }

  if (processedMessages.has(messageId)) {
    return true;
  }

  processedMessages.set(messageId, now);

  return false;
}

const processedMessages = new Map();

const TTL_MS = 30 * 1000;

export function isDuplicateMessage(messageId) {
  if (!messageId) return false;

  const now = Date.now();

  for (const [key, value] of processedMessages.entries()) {
    const at = typeof value === "object" ? value.at : value;
    if (now - at > TTL_MS) {
      processedMessages.delete(key);
    }
  }

  const existing = processedMessages.get(messageId);
  if (existing?.status === "failed") {
    processedMessages.set(messageId, { at: now, status: "processing" });
    return false;
  }

  if (existing) {
    return true;
  }

  processedMessages.set(messageId, { at: now, status: "processing" });

  return false;
}

export function getMessageProcessingStatus(messageId) {
  if (!messageId) return "";
  const existing = processedMessages.get(messageId);
  if (!existing) return "";
  return typeof existing === "object" ? existing.status || "" : "processing";
}

export function markMessageProcessingStatus(messageId, status = "processing") {
  if (!messageId) return;
  processedMessages.set(messageId, { at: Date.now(), status });
}

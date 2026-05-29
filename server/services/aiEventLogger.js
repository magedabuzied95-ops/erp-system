import crypto from "crypto";

const MAX_LOGS = 200;
const logs = [];

export function pushAIEvent(event = {}) {
  logs.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  });

  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
}

export function getAIEvents() {
  return logs;
}

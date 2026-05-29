export const COMMAND_CENTER_EVENT_LIMIT = 40;
export const COMMAND_CENTER_TICKER_LIMIT = 12;
export const COMMAND_CENTER_HIGHLIGHT_MS = 3600;

export const commandCenterSocketEvents = Object.freeze([
  "new_order",
  "payment_success",
  "payment_confirmed",
  "dashboard:activity",
  "dashboard:stock-alert",
  "notification:new",
  "ai:new-message",
  "ai:exact-product-found",
  "ai:no-results",
  "ai:escalation",
  "attendance:check-in",
  "attendance:check-out",
  "staff_tasks:event",
  "staff_tasks:created",
  "staff_tasks:completed",
]);

export const commandCenterPriorityOrder = Object.freeze({
  critical: 0,
  high: 1,
  normal: 2,
});

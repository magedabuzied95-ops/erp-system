export const ACTIVITY_FEED_LIMIT = 80;
export const ACTIVITY_FEED_STORAGE_KEY = "erp.liveActivityFeed.items";
export const ACTIVITY_HIGHLIGHT_MS = 4500;
export const ACTIVITY_DEDUPE_WINDOW_MS = 2200;

export const ACTIVITY_FILTERS = Object.freeze([
  { id: "all", labelKey: "dashboard.activity.filters.all" },
  { id: "orders", labelKey: "dashboard.activity.filters.orders" },
  { id: "pos", labelKey: "dashboard.activity.filters.pos" },
  { id: "ai", labelKey: "dashboard.activity.filters.ai" },
  { id: "inventory", labelKey: "dashboard.activity.filters.inventory" },
  { id: "attendance", labelKey: "dashboard.activity.filters.attendance" },
  { id: "staff_tasks", labelKey: "dashboard.activity.filters.staffTasks" },
  { id: "system", labelKey: "dashboard.activity.filters.system" },
]);

export const ACTIVITY_PRIORITY_FILTERS = Object.freeze([
  { id: "all", labelKey: "dashboard.activity.priority.all" },
  { id: "critical", labelKey: "dashboard.activity.priority.critical" },
  { id: "high", labelKey: "dashboard.activity.priority.high" },
  { id: "normal", labelKey: "dashboard.activity.priority.normal" },
]);

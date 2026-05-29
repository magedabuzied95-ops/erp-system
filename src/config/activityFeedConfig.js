export const ACTIVITY_FEED_LIMIT = 80;
export const ACTIVITY_FEED_STORAGE_KEY = "erp.liveActivityFeed.items";
export const ACTIVITY_HIGHLIGHT_MS = 4500;
export const ACTIVITY_DEDUPE_WINDOW_MS = 2200;

export const ACTIVITY_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "orders", label: "Orders" },
  { id: "pos", label: "POS" },
  { id: "ai", label: "AI" },
  { id: "inventory", label: "Inventory" },
  { id: "attendance", label: "Attendance" },
  { id: "staff_tasks", label: "Staff Tasks" },
  { id: "system", label: "System" },
]);

export const ACTIVITY_PRIORITY_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
]);

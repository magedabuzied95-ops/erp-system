export const REALTIME_PRIORITIES = Object.freeze(["critical", "high", "normal", "silent"]);

export const realtimePriorityConfig = Object.freeze({
  critical: {
    sound: true,
    toast: "large",
    vibrate: true,
    browserNotification: true,
    glow: "strong",
    badgeAnimation: "urgent",
    throttleMs: 900,
    toastDuration: 7000,
  },
  high: {
    sound: true,
    toast: "normal",
    vibrate: true,
    browserNotification: true,
    glow: "medium",
    badgeAnimation: "pulse",
    throttleMs: 1600,
    toastDuration: 4800,
  },
  normal: {
    sound: "optional",
    toast: "compact",
    vibrate: false,
    browserNotification: false,
    glow: "soft",
    badgeAnimation: "soft",
    throttleMs: 4200,
    toastDuration: 3000,
  },
  silent: {
    sound: false,
    toast: false,
    vibrate: false,
    browserNotification: false,
    glow: "none",
    badgeAnimation: "none",
    throttleMs: 6000,
    toastDuration: 0,
  },
});

export const priorityRank = Object.freeze({ silent: 0, normal: 1, high: 2, critical: 3 });

export const normalizeRealtimePriority = (priority = "normal") =>
  REALTIME_PRIORITIES.includes(String(priority).toLowerCase()) ? String(priority).toLowerCase() : "normal";

export const getRealtimePriorityBehavior = (priority = "normal") =>
  realtimePriorityConfig[normalizeRealtimePriority(priority)] || realtimePriorityConfig.normal;

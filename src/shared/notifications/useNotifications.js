import { createContext, useContext } from "react";

export const NotificationsContext = createContext(null);

const fallbackNotifications = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: "",
  refresh: async () => [],
  refreshCount: async () => 0,
  markRead: async () => {},
  markAllRead: async () => {},
  remove: async () => {},
};

export const useNotifications = () => {
  const context = useContext(NotificationsContext);
  if (!context) {
    console.error("[notifications] useNotifications called outside NotificationsProvider");
    return fallbackNotifications;
  }
  return context;
};

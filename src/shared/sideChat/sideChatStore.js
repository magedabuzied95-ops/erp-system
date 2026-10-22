import { useSyncExternalStore } from "react";

import { getCurrentTenant, getCurrentUser } from "../auth/authStorage";

/*
 * The side chat: Genie's chat panel docked next to whatever ERP page is open.
 * The page shrinks to make room. The panel shows the conversation list, or one
 * conversation (with a back arrow to the list); its header toggle folds it to a
 * thin rail so the page gets its width back while the thread stays loaded, and
 * the cross closes it.
 *
 * A tiny external store rather than context so the topbar bell, the layout
 * grid and the panel itself read the same thing without threading props
 * through MainLayout.
 */

const COLLAPSED_STORAGE_KEY = "erp.sideChat.collapsed";

const readCollapsed = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeCollapsed = (collapsed) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* preference only */
  }
};

const state = { open: false, collapsed: readCollapsed(), conversation: null, openedAt: 0 };
let snapshot = { ...state };
const subscribers = new Set();

const emit = () => subscribers.forEach((listener) => listener());
const setState = (patch) => {
  Object.assign(state, patch);
  snapshot = { ...state };
  emit();
};

const clean = (value) => String(value ?? "").trim();
export const sideChatConversationKey = (item = {}) => clean(item?.conversation_key || item?.session_id || item?.conversation_id);

// A conversation opened from anywhere (the bell, a list row) unfolds the panel.
export const openSideChat = (conversation) => {
  if (!sideChatConversationKey(conversation)) return false;
  setState({ open: true, collapsed: false, conversation, openedAt: Date.now() });
  return true;
};

export const openSideChatList = () => {
  setState({ open: true, collapsed: false, conversation: null, openedAt: Date.now() });
};

export const backToSideChatList = () => {
  if (!state.conversation) return;
  setState({ conversation: null });
};

export const closeSideChat = () => {
  if (!state.open) return;
  setState({ open: false, conversation: null });
};

export const setSideChatCollapsed = (collapsed) => {
  const next = Boolean(collapsed);
  if (next === state.collapsed) return;
  writeCollapsed(next);
  setState({ collapsed: next });
};

export const toggleSideChatCollapsed = () => setSideChatCollapsed(!state.collapsed);

export const getSideChatState = () => snapshot;

export const useSideChat = () =>
  useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );

// The tenant the inbox calls carry, resolved the way the inbox page resolves it.
export const inboxTenantId = () => {
  const currentTenant = getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

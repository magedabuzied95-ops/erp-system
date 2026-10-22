import { useSyncExternalStore } from "react";

import { getCurrentTenant, getCurrentUser } from "../auth/authStorage";

/*
 * The side chat: one customer conversation docked next to whatever ERP page is
 * open (Genie's chat-from-a-notification move). The page shrinks to make room;
 * the panel can widen, go back to its narrow width, or close.
 *
 * A tiny external store rather than context so the topbar bell, the layout
 * grid and the panel itself read the same thing without threading props
 * through MainLayout.
 */

const SIZE_STORAGE_KEY = "erp.sideChat.size";
export const SIDE_CHAT_SIZES = Object.freeze(["normal", "expanded"]);

const readSize = () => {
  if (typeof window === "undefined") return "normal";
  try {
    const stored = window.localStorage.getItem(SIZE_STORAGE_KEY);
    return SIDE_CHAT_SIZES.includes(stored) ? stored : "normal";
  } catch {
    return "normal";
  }
};

const writeSize = (size) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIZE_STORAGE_KEY, size);
  } catch {
    /* preference only */
  }
};

const state = { conversation: null, size: readSize(), openedAt: 0 };
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

export const openSideChat = (conversation) => {
  if (!sideChatConversationKey(conversation)) return false;
  setState({ conversation, openedAt: Date.now() });
  return true;
};

export const closeSideChat = () => {
  if (!state.conversation) return;
  setState({ conversation: null });
};

export const setSideChatSize = (size) => {
  const next = SIDE_CHAT_SIZES.includes(size) ? size : "normal";
  if (next === state.size) return;
  writeSize(next);
  setState({ size: next });
};

export const toggleSideChatSize = () => setSideChatSize(state.size === "expanded" ? "normal" : "expanded");

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

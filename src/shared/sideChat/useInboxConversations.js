import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/api";
import { subscribeRealtime } from "../realtime/socketStore";
import { inboxTenantId, sideChatConversationKey } from "./sideChatStore";
import { conversationActivityAt } from "./conversationSummary";

/*
 * One page of the inbox's conversation list for the shell: the bell's dropdown
 * and the side panel's list read the same thing. `view` is the inbox's own SQL
 * view (all | unread | awaiting ...), so "unread" here means exactly what the
 * inbox page's Unread chip means. Messages landing on the socket refresh it,
 * one round trip per burst.
 */

const REFRESH_DEBOUNCE_MS = 600;

export default function useInboxConversations({ view = "unread", limit = 20, search = "", enabled = true } = {}) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(0);
  const enabledRef = useRef(enabled);
  const tenantId = inboxTenantId();
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get("/ai-inbox/conversations", {
        params: {
          tenant_id: tenantId,
          view,
          ...(view === "unread" ? { read_filter: "unread" } : {}),
          ...(search ? { search } : {}),
          limit,
        },
        headers,
        suppressErrorStatuses: [401, 403, 404, 500, 502, 503],
        perfComponent: `Shell.conversations.${view}`,
      });
      const list = (Array.isArray(payload?.conversations) ? payload.conversations : [])
        .filter((row) => sideChatConversationKey(row))
        .sort((a, b) => new Date(conversationActivityAt(b) || 0) - new Date(conversationActivityAt(a) || 0));
      setRows(list);
    } catch {
      setRows((current) => current || []);
    } finally {
      setLoading(false);
    }
  }, [headers, limit, search, tenantId, view]);

  useEffect(() => {
    if (!enabled) return undefined;
    void reload();
    const schedule = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { if (enabledRef.current) void reload(); }, REFRESH_DEBOUNCE_MS);
    };
    const offMessage = subscribeRealtime("ai_inbox:message", schedule);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", schedule);
    window.addEventListener("erp:inbox-conversation-read", schedule);
    return () => {
      window.clearTimeout(timerRef.current);
      offMessage();
      offRefresh();
      window.removeEventListener("erp:inbox-conversation-read", schedule);
    };
  }, [enabled, reload]);

  // Opening a conversation reads it: drop it from an unread list at once
  // instead of waiting for the server to agree.
  const markRead = useCallback((row) => {
    if (view !== "unread") return;
    const key = sideChatConversationKey(row);
    setRows((current) => (current || []).filter((item) => sideChatConversationKey(item) !== key));
  }, [view]);

  return { rows, loading, reload, markRead };
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Inbox, MessageCircle, RefreshCw } from "lucide-react";

import { api } from "../api/api";
import { subscribeRealtime } from "../realtime/socketStore";
import { handleInboundInboxMessage, isInboundCustomerMessage } from "../../modules/aiSupport/services/inboxNotifications";
import CustomerAvatar from "../../modules/aiSupport/components/CustomerAvatar.jsx";
import { relativeTime } from "../notifications/NotificationBell.jsx";
import useDismissableLayer from "../hooks/useDismissableLayer";
import { inboxTenantId, openSideChat, sideChatConversationKey, useSideChat } from "./sideChatStore";
import {
  CHANNEL_COLORS,
  channelDisplayName,
  conversationActivityAt,
  conversationChannel,
  conversationDisplayName,
  conversationPreviewText,
  conversationUnreadCount,
} from "./conversationSummary";

/*
 * Genie's message bell in the ERP topbar: a chat icon with the number of
 * conversations waiting for a reply, and a list of them. Opening one docks it in
 * the side chat next to the current page — the operator answers without
 * leaving the order or product they were on.
 *
 * The count is /ai-inbox/view-counts (the inbox's own unread rule, in SQL); the
 * list is the unread view of /ai-inbox/conversations, fetched when the menu
 * opens and again as messages land on the socket.
 */

const COUNT_POLL_MS = 60 * 1000;
const LIST_LIMIT = 20;
const clean = (value) => String(value ?? "").trim();

export default function MessageNotificationsBell({ className = "" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const openRef = useRef(false);
  const refreshTimerRef = useRef(0);
  const { conversation: sideChatConversation } = useSideChat();
  const tenantId = inboxTenantId();
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const onInboxPage = location.pathname === "/admin/ai-inbox";

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const loadCount = useCallback(async () => {
    try {
      const payload = await api.get("/ai-inbox/view-counts", {
        params: { tenant_id: tenantId },
        headers,
        suppressErrorStatuses: [401, 403, 404, 500, 502, 503],
        perfComponent: "Shell.messageBell.count",
      });
      const unread = Number(payload?.counts?.unread ?? 0);
      setCount(Number.isFinite(unread) && unread > 0 ? unread : 0);
    } catch {
      /* the badge keeps its last value; the next tick retries */
    }
  }, [headers, tenantId]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get("/ai-inbox/conversations", {
        params: { tenant_id: tenantId, view: "unread", read_filter: "unread", limit: LIST_LIMIT },
        headers,
        suppressErrorStatuses: [401, 403, 404, 500, 502, 503],
        perfComponent: "Shell.messageBell.list",
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
  }, [headers, tenantId]);

  // One refresh per burst: a customer sending three lines in a row is one
  // round trip, not three.
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      void loadCount();
      if (openRef.current) void loadRows();
    }, 600);
  }, [loadCount, loadRows]);

  useEffect(() => {
    void loadCount();
    const timer = window.setInterval(() => { if (!document.hidden) void loadCount(); }, COUNT_POLL_MS);
    const onVisible = () => { if (!document.hidden) void loadCount(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(refreshTimerRef.current);
    };
  }, [loadCount]);

  useEffect(() => {
    const onMessage = (payload = {}) => {
      const incoming = payload?.message || null;
      if (incoming && isInboundCustomerMessage(incoming)) {
        // The inbox page rings for its own messages; its dedupe window swallows
        // this second call for the same message when both are mounted.
        if (!onInboxPage) {
          handleInboundInboxMessage({
            message: incoming,
            conversationId: clean(payload.conversation_key || payload.session_id || incoming.session_id),
            channel: clean(payload.channel || incoming.channel || incoming.source),
            surface: "/admin/ai-inbox",
          }).catch(() => null);
        }
      }
      scheduleRefresh();
    };
    const offMessage = subscribeRealtime("ai_inbox:message", onMessage);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", scheduleRefresh);
    const onRead = () => scheduleRefresh();
    window.addEventListener("erp:inbox-conversation-read", onRead);
    return () => {
      offMessage();
      offRefresh();
      window.removeEventListener("erp:inbox-conversation-read", onRead);
    };
  }, [onInboxPage, scheduleRefresh]);

  useEffect(() => {
    if (open) void loadRows();
  }, [open, loadRows]);

  // The topbar clips overflow; the menu portals out like the inbox bell does.
  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    const place = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const width = Math.min(380, window.innerWidth - margin * 2);
      const rtl = document.documentElement.dir === "rtl";
      const preferred = rtl ? rect.left : rect.right - width;
      const left = Math.min(Math.max(margin, preferred), window.innerWidth - width - margin);
      setMenuStyle({ position: "fixed", top: Math.round(rect.bottom + 8), left: Math.round(left), width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useDismissableLayer({ enabled: open, onDismiss: () => setOpen(false), refs: [containerRef, panelRef] });

  const openConversation = (row) => {
    setOpen(false);
    openSideChat(row);
    // Opening it is reading it; drop it from the list right away.
    setRows((current) => (current || []).filter((item) => sideChatConversationKey(item) !== sideChatConversationKey(row)));
    setCount((current) => Math.max(0, current - 1));
  };

  const goToInbox = () => {
    setOpen(false);
    navigate("/admin/ai-inbox");
  };

  const activeKey = sideChatConversationKey(sideChatConversation || {});
  const badge = count > 99 ? "99+" : count;

  return (
    <div ref={containerRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("aiSupport.inbox.messageBell.title")}
        title={t("aiSupport.inbox.messageBell.title")}
        data-message-bell="true"
        data-unread-count={count}
        className="relative inline-flex h-[var(--control-height-md)] w-10 items-center justify-center border border-[var(--border)] bg-[var(--card)] text-[var(--topbar-text)] transition hover:bg-[var(--surface-soft)]"
      >
        <MessageCircle className="h-4 w-4" />
        {count > 0 ? (
          <span data-message-bell-badge="true" className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black leading-none text-white shadow">
            {badge}
          </span>
        ) : null}
      </button>

      {open && menuStyle ? createPortal(
        <div
          ref={panelRef}
          role="menu"
          dir={document.documentElement.dir === "rtl" ? "rtl" : "ltr"}
          style={menuStyle}
          data-message-bell-menu="true"
          className="z-[9999] flex max-h-[min(70vh,560px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
            <div>
              <p className="text-sm font-bold">{t("aiSupport.inbox.messageBell.title")}</p>
              <p className="text-[11px] text-text-muted">{count > 0 ? t("aiSupport.inbox.messageBell.waiting", { count }) : t("aiSupport.inbox.messageBell.allAnswered")}</p>
            </div>
            <button type="button" onClick={() => { void loadRows(); void loadCount(); }} aria-label={t("aiSupport.inbox.messageBell.refresh")} title={t("aiSupport.inbox.messageBell.refresh")} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {rows === null ? (
              <p className="px-3 py-8 text-center text-xs text-text-muted">{t("aiSupport.inbox.messageBell.loading")}</p>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-text-muted">
                <Inbox className="h-7 w-7 opacity-60" />
                <p className="text-xs">{t("aiSupport.inbox.messageBell.empty")}</p>
              </div>
            ) : (
              rows.map((row) => {
                const key = sideChatConversationKey(row);
                const channel = conversationChannel(row);
                const unread = conversationUnreadCount(row);
                const name = conversationDisplayName(row);
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    onClick={() => openConversation(row)}
                    data-conversation-key={key}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start transition hover:bg-surface-hover ${activeKey === key ? "bg-primary/10" : ""}`}
                  >
                    <span className="relative shrink-0">
                      <CustomerAvatar name={name} url={clean(row.customer_avatar_url || row.avatar_url || row.customer_profile?.avatar_url)} className="h-10 w-10 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
                      <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: CHANNEL_COLORS[channel] || "#94a3b8" }} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">{name}</span>
                        <span className="shrink-0 text-[10px] text-text-muted">{relativeTime(conversationActivityAt(row))}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span dir="auto" className="truncate text-xs text-text-muted">{conversationPreviewText(row) || t("aiSupport.inbox.messageBell.noPreview")}</span>
                        {unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-black leading-none text-white">{unread > 99 ? "99+" : unread}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-text-muted">{channelDisplayName(row)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-border p-1.5">
            <button type="button" onClick={goToInbox} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-primary hover:bg-surface-hover">
              <Inbox className="h-4 w-4" />
              {t("aiSupport.inbox.messageBell.openInbox")}
            </button>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Inbox, MessageCircle, PanelRightOpen, RefreshCw } from "lucide-react";

import { api } from "../api/api";
import { subscribeRealtime } from "../realtime/socketStore";
import { handleInboundInboxMessage, isInboundCustomerMessage } from "../../modules/aiSupport/services/inboxNotifications";
import useDismissableLayer from "../hooks/useDismissableLayer";
import ConversationSummaryList from "./ConversationSummaryList.jsx";
import useInboxConversations from "./useInboxConversations";
import { inboxTenantId, openSideChat, openSideChatList, sideChatConversationKey, useSideChat } from "./sideChatStore";

/*
 * Genie's message bell in the ERP topbar: a chat icon with the number of
 * conversations waiting for a reply, and a dropdown with two tabs — Recent
 * (every conversation, newest first) and Unread. Opening one docks it in the
 * side chat next to the current page; the panel icon opens the side chat on
 * its list instead.
 *
 * The count is /ai-inbox/view-counts (the inbox's own unread rule, in SQL);
 * the lists come from useInboxConversations, shared with the side panel.
 */

const COUNT_POLL_MS = 60 * 1000;
const LIST_LIMIT = 20;
const clean = (value) => String(value ?? "").trim();
const formatCount = (value) => (value > 999 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(value));

export default function MessageNotificationsBell({ className = "" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("recent");
  const [counts, setCounts] = useState({ unread: 0, all: 0 });
  const [menuStyle, setMenuStyle] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const refreshTimerRef = useRef(0);
  const { conversation: sideChatConversation } = useSideChat();
  const tenantId = inboxTenantId();
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const onInboxPage = location.pathname === "/admin/ai-inbox";
  const view = tab === "unread" ? "unread" : "all";
  const { rows, loading, reload, markRead } = useInboxConversations({ view, limit: LIST_LIMIT, enabled: open });

  const loadCount = useCallback(async () => {
    try {
      const payload = await api.get("/ai-inbox/view-counts", {
        params: { tenant_id: tenantId },
        headers,
        suppressErrorStatuses: [401, 403, 404, 500, 502, 503],
        perfComponent: "Shell.messageBell.count",
      });
      const unread = Number(payload?.counts?.unread ?? 0);
      const all = Number(payload?.counts?.all ?? 0);
      setCounts({ unread: Number.isFinite(unread) && unread > 0 ? unread : 0, all: Number.isFinite(all) && all > 0 ? all : 0 });
    } catch {
      /* the badge keeps its last value; the next tick retries */
    }
  }, [headers, tenantId]);

  // One refresh per burst: a customer sending three lines in a row is one
  // round trip, not three.
  const scheduleCountRefresh = useCallback(() => {
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => { void loadCount(); }, 600);
  }, [loadCount]);

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
      // The inbox page rings for its own messages; its dedupe window swallows
      // this second call for the same message when both are mounted.
      if (incoming && isInboundCustomerMessage(incoming) && !onInboxPage) {
        handleInboundInboxMessage({
          message: incoming,
          conversationId: clean(payload.conversation_key || payload.session_id || incoming.session_id),
          channel: clean(payload.channel || incoming.channel || incoming.source),
          surface: "/admin/ai-inbox",
        }).catch(() => null);
      }
      scheduleCountRefresh();
    };
    const offMessage = subscribeRealtime("ai_inbox:message", onMessage);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", scheduleCountRefresh);
    window.addEventListener("erp:inbox-conversation-read", scheduleCountRefresh);
    return () => {
      offMessage();
      offRefresh();
      window.removeEventListener("erp:inbox-conversation-read", scheduleCountRefresh);
    };
  }, [onInboxPage, scheduleCountRefresh]);

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
    markRead(row);
    openSideChat(row);
    // Opening it is reading it; the badge drops without waiting for the server.
    setCounts((current) => ({ ...current, unread: Math.max(0, current.unread - 1) }));
  };

  const openPanel = () => {
    setOpen(false);
    openSideChatList();
  };

  const goToInbox = () => {
    setOpen(false);
    navigate("/admin/ai-inbox");
  };

  const activeKey = sideChatConversationKey(sideChatConversation || {});
  const badge = counts.unread > 99 ? "99+" : counts.unread;

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
        data-unread-count={counts.unread}
        className="relative inline-flex h-[var(--control-height-md)] w-10 items-center justify-center border border-[var(--border)] bg-[var(--card)] text-[var(--topbar-text)] transition hover:bg-[var(--surface-soft)]"
      >
        <MessageCircle className="h-4 w-4" />
        {counts.unread > 0 ? (
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
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <div className="flex min-w-0 flex-1 gap-1 rounded-full bg-surface-soft p-0.5" role="tablist">
              {[
                { key: "recent", label: t("aiSupport.inbox.messageBell.tabs.recent"), count: counts.all },
                { key: "unread", label: t("aiSupport.inbox.messageBell.tabs.unread"), count: counts.unread },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  data-bell-tab={item.key}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold transition ${tab === item.key ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"}`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.count > 0 ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black leading-none ${item.key === "unread" ? "bg-rose-500 text-white" : "bg-surface-soft text-text-muted"}`}>
                      {formatCount(item.count)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { void reload(); void loadCount(); }} aria-label={t("aiSupport.inbox.messageBell.refresh")} title={t("aiSupport.inbox.messageBell.refresh")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" onClick={openPanel} aria-label={t("aiSupport.inbox.sideChat.open")} title={t("aiSupport.inbox.sideChat.open")} data-open-side-chat="true" className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover lg:grid">
              <PanelRightOpen className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <ConversationSummaryList
              rows={rows}
              activeKey={activeKey}
              onOpen={openConversation}
              emptyText={tab === "unread" ? t("aiSupport.inbox.messageBell.empty") : t("aiSupport.inbox.sideChat.noConversations")}
            />
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

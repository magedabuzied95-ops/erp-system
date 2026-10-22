import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, ExternalLink, PanelRightClose, PanelRightOpen, Search, X } from "lucide-react";

import CustomerAvatar from "../../modules/aiSupport/components/CustomerAvatar.jsx";
import QuickConversationThread from "../../modules/aiSupport/components/QuickConversationThread.jsx";
import { clean } from "../../modules/aiSupport/components/quickThreadHelpers.js";
import ConversationSummaryList from "./ConversationSummaryList.jsx";
import useInboxConversations from "./useInboxConversations";
import { backToSideChatList, closeSideChat, inboxTenantId, openSideChat, resetSideChatWidth, setSideChatWidth, sideChatConversationKey, toggleSideChatCollapsed, useSideChat } from "./sideChatStore";
import { channelDisplayName, conversationDisplayName } from "./conversationSummary";

/*
 * Genie's chat panel docked beside the page. On desktop it is the third column
 * of the shell grid (MainLayout gives the root `m1-shell-root--side-chat`, and
 * the CSS animates the page narrowing); on phones it covers the screen.
 *
 * Three looks: the conversation list (Recent / Unread, search), one
 * conversation with a back arrow to the list, and the folded rail — the
 * header toggle shrinks the panel to a strip so the page gets its width back
 * while the thread stays loaded; the cross closes it.
 */

const LIST_VIEWS = ["unread", "all"];

function HeaderButton({ onClick, label, children, className = "" }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={`grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover ${className}`}>
      {children}
    </button>
  );
}

// The divider between the page and the panel: drag it to resize (Genie),
// double-click to go back to the default width. Pointer maths is in viewport
// pixels from the panel's page-side edge, which is the left edge in LTR and
// the right edge in RTL.
function ResizeHandle() {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rtl = document.documentElement.dir === "rtl";
    const widthAt = (clientX) => (rtl ? clientX : window.innerWidth - clientX);
    const move = (moveEvent) => setSideChatWidth(widthAt(moveEvent.clientX), { commit: false });
    const up = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(false);
      setSideChatWidth(widthAt(upEvent.clientX));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    setDragging(true);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("aiSupport.inbox.sideChat.resize")}
      title={t("aiSupport.inbox.sideChat.resize")}
      data-side-chat-resize="true"
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={onPointerDown}
      onDoubleClick={resetSideChatWidth}
      className="m1-side-chat-resize hidden lg:block"
    />
  );
}

function PanelList({ activeKey }) {
  const { t } = useTranslation();
  const [view, setView] = useState("unread");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const { rows, markRead } = useInboxConversations({ view, limit: 40, search: debounced });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(clean(search)), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
        <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-soft px-2.5">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("aiSupport.inbox.sideChat.searchPlaceholder")}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
          />
        </label>
        <div className="flex gap-1.5" role="tablist">
          {LIST_VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              data-list-view={key}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${view === key ? "bg-[var(--primary)] text-white" : "bg-surface-soft text-text-muted hover:text-text"}`}
            >
              {t(key === "unread" ? "aiSupport.inbox.messageBell.tabs.unread" : "aiSupport.inbox.messageBell.tabs.recent")}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <ConversationSummaryList
          rows={rows}
          activeKey={activeKey}
          onOpen={(row) => { markRead(row); openSideChat(row); }}
          emptyText={view === "unread" ? t("aiSupport.inbox.messageBell.empty") : t("aiSupport.inbox.sideChat.noConversations")}
        />
      </div>
    </>
  );
}

export default function SideChatPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open, collapsed, conversation } = useSideChat();
  const tenantId = inboxTenantId();
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeSideChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const key = sideChatConversationKey(conversation || {});
  const collapseLabel = t(collapsed ? "aiSupport.inbox.sideChat.open" : "aiSupport.inbox.sideChat.collapse");

  const openInInbox = () => {
    closeSideChat();
    navigate(`/admin/ai-inbox${conversation ? `?conversation=${encodeURIComponent(clean(conversation.session_id || key))}` : ""}`);
  };

  // One <aside> for every look, so the width tweens between the panel and the
  // folded rail (MainLayout.m1.css) instead of a remount. The rail is desktop
  // only — phones never fold, the panel there is the whole screen or nothing.
  const rail = (
    <div className="flex h-full flex-col items-center gap-1 pt-2">
      <HeaderButton onClick={toggleSideChatCollapsed} label={collapseLabel}><PanelRightOpen className="h-4 w-4 rtl:-scale-x-100" /></HeaderButton>
      <HeaderButton onClick={closeSideChat} label={t("aiSupport.inbox.sideChat.close")} className="hover:bg-danger-subtle hover:text-danger"><X className="h-4 w-4" /></HeaderButton>
      {conversation ? (
        <button type="button" onClick={toggleSideChatCollapsed} title={conversationDisplayName(conversation)} aria-label={conversationDisplayName(conversation)} className="mt-2">
          <CustomerAvatar name={conversationDisplayName(conversation)} url={clean(conversation.customer_avatar_url || conversation.avatar_url)} className="h-8 w-8 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  const chrome = (
    <>
      <HeaderButton onClick={openInInbox} label={t("aiSupport.inbox.miniChat.openFull")}><ExternalLink className="h-4 w-4" /></HeaderButton>
      <HeaderButton onClick={toggleSideChatCollapsed} label={collapseLabel} className="hidden lg:grid"><PanelRightClose className="h-4 w-4 rtl:-scale-x-100" /></HeaderButton>
      <HeaderButton onClick={closeSideChat} label={t("aiSupport.inbox.sideChat.close")} className="hover:bg-danger-subtle hover:text-danger"><X className="h-4 w-4" /></HeaderButton>
    </>
  );

  return (
    <aside
      data-side-chat="true"
      data-side-chat-state={collapsed ? "collapsed" : conversation ? "thread" : "list"}
      aria-label={t("aiSupport.inbox.sideChat.title")}
      className={`m1-side-chat flex flex-col bg-surface text-text lg:border-s lg:border-border ${collapsed ? "m1-side-chat--rail" : ""}`}
    >
      {collapsed ? null : <ResizeHandle />}
      {collapsed ? rail : conversation ? (
        <QuickConversationThread
          key={key}
          item={conversation}
          headers={headers}
          tenantId={tenantId}
          className="h-full"
          perfTag="AiInbox.sideChat"
          markReadOnOpen
          onMarkedRead={() => window.dispatchEvent(new CustomEvent("erp:inbox-conversation-read", { detail: { key } }))}
          messageLimit={60}
          header={({ aiEnabled, toggleAi }) => (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2.5">
              <HeaderButton onClick={backToSideChatList} label={t("aiSupport.inbox.sideChat.back")}><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /></HeaderButton>
              <CustomerAvatar name={conversationDisplayName(conversation)} url={clean(conversation.customer_avatar_url || conversation.avatar_url || conversation.customer_profile?.avatar_url)} className="h-9 w-9 shrink-0 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{conversationDisplayName(conversation)}</div>
                <div dir="auto" className="truncate text-[11px] text-text-muted">
                  {clean(conversation.phone || conversation.customer_phone || conversation.customer_profile?.phone || conversation.external_customer_id) || channelDisplayName(conversation)}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleAi}
                aria-pressed={aiEnabled}
                title={t(aiEnabled ? "aiSupport.inbox.miniChat.aiOn" : "aiSupport.inbox.miniChat.aiOff")}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${aiEnabled ? "bg-emerald-500" : "bg-surface-soft ring-1 ring-border"}`}
              >
                <span className={`absolute grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-all ${aiEnabled ? "end-0.5" : "start-0.5"}`}>
                  <Bot className={`h-3 w-3 ${aiEnabled ? "text-emerald-600" : "text-slate-400"}`} />
                </span>
              </button>
              {chrome}
            </div>
          )}
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5">
            <div className="min-w-0 flex-1 text-sm font-bold">{t("aiSupport.inbox.messageBell.title")}</div>
            {chrome}
          </div>
          <PanelList activeKey="" />
        </div>
      )}
    </aside>
  );
}

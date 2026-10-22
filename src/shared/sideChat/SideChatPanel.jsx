import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, ExternalLink, Maximize2, Minimize2, X } from "lucide-react";

import CustomerAvatar from "../../modules/aiSupport/components/CustomerAvatar.jsx";
import QuickConversationThread from "../../modules/aiSupport/components/QuickConversationThread.jsx";
import { clean } from "../../modules/aiSupport/components/quickThreadHelpers.js";
import { closeSideChat, inboxTenantId, sideChatConversationKey, toggleSideChatSize, useSideChat } from "./sideChatStore";
import { channelDisplayName, conversationDisplayName } from "./conversationSummary";

/*
 * The panel that docks beside the page when a message notification is opened.
 * On desktop it is the third column of the shell grid (MainLayout gives the
 * root `m1-shell-root--side-chat`, and the CSS animates the page narrowing);
 * on phones it covers the screen.
 */

export default function SideChatPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { conversation, size } = useSideChat();
  const tenantId = inboxTenantId();
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  useEffect(() => {
    if (!conversation) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeSideChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversation]);

  if (!conversation) return null;

  const key = sideChatConversationKey(conversation);
  const name = conversationDisplayName(conversation);
  const subtitle = clean(conversation.phone || conversation.customer_phone || conversation.customer_profile?.phone || conversation.external_customer_id) || channelDisplayName(conversation);
  const expanded = size === "expanded";

  const openInInbox = () => {
    closeSideChat();
    navigate(`/admin/ai-inbox?conversation=${encodeURIComponent(clean(conversation.session_id || key))}`);
  };

  return (
    <aside
      data-side-chat="true"
      data-side-chat-size={size}
      aria-label={t("aiSupport.inbox.sideChat.title")}
      className="m1-side-chat fixed inset-0 z-[60] flex flex-col bg-surface text-text lg:static lg:inset-auto lg:z-20 lg:h-screen lg:border-s lg:border-border"
    >
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
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
            <CustomerAvatar name={name} url={clean(conversation.customer_avatar_url || conversation.avatar_url || conversation.customer_profile?.avatar_url)} className="h-9 w-9 shrink-0 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{name}</div>
              <div dir="auto" className="truncate text-[11px] text-text-muted">{subtitle}</div>
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
            <button type="button" onClick={openInInbox} title={t("aiSupport.inbox.miniChat.openFull")} aria-label={t("aiSupport.inbox.miniChat.openFull")} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleSideChatSize}
              title={t(expanded ? "aiSupport.inbox.sideChat.shrink" : "aiSupport.inbox.sideChat.expand")}
              aria-label={t(expanded ? "aiSupport.inbox.sideChat.shrink" : "aiSupport.inbox.sideChat.expand")}
              aria-pressed={expanded}
              className="hidden h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-hover lg:grid"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button type="button" onClick={closeSideChat} title={t("aiSupport.inbox.sideChat.close")} aria-label={t("aiSupport.inbox.sideChat.close")} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-danger-subtle hover:text-danger">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      />
    </aside>
  );
}

import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";

import CustomerAvatar from "../../modules/aiSupport/components/CustomerAvatar.jsx";
import { relativeTime } from "../notifications/NotificationBell.jsx";
import { sideChatConversationKey } from "./sideChatStore";
import {
  CHANNEL_COLORS,
  channelDisplayName,
  conversationActivityAt,
  conversationChannel,
  conversationDisplayName,
  conversationPreviewText,
  conversationUnreadCount,
} from "./conversationSummary";

// The conversation rows Genie shows in its bell dropdown and in the side
// panel's list: one component, so the two never drift.

const clean = (value) => String(value ?? "").trim();

export default function ConversationSummaryList({ rows, activeKey = "", onOpen, emptyText = "", className = "" }) {
  const { t } = useTranslation();

  if (rows === null) {
    return <p className="px-3 py-8 text-center text-xs text-text-muted">{t("aiSupport.inbox.messageBell.loading")}</p>;
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-text-muted">
        <Inbox className="h-7 w-7 opacity-60" />
        <p className="text-xs">{emptyText || t("aiSupport.inbox.messageBell.empty")}</p>
      </div>
    );
  }
  return (
    <div className={className} data-conversation-list="true">
      {rows.map((row) => {
        const key = sideChatConversationKey(row);
        const channel = conversationChannel(row);
        const unread = conversationUnreadCount(row);
        const name = conversationDisplayName(row);
        return (
          <button
            key={key}
            type="button"
            role="menuitem"
            onClick={() => onOpen?.(row)}
            data-conversation-key={key}
            className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start transition hover:bg-surface-hover ${activeKey === key ? "bg-primary/10" : ""}`}
          >
            <span className="relative shrink-0">
              <CustomerAvatar name={name} url={clean(row.customer_avatar_url || row.avatar_url || row.customer_profile?.avatar_url)} className="h-10 w-10 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
              <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: CHANNEL_COLORS[channel] || "#94a3b8" }} aria-hidden="true" />
              {unread > 0 ? (
                <span className="absolute -start-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-surface bg-[var(--primary)] px-1 text-[9px] font-black leading-none text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${unread > 0 ? "font-bold" : "font-semibold"}`}>{name}</span>
                <span className="shrink-0 text-[10px] text-text-muted">{relativeTime(conversationActivityAt(row))}</span>
              </span>
              <span dir="auto" className={`mt-0.5 block truncate text-xs ${unread > 0 ? "text-text" : "text-text-muted"}`}>
                {conversationPreviewText(row) || t("aiSupport.inbox.messageBell.noPreview")}
              </span>
              <span className="mt-0.5 block text-[10px] text-text-muted">{channelDisplayName(row)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

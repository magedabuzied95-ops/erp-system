import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bot, Maximize2, Minus, X } from "lucide-react";
import CustomerAvatar from "./CustomerAvatar.jsx";
import QuickConversationThread from "./QuickConversationThread.jsx";
import { clean } from "./quickThreadHelpers.js";

/*
 * Genie's "Open Mini Chat": a conversation in a small floating window at the
 * bottom corner, so the operator can keep answering one customer while the main
 * pane shows another. Up to three sit side by side; the minus folds one into a
 * tab, the cross closes it, the corner arrow opens it in the main pane.
 *
 * The thread itself (transcript + composer) is QuickConversationThread, shared
 * with the side chat that docks next to any ERP page.
 */

function MiniChatWindow({ chat, headers, tenantId, onClose, onToggleMinimize, onOpenFull }) {
  const { t } = useTranslation();
  const sessionId = clean(chat.item?.session_id || chat.item?.conversation_id);
  const name = clean(chat.item?.customer_name || chat.item?.display_name || chat.item?.customer_profile?.name) || sessionId;

  if (chat.minimized) {
    return (
      <div className="flex h-10 w-56 items-center gap-2 rounded-t-xl border border-b-0 border-border bg-surface px-2.5 text-text shadow-xl">
        <button type="button" onClick={() => onToggleMinimize(chat.key)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate text-sm font-semibold">{name}</span>
        </button>
        <button type="button" onClick={() => onClose(chat.key)} aria-label={t("aiSupport.inbox.miniChat.close")} className="grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-surface-hover">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label={name} className="flex h-[460px] max-h-[calc(100vh-5rem)] w-[330px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-surface text-text shadow-2xl">
      <QuickConversationThread
        item={chat.item}
        headers={headers}
        tenantId={tenantId}
        active={!chat.minimized}
        className="h-full"
        header={({ aiEnabled, toggleAi }) => (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2">
            <CustomerAvatar name={name} url={chat.item?.customer_avatar_url || chat.item?.avatar_url || ""} className="h-8 w-8 shrink-0 overflow-hidden rounded-full" iconClassName="h-4 w-4" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{name}</div>
              <div className="truncate text-[11px] text-text-muted">{clean(chat.item?.channel || chat.item?.source)}</div>
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
            <button type="button" onClick={() => onOpenFull(chat.item)} title={t("aiSupport.inbox.miniChat.openFull")} aria-label={t("aiSupport.inbox.miniChat.openFull")} className="grid h-7 w-7 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onToggleMinimize(chat.key)} title={t("aiSupport.inbox.miniChat.minimize")} aria-label={t("aiSupport.inbox.miniChat.minimize")} className="grid h-7 w-7 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onClose(chat.key)} title={t("aiSupport.inbox.miniChat.close")} aria-label={t("aiSupport.inbox.miniChat.close")} className="grid h-7 w-7 place-items-center rounded-lg text-danger hover:bg-danger-subtle">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      />
    </div>
  );
}

export default function MiniChatDock({ chats = [], headers, tenantId, onClose, onToggleMinimize, onOpenFull }) {
  if (!chats.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-0 right-4 z-[1200] flex flex-row-reverse items-end gap-3" data-mini-chat-dock="true">
      {chats.map((chat) => (
        <div key={chat.key} className="pointer-events-auto">
          <MiniChatWindow chat={chat} headers={headers} tenantId={tenantId} onClose={onClose} onToggleMinimize={onToggleMinimize} onOpenFull={onOpenFull} />
        </div>
      ))}
    </div>,
    document.fullscreenElement || document.body
  );
}

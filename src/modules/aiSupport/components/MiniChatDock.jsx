import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Maximize2, Minus, Send, Smile, X } from "lucide-react";
import { api } from "../../../shared/api/api";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";
import { AppleEmojiPicker } from "./AppleEmojiPicker.jsx";
import CustomerAvatar from "./CustomerAvatar.jsx";

/*
 * Genie's "Open Mini Chat": a conversation in a small floating window at the
 * bottom corner, so the operator can keep answering one customer while the main
 * pane shows another. Up to three sit side by side; the minus folds one into a
 * tab, the cross closes it, the corner arrow opens it in the main pane.
 *
 * It reads the thread from the same messages endpoint the inbox uses and polls
 * it while unfolded; it sends through the same /send route as the composer, so
 * the reply is stored, delivered and shown everywhere exactly like any other.
 */

const POLL_MS = 6000;
const clean = (value) => String(value ?? "").trim();
const isOutbound = (message = {}) => {
  const sender = clean(message.sender_type).toLowerCase();
  if (message.from_me === true || message.fromMe === true) return true;
  if (clean(message.direction).toLowerCase() === "outbound") return true;
  return Boolean(sender) && sender !== "customer" && sender !== "user";
};
const textOf = (message = {}) => clean(isOutbound(message)
  ? message.staff_message || message.ai_answer || message.message_text || message.text
  : message.customer_message || message.message_text || message.text);
const imagesOf = (message = {}) => (Array.isArray(message.visual_attachments) ? message.visual_attachments : [])
  .map((item) => clean(item?.url || item?.preview_url || item?.thumbnail_url))
  .filter(Boolean)
  .slice(0, 4);
const timeOf = (value) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
};

function MiniChatWindow({ chat, headers, tenantId, onClose, onToggleMinimize, onOpenFull }) {
  const { t } = useTranslation();
  const sessionId = clean(chat.item?.session_id || chat.item?.conversation_id);
  const name = clean(chat.item?.customer_name || chat.item?.display_name || chat.item?.customer_profile?.name) || sessionId;
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(chat.item?.ai_enabled !== false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const scrollRef = useRef(null);
  const emojiRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/messages"), {
        params: { tenant_id: tenantId, limit: 40 },
        headers,
        suppressErrorStatuses: [404, 500, 502, 503],
        perfComponent: "AiInbox.miniChat",
      });
      const rows = Array.isArray(payload?.messages) ? payload.messages : Array.isArray(payload?.conversation?.messages) ? payload.conversation.messages : [];
      setMessages(rows
        .filter((row) => !["internal_note", "reaction"].includes(clean(row.message_type).toLowerCase()) && clean(row.sender_type).toLowerCase() !== "note")
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
      if (payload?.conversation && typeof payload.conversation.ai_enabled === "boolean") setAiEnabled(payload.conversation.ai_enabled);
    } catch {
      setMessages((current) => current || []);
    }
  }, [headers, sessionId, tenantId]);

  useEffect(() => {
    if (chat.minimized) return undefined;
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [chat.minimized, load]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [messages, chat.minimized]);

  const send = async () => {
    const message = clean(draft);
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const clientRequestId = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await api.post(aiInboxConversationEndpoint(sessionId, "/send"), { tenant_id: tenantId, message, client_request_id: clientRequestId }, { headers, perfComponent: "AiInbox.miniChatSend" });
      setDraft("");
      stickToBottomRef.current = true;
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.inbox.miniChat.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const toggleAi = async () => {
    const next = !aiEnabled;
    setAiEnabled(next);
    try {
      await api.patch(aiInboxConversationEndpoint(sessionId, "/ai-enabled"), { tenant_id: tenantId, ai_enabled: next }, { headers });
    } catch (err) {
      setAiEnabled(!next);
      setError(err?.message || t("aiSupport.inbox.miniChat.aiFailed"));
    }
  };

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
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface-soft px-2.5 py-2"
      >
        {messages === null ? (
          <div className="flex h-full items-center justify-center text-text-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : messages.length ? (
          messages.map((message, index) => {
            const out = isOutbound(message);
            const body = textOf(message);
            const images = imagesOf(message);
            if (!body && !images.length) return null;
            return (
              <div key={message.id || message.external_message_id || index} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[13px] leading-5 shadow-sm ${out ? "bg-emerald-500/15" : "bg-surface"}`}>
                  {images.map((url) => <img key={url} src={url} alt="" loading="lazy" className="mb-1 max-h-40 rounded-lg object-cover" />)}
                  {body ? <div dir="auto" className="whitespace-pre-wrap break-words">{body}</div> : null}
                  <div className="mt-0.5 text-end text-[10px] text-text-muted">{timeOf(message.created_at)}</div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="py-8 text-center text-xs text-text-muted">{t("aiSupport.inbox.miniChat.empty")}</p>
        )}
      </div>
      {error ? <div className="shrink-0 bg-danger-subtle px-3 py-1 text-[11px] text-danger">{error}</div> : null}
      <div className="flex shrink-0 items-end gap-1.5 border-t border-border p-2">
        <div className="relative">
          <button ref={emojiRef} type="button" onClick={() => setEmojiOpen((current) => !current)} aria-label={t("aiSupport.inbox.composer.emoji")} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
            <Smile className="h-5 w-5" />
          </button>
          <AppleEmojiPicker
            open={emojiOpen}
            anchorRef={emojiRef}
            onClose={() => setEmojiOpen(false)}
            onSelect={(emoji) => { setDraft((current) => `${current}${emoji}`); setEmojiOpen(false); }}
            title={t("aiSupport.inbox.ui.chooseEmoji")}
          />
        </div>
        <textarea
          dir="auto"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={t("aiSupport.inbox.composer.placeholder")}
          className="max-h-24 min-h-9 min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface-soft px-2.5 py-1.5 text-sm outline-none focus:border-primary"
        />
        <button type="button" onClick={send} disabled={sending || !clean(draft)} aria-label={t("aiSupport.inbox.miniChat.send")} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-45">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
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

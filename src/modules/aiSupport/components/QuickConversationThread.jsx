import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Send, Smile } from "lucide-react";
import { api } from "../../../shared/api/api";
import { subscribeRealtime } from "../../../shared/realtime/socketStore";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";
import { AppleEmojiPicker } from "./AppleEmojiPicker.jsx";
import { clean, conversationSessionId, isOutbound, sameConversation } from "./quickThreadHelpers.js";

/*
 * One lightweight thread: the transcript plus a composer, reading the same
 * messages endpoint the inbox uses and sending through the same /send route, so
 * a reply made here is stored, delivered and shown everywhere like any other.
 *
 * Two homes share it: the floating mini chat at the bottom of the inbox
 * (MiniChatDock) and the side chat that docks next to any ERP page when a
 * message notification is opened (SideChatPanel). The chrome around it is the
 * caller's — `header` receives the thread's AI switch so each home can draw it
 * in its own bar.
 */

const POLL_MS = 6000;
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

export default function QuickConversationThread({
  item,
  headers,
  tenantId,
  active = true,
  header = null,
  className = "",
  bodyClassName = "",
  perfTag = "AiInbox.miniChat",
  // Opening a thread from a notification is "I looked at it": the inbox's read
  // state follows, and the caller hears about it to refresh its counts.
  markReadOnOpen = false,
  onMarkedRead = null,
  messageLimit = 40,
}) {
  const { t } = useTranslation();
  const sessionId = conversationSessionId(item);
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(item?.ai_enabled !== false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const scrollRef = useRef(null);
  const emojiRef = useRef(null);
  const textareaRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const markedReadRef = useRef("");

  useEffect(() => {
    setMessages(null);
    setDraft("");
    setError("");
    setAiEnabled(item?.ai_enabled !== false);
    stickToBottomRef.current = true;
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/messages"), {
        params: { tenant_id: tenantId, limit: messageLimit },
        headers,
        suppressErrorStatuses: [404, 500, 502, 503],
        perfComponent: perfTag,
      });
      const rows = Array.isArray(payload?.messages) ? payload.messages : Array.isArray(payload?.conversation?.messages) ? payload.conversation.messages : [];
      setMessages(rows
        .filter((row) => !["internal_note", "reaction"].includes(clean(row.message_type).toLowerCase()) && clean(row.sender_type).toLowerCase() !== "note")
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
      if (payload?.conversation && typeof payload.conversation.ai_enabled === "boolean") setAiEnabled(payload.conversation.ai_enabled);
    } catch {
      setMessages((current) => current || []);
    }
  }, [headers, messageLimit, perfTag, sessionId, tenantId]);

  useEffect(() => {
    if (!active || !sessionId) return undefined;
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    // A message on this thread lands at once instead of on the next poll tick.
    const offMessage = subscribeRealtime("ai_inbox:message", (payload = {}) => {
      if (sameConversation(item || {}, payload)) void load();
    });
    return () => {
      window.clearInterval(timer);
      offMessage();
    };
  }, [active, item, load, sessionId]);

  useEffect(() => {
    if (!markReadOnOpen || !active || !sessionId || messages === null) return;
    if (markedReadRef.current === sessionId) return;
    markedReadRef.current = sessionId;
    api.post(
      aiInboxConversationEndpoint(sessionId, "/read"),
      { tenant_id: tenantId, conversation_id: sessionId, channel: clean(item?.channel || item?.source) },
      { headers, suppressErrorStatuses: [404, 500, 502, 503], perfComponent: `${perfTag}.read` }
    )
      .then(() => { if (typeof onMarkedRead === "function") onMarkedRead(item); })
      .catch(() => null);
  }, [active, headers, item, markReadOnOpen, messages, onMarkedRead, perfTag, sessionId, tenantId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [messages, active]);

  const send = async () => {
    const message = clean(draft);
    if (!message || sending || !sessionId) return;
    setSending(true);
    setError("");
    try {
      const clientRequestId = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await api.post(aiInboxConversationEndpoint(sessionId, "/send"), { tenant_id: tenantId, message, client_request_id: clientRequestId }, { headers, perfComponent: `${perfTag}Send` });
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

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {typeof header === "function" ? header({ aiEnabled, toggleAi, sessionId }) : header}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        }}
        className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface-soft px-2.5 py-2 ${bodyClassName}`}
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
            onSelect={(emoji) => { setDraft((current) => `${current}${emoji}`); setEmojiOpen(false); textareaRef.current?.focus(); }}
            title={t("aiSupport.inbox.ui.chooseEmoji")}
          />
        </div>
        <textarea
          ref={textareaRef}
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

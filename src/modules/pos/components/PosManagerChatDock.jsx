import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquareText, PhoneCall, Send, Volume2, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import { emitRealtime, subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { emitRealtimeFeedback, playRealtimeSound, unlockRealtimeFeedbackAudio } from "../../../services/realtimeFeedbackService";
import {
  isPortalChatAudioMessage,
  isPortalChatImageMessage,
  portalChatAttachmentName,
  portalChatAttachmentRawUrl,
  portalChatAttachmentUrl,
  portalChatMessagePreview,
} from "../../../shared/chat/portalChatUtils";
import ChatRingOverlay, { ChatRingStatus } from "../../../shared/chat/ChatRingOverlay";
import useChatRing from "../../../shared/chat/useChatRing";

/*
 * Management → cashier channel inside the POS: "كاشير فرع X".
 *
 * One thread per BRANCH (employee_chat_threads.channel_type = 'branch_pos'),
 * so no employee link is needed — whoever is on the POS at that branch is the
 * cashier side. The POS announces its branch over the shared JWT socket
 * (`employee-chat:pos-branch`) and joins `employee-chat:branch-pos:<id>`; a
 * 12 s poll only runs while that socket is down, mirroring the Employee App.
 *
 * A manager's message rings `employee_chat_message` (priority critical) so the
 * cashier hears it even when the POS tab sits behind the receipt window.
 */

const POLL_MS = 12000;

const messageKey = (message) => String(message?.id || "");
const isAdminMessage = (message) => String(message?.sender_type || "") === "admin";
const sortByTime = (list) =>
  [...list].sort((left, right) => {
    const delta = new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    return delta || Number(left.id || 0) - Number(right.id || 0);
  });
const mergeMessage = (list, message) => {
  if (!message?.id) return list;
  const key = messageKey(message);
  const without = list.filter((item) => messageKey(item) !== key);
  return sortByTime([...without, message]);
};
const countUnreadAdmin = (list) => list.filter((item) => isAdminMessage(item) && !item.read_at && !item.deleted_at).length;

const formatTime = (value, locale) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

export default function PosManagerChatDock({ branchId = "", branchName = "" }) {
  const { t, i18n } = useTranslation();
  const branchKey = String(branchId || "").trim();
  const locale = i18n.language?.startsWith("ar") ? "ar-EG" : "en-US";
  const { connected } = useRealtimeConnection();

  const [available, setAvailable] = useState(null); // null = unknown, false = no usable branch
  const [channelName, setChannelName] = useState("");
  const [messages, setMessages] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const [ringSending, setRingSending] = useState(false);

  // Ring ("نداء"): manager → this branch rings here; cashier → manager rings the portal.
  const ringSubscribe = useCallback((handlers) => {
    const offRing = subscribeRealtime("employee-chat:ring", handlers.onRing);
    const offAnswered = subscribeRealtime("employee-chat:ring-answered", handlers.onRingAnswered);
    return () => {
      offRing();
      offAnswered();
    };
  }, []);
  const ringAnswer = useCallback(
    (ring) => api.post(`/employees/chat/pos/ring/${encodeURIComponent(ring.message.id)}/answer`, { branch_id: branchKey }),
    [branchKey]
  );
  const ringIsIncoming = useCallback(
    (payload) => String(payload?.sender_type || payload?.message?.sender_type || "") === "admin" && (!threadIdRef.current || String(payload?.thread_id || payload?.thread?.id || "") === threadIdRef.current),
    []
  );
  const chatRing = useChatRing({ subscribe: ringSubscribe, answer: ringAnswer, isIncoming: ringIsIncoming });

  const openRef = useRef(false);
  const threadIdRef = useRef("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const typingSent = useRef(false);

  const unread = useMemo(() => countUnreadAdmin(messages), [messages]);
  const labels = useMemo(
    () => ({ image: t("pos.managerChat.image"), voice: t("pos.managerChat.voice"), file: t("pos.managerChat.file") }),
    [t]
  );

  const scrollToEnd = useCallback(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  const markRead = useCallback(async () => {
    if (!threadIdRef.current || !branchKey) return;
    try {
      await api.post("/employees/chat/pos/read", { branch_id: branchKey });
      setMessages((list) => list.map((item) => (isAdminMessage(item) && !item.read_at ? { ...item, read_at: new Date().toISOString() } : item)));
    } catch {
      /* the next load re-syncs read state */
    }
  }, [branchKey]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!branchKey) {
        setAvailable(false);
        return;
      }
      try {
        const data = await api.get(`/employees/chat/pos?branch_id=${encodeURIComponent(branchKey)}`, { suppressErrorStatuses: [404, 400] });
        const nextThread = data?.thread || null;
        threadIdRef.current = nextThread?.id ? String(nextThread.id) : "";
        setChannelName(String(nextThread?.employee_name || data?.branch?.name || ""));
        setMessages(sortByTime(Array.isArray(data?.messages) ? data.messages : []));
        setAvailable(true);
        setError("");
      } catch (err) {
        const status = Number(err?.status || err?.response?.status || 0);
        // 404 = route not deployed yet or branch not found; 400 = no branch. Either way, no dock.
        if (status === 404 || status === 400) {
          setAvailable(false);
          return;
        }
        if (!silent) setError(t("pos.managerChat.loadFailed"));
      }
    },
    [branchKey, t]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    openRef.current = open;
    if (!open) return undefined;
    /*
     * The server's GET /chat/me already marks admin messages read, so a load on
     * open is both the freshest thread and the read receipt the manager sees.
     */
    load({ silent: true });
    const raf = window.requestAnimationFrame(() => {
      scrollToEnd();
      inputRef.current?.focus?.();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, load, scrollToEnd]);

  // Announce the branch to the socket (again after every reconnect — rooms do not survive one).
  useEffect(() => {
    if (!branchKey || !connected) return undefined;
    emitRealtime("employee-chat:pos-branch", { branch_id: branchKey });
    return () => emitRealtime("employee-chat:pos-branch", { branch_id: null });
  }, [branchKey, connected]);

  useEffect(() => {
    if (open) scrollToEnd();
  }, [messages, open, scrollToEnd]);

  // Realtime.
  useEffect(() => {
    if (available === false) return undefined;
    const mine = (payload) => {
      const threadId = String(payload?.thread?.id || payload?.thread_id || payload?.message?.thread_id || "");
      return !threadIdRef.current || !threadId || threadId === threadIdRef.current;
    };
    const offMessage = subscribeRealtime("employee-chat:new-message", (payload = {}) => {
      const message = payload?.message;
      if (!message?.id || !mine(payload)) return;
      if (payload?.thread?.id && !threadIdRef.current) threadIdRef.current = String(payload.thread.id);
      setMessages((list) => mergeMessage(list, message));
      if (!isAdminMessage(message) || String(message.message_kind || "") === "ring") return;

      const visibleNow = openRef.current && typeof document !== "undefined" && !document.hidden;
      emitRealtimeFeedback("employee_chat_message", {
        id: `employee-chat-${message.id}`,
        title: t("pos.managerChat.newMessageToast", { name: t("pos.managerChat.management") }),
        message: portalChatMessagePreview(message, labels),
      });
      setFlash(true);
      window.setTimeout(() => setFlash(false), 2400);
      if (visibleNow) markRead();
    });
    const offRead = subscribeRealtime("employee-chat:read", (payload = {}) => {
      if (!mine(payload) || String(payload?.reader_type || "") !== "admin") return;
      const at = new Date().toISOString();
      setMessages((list) => list.map((item) => (!isAdminMessage(item) && !item.read_at ? { ...item, read_at: at } : item)));
    });
    const offUpdated = subscribeRealtime("employee-chat:message-updated", (payload = {}) => {
      const message = payload?.message || payload;
      if (!message?.id || !mine(payload)) return;
      setMessages((list) => list.map((item) => (messageKey(item) === messageKey(message) ? { ...item, ...message } : item)));
    });
    const offDeleted = subscribeRealtime("employee-chat:message-deleted", (payload = {}) => {
      const id = String(payload?.message?.id || payload?.message_id || payload?.id || "");
      if (!id) return;
      setMessages((list) => list.map((item) => (messageKey(item) === id ? { ...item, deleted_at: item.deleted_at || new Date().toISOString(), body: "" } : item)));
    });
    return () => {
      offMessage();
      offRead();
      offUpdated();
      offDeleted();
    };
  }, [available, labels, markRead, t]);

  // Poll only while the socket is down.
  useEffect(() => {
    if (available === false || connected) return undefined;
    const timer = window.setInterval(() => load({ silent: true }), POLL_MS);
    return () => window.clearInterval(timer);
  }, [available, connected, load]);

  // Reconnect catch-up: anything that landed while the socket was away.
  useEffect(() => {
    if (connected && available) load({ silent: true });
  }, [connected, available, load]);

  const stopTyping = useCallback(() => {
    if (!typingSent.current) return;
    typingSent.current = false;
    emitRealtime("employee-chat:employee-stop-typing", { channel: "branch_pos", thread_id: threadIdRef.current || null });
  }, []);

  const handleDraftChange = useCallback(
    (event) => {
      setDraft(event.target.value);
      if (!typingSent.current) {
        typingSent.current = true;
        emitRealtime("employee-chat:employee-typing", { channel: "branch_pos", thread_id: threadIdRef.current || null, employee_name: channelName });
      }
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(stopTyping, 2200);
    },
    [channelName, stopTyping]
  );

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await api.post("/employees/chat/pos/messages", { branch_id: branchKey, body });
      if (data?.thread?.id) threadIdRef.current = String(data.thread.id);
      if (data?.message) setMessages((list) => mergeMessage(list, data.message));
      setDraft("");
      stopTyping();
      inputRef.current?.focus?.();
    } catch (err) {
      setError(err?.responseBody?.message || t("pos.managerChat.sendFailed"));
    } finally {
      setSending(false);
    }
  }, [branchKey, draft, sending, stopTyping, t]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
      if (event.key === "Escape") setOpen(false);
    },
    [send]
  );

  const ringManager = useCallback(async () => {
    if (!branchKey || ringSending) return;
    setRingSending(true);
    setError("");
    try {
      await unlockRealtimeFeedbackAudio();
      const data = await api.post("/employees/chat/pos/ring", { branch_id: branchKey });
      chatRing.registerOutgoing(data);
    } catch (err) {
      const code = err?.responseBody?.code || "";
      setError(code === "ring_pending" ? t("common.chatRing.ringPending") : err?.responseBody?.message || t("common.chatRing.ringFailed"));
    } finally {
      setRingSending(false);
    }
  }, [branchKey, chatRing, ringSending, t]);

  const answerRingAndOpen = useCallback(async () => {
    await chatRing.answerIncoming();
    setOpen(true);
  }, [chatRing]);

  const testSound = useCallback(async () => {
    await unlockRealtimeFeedbackAudio();
    playRealtimeSound("staffChat", { priority: "critical", key: `test-staff-chat-${Date.now()}` });
  }, []);

  if (available === false) return null;

  const title = t("pos.managerChat.title");
  const subtitle = channelName || branchName || "";
  const unreadLabel = unread ? t("pos.managerChat.unread", { count: unread }) : "";
  const badge = unread > 99 ? "99+" : String(unread || "");

  return (
    <>
      <ChatRingOverlay ring={chatRing.incoming} onAnswer={answerRingAndOpen} onReply={answerRingAndOpen} onDismiss={chatRing.dismissIncoming} />
      <button
        type="button"
        onClick={() => {
          unlockRealtimeFeedbackAudio();
          setOpen((value) => !value);
        }}
        aria-label={unreadLabel || t("pos.managerChat.open")}
        title={unreadLabel || title}
        className={`pos-manager-chat-fab fixed z-[70] inline-flex h-14 w-14 items-center justify-center rounded-full border text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)] transition-transform duration-200 hover:scale-105 active:scale-95 ${
          unread
            ? "border-amber-300/60 bg-[linear-gradient(160deg,#f59e0b,#b45309)]"
            : "border-white/15 bg-[linear-gradient(160deg,rgba(39,39,42,0.98),rgba(9,9,11,0.98))]"
        } ${flash ? "pos-manager-chat-fab--flash" : ""}`}
        style={{ insetInlineStart: "1rem", bottom: "calc(env(safe-area-inset-bottom) + 6.75rem)" }}
      >
        <MessageSquareText className="h-6 w-6" />
        {unread ? (
          <span className="absolute -top-1.5 -end-1.5 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full border-2 border-zinc-950 bg-rose-500 px-1.5 text-[11px] font-black tabular-nums text-white">
            {badge}
          </span>
        ) : null}
        {unread ? <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-amber-400/30" /> : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={title}
          className="fixed z-[71] flex flex-col overflow-hidden rounded-[24px] border border-white/12 bg-zinc-950/97 text-white shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          style={{
            insetInlineStart: "1rem",
            bottom: "calc(env(safe-area-inset-bottom) + 1rem)",
            width: "min(26rem, calc(100vw - 2rem))",
            height: "min(36rem, calc(100dvh - 2rem))",
          }}
        >
          <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{title}</div>
              {subtitle ? <div className="truncate text-[11px] font-bold text-amber-200/80">{subtitle}</div> : null}
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-semibold text-zinc-400">
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
                <span className="truncate">{connected ? t("pos.managerChat.connected") : t("pos.managerChat.reconnecting")}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={ringManager}
              disabled={ringSending || chatRing.outgoing?.status === "ringing"}
              title={t("common.chatRing.ringTitle")}
              aria-label={t("common.chatRing.ringButton")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-400 px-2.5 text-xs font-black text-zinc-950 disabled:opacity-50"
            >
              <PhoneCall className={`h-4 w-4 ${chatRing.outgoing?.status === "ringing" ? "animate-pulse" : ""}`} />
              {t("common.chatRing.ringButton")}
            </button>
            <button
              type="button"
              onClick={testSound}
              title={t("pos.managerChat.testSound")}
              aria-label={t("pos.managerChat.testSound")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("pos.managerChat.close")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs font-semibold leading-5 text-zinc-500">
                <MessageSquareText className="h-8 w-8 text-zinc-700" />
                {t("pos.managerChat.empty")}
                <span className="text-[11px] text-zinc-600">{t("pos.managerChat.soundHint")}</span>
              </div>
            ) : (
              messages.map((message) => {
                const admin = isAdminMessage(message);
                const deleted = Boolean(message.deleted_at);
                const hasAttachment = Boolean(portalChatAttachmentRawUrl(message));
                const url = hasAttachment ? portalChatAttachmentUrl(message) : "";
                return (
                  <div key={messageKey(message)} className={`flex ${admin ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-5 ${
                        admin ? "rounded-ss-md border border-amber-300/20 bg-amber-400/10 text-amber-50" : "rounded-se-md bg-white/8 text-zinc-100"
                      }`}
                    >
                      <div className={`mb-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${admin ? "text-amber-300/80" : "text-zinc-500"}`}>
                        {admin ? t("pos.managerChat.management") : message.sender_name || t("pos.managerChat.you")}
                      </div>
                      {deleted ? (
                        <div className="italic text-zinc-500">—</div>
                      ) : (
                        <>
                          {message.body ? <div className="whitespace-pre-wrap break-words">{message.body}</div> : null}
                          {hasAttachment && isPortalChatImageMessage(message) ? (
                            <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 block overflow-hidden rounded-xl border border-white/10">
                              <img src={url} alt={portalChatAttachmentName(message) || labels.image} className="max-h-56 w-full object-cover" loading="lazy" />
                            </a>
                          ) : null}
                          {hasAttachment && isPortalChatAudioMessage(message) ? (
                            <audio controls preload="none" src={url} className="mt-1.5 w-full" />
                          ) : null}
                          {hasAttachment && !isPortalChatImageMessage(message) && !isPortalChatAudioMessage(message) ? (
                            <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-sky-300 underline-offset-2 hover:underline">
                              {portalChatAttachmentName(message) || t("pos.managerChat.attachment")}
                            </a>
                          ) : null}
                        </>
                      )}
                      <div className={`mt-1 text-[10px] tabular-nums ${admin ? "text-amber-200/60" : "text-zinc-500"}`}>
                        {formatTime(message.created_at, locale)}
                        {!admin && message.read_at ? " ✓✓" : ""}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {chatRing.outgoing ? <div className="border-t border-white/10 px-3 py-2"><ChatRingStatus outgoing={chatRing.outgoing} onClear={chatRing.clearOutgoing} /></div> : null}
          {error ? <div className="border-t border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-200">{error}</div> : null}

          <footer className="flex items-end gap-2 border-t border-white/10 p-3">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={onKeyDown}
              onBlur={stopTyping}
              rows={1}
              placeholder={t("pos.managerChat.placeholder")}
              className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-amber-300/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || sending}
              aria-label={t("pos.managerChat.send")}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-zinc-950 transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-5 w-5 rtl:-scale-x-100" />
            </button>
          </footer>
        </div>
      ) : null}
    </>
  );
}

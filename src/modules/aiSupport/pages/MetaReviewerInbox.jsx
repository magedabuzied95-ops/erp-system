import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Camera,
  CheckCheck,
  ChevronLeft,
  LogOut,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  Smile,
  User,
  Wifi,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { clearAuth } from "../../../shared/auth/authStorage";
import { emitRealtime, subscribeRealtime } from "../../../shared/realtime/socketStore";

const CHANNELS = [
  { id: "messenger", label: "Messenger", Icon: MessageCircle, tone: "cyan" },
  { id: "instagram", label: "Instagram", Icon: Camera, tone: "rose" },
];

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const timeLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

const relativeTime = (value) => {
  if (!value) return "";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return timeLabel(value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const attachmentUrl = (attachment = {}) => {
  const candidate = attachment.url || attachment.image_url || attachment.file_url || attachment.src || "";
  return /^https?:\/\//i.test(String(candidate)) ? String(candidate) : "";
};

function ReviewerMessage({ message }) {
  const incoming = message.sender_type === "customer" || message.direction === "inbound";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return (
    <article className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[86%] rounded-2xl border px-3.5 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.18)] md:max-w-[72%] ${incoming ? "rounded-bl-md border-white/10 bg-white/[0.06] text-slate-100" : "rounded-br-md border-emerald-300/25 bg-emerald-400/15 text-emerald-50"}`}>
        {attachments.map((attachment, index) => {
          const url = attachmentUrl(attachment);
          if (!url) return null;
          const type = String(attachment.type || attachment.mime_type || "").toLowerCase();
          if (type.includes("image") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) {
            return <img key={`${url}-${index}`} src={url} alt="Message attachment" className="mb-2 max-h-72 w-full rounded-xl object-contain" loading="lazy" />;
          }
          return <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="mb-2 block truncate rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-cyan-200 underline">Open attachment</a>;
        })}
        {message.text ? <p dir="auto" className="whitespace-pre-wrap break-words text-[13px] font-medium leading-6 md:text-sm">{message.text}</p> : null}
        <div className={`mt-1.5 flex items-center gap-1.5 text-[9px] font-bold ${incoming ? "text-slate-500" : "justify-end text-emerald-200/70"}`}>
          <time>{timeLabel(message.created_at)}</time>
          {!incoming ? <CheckCheck className="h-3.5 w-3.5" aria-label={message.delivery_status || "sent"} /> : null}
        </div>
        {message.reaction_emoji || message.reaction ? <span className="-mb-5 mt-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-slate-800 px-1.5 text-sm shadow-lg">{message.reaction_emoji || message.reaction}</span> : null}
      </div>
    </article>
  );
}

export default function MetaReviewerInbox() {
  const { t } = useTranslation();
  const transcriptEndRef = useRef(null);
  const [activeChannel, setActiveChannel] = useState("messenger");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [counts, setCounts] = useState({ total: 0, unread: 0 });
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [error, setError] = useState("");

  const activeChannelConfig = CHANNELS.find((item) => item.id === activeChannel) || CHANNELS[0];
  const selected = useMemo(() => conversations.find((item) => item.id === selectedId) || null, [conversations, selectedId]);

  const loadConversations = useCallback(async ({ showProgress = false } = {}) => {
    if (showProgress) setRefreshing(true);
    try {
      const result = await api.get(`/meta-reviewer/inbox/channels/${activeChannel}/conversations`, { params: { search } });
      const list = result.conversations || [];
      setChannelEnabled(result.enabled !== false);
      setConversations(list);
      setCounts(result.counts || { total: 0, unread: 0 });
      setSelectedId((current) => current && list.some((item) => item.id === current) ? current : (list[0]?.id || ""));
    } finally {
      if (showProgress) setRefreshing(false);
    }
  }, [activeChannel, search]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return setMessages([]);
    const result = await api.get(`/meta-reviewer/inbox/channels/${activeChannel}/conversations/${encodeURIComponent(conversationId)}/messages`);
    setMessages(result.messages || []);
  }, [activeChannel]);

  useEffect(() => {
    setConversations([]);
    setMessages([]);
    setSelectedId("");
    setCounts({ total: 0, unread: 0 });
    setError("");
    const timeout = setTimeout(() => loadConversations().catch(() => setError("The authorized review inbox could not be loaded.")), 150);
    return () => clearTimeout(timeout);
  }, [loadConversations]);

  useEffect(() => {
    loadMessages(selectedId).catch(() => setError("The authorized test conversation could not be opened."));
  }, [loadMessages, selectedId]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedId]);

  useEffect(() => {
    const selectChannel = () => emitRealtime("meta_reviewer:select_channel", { channel: activeChannel });
    selectChannel();
    const refresh = (payload = {}) => {
      if (payload.channel && payload.channel !== activeChannel) return;
      loadConversations().then(() => selectedId && loadMessages(selectedId)).catch(() => {});
    };
    const offConnect = subscribeRealtime("connect", selectChannel);
    const offMessage = subscribeRealtime("meta_reviewer:message", refresh);
    const offRefresh = subscribeRealtime("meta_reviewer:refresh", refresh);
    return () => { offConnect(); offMessage(); offRefresh(); };
  }, [activeChannel, loadConversations, loadMessages, selectedId]);

  const send = async (event) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || !selectedId || !channelEnabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post(`/meta-reviewer/inbox/channels/${activeChannel}/conversations/${encodeURIComponent(selectedId)}/send`, { message });
      if (result?.message) setMessages((current) => [...current.filter((item) => item.id !== result.message.id), result.message]);
      setDraft("");
      setEmojiOpen(false);
      await loadMessages(selectedId);
      await loadConversations();
    } catch {
      setError(t("aiSupport.metaReviewer.sendBlocked"));
    } finally {
      setBusy(false);
    }
  };

  const chooseChannel = (channel) => {
    setActiveChannel(channel);
    setSearch("");
    setMobileChatOpen(false);
    setEmojiOpen(false);
  };

  const chooseConversation = (conversationId) => {
    setSelectedId(conversationId);
    setMobileChatOpen(true);
    setError("");
  };

  const logout = () => {
    clearAuth();
    window.location.replace("/login");
  };

  return (
    <main data-meta-reviewer-modern-inbox="true" className="min-h-screen bg-[#090b0c] p-2 text-slate-100 md:p-4" dir="ltr">
      <section className="mx-auto flex min-h-[calc(100vh-1rem)] max-w-[1720px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#121514] shadow-[0_28px_80px_rgba(0,0,0,0.42)] md:min-h-[calc(100vh-2rem)]">
        <header className="border-b border-white/10 bg-white/[0.025] px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-amber-300/25 bg-amber-400/10 text-amber-300"><Bot className="h-5 w-5" /></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">AI Social Media Center</p>
                <h1 className="text-base font-black text-white md:text-lg">AI Inbox</h1>
              </div>
              <span className="hidden rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100 sm:inline-flex">Meta review</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-[11px] font-black text-emerald-100"><Wifi className="h-3.5 w-3.5" /> Live</span>
              <button type="button" onClick={() => loadConversations({ showProgress: true }).catch(() => setError("Refresh failed."))} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-200 transition hover:bg-white/[0.09]" aria-label="Refresh inbox"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button>
              <button type="button" onClick={logout} className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/15 bg-rose-400/10 text-rose-200 transition hover:bg-rose-400/15" aria-label={t("aiSupport.metaReviewer.logout")}><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end">
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-amber-400 px-4 text-[11px] font-black text-slate-950"><MessageSquareText className="h-4 w-4" /> AI Inbox <span className="rounded-full bg-black/15 px-2 py-0.5">{counts.total}</span></span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[64px_320px_minmax(0,1fr)]">
          <nav className="hidden border-r border-white/10 bg-black/15 py-4 md:flex md:flex-col md:items-center md:gap-3" aria-label="Review channels">
            {CHANNELS.map(({ id, label, Icon, tone }) => (
              <button data-meta-reviewer-channel={id} key={id} type="button" onClick={() => chooseChannel(id)} aria-label={label} aria-current={activeChannel === id ? "page" : undefined} className={`relative grid h-11 w-11 place-items-center rounded-2xl border transition ${activeChannel === id ? tone === "rose" ? "border-rose-300/40 bg-rose-400/15 text-rose-200 shadow-[0_12px_30px_rgba(244,63,94,0.15)]" : "border-cyan-300/40 bg-cyan-400/15 text-cyan-200 shadow-[0_12px_30px_rgba(34,211,238,0.15)]" : "border-white/10 bg-white/[0.04] text-slate-500 hover:text-slate-200"}`}>
                <Icon className="h-5 w-5" />
                {activeChannel === id ? <span className="absolute -right-1 h-2 w-2 rounded-full bg-amber-300" /> : null}
              </button>
            ))}
          </nav>

          <aside className={`${mobileChatOpen ? "hidden" : "flex"} min-h-0 flex-col border-r border-white/10 bg-[#111413] md:flex`}>
            <div className="border-b border-white/10 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-black text-white">Conversations</h2><p className="mt-0.5 text-[10px] font-semibold text-slate-500">Authorized customer channels</p></div>
                <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">{counts.unread}</span>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 md:hidden" role="tablist">
                {CHANNELS.map(({ id, label, Icon }) => <button data-meta-reviewer-channel={id} key={id} type="button" onClick={() => chooseChannel(id)} className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl border text-[11px] font-black ${activeChannel === id ? "border-amber-300/35 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/[0.04] text-slate-400"}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}
              </div>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-cyan-300/35">
                <Search className="h-4 w-4 text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-white outline-none placeholder:text-slate-600" placeholder={`Search ${activeChannelConfig.label} conversations`} />
              </label>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
              {conversations.map((item) => (
                <button key={item.id} type="button" onClick={() => chooseConversation(item.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedId === item.id ? "border-cyan-300/35 bg-cyan-300/10 shadow-[0_14px_32px_rgba(8,145,178,0.10)]" : "border-white/10 bg-white/[0.025] hover:bg-white/[0.055]"}`}>
                  <div className="flex items-start gap-3">
                    <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/[0.07] text-slate-400 ring-1 ring-white/10">
                      {item.customer_avatar_url ? <img src={item.customer_avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <User className="h-5 w-5" />}
                      {item.unread_count ? <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-[#111413] bg-rose-500" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2"><strong dir="auto" className="truncate text-[13px] font-black text-white">{item.customer_name || "Meta test customer"}</strong><time className="shrink-0 text-[9px] font-bold text-slate-600">{relativeTime(item.last_message_at)}</time></div>
                      <div className="mt-1 flex items-center gap-1.5"><span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[8px] font-black ${activeChannel === "instagram" ? "border-rose-300/20 bg-rose-400/10 text-rose-200" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-200"}`}>{activeChannelConfig.label}</span>{item.unread_count ? <span className="text-[9px] font-black text-amber-300">{item.unread_count} new</span> : null}</div>
                      <p dir="auto" className="mt-2 truncate text-[11px] font-medium text-slate-500">{item.latest_message_preview || "No messages yet"}</p>
                    </div>
                  </div>
                </button>
              ))}
              {!channelEnabled ? <div className="rounded-2xl border border-dashed border-rose-300/20 bg-rose-400/5 p-6 text-center text-xs font-semibold text-rose-200">{t("aiSupport.metaReviewer.channelLocked")}</div> : null}
              {channelEnabled && !conversations.length ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center"><MessageCircle className="mx-auto mb-3 h-8 w-8 text-slate-700" /><p className="text-xs font-semibold text-slate-500">{t("aiSupport.metaReviewer.noConversation")}</p></div> : null}
            </div>
          </aside>

          <section className={`${mobileChatOpen ? "flex" : "hidden"} min-h-0 flex-col bg-[#0d100f] md:flex`}>
            <header className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.025] px-3 py-2.5 md:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <button type="button" onClick={() => setMobileChatOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] md:hidden" aria-label="Back to conversations"><ChevronLeft className="h-4 w-4" /></button>
                <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/10">{selected?.customer_avatar_url ? <img src={selected.customer_avatar_url} alt="" className="h-full w-full object-cover" /> : <User className="h-4 w-4 text-slate-400" />}</div>
                <div className="min-w-0"><strong dir="auto" className="block truncate text-sm font-black text-white">{selected?.customer_name || t("aiSupport.metaReviewer.selectConversation")}</strong><span className={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[8px] font-black ${activeChannel === "instagram" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"}`}><activeChannelConfig.Icon className="h-2.5 w-2.5" />{activeChannelConfig.label}</span></div>
              </div>
              <span className="hidden items-center gap-1.5 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-black text-emerald-100 sm:inline-flex"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Authorized review conversation</span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.055),transparent_32%)] p-3 md:p-5">
              <div className="mx-auto max-w-5xl space-y-3">
                {messages.map((message) => <ReviewerMessage key={message.id} message={message} />)}
                {selectedId && !messages.length ? <div className="mx-auto max-w-md rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-7 text-center text-xs font-semibold text-slate-500">{t("aiSupport.metaReviewer.beginReview")}</div> : null}
                {!selectedId ? <div className="grid min-h-[360px] place-items-center"><div className="text-center"><MessageSquareText className="mx-auto mb-3 h-10 w-10 text-slate-700" /><p className="text-sm font-black text-slate-400">Select a conversation to start reviewing</p><p className="mt-1 text-xs text-slate-600">Only authorized Meta test conversations are available.</p></div></div> : null}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {error ? <p className="border-t border-rose-300/15 bg-rose-400/10 px-4 py-2 text-xs font-bold text-rose-200">{error}</p> : null}
            <form onSubmit={send} className="border-t border-white/10 bg-[#121514] p-2.5 md:p-3">
              <div className="relative mx-auto flex max-w-5xl items-end gap-2 rounded-2xl border border-amber-300/25 bg-white/[0.045] p-1.5 shadow-[0_14px_42px_rgba(0,0,0,0.25)] focus-within:border-amber-300/45">
                <button type="button" disabled={!selectedId || !channelEnabled} onClick={() => setEmojiOpen((value) => !value)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-white/[0.07] hover:text-amber-200 disabled:opacity-30" aria-label="Choose emoji"><Smile className="h-5 w-5" /></button>
                {emojiOpen ? <div className="absolute bottom-[calc(100%+8px)] left-0 flex items-center gap-1 rounded-2xl border border-white/10 bg-[#1a1e1c] p-2 shadow-2xl">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { setDraft((current) => `${current}${emoji}`); setEmojiOpen(false); }} className="grid h-9 w-9 place-items-center rounded-xl text-lg transition hover:bg-white/10">{emoji}</button>)}</div> : null}
                <textarea disabled={!selectedId || !channelEnabled} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(event); } }} maxLength={2000} rows={1} className="min-h-10 max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm font-medium text-white outline-none placeholder:text-slate-600 disabled:opacity-40" placeholder={t("aiSupport.metaReviewer.replyPlaceholder")} />
                <button type="submit" disabled={!selectedId || !channelEnabled || !draft.trim() || busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-400 text-slate-950 shadow-[0_10px_28px_rgba(251,191,36,0.22)] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-35" aria-label={t("aiSupport.metaReviewer.send")}><Send className={`h-5 w-5 ${busy ? "animate-pulse" : ""}`} /></button>
              </div>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}

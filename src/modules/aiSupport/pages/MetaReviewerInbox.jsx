import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, LogOut, MessageCircle, Search, Send } from "lucide-react";

import { api } from "../../../shared/api/api";
import { clearAuth } from "../../../shared/auth/authStorage";
import { emitRealtime, subscribeRealtime } from "../../../shared/realtime/socketStore";

const timeLabel = (value) => value ? new Date(value).toLocaleString() : "";
const channelLabels = { messenger: "Messenger", instagram: "Instagram" };

export default function MetaReviewerInbox() {
  const { t } = useTranslation();
  const [activeChannel, setActiveChannel] = useState("messenger");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [counts, setCounts] = useState({ total: 0, unread: 0 });
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => conversations.find((item) => item.id === selectedId) || null, [conversations, selectedId]);

  const loadConversations = useCallback(async () => {
    const result = await api.get(`/meta-reviewer/inbox/channels/${activeChannel}/conversations`, { params: { search } });
    const list = result.conversations || [];
    setChannelEnabled(result.enabled !== false);
    setConversations(list);
    setCounts(result.counts || { total: 0, unread: 0 });
    setSelectedId((current) => current && list.some((item) => item.id === current) ? current : (list[0]?.id || ""));
  }, [activeChannel, search]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return setMessages([]);
    const result = await api.get(`/meta-reviewer/inbox/channels/${activeChannel}/conversations/${encodeURIComponent(conversationId)}/messages`);
    setMessages(result.messages || []);
  }, [activeChannel]);

  useEffect(() => {
    setConversations([]); setMessages([]); setSelectedId(""); setCounts({ total: 0, unread: 0 }); setError("");
    const timeout = setTimeout(() => loadConversations().catch(() => setError("The authorized review inbox could not be loaded.")), 150);
    return () => clearTimeout(timeout);
  }, [loadConversations]);

  useEffect(() => { loadMessages(selectedId).catch(() => setError("The authorized test conversation could not be opened.")); }, [loadMessages, selectedId]);

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
    event.preventDefault();
    const message = draft.trim();
    if (!message || !selectedId || !channelEnabled || busy) return;
    setBusy(true); setError("");
    try {
      await api.post(`/meta-reviewer/inbox/channels/${activeChannel}/conversations/${encodeURIComponent(selectedId)}/send`, { message });
      setDraft(""); await loadMessages(selectedId);
    } catch {
      setError(t("aiSupport.metaReviewer.sendBlocked"));
    } finally { setBusy(false); }
  };

  const logout = () => { clearAuth(); window.location.replace("/login"); };

  return (
    <main className="min-h-screen bg-[var(--bg)] p-3 text-[var(--text)] md:p-6" dir="ltr">
      <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] md:grid-cols-[320px_1fr]">
        <aside className="border-b border-[var(--border)] p-4 md:border-b-0 md:border-r">
          <header className="mb-4 flex items-center justify-between">
            <div><p className="text-xs text-[var(--muted)]">{t("aiSupport.metaReviewer.eyebrow")}</p><h1 className="m1-page-title">{t("aiSupport.metaReviewer.title")}</h1></div>
            <button type="button" onClick={logout} className="rounded-full border border-[var(--border)] p-2" aria-label={t("aiSupport.metaReviewer.logout")}><LogOut size={18} /></button>
          </header>
          <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label={t("aiSupport.metaReviewer.reviewChannel")}>
            {Object.entries(channelLabels).map(([channel, label]) => (
              <button key={channel} type="button" role="tab" aria-selected={activeChannel === channel} onClick={() => { setActiveChannel(channel); setSearch(""); }} className={`flex items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold ${activeChannel === channel ? "border-amber-400 bg-amber-400 text-black" : "border-[var(--border)]"}`}>
                {channel === "instagram" ? <Camera size={16} /> : <MessageCircle size={16} />}{label}
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--border)] px-3">
            <Search size={18} className="text-[var(--muted)]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder={t("aiSupport.metaReviewer.searchPlaceholder", { channel: channelLabels[activeChannel] })} />
          </div>
          <p className="mb-3 text-xs text-[var(--muted)]">{t("aiSupport.metaReviewer.counts", { total: counts.total, unread: counts.unread })}</p>
          <div className="space-y-2">
            {conversations.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-[var(--radius-control)] border p-3 text-left ${selectedId === item.id ? "border-amber-400 bg-amber-400/10" : "border-[var(--border)]"}`}>
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[var(--surface-2)]">{item.customer_avatar_url ? <img src={item.customer_avatar_url} alt="" className="h-full w-full object-cover" /> : <MessageCircle size={20} />}</div><div className="min-w-0"><strong>{item.customer_name}</strong><p className="truncate text-xs text-[var(--muted)]">{item.latest_message_preview}</p></div></div>
              </button>
            ))}
            {!channelEnabled && <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">{t("aiSupport.metaReviewer.channelLocked")}</div>}
            {channelEnabled && !conversations.length && <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">{t("aiSupport.metaReviewer.noConversation")}</div>}
          </div>
        </aside>

        <section className="flex min-h-[560px] flex-col">
          <header className="border-b border-[var(--border)] p-4"><strong>{selected?.customer_name || t("aiSupport.metaReviewer.selectConversation")}</strong><p className="text-xs text-[var(--muted)]">{channelLabels[activeChannel]} · M1 Store</p></header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => <article key={message.id} className={`max-w-[80%] rounded-2xl p-3 ${message.sender_type === "customer" ? "mr-auto bg-[var(--surface-2)]" : "ml-auto bg-amber-400 text-black"}`}><p className="whitespace-pre-wrap">{message.text}</p><time className="mt-1 block text-[10px] opacity-60">{timeLabel(message.created_at)}</time></article>)}
            {selectedId && !messages.length && <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">{t("aiSupport.metaReviewer.beginReview")}</div>}
          </div>
          {error && <p className="px-4 pb-2 text-sm text-red-500">{error}</p>}
          <form onSubmit={send} className="flex gap-2 border-t border-[var(--border)] p-4">
            <input disabled={!selectedId || !channelEnabled} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-4 py-3 outline-none" placeholder={t("aiSupport.metaReviewer.replyPlaceholder")} />
            <button disabled={!selectedId || !channelEnabled || !draft.trim() || busy} className="rounded-[var(--radius-control)] bg-amber-400 px-5 text-black disabled:opacity-40" aria-label={t("aiSupport.metaReviewer.send")}><Send size={20} /></button>
          </form>
        </section>
      </section>
    </main>
  );
}

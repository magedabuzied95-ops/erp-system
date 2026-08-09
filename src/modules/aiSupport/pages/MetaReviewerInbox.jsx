import { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, MessageCircle, Search, Send } from "lucide-react";

import { api } from "../../../shared/api/api";
import { clearAuth } from "../../../shared/auth/authStorage";
import { subscribeRealtime } from "../../../shared/realtime/socketStore";

const timeLabel = (value) => value ? new Date(value).toLocaleString() : "";

export default function MetaReviewerInbox() {
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
    const result = await api.get("/meta-reviewer/inbox/conversations", { params: { search } });
    setConversations(result.conversations || []);
    setCounts(result.counts || { total: 0, unread: 0 });
    setSelectedId((current) => current && (result.conversations || []).some((item) => item.id === current)
      ? current
      : (result.conversations?.[0]?.id || ""));
  }, [search]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return setMessages([]);
    const result = await api.get(`/meta-reviewer/inbox/conversations/${encodeURIComponent(conversationId)}/messages`);
    setMessages(result.messages || []);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => loadConversations().catch(() => setError("تعذر تحميل صندوق المراجعة.")), 200);
    return () => clearTimeout(timeout);
  }, [loadConversations]);

  useEffect(() => {
    loadMessages(selectedId).catch(() => setError("تعذر فتح المحادثة."));
  }, [loadMessages, selectedId]);

  useEffect(() => {
    const refresh = () => loadConversations().then(() => selectedId && loadMessages(selectedId)).catch(() => {});
    const offMessage = subscribeRealtime("meta_reviewer:message", refresh);
    const offRefresh = subscribeRealtime("meta_reviewer:refresh", refresh);
    return () => { offMessage(); offRefresh(); };
  }, [loadConversations, loadMessages, selectedId]);

  const send = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !selectedId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/meta-reviewer/inbox/conversations/${encodeURIComponent(selectedId)}/send`, { message });
      setDraft("");
      await loadMessages(selectedId);
    } catch {
      setError("تعذر إرسال الرد. تحقق من أن المحادثة التجريبية ما زالت ضمن النطاق المسموح.");
    } finally {
      setBusy(false);
    }
  };

  const logout = () => { clearAuth(); window.location.replace("/login"); };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-3 md:p-6" dir="rtl">
      <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] md:grid-cols-[320px_1fr]">
        <aside className="border-b border-[var(--border)] p-4 md:border-b-0 md:border-l">
          <header className="mb-4 flex items-center justify-between">
            <div><p className="text-xs text-[var(--muted)]">META REVIEW</p><h1 className="text-xl font-bold">Messenger Inbox</h1></div>
            <button type="button" onClick={logout} className="rounded-full border border-[var(--border)] p-2" aria-label="تسجيل الخروج"><LogOut size={18} /></button>
          </header>
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--border)] px-3">
            <Search size={18} className="text-[var(--muted)]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent py-3 outline-none" placeholder="بحث داخل محادثة الاختبار" />
          </div>
          <p className="mb-3 text-xs text-[var(--muted)]">المحادثات: {counts.total} · غير المقروء: {counts.unread}</p>
          <div className="space-y-2">
            {conversations.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl border p-3 text-right ${selectedId === item.id ? "border-amber-400 bg-amber-400/10" : "border-[var(--border)]"}`}>
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[var(--surface-2)]">{item.customer_avatar_url ? <img src={item.customer_avatar_url} alt="" className="h-full w-full object-cover" /> : <MessageCircle size={20} />}</div><div className="min-w-0"><strong>{item.customer_name}</strong><p className="truncate text-xs text-[var(--muted)]">{item.latest_message_preview}</p></div></div>
              </button>
            ))}
            {!conversations.length && <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">لا توجد محادثات ضمن نطاق الاختبار المصرح.</div>}
          </div>
        </aside>

        <section className="flex min-h-[560px] flex-col">
          <header className="border-b border-[var(--border)] p-4"><strong>{selected?.customer_name || "اختر محادثة الاختبار"}</strong><p className="text-xs text-[var(--muted)]">Facebook Messenger · M1 Store</p></header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => <article key={message.id} className={`max-w-[80%] rounded-2xl p-3 ${message.sender_type === "customer" ? "mr-auto bg-[var(--surface-2)]" : "ml-auto bg-amber-400 text-black"}`}><p className="whitespace-pre-wrap">{message.text}</p><time className="mt-1 block text-[10px] opacity-60">{timeLabel(message.created_at)}</time></article>)}
          </div>
          {error && <p className="px-4 pb-2 text-sm text-red-500">{error}</p>}
          <form onSubmit={send} className="flex gap-2 border-t border-[var(--border)] p-4">
            <input disabled={!selectedId} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} className="min-w-0 flex-1 rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none" placeholder="اكتب ردًا يدويًا" />
            <button disabled={!selectedId || !draft.trim() || busy} className="rounded-2xl bg-amber-400 px-5 text-black disabled:opacity-40" aria-label="إرسال"><Send size={20} /></button>
          </form>
        </section>
      </section>
    </main>
  );
}

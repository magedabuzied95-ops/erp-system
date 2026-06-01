import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";

import { api } from "../../../shared/api/api";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";

const formatChatTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function EmployeeChatInbox() {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const realtime = useRealtimeConnection();

  const selectedThread = useMemo(
    () => threads.find((item) => String(item.id) === String(selectedId)) || thread,
    [selectedId, thread, threads]
  );

  const loadThreads = async () => {
    try {
      setError("");
      const response = await api.get("/employees/chat/threads");
      setThreads(response.threads || []);
      if (!selectedId && response.threads?.[0]?.id) setSelectedId(response.threads[0].id);
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تحميل محادثات الموظفين");
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadThread = async (threadId = selectedId) => {
    if (!threadId) return;
    try {
      setLoadingThread(true);
      setError("");
      const response = await api.get(`/employees/chat/threads/${encodeURIComponent(threadId)}`);
      setThread(response.thread || null);
      setMessages(response.messages || []);
      setThreads((current) =>
        current.map((item) => (String(item.id) === String(threadId) ? { ...item, unread_count: 0 } : item))
      );
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر فتح المحادثة");
    } finally {
      setLoadingThread(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    loadThread(selectedId);
    if (realtime.connected) return undefined;
    const timer = window.setInterval(() => {
      loadThread(selectedId);
      loadThreads();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [selectedId, realtime.connected]);

  useEffect(() => {
    const upsertThread = (nextThread) => {
      if (!nextThread?.id) return;
      setThreads((current) => {
        const exists = current.some((item) => String(item.id) === String(nextThread.id));
        const rows = exists
          ? current.map((item) => (String(item.id) === String(nextThread.id) ? { ...item, ...nextThread } : item))
          : [nextThread, ...current];
        return rows.sort((a, b) => new Date(b.last_message_created_at || b.last_message_at || b.updated_at || 0) - new Date(a.last_message_created_at || a.last_message_at || a.updated_at || 0));
      });
    };

    const onMessage = (payload = {}) => {
      const nextThread = payload.thread;
      const message = payload.message;
      upsertThread(nextThread);
      if (String(nextThread?.id || message?.thread_id) === String(selectedId)) {
        setMessages((current) => {
          if (!message?.id || current.some((item) => String(item.id) === String(message.id))) return current;
          return [...current, message];
        });
        if (message?.sender_type === "employee") {
          loadThread(selectedId);
        }
      }
    };

    const onThreadUpdated = (payload = {}) => upsertThread(payload.thread);

    const onRead = (payload = {}) => {
      if (!payload.thread_id) return;
      setThreads((current) =>
        current.map((item) => (String(item.id) === String(payload.thread_id) ? { ...item, unread_count: 0 } : item))
      );
    };

    const offMessage = subscribeRealtime("employee-chat:new-message", onMessage);
    const offThread = subscribeRealtime("employee-chat:thread-updated", onThreadUpdated);
    const offRead = subscribeRealtime("employee-chat:read", onRead);
    return () => {
      offMessage();
      offThread();
      offRead();
    };
  }, [selectedId]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || !selectedId) return;
    try {
      setSending(true);
      setError("");
      await api.post(`/employees/chat/threads/${encodeURIComponent(selectedId)}/messages`, { body: text });
      setBody("");
      await loadThread(selectedId);
      await loadThreads();
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر إرسال الرد");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="theme-card overflow-hidden p-0" dir="rtl">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black text-[var(--muted)]">الموظفون / المحادثات</p>
            <h2 className="mt-1 text-2xl font-black text-[var(--text)]">محادثات الموظفين</h2>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">{realtime.connected ? "التحديث الفوري يعمل" : "التحديث الاحتياطي يعمل كل 12 ثانية"}</p>
          </div>
          <button type="button" onClick={loadThreads} className="theme-button-soft min-h-10 px-3 text-sm">
            <RefreshCw className={`h-4 w-4 ${loadingThreads ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">{error}</div> : null}
      </div>

      <div className="grid min-h-[34rem] md:grid-cols-[22rem_1fr]">
        <aside className="border-b border-[var(--border)] bg-[var(--card)] md:border-b-0 md:border-l">
          {loadingThreads ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل...
            </div>
          ) : threads.length ? (
            <div className="max-h-[34rem] overflow-y-auto p-2">
              {threads.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={[
                    "mb-2 w-full rounded-xl border p-3 text-right transition",
                    String(selectedId) === String(item.id)
                      ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                      : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-black text-[var(--text)]" dir="auto">{item.employee_name || "موظف"}</div>
                        {Number(item.unread_count || 0) > 0 ? (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white" dir="ltr">{item.unread_count}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{item.branch_name || "بدون فرع"}</div>
                      <div className="mt-2 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{item.last_message || "لا توجد رسائل بعد"}</div>
                      <div className="mt-2 text-[11px] font-black text-[var(--muted)]" dir="ltr">{formatChatTime(item.last_message_created_at || item.last_message_at || item.updated_at)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-sm font-bold text-[var(--muted)]">
              <MessageCircle className="mx-auto h-8 w-8" />
              <div className="mt-2">لا توجد محادثات حتى الآن.</div>
            </div>
          )}
        </aside>

        <div className="flex min-h-[34rem] flex-col bg-[var(--bg)]">
          {selectedThread ? (
            <>
              <div className="border-b border-[var(--border)] p-4">
                <div className="text-lg font-black text-[var(--text)]" dir="auto">{selectedThread.employee_name || "موظف"}</div>
                <div className="mt-1 text-xs font-bold text-[var(--muted)]" dir="auto">
                  {selectedThread.employee_code || "-"} · {selectedThread.branch_name || "بدون فرع"}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto scroll-smooth p-4">
                {loadingThread ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm font-bold text-[var(--muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري فتح المحادثة...
                  </div>
                ) : messages.length ? (
                  messages.map((message) => {
                    const admin = message.sender_type === "admin";
                    return (
                      <div key={message.id} className={`flex ${admin ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[82%] break-words rounded-2xl px-4 py-3 text-sm font-bold leading-relaxed shadow-sm sm:max-w-[70%] ${admin ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}>
                          <div className="whitespace-pre-wrap break-words" dir="auto">{message.body}</div>
                          <div className={`mt-2 text-[10px] font-black ${admin ? "text-white/70" : "text-[var(--muted)]"}`} dir="ltr">{formatChatTime(message.created_at)}</div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-6 text-center text-sm font-bold text-[var(--muted)]">
                    لا توجد رسائل في هذه المحادثة.
                  </div>
                )}
              </div>
              <form onSubmit={sendMessage} className="shrink-0 border-t border-[var(--border)] p-3">
                <div className="flex gap-2">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="اكتب رد الإدارة..."
                    className="min-h-12 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm font-bold text-[var(--text)] outline-none focus:border-[var(--primary)]"
                    dir="auto"
                  />
                  <button type="submit" disabled={sending || !body.trim()} className="theme-button-primary min-h-12 px-4 disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    إرسال
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-[var(--muted)]">
              اختر محادثة من القائمة.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownCircle, CheckCheck, FileText, Loader2, MessageCircle, Mic, Paperclip, RefreshCw, Send, UserRound, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import { API_ORIGIN } from "../../../shared/constants/app";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { socket } from "../../../socket";
import WhatsAppVoiceMessage from "../components/WhatsAppVoiceMessage";

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

const formatMessageTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const attachmentUrl = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `${API_ORIGIN}${text.startsWith("/") ? text : `/${text}`}`;
};

const formatFileSize = (value = 0) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const allowedAttachment = (file) => {
  if (!file) return true;
  return new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
  ]).has(file.type);
};

const messagePreview = (item = {}) => {
  const body = String(item.last_message || item.body || "").trim();
  if (body) return body;
  if (item.attachment_type === "image") return "صورة";
  if (item.attachment_type === "audio") return "رسالة صوتية";
  if (item.attachment_url) return "ملف";
  return "لا توجد رسائل بعد";
};

const replyPreview = (message = {}) => {
  const body = String(message.body || message.reply_body || "").trim();
  if (body) return body.length > 80 ? `${body.slice(0, 77)}...` : body;
  const type = message.attachment_type || message.reply_attachment_type;
  if (type === "image") return "صورة";
  if (type === "audio") return "رسالة صوتية";
  if (message.attachment_url || message.reply_attachment_name) return "ملف";
  return "رسالة";
};

function AttachmentView({ message, outgoing = false, timeText = "", showChecks = false, read = false, onImageClick }) {
  if (!message?.attachment_url) return null;
  const href = attachmentUrl(message.attachment_url);
  const isImage = message.attachment_type === "image" || String(message.attachment_mime || "").startsWith("image/");
  const isAudio = message.attachment_type === "audio" || String(message.attachment_mime || "").startsWith("audio/");
  const name = message.attachment_name || (isImage ? "صورة" : "ملف");
  if (isImage) {
    return (
      <button type="button" onClick={() => onImageClick?.(href)} className="mb-2 block overflow-hidden rounded-2xl border border-black/5 bg-black/5 text-start">
        <img src={href} alt={name} className="max-h-64 w-full object-cover" />
      </button>
    );
  }
  if (isAudio) {
    return (
      <WhatsAppVoiceMessage
        src={href}
        outgoing={outgoing}
        label="رسالة صوتية"
        timeText={timeText}
        showChecks={showChecks}
        read={read}
      />
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" download className="mb-2 flex items-center gap-3 rounded-2xl border border-black/10 bg-black/5 p-3 text-inherit no-underline">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700">
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black" dir="auto">{name}</span>
        <span className="mt-0.5 block text-[10px] font-bold opacity-70" dir="ltr">{message.attachment_mime || "ملف"} {formatFileSize(message.attachment_size)}</span>
      </span>
    </a>
  );
}

export default function EmployeeChatInbox() {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [typingEmployee, setTypingEmployee] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, seconds: 0, supported: false });
  const [error, setError] = useState("");
  const realtime = useRealtimeConnection();
  const fileInputRef = useRef(null);
  const messagesRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingStopRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const selectedThread = useMemo(
    () => threads.find((item) => String(item.id) === String(selectedId)) || thread,
    [selectedId, thread, threads]
  );
  const firstUnreadIndex = useMemo(
    () => messages.findIndex((message) => message.sender_type === "employee" && !message.read_at),
    [messages]
  );

  useEffect(() => {
    setRecordingState((current) => ({ ...current, supported: typeof window !== "undefined" && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia) }));
  }, []);

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
    const onTyping = (payload = {}) => {
      if (payload.sender_type !== "employee") return;
      if (payload.thread_id && String(payload.thread_id) !== String(selectedId)) return;
      setTypingEmployee(payload.employee_name || selectedThread?.employee_name || "الموظف");
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => setTypingEmployee(""), 3000);
    };
    const onStopTyping = (payload = {}) => {
      if (payload.sender_type !== "employee") return;
      if (payload.thread_id && String(payload.thread_id) !== String(selectedId)) return;
      setTypingEmployee("");
    };

    const offMessage = subscribeRealtime("employee-chat:new-message", onMessage);
    const offThread = subscribeRealtime("employee-chat:thread-updated", onThreadUpdated);
    const offRead = subscribeRealtime("employee-chat:read", onRead);
    const offTyping = subscribeRealtime("employee-chat:typing", onTyping);
    const offStopTyping = subscribeRealtime("employee-chat:stop-typing", onStopTyping);
    return () => {
      offMessage();
      offThread();
      offRead();
      offTyping();
      offStopTyping();
    };
  }, [selectedId, selectedThread?.employee_name]);

  useEffect(() => {
    if (!selectedThread) return undefined;
    window.setTimeout(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      }
    }, 50);
    return undefined;
  }, [selectedThread, messages.length]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if ((!text && !attachment) || !selectedId) return;
    try {
      setSending(true);
      setError("");
      const formData = new FormData();
      if (text) formData.append("body", text);
      if (attachment) formData.append("attachment", attachment);
      if (replyTo?.id) formData.append("reply_to_message_id", replyTo.id);
      await api.post(`/employees/chat/threads/${encodeURIComponent(selectedId)}/messages`, formData);
      setBody("");
      setAttachment(null);
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadThread(selectedId);
      await loadThreads();
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر إرسال الرد");
    } finally {
      setSending(false);
    }
  };

  const chooseAttachment = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setAttachment(null);
      return;
    }
    if (!allowedAttachment(file) || file.size > 10 * 1024 * 1024) {
      setError("نوع الملف غير مدعوم أو أكبر من 10MB");
      event.target.value = "";
      setAttachment(null);
      return;
    }
    setError("");
    setAttachment(file);
  };

  const emitTyping = () => {
    if (!selectedThread?.employee_id || !socket?.connected) return;
    const payload = { thread_id: selectedId, employee_id: selectedThread.employee_id };
    if (!typingStopRef.current) socket.emit("employee-chat:typing", payload);
    if (typingStopRef.current) window.clearTimeout(typingStopRef.current);
    typingStopRef.current = window.setTimeout(() => {
      socket.emit("employee-chat:stop-typing", payload);
      typingStopRef.current = null;
    }, 2500);
  };

  const scrollToBottom = () => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    setShowJump(false);
  };

  const onMessagesScroll = () => {
    const node = messagesRef.current;
    if (!node) return;
    setShowJump(node.scrollHeight - node.scrollTop - node.clientHeight > 140);
  };

  const startVoiceRecording = async () => {
    if (!recordingState.supported || recordingState.active) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordingState((current) => ({ ...current, active: true, seconds: 0 }));
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingState((current) => ({ ...current, seconds: current.seconds + 1 }));
    }, 1000);
  };

  const cancelVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
    recordingChunksRef.current = [];
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    setRecordingState((current) => ({ ...current, active: false, seconds: 0 }));
  };

  const sendVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.onstop = () => {
      recorder.stream?.getTracks?.().forEach((track) => track.stop());
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      recordingChunksRef.current = [];
      setRecordingState((current) => ({ ...current, active: false, seconds: 0 }));
      if (blob.size) setAttachment(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));
    };
    recorder.stop();
  };

  return (
    <section className="theme-card flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden p-0 md:h-auto md:min-h-0" dir="rtl">
      <div className="shrink-0 border-b border-[var(--border)] p-4">
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

      <div className="grid min-h-0 flex-1 md:min-h-[34rem] md:grid-cols-[22rem_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--border)] bg-[var(--card)] md:border-b-0 md:border-l">
          {loadingThreads ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل...
            </div>
          ) : threads.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:max-h-[34rem]">
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
                      <div className="mt-2 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{messagePreview(item)}</div>
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

        <div className="flex min-h-0 flex-col bg-[#0b141a] md:min-h-[34rem]">
          {selectedThread ? (
            <>
              <div className="shrink-0 border-b border-white/10 bg-[#1f2c33] px-4 py-2 text-white">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-white/10">
                    <UserRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-black leading-5" dir="auto">{selectedThread.employee_name || "موظف"}</div>
                    <div className="hidden">
                  {selectedThread.employee_code || "-"} · {selectedThread.branch_name || "بدون فرع"}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-emerald-200">متصل الآن</div>
                  </div>
                </div>
              </div>
              <div
                ref={messagesRef}
                className="min-h-0 flex-1 space-y-1 overflow-y-auto scroll-smooth px-3 py-2"
                onScroll={onMessagesScroll}
                style={{
                  backgroundColor: "#0b141a",
                  backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0), linear-gradient(135deg, rgba(20,184,166,0.035), transparent 35%, rgba(15,23,42,0.18))",
                  backgroundSize: "18px 18px, 100% 100%",
                }}
              >
                <div className="mx-auto mb-3 w-fit rounded-full bg-[#182229]/90 px-3 py-1 text-[11px] font-black text-slate-300">اليوم</div>
                <div className="mx-auto mb-2 w-fit rounded-full bg-[#182229]/90 px-2.5 py-0.5 text-[10px] font-bold leading-4 text-slate-300">هذه المحادثة خاصة بين الموظف والإدارة</div>
                {loadingThread ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl bg-white/10 p-4 text-sm font-bold text-slate-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري فتح المحادثة...
                  </div>
                ) : messages.length ? (
                  messages.map((message, index) => {
                    const admin = message.sender_type === "admin";
                    const isAudioMessage = message.attachment_type === "audio" || String(message.attachment_mime || "").startsWith("audio/");
                    const hasMessageBody = Boolean(String(message.body || "").trim());
                    const voiceMessage = isAudioMessage && !hasMessageBody;
                    return (
                      <div key={message.id} id={`admin-chat-message-${message.id}`}>
                        {index === firstUnreadIndex ? <div className="mx-auto mb-2 w-fit rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-black text-emerald-100">رسائل غير مقروءة</div> : null}
                      <div className={`flex ${admin ? "justify-start" : "justify-end"}`}>
                        <div className={`relative w-fit break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm ${voiceMessage ? "max-w-[86%] px-2 py-1.5" : "max-w-[72%] px-2 py-1"} ${admin ? "rounded-bl-[0.25rem] bg-[#005c4b] text-white after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[#005c4b] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]" : "rounded-br-[0.25rem] bg-[#202c33] text-slate-50 after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[#202c33] after:[clip-path:polygon(0_0,100%_100%,0_100%)]"}`}>
                          {message.reply_to_message_id ? (
                            <button type="button" onClick={() => document.getElementById(`admin-chat-message-${message.reply_to_message_id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })} className="mb-1 w-full rounded-xl border-r-2 border-emerald-300 bg-black/10 px-2 py-1 text-start text-[11px] leading-4 text-slate-200/80">
                              <div className="font-black">{message.reply_sender_type === "admin" ? "الإدارة" : selectedThread?.employee_name || "الموظف"}</div>
                              <div className="truncate">{replyPreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name })}</div>
                            </button>
                          ) : null}
                          <AttachmentView
                            message={message}
                            outgoing={admin}
                            timeText={formatMessageTime(message.created_at)}
                            showChecks={admin}
                            read={Boolean(message.read_at)}
                            onImageClick={setImagePreview}
                          />
                          {message.body ? <div className="whitespace-pre-wrap break-words" dir="auto">{message.body}</div> : null}
                          {!voiceMessage ? <button type="button" onClick={() => setReplyTo(message)} className="mt-1 text-[10px] font-bold text-slate-300/60">رد</button> : null}
                          {!voiceMessage ? (
                            <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium leading-4 text-slate-300/65" dir="ltr">
                              <span>{formatMessageTime(message.created_at)}</span>
                              {admin ? <CheckCheck className={`h-3.5 w-3.5 ${message.read_at ? "text-sky-300" : "text-slate-300/70"}`} /> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm font-bold text-slate-300">
                    لا توجد رسائل في هذه المحادثة.
                  </div>
                )}
                {typingEmployee ? <div className="w-fit rounded-2xl bg-[#202c33] px-3 py-1.5 text-[12px] font-bold text-emerald-200">{typingEmployee} يكتب الآن...</div> : null}
                {showJump ? (
                  <button type="button" onClick={scrollToBottom} className="sticky bottom-3 z-10 ms-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#202c33] text-white shadow-lg">
                    <ArrowDownCircle className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
              <form onSubmit={sendMessage} className="shrink-0 border-t border-white/10 bg-[#1f2c33] px-2.5 pb-2.5 pt-2.5">
                {replyTo ? (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-bold text-white">
                    <div className="min-w-0">
                      <div className="text-emerald-200">{replyTo.sender_type === "admin" ? "الإدارة" : selectedThread?.employee_name || "الموظف"}</div>
                      <div className="truncate opacity-80">{replyPreview(replyTo)}</div>
                    </div>
                    <button type="button" onClick={() => setReplyTo(null)} className="shrink-0 text-red-200"><X className="h-4 w-4" /></button>
                  </div>
                ) : null}
                {recordingState.active ? (
                  <div className="mb-2 flex items-center justify-between rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-black text-red-100">
                    <span dir="ltr">{Math.floor(recordingState.seconds / 60)}:{String(recordingState.seconds % 60).padStart(2, "0")}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={cancelVoiceRecording}>إلغاء</button>
                      <button type="button" onClick={sendVoiceRecording} className="text-emerald-200">إرسال</button>
                    </div>
                  </div>
                ) : null}
                {attachment ? (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                    <span className="min-w-0 truncate" dir="auto">{attachment.name}</span>
                    <button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="inline-flex items-center gap-1 font-black text-red-200">
                      <X className="h-3 w-3" />
                      حذف
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.webm,.m4a,.mp4,.mp3,.wav,image/jpeg,image/png,image/webp,audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={chooseAttachment}
                  />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100" aria-label="إرفاق ملف">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  {recordingState.supported ? (
                    <button type="button" onClick={startVoiceRecording} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100" aria-label="تسجيل صوتي">
                      <Mic className="h-4 w-4" />
                    </button>
                  ) : null}
                  <textarea
                    value={body}
                    onChange={(event) => { setBody(event.target.value); emitTyping(); }}
                    placeholder="اكتب رد الإدارة..."
                    className="min-h-[42px] flex-1 resize-none rounded-[1.4rem] border border-white/10 bg-white/10 px-4 py-[9px] !text-[16px] font-bold leading-[22px] text-white outline-none [transform:none] [zoom:1] placeholder:text-slate-400 focus:border-emerald-400"
                    dir="auto"
                  />
                  <button type="submit" disabled={sending || (!body.trim() && !attachment)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
      {imagePreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <button type="button" onClick={() => setImagePreview("")} className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white">
            <X className="h-5 w-5" />
          </button>
          <img src={imagePreview} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
    </section>
  );
}

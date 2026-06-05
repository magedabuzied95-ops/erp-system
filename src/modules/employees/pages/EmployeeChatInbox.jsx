import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownCircle, CheckCheck, FileText, Loader2, MessageCircle, Mic, Paperclip, RefreshCw, Send, UserRound, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { socket } from "../../../socket";
import { getAttendanceEmployees } from "../../attendance/attendanceApi";
import ChatImageAttachment from "../components/ChatImageAttachment";
import WhatsAppRecordingBar from "../components/WhatsAppRecordingBar";
import WhatsAppVoiceMessage from "../components/WhatsAppVoiceMessage";
import { logResolvedChatImageUrl, messageAttachmentDuration, normalizeChatAttachmentUrl } from "../lib/chatAttachments";

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

const safeArray = (value) => (Array.isArray(value) ? value : []);
const employeeRecordId = (item = {}) => String(item?.id || item?.employee_id || item?.employeeId || "");
const threadEmployeeId = (item = {}) => employeeRecordId(item);
const threadSortValue = (item = {}) => new Date(item.last_message_created_at || item.last_message_at || item.updated_at || item.created_at || 0).getTime() || 0;
const shallowRecordEqual = (left, right) => {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));
};
const shallowRecordArrayEqual = (left = [], right = []) => (
  left.length === right.length && left.every((item, index) => shallowRecordEqual(item, right[index]))
);
const sortThreads = (rows = []) => [...rows].sort((left, right) => threadSortValue(right) - threadSortValue(left));

function AttachmentView({ message, outgoing = false, timeText = "", showChecks = false, read = false, onImageClick }) {
  if (!message?.attachment_url) return null;
  const href = normalizeChatAttachmentUrl(message.attachment_url);
  const isImage = message.attachment_type === "image" || String(message.attachment_mime || "").startsWith("image/");
  const isAudio = message.attachment_type === "audio" || String(message.attachment_mime || "").startsWith("audio/");
  const name = message.attachment_name || (isImage ? "صورة" : "ملف");
  if (isImage) {
    logResolvedChatImageUrl("[chat-image-admin-src]", message, message.attachment_url, href);
    return (
      <ChatImageAttachment
        src={href}
        alt={name}
        onClick={onImageClick}
        originalUrl={message.attachment_url}
        messageId={message.id}
      />
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
        duration={messageAttachmentDuration(message)}
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

export default function EmployeeChatInbox({ selectedEmployee = null, selectedEmployeeId: initialSelectedEmployeeId = "", onSelectedEmployeeChange = null }) {
  const [employees, setEmployees] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(String(initialSelectedEmployeeId || employeeRecordId(selectedEmployee) || ""));
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [attachmentDuration, setAttachmentDuration] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [typingEmployee, setTypingEmployee] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, paused: false, seconds: 0, supported: false });
  const [recordingStream, setRecordingStream] = useState(null);
  const [error, setError] = useState("");
  const realtime = useRealtimeConnection();
  const fileInputRef = useRef(null);
  const messagesRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingStopRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const lastNotifiedSelectedEmployeeIdRef = useRef(employeeRecordId(selectedEmployee));

  const externalSelectedEmployeeId = useMemo(
    () => String(initialSelectedEmployeeId || employeeRecordId(selectedEmployee) || ""),
    [initialSelectedEmployeeId, selectedEmployee]
  );

  const threadMap = useMemo(() => {
    const entries = new Map();
    threads.forEach((item) => {
      const id = threadEmployeeId(item);
      if (id) entries.set(id, item);
    });
    return entries;
  }, [threads]);

  const selectedEmployeeRecord = useMemo(() => {
    const resolvedId = String(selectedEmployeeId || "");
    if (resolvedId) {
      const employeeMatch = employees.find((item) => employeeRecordId(item) === resolvedId);
      if (employeeMatch) return employeeMatch;
      if (employeeRecordId(selectedEmployee) === resolvedId) return selectedEmployee;
      const threadMatch = threadMap.get(resolvedId);
      if (threadMatch) {
        return {
          id: threadMatch.employee_id,
          employee_id: threadMatch.employee_id,
          full_name: threadMatch.employee_name,
          employee_code: threadMatch.employee_code,
          branch_name: threadMatch.branch_name,
        };
      }
    }
    return selectedEmployee || null;
  }, [employees, selectedEmployee, selectedEmployeeId, threadMap]);

  const selectedThread = useMemo(() => {
    const resolvedId = String(selectedEmployeeId || "");
    if (!resolvedId) return null;
    return threadMap.get(resolvedId) || (thread && threadEmployeeId(thread) === resolvedId ? thread : null);
  }, [selectedEmployeeId, thread, threadMap]);

  const activeThreadId = selectedThread?.id || null;
  const firstUnreadIndex = useMemo(
    () => messages.findIndex((message) => message.sender_type === "employee" && !message.read_at),
    [messages]
  );

  const sidebarRows = useMemo(() => {
    const employeeIds = new Set();
    const employeeRows = employees.map((employee) => {
      const id = employeeRecordId(employee);
      employeeIds.add(id);
      return { employee, thread: threadMap.get(id) || null };
    });
    const threadOnlyRows = threads
      .filter((item) => !employeeIds.has(threadEmployeeId(item)))
      .map((item) => ({
        employee: {
          id: item.employee_id,
          employee_id: item.employee_id,
          full_name: item.employee_name,
          employee_code: item.employee_code,
          branch_name: item.branch_name,
        },
        thread: item,
      }));
    return [...employeeRows, ...threadOnlyRows].sort((left, right) => {
      if (left.thread && right.thread) return threadSortValue(right.thread) - threadSortValue(left.thread);
      if (left.thread) return -1;
      if (right.thread) return 1;
      return String(left.employee?.full_name || "").localeCompare(String(right.employee?.full_name || ""), "ar");
    });
  }, [employees, threadMap, threads]);

  const loadEmployees = useCallback(async () => {
    try {
      setError("");
      const response = await getAttendanceEmployees({ search: "" });
      const nextEmployees = safeArray(response);
      setEmployees((current) => (shallowRecordArrayEqual(current, nextEmployees) ? current : nextEmployees));
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تحميل الموظفين");
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      setError("");
      const response = await api.get("/employees/chat/threads");
      const nextThreads = safeArray(response.threads);
      setThreads((current) => (shallowRecordArrayEqual(current, nextThreads) ? current : nextThreads));
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تحميل محادثات الموظفين");
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const loadThread = useCallback(async (threadId) => {
    if (!threadId) return;
    try {
      setLoadingThread(true);
      setError("");
      const response = await api.get(`/employees/chat/threads/${encodeURIComponent(threadId)}`);
      const nextThread = response.thread || null;
      const nextMessages = safeArray(response.messages);
      setThread((current) => (shallowRecordEqual(current, nextThread) ? current : nextThread));
      setMessages((current) => (shallowRecordArrayEqual(current, nextMessages) ? current : nextMessages));
      setThreads((current) => {
        let changed = false;
        const nextRows = current.map((item) => {
          if (String(item.id) !== String(threadId)) return item;
          const nextItem = { ...item, ...(nextThread || {}), unread_count: 0 };
          if (!shallowRecordEqual(item, nextItem)) changed = true;
          return shallowRecordEqual(item, nextItem) ? item : nextItem;
        });
        return changed ? nextRows : current;
      });
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر فتح المحادثة");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    const supported = typeof window !== "undefined" && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
    setRecordingState((current) => (current.supported === supported ? current : { ...current, supported }));
  }, []);

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stream?.getTracks?.().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    void Promise.all([loadEmployees(), loadThreads()]);
  }, [loadEmployees, loadThreads]);

  useEffect(() => {
    const nextSelectedEmployeeId = externalSelectedEmployeeId;
    if (!nextSelectedEmployeeId || nextSelectedEmployeeId === String(selectedEmployeeId || "")) return;
    setSelectedEmployeeId(nextSelectedEmployeeId);
  }, [externalSelectedEmployeeId, selectedEmployeeId]);

  const firstSidebarEmployeeId = useMemo(
    () => employeeRecordId(sidebarRows[0]?.employee),
    [sidebarRows]
  );

  useEffect(() => {
    if (selectedEmployeeId) return;
    const nextSelectedEmployeeId =
      externalSelectedEmployeeId ||
      firstSidebarEmployeeId ||
      "";
    if (nextSelectedEmployeeId) setSelectedEmployeeId(nextSelectedEmployeeId);
  }, [externalSelectedEmployeeId, firstSidebarEmployeeId, selectedEmployeeId]);

  useEffect(() => {
    if (typeof onSelectedEmployeeChange !== "function") return;
    const nextSelectedEmployeeId = employeeRecordId(selectedEmployeeRecord);
    if (nextSelectedEmployeeId === String(lastNotifiedSelectedEmployeeIdRef.current || "")) return;
    lastNotifiedSelectedEmployeeIdRef.current = nextSelectedEmployeeId;
    onSelectedEmployeeChange(selectedEmployeeRecord || null);
  }, [onSelectedEmployeeChange, selectedEmployeeRecord]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setThread((current) => (current === null ? current : null));
      setMessages((current) => (current.length ? [] : current));
      setLoadingThread((current) => (current ? false : current));
      return undefined;
    }
    if (!activeThreadId) {
      setThread((current) => (current === null ? current : null));
      setMessages((current) => (current.length ? [] : current));
      setLoadingThread((current) => (current ? false : current));
      return undefined;
    }
    void loadThread(activeThreadId);
    if (realtime.connected) return undefined;
    const timer = window.setInterval(() => {
      void loadThread(activeThreadId);
      void loadThreads();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, loadThread, loadThreads, realtime.connected, selectedEmployeeId]);

  useEffect(() => {
    const upsertThread = (nextThread) => {
      if (!nextThread?.id) return;
      setThreads((current) => {
        const exists = current.some((item) => String(item.id) === String(nextThread.id));
        const rows = exists
          ? current.map((item) => (String(item.id) === String(nextThread.id) ? { ...item, ...nextThread } : item))
          : [nextThread, ...current];
        const sortedRows = sortThreads(rows);
        return shallowRecordArrayEqual(current, sortedRows) ? current : sortedRows;
      });
    };

    const onMessage = (payload = {}) => {
      const nextThread = payload.thread;
      const message = payload.message;
      upsertThread(nextThread);
      const nextEmployeeId = String(threadEmployeeId(nextThread || message) || "");
      if (nextEmployeeId && nextEmployeeId === String(selectedEmployeeId || "")) {
        if (nextThread) setThread((current) => (shallowRecordEqual(current, nextThread) ? current : nextThread));
        setMessages((current) => {
          if (!message?.id || current.some((item) => String(item.id) === String(message.id))) return current;
          return [...current, message];
        });
        if (nextThread?.id && message?.sender_type === "employee") void loadThread(nextThread.id);
      }
    };

    const onThreadUpdated = (payload = {}) => upsertThread(payload.thread);

    const onRead = (payload = {}) => {
      if (!payload.thread_id) return;
      setThreads((current) => {
        let changed = false;
        const nextRows = current.map((item) => {
          if (String(item.id) !== String(payload.thread_id) || Number(item.unread_count || 0) === 0) return item;
          changed = true;
          return { ...item, unread_count: 0 };
        });
        return changed ? nextRows : current;
      });
      if (String(payload.thread_id) === String(activeThreadId || "")) {
        setMessages((current) => {
          const readAt = payload.at || new Date().toISOString();
          let changed = false;
          const nextMessages = current.map((message) => {
            if (message.sender_type !== payload.read_sender_type || message.read_at) return message;
            changed = true;
            return { ...message, read_at: readAt };
          });
          return changed ? nextMessages : current;
        });
      }
    };

    const onTyping = (payload = {}) => {
      if (payload.sender_type !== "employee") return;
      if (payload.thread_id && String(payload.thread_id) !== String(activeThreadId || "")) return;
      setTypingEmployee(payload.employee_name || selectedThread?.employee_name || selectedEmployeeRecord?.full_name || "الموظف");
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => setTypingEmployee(""), 3000);
    };

    const onStopTyping = (payload = {}) => {
      if (payload.sender_type !== "employee") return;
      if (payload.thread_id && String(payload.thread_id) !== String(activeThreadId || "")) return;
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
  }, [activeThreadId, loadThread, selectedEmployeeId, selectedEmployeeRecord?.full_name, selectedThread?.employee_name]);

  useEffect(() => {
    if (!selectedEmployeeId) return undefined;
    window.setTimeout(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, 50);
    return undefined;
  }, [messages.length, selectedEmployeeId]);

  const chooseEmployee = (employeeId) => {
    const nextEmployeeId = String(employeeId || "");
    setSelectedEmployeeId((current) => (String(current || "") === nextEmployeeId ? current : nextEmployeeId));
    setReplyTo(null);
    setTypingEmployee("");
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if ((!text && !attachment) || !activeThreadId) return;
    try {
      setSending(true);
      setError("");
      const formData = new FormData();
      if (text) formData.append("body", text);
      if (attachment) formData.append("attachment", attachment);
      if (attachment && attachmentDuration > 0) formData.append("attachment_duration_seconds", String(attachmentDuration));
      if (replyTo?.id) formData.append("reply_to_message_id", replyTo.id);
      await api.post(`/employees/chat/threads/${encodeURIComponent(activeThreadId)}/messages`, formData);
      setBody("");
      setAttachment(null);
      setAttachmentDuration(0);
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadThread(activeThreadId);
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
      setAttachmentDuration(0);
      return;
    }
    if (!allowedAttachment(file) || file.size > 10 * 1024 * 1024) {
      setError("نوع الملف غير مدعوم أو أكبر من 10MB");
      event.target.value = "";
      setAttachment(null);
      setAttachmentDuration(0);
      return;
    }
    setError("");
    setAttachment(file);
    setAttachmentDuration(0);
  };

  const emitTyping = () => {
    const employeeId = employeeRecordId(selectedEmployeeRecord || selectedThread || {});
    if (!employeeId || !activeThreadId || !socket?.connected) return;
    const payload = { thread_id: activeThreadId, employee_id: employeeId };
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
    if (!recordingState.supported || recordingState.active || !activeThreadId) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recordingSecondsRef.current = 0;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) recordingChunksRef.current.push(event.data);
    };
    mediaRecorderRef.current = recorder;
    setAttachment(null);
    setAttachmentDuration(0);
    setRecordingStream(stream);
    if (fileInputRef.current) fileInputRef.current.value = "";
    recorder.start();
    setRecordingState((current) => ({ ...current, active: true, paused: false, seconds: 0 }));
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingState((current) => {
        if (!current.active || current.paused) return current;
        const seconds = current.seconds + 1;
        recordingSecondsRef.current = seconds;
        return { ...current, seconds };
      });
    }, 1000);
  };

  const stopVoiceRecording = ({ capture = false } = {}) => new Promise((resolve) => {
    const recorder = mediaRecorderRef.current;
    const durationSeconds = Math.max(1, recordingSecondsRef.current || recordingState.seconds || 0);
    const mimeType = recorder?.mimeType || "audio/webm";
    const finish = () => {
      const blob = capture ? new Blob(recordingChunksRef.current, { type: mimeType }) : null;
      recorder?.stream?.getTracks?.().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      recordingChunksRef.current = [];
      recordingSecondsRef.current = 0;
      setRecordingStream(null);
      setRecordingState((current) => ({ ...current, active: false, paused: false, seconds: 0 }));
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      resolve(blob?.size ? { blob, durationSeconds, mimeType } : null);
    };

    if (!recorder) {
      finish();
      return;
    }

    recorder.onstop = finish;
    if (recorder.state === "inactive") {
      finish();
      return;
    }
    recorder.stop();
  });

  const cancelVoiceRecording = () => {
    void stopVoiceRecording({ capture: false });
  };

  const toggleVoiceRecordingPause = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !recordingState.active) return;
    if (recorder.state === "recording" && typeof recorder.pause === "function") {
      recorder.pause();
      setRecordingState((current) => ({ ...current, paused: true }));
      return;
    }
    if (recorder.state === "paused" && typeof recorder.resume === "function") {
      recorder.resume();
      setRecordingState((current) => ({ ...current, paused: false }));
    }
  };

  const sendVoiceRecording = async () => {
    if (sending || !activeThreadId) return;
    setSending(true);
    setError("");
    try {
      const recording = await stopVoiceRecording({ capture: true });
      if (!recording?.blob?.size) return;
      const formData = new FormData();
      formData.append("attachment", new File([recording.blob], `voice-${Date.now()}.webm`, { type: recording.mimeType || recording.blob.type || "audio/webm" }));
      formData.append("attachment_duration_seconds", String(recording.durationSeconds));
      if (replyTo?.id) formData.append("reply_to_message_id", replyTo.id);
      await api.post(`/employees/chat/threads/${encodeURIComponent(activeThreadId)}/messages`, formData);
      setBody("");
      setAttachment(null);
      setAttachmentDuration(0);
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadThread(activeThreadId);
      await loadThreads();
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر إرسال الرد");
    } finally {
      setSending(false);
    }
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
          <button type="button" onClick={() => { void Promise.all([loadEmployees(), loadThreads()]); }} className="theme-button-soft min-h-10 px-3 text-sm">
            <RefreshCw className={`h-4 w-4 ${loadingEmployees || loadingThreads ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">{error}</div> : null}
      </div>

      <div className="grid min-h-0 flex-1 md:min-h-[34rem] md:grid-cols-[22rem_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--border)] bg-[var(--card)] md:border-b-0 md:border-l">
          {loadingEmployees || loadingThreads ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل...
            </div>
          ) : sidebarRows.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:max-h-[34rem]">
              {sidebarRows.map(({ employee, thread: employeeThread }) => {
                const rowEmployeeId = employeeRecordId(employee);
                return (
                  <button
                    key={`${rowEmployeeId || "employee"}:${employeeThread?.id || "no-thread"}`}
                    type="button"
                    onClick={() => chooseEmployee(rowEmployeeId)}
                    className={[
                      "mb-2 w-full rounded-xl border p-3 text-right transition",
                      String(selectedEmployeeId || "") === rowEmployeeId
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
                          <div className="truncate text-sm font-black text-[var(--text)]" dir="auto">{employee.full_name || employee.employee_name || "موظف"}</div>
                          {Number(employeeThread?.unread_count || 0) > 0 ? (
                            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white" dir="ltr">{employeeThread.unread_count}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{employee.branch_name || employeeThread?.branch_name || "بدون فرع"}</div>
                        <div className="mt-2 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{employeeThread ? messagePreview(employeeThread) : "لا توجد رسائل بعد"}</div>
                        <div className="mt-2 text-[11px] font-black text-[var(--muted)]" dir="ltr">{employeeThread ? formatChatTime(employeeThread.last_message_created_at || employeeThread.last_message_at || employeeThread.updated_at) : "-"}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-sm font-bold text-[var(--muted)]">
              <MessageCircle className="mx-auto h-8 w-8" />
              <div className="mt-2">لا يوجد موظفون أو محادثات حتى الآن.</div>
            </div>
          )}
        </aside>

        <div className="flex min-h-0 flex-col bg-[#0b141a] md:min-h-[34rem]">
          {selectedEmployeeRecord ? (
            <>
              <div className="shrink-0 border-b border-white/10 bg-[#1f2c33] px-4 py-2 text-white">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-white/10">
                    <UserRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-black leading-5" dir="auto">{selectedEmployeeRecord.full_name || selectedThread?.employee_name || "موظف"}</div>
                    <div className="hidden">{selectedEmployeeRecord.employee_code || selectedThread?.employee_code || "-"} · {selectedEmployeeRecord.branch_name || selectedThread?.branch_name || "بدون فرع"}</div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-emerald-200">{activeThreadId ? "المحادثة جاهزة" : "لا توجد رسائل حتى الآن"}</div>
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
                          <div className={`relative break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm ${voiceMessage ? "w-[min(78vw,18.5rem)] px-2 py-1" : "w-fit max-w-[72%] px-2 py-1"} ${admin ? "rounded-bl-[0.25rem] bg-[#005c4b] text-white after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[#005c4b] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]" : "rounded-br-[0.25rem] bg-[#202c33] text-slate-50 after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[#202c33] after:[clip-path:polygon(0_0,100%_100%,0_100%)]"}`}>
                            {message.reply_to_message_id ? (
                              <button type="button" onClick={() => document.getElementById(`admin-chat-message-${message.reply_to_message_id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })} className="mb-1 w-full rounded-xl border-r-2 border-emerald-300 bg-black/10 px-2 py-1 text-start text-[11px] leading-4 text-slate-200/80">
                                <div className="font-black">{message.reply_sender_type === "admin" ? "الإدارة" : selectedEmployeeRecord.full_name || "الموظف"}</div>
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
                {recordingState.active ? (
                  <WhatsAppRecordingBar
                    stream={recordingStream}
                    seconds={recordingState.seconds}
                    paused={recordingState.paused}
                    sending={sending}
                    onDelete={cancelVoiceRecording}
                    onPauseResume={toggleVoiceRecordingPause}
                    onSend={sendVoiceRecording}
                  />
                ) : (
                  <>
                    {replyTo ? (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-bold text-white">
                        <div className="min-w-0">
                          <div className="text-emerald-200">{replyTo.sender_type === "admin" ? "الإدارة" : selectedEmployeeRecord.full_name || "الموظف"}</div>
                          <div className="truncate opacity-80">{replyPreview(replyTo)}</div>
                        </div>
                        <button type="button" onClick={() => setReplyTo(null)} className="shrink-0 text-red-200"><X className="h-4 w-4" /></button>
                      </div>
                    ) : null}
                    {attachment ? (
                      <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white">
                        <span className="min-w-0 truncate" dir="auto">{attachment.name}</span>
                        <button type="button" onClick={() => { setAttachment(null); setAttachmentDuration(0); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="inline-flex items-center gap-1 font-black text-red-200">
                          <X className="h-3 w-3" />
                          حذف
                        </button>
                      </div>
                    ) : null}
                    {!activeThreadId ? (
                      <div className="mb-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold text-slate-200">
                        ستظهر المحادثة هنا بعد أن يرسل الموظف أول رسالة من بوابة الموظف.
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
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100 disabled:opacity-50" aria-label="إرفاق ملف" disabled={!activeThreadId}>
                        <Paperclip className="h-4 w-4" />
                      </button>
                      {recordingState.supported ? (
                        <button type="button" onClick={startVoiceRecording} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100 disabled:opacity-50" aria-label="تسجيل صوتي" disabled={!activeThreadId}>
                          <Mic className="h-4 w-4" />
                        </button>
                      ) : null}
                      <textarea
                        value={body}
                        onChange={(event) => { setBody(event.target.value); emitTyping(); }}
                        placeholder="اكتب رد الإدارة..."
                        className="min-h-[42px] flex-1 resize-none rounded-[1.4rem] border border-white/10 bg-white/10 px-4 py-[9px] !text-[16px] font-bold leading-[22px] text-white outline-none [transform:none] [zoom:1] placeholder:text-slate-400 focus:border-emerald-400 disabled:opacity-60"
                        dir="auto"
                        disabled={!activeThreadId}
                      />
                      <button type="submit" disabled={!activeThreadId || sending || (!body.trim() && !attachment)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 disabled:opacity-50">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-[var(--muted)]">
              اختر موظفًا من القائمة.
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

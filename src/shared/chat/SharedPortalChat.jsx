import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, MessageCircle, RefreshCw, UserRound, X } from "lucide-react";

import { dedupeChatMessages, dedupeChatThreads, mergeChatMessages, mergeChatThreads } from "../lib/chatState";
import PortalChatComposer from "./PortalChatComposer";
import PortalChatMessageList from "./PortalChatMessageList";
import { allowedPortalChatAttachment, portalChatMessagePreview } from "./portalChatUtils";

const safeArray = (value) => (Array.isArray(value) ? value : []);
const employeeRecordId = (item = {}) => String(item?.employee_id || item?.employeeId || item?.id || "");
const threadEmployeeId = (item = {}) => String(item?.employee_id || item?.employeeId || item?.employee?.id || item?.employee?.employee_id || "");
const threadSortValue = (item = {}) => new Date(item.last_message_created_at || item.last_message_at || item.updated_at || item.created_at || 0).getTime() || 0;
const threadHasMessages = (item = {}) =>
  Number(item?.message_count ?? item?.messages_count ?? 0) > 0 ||
  Boolean(item?.last_message_id || item?.last_message_created_at || item?.last_message_at || String(item?.last_message || item?.body || "").trim());

const formatChatDateTime = (value) => {
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

const normalizeThread = (item = {}) => ({
  ...item,
  employee_id: threadEmployeeId(item),
  unread_count: Number(item?.unread_count || 0),
});

const dedupeThreadsByEmployee = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const employeeId = threadEmployeeId(row);
    if (!employeeId) return;
    const nextRow = normalizeThread(row);
    const current = grouped.get(employeeId);
    if (!current) {
      grouped.set(employeeId, nextRow);
      return;
    }
    const currentScore = [threadHasMessages(current) ? 1 : 0, threadSortValue(current), Number(current.unread_count || 0)];
    const nextScore = [threadHasMessages(nextRow) ? 1 : 0, threadSortValue(nextRow), Number(nextRow.unread_count || 0)];
    const shouldReplace =
      nextScore[0] > currentScore[0] ||
      (nextScore[0] === currentScore[0] && nextScore[1] > currentScore[1]) ||
      (nextScore[0] === currentScore[0] && nextScore[1] === currentScore[1] && nextScore[2] > currentScore[2]);
    const unread_count = Number(current.unread_count || 0) + Number(nextRow.unread_count || 0);
    grouped.set(employeeId, shouldReplace ? { ...current, ...nextRow, unread_count } : { ...nextRow, ...current, unread_count });
  });
  return [...grouped.values()].sort((left, right) => threadSortValue(right) - threadSortValue(left));
};

export default function SharedPortalChat({
  apiAdapter,
  employees = [],
  selectedEmployee = null,
  selectedEmployeeId: initialSelectedEmployeeId = "",
  onSelectedEmployeeChange,
  onThreadChange,
  className = "",
  headerTitle = "محادثات الموظفين",
  headerKicker = "الموظفون / المحادثات",
  secureNotice = "هذه المحادثة خاصة بين الموظف والإدارة",
  managerPanel = null,
  pollMs = 12000,
  allowReply = true,
  useTextareaComposer = false,
  mobileFullScreen = false,
}) {
  const [threads, setThreads] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(String(initialSelectedEmployeeId || employeeRecordId(selectedEmployee) || ""));
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [thread, setThread] = useState(null);
  const [messagesByThread, setMessagesByThread] = useState({});
  const [draftsByThread, setDraftsByThread] = useState({});
  const [body, setBodyState] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [attachmentDuration, setAttachmentDuration] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [typingLabel, setTypingLabel] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [recordingState, setRecordingState] = useState({ active: false, paused: false, seconds: 0, supported: false });
  const [recordingStream, setRecordingStream] = useState(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(null);
  const messagesByThreadRef = useRef({});
  const draftsByThreadRef = useRef({});
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const selectedThreadIdRef = useRef("");
  const selectedEmployeeIdRef = useRef("");
  const threadRef = useRef(null);
  const typingStopRef = useRef(null);
  const chatSwipeRef = useRef({ id: null, startX: 0, startY: 0, active: false });

  const normalizedThreads = useMemo(() => dedupeThreadsByEmployee(dedupeChatThreads(threads)), [threads]);
  const threadMap = useMemo(() => {
    const entries = new Map();
    normalizedThreads.forEach((item) => {
      const id = threadEmployeeId(item);
      if (id) entries.set(id, item);
    });
    return entries;
  }, [normalizedThreads]);
  const threadById = useMemo(() => {
    const entries = new Map();
    normalizedThreads.forEach((item) => {
      if (item?.id) entries.set(String(item.id), item);
    });
    return entries;
  }, [normalizedThreads]);

  const selectedEmployeeRecord = useMemo(() => {
    const resolvedId = String(selectedEmployeeId || "");
    if (!resolvedId) return selectedEmployee || null;
    const employeeMatch = employees.find((item) => employeeRecordId(item) === resolvedId || String(item.employee_id || "") === resolvedId);
    if (employeeMatch) return employeeMatch;
    const threadMatch = threadMap.get(resolvedId);
    if (threadMatch) {
      return {
        id: threadMatch.employee_id,
        employee_id: threadMatch.employee_id,
        full_name: threadMatch.employee_name,
        employee_name: threadMatch.employee_name,
        employee_code: threadMatch.employee_code,
        branch_name: threadMatch.branch_name,
      };
    }
    return selectedEmployee || null;
  }, [employees, selectedEmployee, selectedEmployeeId, threadMap]);

  const selectedThread = useMemo(() => {
    if (thread?.id && String(thread.id) === String(selectedThreadId || thread?.id)) return thread;
    if (selectedThreadId && threadById.has(String(selectedThreadId))) return threadById.get(String(selectedThreadId));
    if (!selectedEmployeeId) return null;
    return threadMap.get(String(selectedEmployeeId)) || null;
  }, [selectedEmployeeId, selectedThreadId, thread, threadById, threadMap]);

  const activeThreadId = selectedThread?.id || "";
  const messages = useMemo(
    () => (activeThreadId ? safeArray(messagesByThread[String(activeThreadId)]) : []),
    [activeThreadId, messagesByThread]
  );
  const firstUnreadIndex = useMemo(() => messages.findIndex((message) => message.sender_type === "employee" && !message.read_at), [messages]);

  const sidebarRows = useMemo(() => {
    const employeeIds = new Set();
    const employeeRows = safeArray(employees).map((employee) => {
      const id = employeeRecordId(employee) || String(employee.employee_id || "");
      employeeIds.add(id);
      return { employee, thread: threadMap.get(id) || null };
    });
    const threadOnlyRows = normalizedThreads
      .filter((item) => !employeeIds.has(threadEmployeeId(item)))
      .map((item) => ({
        employee: {
          id: item.employee_id,
          employee_id: item.employee_id,
          full_name: item.employee_name,
          employee_name: item.employee_name,
          employee_code: item.employee_code,
          branch_name: item.branch_name,
        },
        thread: item,
      }));
    return [...employeeRows, ...threadOnlyRows].sort((left, right) => {
      if (left.thread && right.thread) return threadSortValue(right.thread) - threadSortValue(left.thread);
      if (left.thread) return -1;
      if (right.thread) return 1;
      return String(left.employee?.full_name || left.employee?.employee_name || "").localeCompare(String(right.employee?.full_name || right.employee?.employee_name || ""), "ar");
    });
  }, [employees, normalizedThreads, threadMap]);

  useEffect(() => {
    selectedThreadIdRef.current = activeThreadId || selectedThreadId || "";
    threadRef.current = selectedThread;
    selectedEmployeeIdRef.current = selectedEmployeeId;
  }, [activeThreadId, selectedEmployeeId, selectedThread, selectedThreadId]);

  useEffect(() => {
    messagesByThreadRef.current = messagesByThread;
  }, [messagesByThread]);

  useEffect(() => {
    draftsByThreadRef.current = draftsByThread;
  }, [draftsByThread]);

  useEffect(() => {
    const supported = typeof window !== "undefined" && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
    setRecordingState((current) => (current.supported === supported ? current : { ...current, supported }));
  }, []);

  useEffect(() => {
    if (!mobileFullScreen || !mobileConversationOpen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileConversationOpen, mobileFullScreen]);

  const loadThreads = useCallback(async () => {
    if (!apiAdapter?.listThreads) return;
    setLoadingThreads(true);
    try {
      setError("");
      const response = await apiAdapter.listThreads();
      const nextThreads = dedupeChatThreads(safeArray(response?.threads));
      setThreads((current) => mergeChatThreads(current, nextThreads));
      return response;
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تحميل محادثات الموظفين");
      return null;
    } finally {
      setLoadingThreads(false);
    }
  }, [apiAdapter]);

  const loadThread = useCallback(async (threadId, { silent = false } = {}) => {
    const resolvedThreadId = String(threadId || "");
    if (!resolvedThreadId || !apiAdapter?.getThread) return null;
    if (!silent) setLoadingThread(true);
    try {
      setError("");
      const response = await apiAdapter.getThread(resolvedThreadId);
      const nextThread = response?.thread || null;
      const nextMessages = dedupeChatMessages(safeArray(response?.messages), nextThread);
      if (nextThread) {
        setThread(nextThread);
        setThreads((current) => mergeChatThreads(current, [{ ...nextThread, unread_count: 0 }]));
      }
      setMessagesByThread((current) => ({ ...current, [resolvedThreadId]: nextMessages }));
      await apiAdapter.markRead?.(resolvedThreadId);
      return response;
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر فتح المحادثة");
      return null;
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, [apiAdapter]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const externalId = String(initialSelectedEmployeeId || employeeRecordId(selectedEmployee) || "");
    if (externalId) setSelectedEmployeeId((current) => (String(current || "") === externalId ? current : externalId));
  }, [initialSelectedEmployeeId, selectedEmployee]);

  useEffect(() => {
    if (selectedEmployeeId) return;
    const firstEmployeeId = employeeRecordId(sidebarRows[0]?.employee) || String(sidebarRows[0]?.employee?.employee_id || "");
    if (firstEmployeeId) setSelectedEmployeeId(firstEmployeeId);
  }, [selectedEmployeeId, sidebarRows]);

  useEffect(() => {
    const nextThreadId = selectedEmployeeId ? String(threadMap.get(String(selectedEmployeeId))?.id || "") : "";
    setSelectedThreadId((current) => (String(current || "") === nextThreadId ? current : nextThreadId));
    if (!nextThreadId) {
      setThread(null);
      setBodyState(draftsByThreadRef.current[`employee:${selectedEmployeeId}`] || "");
      return;
    }
    setBodyState(draftsByThreadRef.current[nextThreadId] || "");
    if (messagesByThreadRef.current[nextThreadId]?.length) {
      setThread(threadMap.get(String(selectedEmployeeId)) || null);
    }
    void loadThread(nextThreadId, { silent: Boolean(messagesByThreadRef.current[nextThreadId]?.length) });
  }, [loadThread, selectedEmployeeId, threadMap]);

  useEffect(() => {
    onSelectedEmployeeChange?.(selectedEmployeeRecord);
  }, [onSelectedEmployeeChange, selectedEmployeeRecord]);

  useEffect(() => {
    onThreadChange?.({ thread: selectedThread, messages, employee: selectedEmployeeRecord });
  }, [messages, onThreadChange, selectedEmployeeRecord, selectedThread]);

  useEffect(() => {
    if (!pollMs) return undefined;
    const timer = window.setInterval(() => {
      void loadThreads();
      if (selectedThreadIdRef.current) void loadThread(selectedThreadIdRef.current, { silent: true });
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [loadThread, loadThreads, pollMs]);

  useEffect(() => {
    if (!apiAdapter?.subscribe) return undefined;

    const eventThreadId = (payload = {}) => String(payload?.thread?.id || payload?.message?.thread_id || payload?.thread_id || "");
    const refreshActiveThread = (payload = {}) => {
      const threadId = eventThreadId(payload);
      if (threadId && threadId === String(selectedThreadIdRef.current || "")) {
        void loadThread(threadId, { silent: true });
      }
    };

    return apiAdapter.subscribe({
      onMessage: (payload = {}) => {
        const nextThread = payload?.thread || null;
        const nextMessage = payload?.message || null;
        const threadId = eventThreadId(payload);
        if (nextThread) {
          setThreads((current) => mergeChatThreads(current, [nextThread]));
          if (threadId === String(selectedThreadIdRef.current || "")) setThread(nextThread);
        }
        if (threadId && nextMessage) {
          setMessagesByThread((current) => ({
            ...current,
            [threadId]: mergeChatMessages(current[threadId] || [], [nextMessage]),
          }));
          if (threadId === String(selectedThreadIdRef.current || "")) void apiAdapter.markRead?.(threadId);
        }
      },
      onThread: (payload = {}) => {
        const nextThread = payload?.thread || payload;
        if (nextThread?.id) setThreads((current) => mergeChatThreads(current, [nextThread]));
      },
      onRead: refreshActiveThread,
      onTyping: (payload = {}) => {
        const threadId = eventThreadId(payload);
        if (threadId && threadId === String(selectedThreadIdRef.current || "")) {
          setTypingLabel(payload?.sender_name || payload?.employee_name || "يكتب الآن...");
        }
      },
      onStopTyping: (payload = {}) => {
        const threadId = eventThreadId(payload);
        if (!threadId || threadId === String(selectedThreadIdRef.current || "")) setTypingLabel("");
      },
    });
  }, [apiAdapter, loadThread]);

  useEffect(() => {
    window.setTimeout(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, 50);
  }, [messages.length, selectedEmployeeId]);

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stream?.getTracks?.().forEach((track) => track.stop());
  }, []);

  const setBody = (nextBody) => {
    const value = typeof nextBody === "function" ? nextBody(body) : nextBody;
    setBodyState(value);
    const key = activeThreadId || `employee:${selectedEmployeeId || ""}`;
    if (key) setDraftsByThread((current) => ({ ...current, [key]: value }));
  };

  const chooseEmployee = (employeeId, threadId = "") => {
    const currentKey = activeThreadId || `employee:${selectedEmployeeId || ""}`;
    if (currentKey) setDraftsByThread((current) => ({ ...current, [currentKey]: body }));
    const nextEmployeeId = String(employeeId || "");
    const nextThreadId = String(threadId || threadMap.get(nextEmployeeId)?.id || "");
    setSelectedEmployeeId(nextEmployeeId);
    setSelectedThreadId(nextThreadId);
    setReplyTo(null);
    setAttachment(null);
    setAttachmentDuration(0);
    setTypingLabel("");
    if (mobileFullScreen) setMobileConversationOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const chooseAttachment = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setAttachment(null);
      setAttachmentDuration(0);
      return;
    }
    if (!allowedPortalChatAttachment(file) || file.size > 10 * 1024 * 1024) {
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

  const submitMessage = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if ((!text && !attachment) || !activeThreadId || !apiAdapter?.sendMessage) return;
    const formData = new FormData();
    if (text) formData.append("body", text);
    if (attachment) formData.append("attachment", attachment);
    if (attachment && attachmentDuration > 0) formData.append("attachment_duration_seconds", String(attachmentDuration));
    if (replyTo?.id) formData.append("reply_to_message_id", replyTo.id);
    try {
      setSending(true);
      setError("");
      setBody("");
      setAttachment(null);
      setAttachmentDuration(0);
      setReplyTo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const response = await apiAdapter.sendMessage(activeThreadId, formData);
      if (response?.thread) {
        setThread(response.thread);
        setThreads((current) => mergeChatThreads(current, [response.thread]));
      }
      if (response?.message) {
        setMessagesByThread((current) => ({
          ...current,
          [activeThreadId]: mergeChatMessages(current[activeThreadId] || [], [response.message], response?.thread || threadRef.current),
        }));
      }
      await loadThread(activeThreadId, { silent: true });
      await loadThreads();
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  const emitTyping = () => {
    apiAdapter?.emitTyping?.({ thread_id: activeThreadId, employee_id: selectedEmployeeId });
    if (typingStopRef.current) window.clearTimeout(typingStopRef.current);
    typingStopRef.current = window.setTimeout(() => {
      apiAdapter?.emitStopTyping?.({ thread_id: activeThreadId, employee_id: selectedEmployeeId });
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

  const scrollToMessage = (messageId) => {
    document.getElementById(`shared-portal-chat-message-${messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const beginSwipe = (event, message) => {
    const touch = event.touches?.[0];
    if (!touch || !message?.id) return;
    chatSwipeRef.current = { id: message.id, startX: touch.clientX, startY: touch.clientY, active: true };
  };

  const moveSwipe = (event, message) => {
    const touch = event.touches?.[0];
    const swipe = chatSwipeRef.current;
    if (!touch || !swipe.active || swipe.id !== message.id) return;
    const deltaX = touch.clientX - swipe.startX;
    const deltaY = Math.abs(touch.clientY - swipe.startY);
    if (Math.abs(deltaX) > 42 && deltaY < 24) {
      setReplyTo(message);
      chatSwipeRef.current = { id: null, startX: 0, startY: 0, active: false };
    }
  };

  const endSwipe = () => {
    chatSwipeRef.current = { id: null, startX: 0, startY: 0, active: false };
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
    if (recorder.state === "inactive") finish();
    else recorder.stop();
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
    if (sending || !activeThreadId || !apiAdapter?.sendMessage) return;
    setSending(true);
    setError("");
    try {
      const recording = await stopVoiceRecording({ capture: true });
      if (!recording?.blob?.size) return;
      const formData = new FormData();
      formData.append("attachment", new File([recording.blob], `voice-${Date.now()}.webm`, { type: recording.mimeType || recording.blob.type || "audio/webm" }));
      formData.append("attachment_duration_seconds", String(recording.durationSeconds));
      if (replyTo?.id) formData.append("reply_to_message_id", replyTo.id);
      const response = await apiAdapter.sendMessage(activeThreadId, formData);
      setBody("");
      setAttachment(null);
      setAttachmentDuration(0);
      setReplyTo(null);
      if (response?.message) {
        setMessagesByThread((current) => ({
          ...current,
          [activeThreadId]: mergeChatMessages(current[activeThreadId] || [], [response.message], response?.thread || threadRef.current),
        }));
      }
      await loadThread(activeThreadId, { silent: true });
      await loadThreads();
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  const currentPanel = typeof managerPanel === "function"
    ? managerPanel({ employee: selectedEmployeeRecord, thread: selectedThread, messages })
    : managerPanel;

  return (
    <section
      className={`theme-card flex min-w-0 flex-col overflow-hidden p-0 ${mobileFullScreen ? (mobileConversationOpen ? "fixed inset-0 z-[80] h-[100dvh] min-h-[100dvh] w-full max-w-none rounded-none border-0" : "h-auto min-h-0") : "h-[100dvh] min-h-[100dvh]"} md:static md:z-auto md:h-auto md:min-h-0 md:w-auto md:rounded-[var(--radius-card)] md:border ${className}`}
      dir="rtl"
      data-mobile-conversation-open={mobileConversationOpen ? "true" : "false"}
    >
      <div className={`shrink-0 border-b border-[var(--border)] p-4 ${mobileFullScreen && mobileConversationOpen ? "hidden md:block" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black text-[var(--muted)]">{headerKicker}</p>
            <h2 className="mt-1 text-2xl font-black text-[var(--text)]">{headerTitle}</h2>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">التحديث الاحتياطي يعمل كل {Math.round(pollMs / 1000)} ثانية</p>
          </div>
          <button type="button" onClick={() => { void loadThreads(); if (activeThreadId) void loadThread(activeThreadId); }} className="theme-button-soft min-h-10 px-3 text-sm">
            <RefreshCw className={`h-4 w-4 ${loadingThreads ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200" dir="auto">{error}</div> : null}
      </div>

      <div className={`grid min-h-0 flex-1 md:min-h-[34rem] ${currentPanel ? "xl:grid-cols-[22rem_1fr_20rem] md:grid-cols-[20rem_1fr]" : "md:grid-cols-[22rem_1fr]"}`}>
        <aside className={`${mobileFullScreen && mobileConversationOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col border-b border-[var(--border)] bg-[var(--card)] md:border-b-0 md:border-l`}>
          {loadingThreads && !sidebarRows.length ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل...
            </div>
          ) : sidebarRows.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:max-h-[34rem]">
              {sidebarRows.map(({ employee, thread: employeeThread }) => {
                const rowEmployeeId = employeeRecordId(employee) || String(employee.employee_id || "");
                const active = String(selectedEmployeeId || "") === rowEmployeeId;
                return (
                  <button
                    key={`${rowEmployeeId || "employee"}:${employeeThread?.id || "no-thread"}`}
                    type="button"
                    onClick={() => chooseEmployee(rowEmployeeId, employeeThread?.id || "")}
                    data-testid={`chat-thread-${employeeThread?.id || rowEmployeeId || "employee"}`}
                    className={[
                      "mb-2 w-full rounded-xl border p-3 text-right transition",
                      active ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]",
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
                        <div className="mt-2 truncate text-xs font-bold text-[var(--muted)]" dir="auto">{employeeThread ? portalChatMessagePreview(employeeThread, { image: "صورة", voice: "رسالة صوتية", file: "ملف" }) : "لا توجد رسائل بعد"}</div>
                        <div className="mt-2 text-[11px] font-black text-[var(--muted)]" dir="ltr">{employeeThread ? formatChatDateTime(employeeThread.last_message_created_at || employeeThread.last_message_at || employeeThread.updated_at) : "-"}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-sm font-bold text-[var(--muted)]">
              <MessageCircle className="mx-auto h-8 w-8" />
              <div className="mt-2">لا توجد محادثات حتى الآن.</div>
            </div>
          )}
        </aside>

        <div className={`${mobileFullScreen && !mobileConversationOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0b141a] md:min-h-[34rem]`}>
          {selectedEmployeeRecord ? (
            <>
              <div className="shrink-0 border-b border-white/10 bg-[#1f2c33] px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-white md:px-4 md:py-2">
                <div className="flex min-w-0 items-center gap-3">
                  {mobileFullScreen ? (
                    <button
                      type="button"
                      onClick={() => setMobileConversationOpen(false)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/10 md:hidden"
                      aria-label="الرجوع إلى محادثات الموظفين"
                    >
                      <ArrowRight className="h-6 w-6" />
                    </button>
                  ) : null}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-white/10">
                    <UserRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-black leading-5" dir="auto">{selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || selectedThread?.employee_name || "موظف"}</div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-emerald-200">{activeThreadId ? "المحادثة جاهزة" : "لا توجد رسائل حتى الآن"}</div>
                  </div>
                </div>
              </div>
              <div className="mx-auto mt-1.5 w-fit rounded-full bg-[#182229]/90 px-2.5 py-0.5 text-center text-[10px] font-bold leading-4 text-slate-300">
                {secureNotice}
              </div>
              <PortalChatMessageList
                messages={messages}
                loading={loadingThread}
                labels={{
                  today: "اليوم",
                  loading: "جاري فتح المحادثة...",
                  empty: "لا توجد رسائل في هذه المحادثة.",
                  unread: "رسائل غير مقروءة",
                  image: "صورة",
                  voice: "رسالة صوتية",
                  file: "ملف",
                  reply: "رد",
                }}
                outgoingSenderType="admin"
                outgoingLabel="الإدارة"
                incomingLabel={selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || "الموظف"}
                timeFormatter={formatMessageTime}
                messagesRef={messagesRef}
                onScroll={onMessagesScroll}
                showJump={showJump}
                onJumpToBottom={scrollToBottom}
                typingLabel={typingLabel}
                onImageClick={setImagePreview}
                onReply={allowReply ? setReplyTo : null}
                onBeginSwipe={beginSwipe}
                onMoveSwipe={moveSwipe}
                onEndSwipe={endSwipe}
                firstUnreadIndex={firstUnreadIndex}
                messageIdPrefix="shared-portal-chat-message"
              />
              <PortalChatComposer
                onSubmit={submitMessage}
                body={body}
                setBody={setBody}
                sending={sending}
                attachment={attachment}
                setAttachment={setAttachment}
                setAttachmentDuration={setAttachmentDuration}
                replyTo={replyTo}
                setReplyTo={setReplyTo}
                labels={{
                  outgoingSenderType: "admin",
                  you: "الإدارة",
                  management: selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || "الموظف",
                  placeholder: "اكتب رد الإدارة...",
                  attachFile: "إرفاق ملف",
                  removeAttachment: "حذف",
                  recordVoice: "تسجيل صوتي",
                  disabledNotice: "ستظهر المحادثة هنا بعد أن يرسل الموظف أول رسالة من بوابة الموظف.",
                }}
                fileInputRef={fileInputRef}
                inputRef={inputRef}
                chooseAttachment={chooseAttachment}
                emitTyping={emitTyping}
                recordingState={recordingState}
                recordingStream={recordingStream}
                onCancelRecording={cancelVoiceRecording}
                onToggleRecordingPause={toggleVoiceRecordingPause}
                onSendRecording={sendVoiceRecording}
                onStartRecording={startVoiceRecording}
                onScrollToReply={scrollToMessage}
                disabled={!activeThreadId}
                useTextarea={useTextareaComposer}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-[var(--muted)]">
              اختر موظفًا من القائمة.
            </div>
          )}
        </div>

        {currentPanel ? (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-3 xl:block">
            {currentPanel}
          </aside>
        ) : null}
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, ArrowRight, Bell, BellOff, ChevronDown, ChevronUp, Loader2, MessageCircle, PhoneCall, Pin, PinOff, RefreshCw, Search, Star, UserRound, X } from "lucide-react";
import { createPortal } from "react-dom";

import i18n from "../../i18n/i18n";
import { dedupeChatMessages, dedupeChatThreads, mergeChatMessages, mergeChatThreads } from "../lib/chatState";
import { resolveEmployeeProfileImageUrl } from "../lib/imageUrls";
import PortalChatComposer from "./PortalChatComposer";
import PortalChatMessageList from "./PortalChatMessageList";
import PortalChatContactInfo from "./PortalChatContactInfo";
import { allowedPortalChatAttachment, portalChatMessagePreview } from "./portalChatUtils";
import ChatRingOverlay, { ChatRingStatus } from "./ChatRingOverlay";
import ChatThreadRow from "./ChatThreadRow";
import ChatMediaViewer from "./ChatMediaViewer";
import chatCache from "./chatCache";
import useChatRing from "./useChatRing";

const safeArray = (value) => (Array.isArray(value) ? value : []);
const employeeRecordId = (item = {}) => String(item?.employee_id || item?.employeeId || item?.id || "");
const threadEmployeeId = (item = {}) => String(item?.employee_id || item?.employeeId || item?.employee?.id || item?.employee?.employee_id || "");
const threadSortValue = (item = {}) => new Date(item.last_message_created_at || item.last_message_at || item.updated_at || item.created_at || 0).getTime() || 0;
const threadHasMessages = (item = {}) =>
  Number(item?.message_count ?? item?.messages_count ?? 0) > 0 ||
  Boolean(item?.last_message_id || item?.last_message_created_at || item?.last_message_at || String(item?.last_message || item?.body || "").trim());

/*
 * Read at CALL time, never at module scope: these formatters are module-level, so
 * capturing the locale here would freeze chat timestamps to whichever language was
 * active when the module first loaded. `-u-nu-latn` keeps Latin digits in Arabic,
 * which is what the rest of the portal does.
 */
const chatDateLocale = () =>
  String(i18n.language || "").toLowerCase().startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";

const formatChatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(chatDateLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatListTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const days = (now - date) / 86400000;
  if (sameDay) return new Intl.DateTimeFormat(chatDateLocale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days < 7) return new Intl.DateTimeFormat(chatDateLocale(), { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat(chatDateLocale(), { day: "numeric", month: "short" }).format(date);
};

const formatLastSeen = (value, t) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  const time = new Intl.DateTimeFormat(chatDateLocale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  if (date.toDateString() === now.toDateString()) return t("employeePortal.chat.lastSeenToday", { time });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("employeePortal.chat.lastSeenYesterday", { time });
  return t("employeePortal.chat.lastSeenOn", { date: new Intl.DateTimeFormat(chatDateLocale(), { day: "numeric", month: "short" }).format(date), time });
};

const formatMessageTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(chatDateLocale(), {
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
  headerTitle,
  headerKicker,
  secureNotice,
  managerPanel = null,
  pollMs = 12000,
  allowReply = true,
  cacheScope = "", // non-empty enables the IndexedDB warm-open cache, namespaced by this key
  // eslint-disable-next-line no-unused-vars -- retained for callers; the composer is always an auto-growing textarea now
  useTextareaComposer = false,
  mobileFullScreen = false,
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  /*
   * Resolved here rather than as a signature default: `t` is not in scope in the
   * parameter list, and a literal default would render Arabic chrome inside an
   * English shell for any caller that does not pass its own copy.
   */
  const resolvedHeaderTitle = headerTitle ?? t("employeePortal.chat.admin.headerTitle");
  const resolvedHeaderKicker = headerKicker ?? t("employeePortal.chat.admin.headerKicker");
  const resolvedSecureNotice = secureNotice ?? t("employeePortal.chat.admin.secureNotice");
  const employeeFallback = t("employeePortal.chat.admin.employeeFallback");
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
  const [editingMessage, setEditingMessage] = useState(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState("all"); // all | unread | cashier | archived
  const [rowMenu, setRowMenu] = useState(null); // { thread, employee, left, top }
  const [starredOpen, setStarredOpen] = useState(false);
  const [starredRows, setStarredRows] = useState(null);
  const [pendingJump, setPendingJump] = useState(null); // message id to scroll to once its thread is loaded
  const [typingThreadIds, setTypingThreadIds] = useState({});
  const [messageSearch, setMessageSearch] = useState("");
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardMessage, setForwardMessage] = useState(null);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [imagePreview, setImagePreview] = useState("");
  const [typingLabel, setTypingLabel] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  // P1: cursor pagination + "new messages below" counter for the jump button.
  const [hasOlderByThread, setHasOlderByThread] = useState({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseenBelow, setUnseenBelow] = useState(0);
  const liveEventAtRef = useRef(0);
  const pendingSendsRef = useRef(new Map());
  /*
   * The banner holds either OUR translation key or the raw `text` of a server
   * message, which is not ours to translate. Keeping our half unresolved is what
   * lets a language switch relabel a banner that is already on screen.
   */
  const [error, setError] = useState({ key: "", text: "" });
  const clearError = useCallback(() => setError({ key: "", text: "" }), []);
  const [ringSending, setRingSending] = useState(false);
  /*
   * Ring ("نداء"): the adapter owns transport; this component only decides
   * that rings from the cashier/employee side are "incoming" here and that
   * answering jumps to the ringing thread.
   */
  const ringSubscribe = useCallback(
    (handlers) => (typeof apiAdapter?.subscribe === "function" ? apiAdapter.subscribe(handlers) : () => {}),
    [apiAdapter]
  );
  const ringAnswer = useCallback((ring) => apiAdapter?.answerRing?.(ring.thread_id, ring.message?.id), [apiAdapter]);
  const ringIsIncoming = useCallback((payload) => String(payload?.sender_type || payload?.message?.sender_type || "") !== "admin", []);
  const chatRing = useChatRing({ subscribe: ringSubscribe, answer: ringAnswer, isIncoming: ringIsIncoming });
  const failure = useCallback(
    (err, key) => ({ key: err?.responseBody?.message || err?.message ? "" : key, text: err?.responseBody?.message || err?.message || "" }),
    []
  );
  const errorMessage = error.key ? t(error.key) : error.text;
  const [recordingState, setRecordingState] = useState({ active: false, paused: false, seconds: 0, supported: false });
  const [recordingStream, setRecordingStream] = useState(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  // The contact panel focuses this input directly. It used to be located by a
  // DOM query on its placeholder text, which made a RENDERED label part of the
  // lookup - translating that placeholder would have broken the focus jump.
  const messageSearchRef = useRef(null);
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
        photo_url: threadMatch.photo_url || "",
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
  // Presence rides on the list rows (and presence events update them); the
  // single-thread response does not carry it.
  const presenceThread = threadMap.get(String(selectedEmployeeId || "")) || selectedThread;
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
          photo_url: item.photo_url || "",
          branch_name: item.branch_name,
        },
        thread: item,
      }));
    const query = threadSearch.trim().toLocaleLowerCase("ar");
    return [...employeeRows, ...threadOnlyRows].filter(({ employee, thread: employeeThread }) => {
      const archived = Boolean(employeeThread?.archived_at);
      if (threadFilter === "archived" ? !archived : archived) return false;
      if (threadFilter === "unread" && !Number(employeeThread?.unread_count || 0)) return false;
      if (threadFilter === "cashier" && !/^pos-branch-/.test(String(employeeThread?.employee_id || employee?.employee_id || employee?.id || ""))) return false;
      if (!query) return true;
      return [employee?.full_name, employee?.employee_name, employee?.employee_code, employee?.branch_name, employeeThread?.last_message]
        .some((value) => String(value || "").toLocaleLowerCase("ar").includes(query));
    }).sort((left, right) => {
      // Pinned conversations first (oldest pin on top, WhatsApp's order), then by activity.
      const leftPin = left.thread?.pinned_at ? new Date(left.thread.pinned_at).getTime() : 0;
      const rightPin = right.thread?.pinned_at ? new Date(right.thread.pinned_at).getTime() : 0;
      if (Boolean(leftPin) !== Boolean(rightPin)) return leftPin ? -1 : 1;
      if (leftPin && rightPin && leftPin !== rightPin) return leftPin - rightPin;
      if (left.thread && right.thread) return threadSortValue(right.thread) - threadSortValue(left.thread);
      if (left.thread) return -1;
      if (right.thread) return 1;
      return String(left.employee?.full_name || left.employee?.employee_name || "").localeCompare(String(right.employee?.full_name || right.employee?.employee_name || ""), "ar");
    });
  }, [employees, normalizedThreads, threadFilter, threadMap, threadSearch]);

  /*
   * Search highlights and steps through matches; it no longer hides the rest
   * of the conversation, so a hit keeps its context (WhatsApp's behaviour).
   */
  const searchQuery = messageSearch.trim();
  const searchMatchIds = useMemo(() => {
    const query = searchQuery.toLocaleLowerCase("ar");
    if (!query) return [];
    return messages
      .filter((message) => [message.body, message.attachment_name, message.reply_body].some((value) => String(value || "").toLocaleLowerCase("ar").includes(query)))
      .map((message) => String(message.id || message.client_id || ""));
  }, [messages, searchQuery]);
  const [searchCursor, setSearchCursor] = useState(0);
  useEffect(() => { setSearchCursor(searchMatchIds.length ? searchMatchIds.length - 1 : 0); }, [searchMatchIds]);
  const stepSearch = (delta) => {
    if (!searchMatchIds.length) return;
    const next = (searchCursor + delta + searchMatchIds.length) % searchMatchIds.length;
    setSearchCursor(next);
    scrollToMessage(searchMatchIds[next]);
  };
  useEffect(() => {
    if (searchMatchIds.length && searchQuery) scrollToMessage(searchMatchIds[searchMatchIds.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);
  const visibleMessages = messages;

  useEffect(() => {
    selectedThreadIdRef.current = activeThreadId || selectedThreadId || "";
    threadRef.current = selectedThread;
    selectedEmployeeIdRef.current = selectedEmployeeId;
  }, [activeThreadId, selectedEmployeeId, selectedThread, selectedThreadId]);

  useEffect(() => {
    messagesByThreadRef.current = messagesByThread;
  }, [messagesByThread]);
  useEffect(() => {
    if (!cacheScope || !activeThreadId) return undefined;
    const rows = messagesByThread[String(activeThreadId)];
    if (!rows?.length) return undefined;
    const timer = window.setTimeout(() => { void chatCache.saveThread(cacheScope, activeThreadId, rows); }, 400);
    return () => window.clearTimeout(timer);
  }, [cacheScope, activeThreadId, messagesByThread]);

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

  // iOS keyboard: Safari keeps the layout viewport tall and scrolls the page
  // so the focused composer shows, which pushes the chat header off-screen.
  // Size the fixed chat to the *visual* viewport and pin it to its top instead,
  // so the header stays put like WhatsApp and only the message list shrinks.
  const chatRootRef = useRef(null);
  useEffect(() => {
    if (!mobileFullScreen || !mobileConversationOpen || typeof window === "undefined") return undefined;
    const vv = window.visualViewport;
    const root = chatRootRef.current;
    if (!vv || !root) return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const node = chatRootRef.current;
      if (!node) return;
      node.style.height = `${Math.round(vv.height)}px`;
      node.style.minHeight = "0";
      node.style.top = `${Math.round(vv.offsetTop)}px`;
      node.style.bottom = "auto";
      if (window.scrollY) window.scrollTo(0, 0);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.height = "";
      root.style.minHeight = "";
      root.style.top = "";
      root.style.bottom = "";
    };
  }, [mobileConversationOpen, mobileFullScreen]);

  const loadThreads = useCallback(async () => {
    if (!apiAdapter?.listThreads) return;
    setLoadingThreads(true);
    try {
      clearError();
      const response = await apiAdapter.listThreads();
      const nextThreads = dedupeChatThreads(safeArray(response?.threads));
      setThreads((current) => mergeChatThreads(current, nextThreads));
      if (cacheScope) void chatCache.saveThreads(cacheScope, nextThreads);
      return response;
    } catch (err) {
      setError(failure(err, "employeePortal.chat.admin.errors.loadThreads"));
      return null;
    } finally {
      setLoadingThreads(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiAdapter, cacheScope]);

  const loadThread = useCallback(async (threadId, { silent = false, beforeId = null } = {}) => {
    const resolvedThreadId = String(threadId || "");
    if (!resolvedThreadId || !apiAdapter?.getThread) return null;
    if (!silent && !beforeId) setLoadingThread(true);
    try {
      clearError();
      const response = await apiAdapter.getThread(resolvedThreadId, beforeId ? { beforeId } : {});
      const nextThread = response?.thread || null;
      const pageMessages = dedupeChatMessages(safeArray(response?.messages), nextThread);
      if (nextThread && !beforeId) {
        setThread(nextThread);
        setThreads((current) => mergeChatThreads(current, [{ ...nextThread, unread_count: 0 }]));
      }
      setMessagesByThread((current) => {
        const existing = current[resolvedThreadId] || [];
        if (beforeId) return { ...current, [resolvedThreadId]: mergeChatMessages(existing, pageMessages, nextThread) };
        // Newest page: keep older pages already loaded, and keep optimistic rows
        // the server has not confirmed yet.
        const oldestId = Number(pageMessages[0]?.id || 0);
        const retained = existing.filter((item) => (oldestId && Number(item.id || 0) < oldestId) || item.status === "pending" || item.status === "failed");
        return { ...current, [resolvedThreadId]: mergeChatMessages(retained, pageMessages, nextThread) };
      });
      if (beforeId) {
        setHasOlderByThread((current) => ({ ...current, [resolvedThreadId]: Boolean(response?.has_more) }));
      } else {
        setHasOlderByThread((current) => (current[resolvedThreadId] === undefined || !messagesByThreadRef.current[resolvedThreadId]?.length
          ? { ...current, [resolvedThreadId]: Boolean(response?.has_more) }
          : current));
        const newestIncoming = [...pageMessages].reverse().find((item) => item.sender_type !== "admin");
        if (newestIncoming && !newestIncoming.delivered_at && !newestIncoming.read_at) void apiAdapter.markDelivered?.(resolvedThreadId, newestIncoming.id);
        await apiAdapter.markRead?.(resolvedThreadId);
      }
      return response;
    } catch (err) {
      setError(failure(err, "employeePortal.chat.admin.errors.openThread"));
      return null;
    } finally {
      if (!silent && !beforeId) setLoadingThread(false);
    }
  }, [apiAdapter]);

  const loadOlder = useCallback(async () => {
    const threadId = String(selectedThreadIdRef.current || "");
    const rows = messagesByThreadRef.current[threadId] || [];
    const oldest = rows.find((item) => item.id);
    if (!threadId || !oldest || loadingOlder) return;
    const node = messagesRef.current;
    const previousHeight = node?.scrollHeight || 0;
    const previousTop = node?.scrollTop || 0;
    setLoadingOlder(true);
    try {
      await loadThread(threadId, { silent: true, beforeId: oldest.id });
      // Anchor: keep the message the reader was looking at where it was.
      window.requestAnimationFrame(() => {
        if (node) node.scrollTop = previousTop + (node.scrollHeight - previousHeight);
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [loadThread, loadingOlder]);

  const cachePrimedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cacheScope && !cachePrimedRef.current) {
        cachePrimedRef.current = true;
        const cached = await chatCache.loadThreads(cacheScope);
        if (!cancelled && cached?.length) {
          // Paint from disk; the network merges over it and stays authoritative.
          setThreads((current) => (current.length ? current : dedupeChatThreads(cached)));
          setLoadingThreads(false);
        }
        void chatCache.sweep(cacheScope);
      }
      if (!cancelled) void loadThreads();
    };
    void run();
    return () => { cancelled = true; };
  }, [cacheScope, loadThreads]);

  useEffect(() => {
    const externalId = String(initialSelectedEmployeeId || employeeRecordId(selectedEmployee) || "");
    if (externalId) setSelectedEmployeeId((current) => (String(current || "") === externalId ? current : externalId));
  }, [initialSelectedEmployeeId, selectedEmployee]);

  useEffect(() => {
    if (selectedEmployeeId) return;
    const firstEmployeeId = employeeRecordId(sidebarRows[0]?.employee) || String(sidebarRows[0]?.employee?.employee_id || "");
    if (firstEmployeeId) setSelectedEmployeeId(firstEmployeeId);
  }, [selectedEmployeeId, sidebarRows]);

  /*
   * Depends on the resolved thread ID, not on threadMap: every loadThread merges
   * the thread back into the list, which rebuilt the map, which re-ran this
   * effect, which called loadThread again - an open network loop (GET + read
   * POST every few hundred ms) for as long as the tab stayed open.
   */
  const mappedThreadId = selectedEmployeeId ? String(threadMap.get(String(selectedEmployeeId))?.id || "") : "";
  useEffect(() => {
    const nextThreadId = mappedThreadId;
    setSelectedThreadId((current) => (String(current || "") === nextThreadId ? current : nextThreadId));
    if (!nextThreadId) {
      setThread(null);
      setBodyState(draftsByThreadRef.current[`employee:${selectedEmployeeId}`] || "");
      return;
    }
    setBodyState(draftsByThreadRef.current[nextThreadId] || "");
    const inMemory = Boolean(messagesByThreadRef.current[nextThreadId]?.length);
    if (inMemory) {
      setThread(threadMap.get(String(selectedEmployeeId)) || null);
      void loadThread(nextThreadId, { silent: true });
      return;
    }
    if (!cacheScope) {
      void loadThread(nextThreadId, { silent: false });
      return;
    }
    // Warm open: cached newest page first, then the network replaces the window.
    let cancelled = false;
    (async () => {
      const cached = await chatCache.loadThread(cacheScope, nextThreadId);
      if (cancelled) return;
      if (cached?.length && !messagesByThreadRef.current[nextThreadId]?.length) {
        setMessagesByThread((current) => (current[nextThreadId]?.length ? current : { ...current, [nextThreadId]: cached }));
        setThread(threadMap.get(String(selectedEmployeeId)) || null);
      }
      void loadThread(nextThreadId, { silent: Boolean(cached?.length) });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThread, selectedEmployeeId, mappedThreadId, cacheScope]);

  useEffect(() => {
    onSelectedEmployeeChange?.(selectedEmployeeRecord);
  }, [onSelectedEmployeeChange, selectedEmployeeRecord]);

  useEffect(() => {
    onThreadChange?.({ thread: selectedThread, messages, employee: selectedEmployeeRecord });
  }, [messages, onThreadChange, selectedEmployeeRecord, selectedThread]);

  /*
   * Polling is the fallback, not the transport. While the socket is connected
   * AND has delivered an event recently, the poll is skipped; "connected" alone
   * is not trusted (a socket can be connected and receive nothing), so a
   * quiet socket still polls every LIVE_POLL_MS. A hidden tab never polls.
   */
  useEffect(() => {
    if (!pollMs) return undefined;
    const LIVE_POLL_MS = 60000;
    let lastPollAt = Date.now();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      const socketAlive = apiAdapter?.isLive?.() && now - liveEventAtRef.current < LIVE_POLL_MS;
      if (socketAlive && now - lastPollAt < LIVE_POLL_MS) return;
      lastPollAt = now;
      void loadThreads();
      if (selectedThreadIdRef.current) void loadThread(selectedThreadIdRef.current, { silent: true });
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [apiAdapter, loadThread, loadThreads, pollMs]);

  useEffect(() => {
    if (!apiAdapter?.subscribe) return undefined;

    const eventThreadId = (payload = {}) => String(payload?.thread?.id || payload?.message?.thread_id || payload?.thread_id || "");
    const refreshActiveThread = (payload = {}) => {
      const threadId = eventThreadId(payload);
      if (threadId && threadId === String(selectedThreadIdRef.current || "")) {
        void loadThread(threadId, { silent: true });
      }
    };

    const stampLive = () => { liveEventAtRef.current = Date.now(); };
    const nearBottom = () => {
      const node = messagesRef.current;
      return !node || node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    };
    return apiAdapter.subscribe({
      onMessage: (payload = {}) => {
        stampLive();
        const nextThread = payload?.thread || null;
        const nextMessage = payload?.message || null;
        const threadId = eventThreadId(payload);
        const isActive = threadId === String(selectedThreadIdRef.current || "");
        if (nextThread) {
          setThreads((current) => mergeChatThreads(current, [nextThread]));
          if (isActive) setThread(nextThread);
        }
        if (threadId && nextMessage) {
          setMessagesByThread((current) => ({
            ...current,
            [threadId]: mergeChatMessages(current[threadId] || [], [nextMessage]),
          }));
          const incoming = nextMessage.sender_type !== "admin";
          if (incoming && isActive) {
            // Our device has it: tell the sender (single tick -> double tick).
            void apiAdapter.markDelivered?.(threadId, nextMessage.id);
            const visible = typeof document === "undefined" || document.visibilityState === "visible";
            if (visible && nearBottom()) void apiAdapter.markRead?.(threadId);
            else setUnseenBelow((count) => count + 1);
          } else if (incoming) {
            void apiAdapter.markDelivered?.(threadId, nextMessage.id);
          }
        }
      },
      onThread: (payload = {}) => {
        stampLive();
        const nextThread = payload?.thread || payload;
        if (nextThread?.id) setThreads((current) => mergeChatThreads(current, [nextThread]));
      },
      onRead: (payload = {}) => {
        stampLive();
        const threadId = eventThreadId(payload);
        if (!threadId) return;
        // The other side read our messages: flip every unread outgoing row in place.
        const readAt = payload?.at || new Date().toISOString();
        setMessagesByThread((current) => {
          const rows = current[threadId];
          if (!rows?.length) return current;
          return { ...current, [threadId]: rows.map((item) => (item.sender_type === "admin" && !item.read_at ? { ...item, read_at: readAt } : item)) };
        });
      },
      onDelivered: (payload = {}) => {
        stampLive();
        const threadId = eventThreadId(payload);
        const ids = new Set(safeArray(payload?.message_ids).map(String));
        if (!threadId || !ids.size) return;
        const deliveredAt = payload?.delivered_at || new Date().toISOString();
        setMessagesByThread((current) => {
          const rows = current[threadId];
          if (!rows?.length) return current;
          return { ...current, [threadId]: rows.map((item) => (ids.has(String(item.id)) && !item.delivered_at ? { ...item, delivered_at: deliveredAt } : item)) };
        });
      },
      onMutation: (payload = {}) => {
        stampLive();
        const threadId = eventThreadId(payload);
        const nextMessage = payload?.message || null;
        if (threadId && nextMessage?.id) {
          setMessagesByThread((current) => (current[threadId]?.length
            ? { ...current, [threadId]: mergeChatMessages(current[threadId], [nextMessage]) }
            : current));
          return;
        }
        refreshActiveThread(payload);
      },
      onTyping: (payload = {}) => {
        stampLive();
        const threadId = eventThreadId(payload);
        if (!threadId) return;
        setTypingThreadIds((current) => (current[threadId] ? current : { ...current, [threadId]: true }));
        if (threadId === String(selectedThreadIdRef.current || "")) {
          setTypingLabel(payload?.sender_name || payload?.employee_name || t("employeePortal.chat.admin.typing"));
        }
      },
      onStopTyping: (payload = {}) => {
        const threadId = eventThreadId(payload);
        if (threadId) setTypingThreadIds((current) => { if (!current[threadId]) return current; const next = { ...current }; delete next[threadId]; return next; });
        if (!threadId || threadId === String(selectedThreadIdRef.current || "")) setTypingLabel("");
      },
      onPresence: (payload = {}) => {
        stampLive();
        const identity = String(payload?.employee_id || "");
        if (!identity) return;
        setThreads((current) => current.map((item) => (String(threadEmployeeId(item)) === identity ? { ...item, online: Boolean(payload.online), last_seen_at: payload.last_seen_at || item.last_seen_at || null } : item)));
      },
    });
  }, [apiAdapter, loadThread]);

  const lastMessageKey = messages.length ? String(messages[messages.length - 1]?.client_id || messages[messages.length - 1]?.id || "") : "";
  const lastOwn = messages.length ? messages[messages.length - 1]?.sender_type === "admin" : false;
  const scrolledThreadRef = useRef("");
  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return undefined;
    const threadChanged = scrolledThreadRef.current !== String(activeThreadId || selectedEmployeeId || "");
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    // A new message only pulls the view down when the reader is already at the
    // bottom or wrote it; otherwise the jump button counts it.
    if (!threadChanged && !nearBottom && !lastOwn) return undefined;
    const timer = window.setTimeout(() => {
      const firstUnread = threadChanged && firstUnreadIndex >= 0 ? messages[firstUnreadIndex] : null;
      const unreadNode = firstUnread ? document.getElementById(`shared-portal-chat-message-${firstUnread.id || firstUnread.client_id}`) : null;
      if (unreadNode) {
        // Open where reading stopped: the unread divider sits just under the header.
        node.scrollTop = Math.max(0, unreadNode.offsetTop - node.offsetTop - 48);
      } else {
        node.scrollTop = node.scrollHeight;
      }
      scrolledThreadRef.current = String(activeThreadId || selectedEmployeeId || "");
      setUnseenBelow(0);
    }, 50);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageKey, activeThreadId, selectedEmployeeId]);

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

  const ringThread = async () => {
    if (!activeThreadId || !apiAdapter?.ring || ringSending) return;
    setRingSending(true);
    clearError();
    try {
      const response = await apiAdapter.ring(activeThreadId);
      chatRing.registerOutgoing(response);
    } catch (err) {
      const code = err?.responseBody?.code || "";
      setError(code === "ring_pending" ? { key: "common.chatRing.ringPending", text: "" } : failure(err, "common.chatRing.ringFailed"));
    } finally {
      setRingSending(false);
    }
  };
  const answerRingAndOpen = async () => {
    const ring = chatRing.incoming;
    await chatRing.answerIncoming();
    if (ring?.employee_id) chooseEmployee(String(ring.employee_id), ring.thread_id);
  };

  const chooseEmployee = (employeeId, threadId = "") => {
    const currentKey = activeThreadId || `employee:${selectedEmployeeId || ""}`;
    if (currentKey) setDraftsByThread((current) => ({ ...current, [currentKey]: body }));
    const nextEmployeeId = String(employeeId || "");
    const nextThreadId = String(threadId || threadMap.get(nextEmployeeId)?.id || "");
    setSelectedEmployeeId(nextEmployeeId);
    setSelectedThreadId(nextThreadId);
    setUnseenBelow(0);
    setReplyTo(null);
    setEditingMessage(null);
    setMessageSearch("");
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
      setError({ key: "employeePortal.chat.admin.errors.unsupportedFile", text: "" });
      event.target.value = "";
      setAttachment(null);
      setAttachmentDuration(0);
      return;
    }
    clearError();
    setAttachment(file);
    setAttachmentDuration(0);
  };

  const submitMessage = async (event) => {
    event.preventDefault();
    const text = body.trim();
    if (editingMessage) {
      if (!text || !activeThreadId || !apiAdapter?.editMessage) return;
      try {
        setSending(true);
        clearError();
        await apiAdapter.editMessage(activeThreadId, editingMessage.id, { body: text });
        setEditingMessage(null);
        setBody("");
        await loadThread(activeThreadId, { silent: true });
      } catch (err) {
        setError(failure(err, "employeePortal.chat.editFailed"));
      } finally {
        setSending(false);
      }
      return;
    }
    if ((!text && !attachment) || !activeThreadId || !apiAdapter?.sendMessage) return;
    const draft = { text, attachment, attachmentDuration, replyTo };
    setBody("");
    setAttachment(null);
    setAttachmentDuration(0);
    setReplyTo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void dispatchSend(activeThreadId, draft);
  };

  /*
   * Optimistic send: the bubble appears at once with a clock, carrying a
   * client_id the server echoes back, so the confirmed row replaces it in
   * place (mergeChatMessages keys on client_id). A failure keeps the bubble
   * with a retry; the same client_id makes the retry idempotent server-side.
   */
  const buildSendFormData = (draft) => {
    const formData = new FormData();
    if (draft.text) formData.append("body", draft.text);
    if (draft.attachment) formData.append("attachment", draft.attachment);
    if (draft.attachment && draft.attachmentDuration > 0) formData.append("attachment_duration_seconds", String(draft.attachmentDuration));
    if (draft.replyTo?.id) formData.append("reply_to_message_id", draft.replyTo.id);
    formData.append("client_id", draft.clientId);
    return formData;
  };

  const dispatchSend = async (threadId, draft, existingClientId = "") => {
    const clientId = existingClientId || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const fullDraft = { ...draft, clientId };
    pendingSendsRef.current.set(clientId, fullDraft);
    const attachmentType = draft.attachment
      ? (draft.attachment.type?.startsWith("image/") ? "image" : draft.attachment.type?.startsWith("audio/") ? "audio" : draft.attachment.type?.startsWith("video/") ? "video" : "file")
      : null;
    const optimistic = {
      client_id: clientId,
      thread_id: threadId,
      sender_type: "admin",
      body: draft.text || "",
      attachment_type: attachmentType,
      attachment_name: draft.attachment?.name || null,
      attachment_url: draft.attachment ? URL.createObjectURL(draft.attachment) : null,
      attachment_duration_seconds: draft.attachmentDuration || null,
      reply_to_message_id: draft.replyTo?.id || null,
      reply_sender_type: draft.replyTo?.sender_type || null,
      reply_body: draft.replyTo?.body || null,
      reply_attachment_type: draft.replyTo?.attachment_type || null,
      created_at: new Date().toISOString(),
      status: "pending",
      reactions: [],
    };
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: mergeChatMessages(current[threadId] || [], [optimistic], threadRef.current),
    }));
    setSending(true);
    clearError();
    try {
      const response = await apiAdapter.sendMessage(threadId, buildSendFormData(fullDraft));
      pendingSendsRef.current.delete(clientId);
      if (response?.thread) {
        setThread((current) => (String(current?.id) === String(threadId) ? response.thread : current));
        setThreads((current) => mergeChatThreads(current, [response.thread]));
      }
      if (response?.message) {
        setMessagesByThread((current) => ({
          ...current,
          [threadId]: mergeChatMessages(current[threadId] || [], [{ ...response.message, client_id: response.message.client_id || clientId }], response?.thread || threadRef.current),
        }));
      }
    } catch (err) {
      setMessagesByThread((current) => ({
        ...current,
        [threadId]: (current[threadId] || []).map((item) => (item.client_id === clientId ? { ...item, status: "failed" } : item)),
      }));
      setError(failure(err, "employeePortal.chat.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const retrySend = (message) => {
    const draft = pendingSendsRef.current.get(message?.client_id);
    if (!draft || !message?.thread_id) return;
    void dispatchSend(String(message.thread_id), draft, message.client_id);
  };

  const beginEditMessage = (message) => {
    setReplyTo(null);
    setAttachment(null);
    setEditingMessage(message);
    setBody(message.body || "");
    window.setTimeout(() => inputRef.current?.focus?.(), 30);
  };

  const deleteMessage = async (message) => {
    if (!activeThreadId || !message?.id || !apiAdapter?.deleteMessage) return;
    if (!window.confirm(t("employeePortal.chat.confirmDeleteForAll"))) return;
    try {
      clearError();
      await apiAdapter.deleteMessage(activeThreadId, message.id);
      await loadThread(activeThreadId, { silent: true });
      await loadThreads();
    } catch (err) {
      setError(failure(err, "employeePortal.chat.deleteFailed"));
    }
  };

  const reactToMessage = async (message, emoji) => {
    if (!message?.id || !apiAdapter?.reactMessage) return;
    try {
      clearError();
      const response = await apiAdapter.reactMessage(message.id, emoji);
      if (response?.message) {
        setMessagesByThread((current) => ({
          ...current,
          [activeThreadId]: mergeChatMessages(current[activeThreadId] || [], [response.message], response?.thread || threadRef.current),
        }));
      }
    } catch (err) {
      setError(failure(err, "employeePortal.chat.reactionFailed"));
    }
  };

  const forwardTargets = sidebarRows.filter(({ employee, thread: targetThread }) => {
    if (!targetThread?.id || String(targetThread.id) === String(activeThreadId || "")) return false;
    const query = forwardSearch.trim().toLocaleLowerCase("ar");
    if (!query) return true;
    return [employee?.full_name, employee?.employee_name, employee?.employee_code, employee?.branch_name]
      .some((value) => String(value || "").toLocaleLowerCase("ar").includes(query));
  });

  const forwardToThread = async (targetThreadId) => {
    if (!forwardMessage?.id || !targetThreadId || !apiAdapter?.forwardMessage) return;
    try {
      setForwarding(true);
      clearError();
      await apiAdapter.forwardMessage(forwardMessage.id, targetThreadId);
      setForwardMessage(null);
      setForwardSearch("");
      await loadThreads();
    } catch (err) {
      setError(failure(err, "employeePortal.chat.admin.errors.forward"));
    } finally {
      setForwarding(false);
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
    setUnseenBelow(0);
    if (activeThreadId) void apiAdapter?.markRead?.(activeThreadId);
  };

  const onMessagesScroll = () => {
    const node = messagesRef.current;
    if (!node) return;
    const away = node.scrollHeight - node.scrollTop - node.clientHeight > 140;
    setShowJump((current) => (current === away ? current : away));
    if (!away && unseenBelow) {
      setUnseenBelow(0);
      if (activeThreadId) void apiAdapter?.markRead?.(activeThreadId);
    }
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
    clearError();
    try {
      const recording = await stopVoiceRecording({ capture: true });
      if (!recording?.blob?.size) return;
      const file = new File([recording.blob], `voice-${Date.now()}.webm`, { type: recording.mimeType || recording.blob.type || "audio/webm" });
      const draft = { text: "", attachment: file, attachmentDuration: recording.durationSeconds, replyTo };
      setBody("");
      setAttachment(null);
      setAttachmentDuration(0);
      setReplyTo(null);
      await dispatchSend(activeThreadId, draft);
    } catch (err) {
      setError(failure(err, "employeePortal.chat.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const starMessage = async (message) => {
    if (!message?.id || !apiAdapter?.starMessage) return;
    const threadId = String(message.thread_id || activeThreadId || "");
    try {
      clearError();
      const response = await apiAdapter.starMessage(message.id);
      if (response?.message && threadId) {
        setMessagesByThread((current) => (current[threadId]?.length ? { ...current, [threadId]: mergeChatMessages(current[threadId], [response.message]) } : current));
      }
      if (starredRows) setStarredRows((rows) => (response?.starred ? rows : rows.filter((row) => String(row.id) !== String(message.id))));
    } catch (err) {
      setError(failure(err, "employeePortal.chat.starFailed"));
    }
  };
  const openStarred = async () => {
    setStarredOpen(true);
    if (!apiAdapter?.listStarred) return;
    try {
      const response = await apiAdapter.listStarred();
      setStarredRows(safeArray(response?.messages));
    } catch (err) {
      setError(failure(err, "employeePortal.chat.starFailed"));
      setStarredRows([]);
    }
  };
  const jumpToStarred = (row) => {
    setStarredOpen(false);
    const employeeId = String(row.thread_employee_id || "");
    const threadId = String(row.thread_id || "");
    setPendingJump(String(row.id));
    if (threadId && threadId === String(activeThreadId || "")) {
      window.setTimeout(() => scrollToMessage(row.id), 50);
      return;
    }
    chooseEmployee(employeeId, threadId);
  };
  useEffect(() => {
    if (!pendingJump || !messages.length) return undefined;
    const present = messages.some((item) => String(item.id) === pendingJump);
    if (!present) return undefined;
    const timer = window.setTimeout(() => { scrollToMessage(pendingJump); setPendingJump(null); }, 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, messages]);
  const starredSheet = starredOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" dir={i18nInstance.dir()} role="dialog" aria-modal="true" aria-label={t("employeePortal.chat.starredMessages")}>
      <button type="button" className="absolute inset-0" onClick={() => setStarredOpen(false)} aria-label={t("common.close")} />
      <div className="relative flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[1.5rem] border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-2xl sm:rounded-[1.5rem]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-base font-black"><Star className="h-4 w-4 text-[var(--primary)]" />{t("employeePortal.chat.starredMessages")}</div>
          <button type="button" onClick={() => setStarredOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--surface-hover)]" aria-label={t("common.close")}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {starredRows === null ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</div>
          ) : starredRows.length ? starredRows.map((row) => (
            <button key={row.id} type="button" onClick={() => jumpToStarred(row)} className="mb-1 flex w-full flex-col gap-0.5 rounded-[var(--radius-control)] px-3 py-2 text-start hover:bg-[var(--surface-hover)]">
              <span className="flex items-center justify-between gap-2 text-[11px] font-black text-[var(--muted)]">
                <span className="truncate" dir="auto">{row.sender_type === "admin" ? t("employeePortal.chat.admin.management") : row.thread_name}</span>
                <span className="shrink-0 tabular-nums" dir="ltr">{formatChatDateTime(row.created_at)}</span>
              </span>
              <span className="line-clamp-2 text-[14px] font-semibold" dir="auto">{portalChatMessagePreview(row, { image: t("employeePortal.chat.image"), voice: t("employeePortal.chat.voiceMessage"), file: t("employeePortal.chat.file") })}</span>
            </button>
          )) : (
            <div className="p-8 text-center text-sm font-bold text-[var(--muted)]">{t("employeePortal.chat.noStarred")}</div>
          )}
        </div>
      </div>
    </div>, document.body
  ) : null;

  const openRowMenu = (node, rowThread, rowEmployee) => {
    const rect = node?.getBoundingClientRect?.();
    const viewportWidth = window.innerWidth || 360;
    const viewportHeight = window.innerHeight || 640;
    const width = Math.min(260, viewportWidth - 24);
    const height = 232;
    const left = Math.max(12, Math.min(i18nInstance.dir() === "rtl" ? (rect?.right || viewportWidth) - width : rect?.left || 12, viewportWidth - width - 12));
    const top = (rect?.bottom || 80) + height + 12 < viewportHeight ? (rect?.bottom || 80) + 4 : Math.max(12, (rect?.top || viewportHeight) - height - 4);
    setRowMenu({ thread: rowThread, employee: rowEmployee, left, top, width });
  };
  const updateThreadPrefs = async (rowThread, prefs) => {
    setRowMenu(null);
    if (!rowThread?.id || !apiAdapter?.updatePrefs) return;
    // Optimistic: the row moves at once; the server's summary confirms it.
    const guess = { ...rowThread };
    if (prefs.pinned !== undefined) guess.pinned_at = prefs.pinned ? new Date().toISOString() : null;
    if (prefs.archived !== undefined) guess.archived_at = prefs.archived ? new Date().toISOString() : null;
    if (prefs.muted_until !== undefined) guess.muted_until = prefs.muted_until === "forever" ? "2999-01-01T00:00:00.000Z" : prefs.muted_until;
    setThreads((current) => mergeChatThreads(current, [guess]));
    try {
      const response = await apiAdapter.updatePrefs(rowThread.id, prefs);
      if (response?.thread) setThreads((current) => mergeChatThreads(current, [response.thread]));
    } catch (err) {
      setThreads((current) => mergeChatThreads(current, [rowThread]));
      setError(failure(err, "employeePortal.chat.prefsFailed"));
    }
  };
  const rowMenuSheet = rowMenu && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[140]" dir={i18nInstance.dir()} role="dialog" aria-modal="true" aria-label={t("employeePortal.chat.conversationOptions")}>
      <button type="button" className="absolute inset-0 bg-black/30" onClick={() => setRowMenu(null)} aria-label={t("common.close")} />
      <div className="absolute overflow-hidden rounded-[1.1rem] border border-[var(--border)] bg-[var(--card)] p-1.5 text-[var(--text)] shadow-2xl" style={{ left: rowMenu.left, top: rowMenu.top, width: rowMenu.width }}>
        <div className="truncate px-3 py-1.5 text-xs font-black text-[var(--muted)]" dir="auto">{rowMenu.employee?.full_name || rowMenu.employee?.employee_name || rowMenu.thread?.employee_name}</div>
        {(() => {
          const pinned = Boolean(rowMenu.thread?.pinned_at);
          const muted = Boolean(rowMenu.thread?.muted_until && new Date(rowMenu.thread.muted_until).getTime() > Date.now());
          const archived = Boolean(rowMenu.thread?.archived_at);
          const item = "flex min-h-[var(--control-height-md)] w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-start text-[14px] font-bold hover:bg-[var(--surface-hover)]";
          return (
            <div className="grid">
              <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { pinned: !pinned })} className={item}>{pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{t(pinned ? "employeePortal.chat.unpin" : "employeePortal.chat.pin")}</button>
              {muted ? (
                <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { muted_until: null })} className={item}><Bell className="h-4 w-4" />{t("employeePortal.chat.unmute")}</button>
              ) : (
                <>
                  <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { muted_until: new Date(Date.now() + 8 * 3600000).toISOString() })} className={item}><BellOff className="h-4 w-4" />{t("employeePortal.chat.mute8h")}</button>
                  <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { muted_until: new Date(Date.now() + 7 * 86400000).toISOString() })} className={item}><BellOff className="h-4 w-4" />{t("employeePortal.chat.mute1w")}</button>
                  <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { muted_until: "forever" })} className={item}><BellOff className="h-4 w-4" />{t("employeePortal.chat.muteForever")}</button>
                </>
              )}
              <button type="button" onClick={() => updateThreadPrefs(rowMenu.thread, { archived: !archived })} className={item}>{archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{t(archived ? "employeePortal.chat.unarchive" : "employeePortal.chat.archive")}</button>
            </div>
          );
        })()}
      </div>
    </div>, document.body
  ) : null;

  const currentPanel = typeof managerPanel === "function"
    ? managerPanel({ employee: selectedEmployeeRecord, thread: selectedThread, messages })
    : managerPanel;

  return (
    <>
    <ChatRingOverlay ring={chatRing.incoming} onAnswer={answerRingAndOpen} onReply={answerRingAndOpen} onDismiss={chatRing.dismissIncoming} />
    {rowMenuSheet}
    {starredSheet}
    <section
      ref={chatRootRef}
      className={`theme-card portal-chat-root flex min-w-0 flex-col overflow-hidden p-0 ${mobileFullScreen ? (mobileConversationOpen ? "fixed inset-0 z-[80] h-[100dvh] min-h-[100dvh] w-full max-w-none rounded-none border-0" : "h-auto min-h-0") : "h-[100dvh] min-h-[100dvh]"} md:static md:z-auto md:h-auto md:min-h-0 md:w-auto md:rounded-[var(--radius-card)] md:border ${className}`}
      dir={i18nInstance.dir()}
      data-mobile-conversation-open={mobileConversationOpen ? "true" : "false"}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "f" && messageSearchRef.current) {
          event.preventDefault();
          messageSearchRef.current.focus();
          messageSearchRef.current.select?.();
        }
      }}
    >
      <div className={`shrink-0 border-b border-[var(--border)] p-4 ${mobileFullScreen && mobileConversationOpen ? "hidden md:block" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black text-[var(--muted)]">{resolvedHeaderKicker}</p>
            <h2 className="m1-section-title mt-1 text-[var(--text)]">{resolvedHeaderTitle}</h2>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">{t("employeePortal.chat.admin.pollNotice", { seconds: Math.round(pollMs / 1000) })}</p>
          </div>
          <button type="button" onClick={() => { void loadThreads(); if (activeThreadId) void loadThread(activeThreadId); }} className="theme-button-soft min-h-[var(--control-height-md)] px-3 text-sm">
            <RefreshCw className={`h-4 w-4 ${loadingThreads ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </button>
        </div>
        {errorMessage ? <div className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm font-bold text-[var(--danger)]" dir="auto">{errorMessage}</div> : null}
      </div>

      <div className={`grid min-h-0 flex-1 md:min-h-[34rem] ${currentPanel ? "md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)_18rem]" : "md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"}`}>
        <aside className={`${mobileFullScreen && mobileConversationOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col border-b border-[var(--border)] bg-[var(--card)] md:border-b-0 md:border-l`}>
          <div className="shrink-0 px-2 pt-2">
            <label className="flex h-10 items-center gap-2 rounded-full bg-[var(--surface-soft)] px-3 text-[var(--muted)]">
              <Search className="h-4 w-4 shrink-0" />
              <input value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder={t("employeePortal.chat.admin.searchThreads")} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--text)] outline-none" />
              {threadSearch ? <button type="button" onClick={() => setThreadSearch("")} aria-label={t("common.close")}><X className="h-4 w-4" /></button> : null}
            </label>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist">
              {[["all", t("common.all")], ["unread", t("employeePortal.chat.filterUnread")], ["cashier", t("employeePortal.chat.filterCashiers")], ["archived", t("employeePortal.chat.filterArchived")]].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={threadFilter === key} onClick={() => setThreadFilter(key)} className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-black transition ${threadFilter === key ? "bg-[var(--primary)] text-[var(--primary-contrast)]" : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loadingThreads && !sidebarRows.length ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm font-bold text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : sidebarRows.length ? (
            <div className="min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto md:max-h-[34rem]">
              {sidebarRows.map(({ employee, thread: employeeThread }) => {
                const rowEmployeeId = employeeRecordId(employee) || String(employee.employee_id || "");
                return (
                  <ChatThreadRow
                    key={`${rowEmployeeId || "employee"}:${employeeThread?.id || "no-thread"}`}
                    employee={employee}
                    thread={employeeThread}
                    active={String(selectedEmployeeId || "") === rowEmployeeId}
                    typing={Boolean(employeeThread?.id && typingThreadIds[String(employeeThread.id)])}
                    typingLabel={t("employeePortal.chat.admin.typing")}
                    name={employee.full_name || employee.employee_name || employeeFallback}
                    subtitle={employee.branch_name || employeeThread?.branch_name || t("employeePortal.chat.admin.noBranch")}
                    preview={employeeThread ? portalChatMessagePreview(employeeThread, { image: t("employeePortal.chat.image"), voice: t("employeePortal.chat.voiceMessage"), file: t("employeePortal.chat.file") }) : ""}
                    timeText={employeeThread ? formatListTime(employeeThread.last_message_created_at || employeeThread.last_message_at || employeeThread.updated_at) : ""}
                    outgoingSenderType="admin"
                    onSelect={() => chooseEmployee(rowEmployeeId, employeeThread?.id || "")}
                    onMenu={apiAdapter?.updatePrefs && employeeThread?.id ? (node) => openRowMenu(node, employeeThread, employee) : null}
                    menuLabel={t("employeePortal.chat.conversationOptions")}
                    testId={`chat-thread-${employeeThread?.id || rowEmployeeId || "employee"}`}
                  />
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-sm font-bold text-[var(--muted)]">
              <MessageCircle className="mx-auto h-8 w-8" />
              <div className="mt-2">{t("employeePortal.chat.admin.noThreads")}</div>
            </div>
          )}
        </aside>

        <div className={`${mobileFullScreen && !mobileConversationOpen ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--chat-bg)] md:min-h-[34rem]`}>
          {selectedEmployeeRecord ? (
            <>
              <div className="shrink-0 border-b border-[var(--chat-border)] bg-[var(--chat-chrome)] px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-[var(--chat-text)] md:px-4 md:py-2">
                <div className="flex min-w-0 items-center gap-3">
                  {mobileFullScreen ? (
                    <button
                      type="button"
                      onClick={() => setMobileConversationOpen(false)}
                      className="grid h-[var(--control-height-md)] w-10 shrink-0 place-items-center rounded-full text-[var(--chat-text)] transition hover:bg-[var(--surface-hover)] md:hidden"
                      aria-label={t("employeePortal.chat.admin.backToThreads")}
                    >
                      <ArrowRight className="h-6 w-6" />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setContactInfoOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] text-start hover:bg-[var(--surface-hover)]" aria-label={t("employeePortal.chat.admin.openEmployeeInfo")}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-[var(--primary)] ring-1 ring-[var(--chat-border)]">
                      {selectedEmployeeRecord.photo_url ? (
                        <>
                          <img src={resolveEmployeeProfileImageUrl(selectedEmployeeRecord.photo_url)} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.classList.add("hidden"); event.currentTarget.nextElementSibling?.classList.remove("hidden"); }} />
                          <UserRound className="hidden h-4 w-4" />
                        </>
                      ) : <UserRound className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-black leading-5" dir="auto">{selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || selectedThread?.employee_name || employeeFallback}</div>
                      <div className={`mt-0.5 truncate text-[11px] font-bold ${typingLabel || selectedThread?.online ? "text-[var(--primary)]" : "text-[var(--chat-muted)]"}`}>
                        {typingLabel
                          ? t("employeePortal.chat.admin.typing")
                          : presenceThread?.online
                            ? t("employeePortal.chat.online")
                            : presenceThread?.last_seen_at
                              ? formatLastSeen(presenceThread.last_seen_at, t)
                              : t(activeThreadId ? "employeePortal.chat.admin.threadReady" : "employeePortal.chat.empty")}
                      </div>
                    </div>
                  </button>
                  {apiAdapter?.listStarred ? (
                    <button type="button" onClick={openStarred} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--chat-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--primary)]" aria-label={t("employeePortal.chat.starredMessages")} title={t("employeePortal.chat.starredMessages")}>
                      <Star className="h-5 w-5" />
                    </button>
                  ) : null}
                  {apiAdapter?.ring && activeThreadId ? (
                    <button
                      type="button"
                      onClick={ringThread}
                      disabled={ringSending || chatRing.outgoing?.status === "ringing"}
                      title={t("common.chatRing.ringTitle")}
                      aria-label={t("common.chatRing.ringButton")}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 text-xs font-black text-[var(--primary-contrast)] shadow-[0_8px_20px_rgba(245,158,11,0.3)] disabled:opacity-50"
                    >
                      <PhoneCall className={`h-4 w-4 ${chatRing.outgoing?.status === "ringing" ? "animate-pulse" : ""}`} />
                      <span className="hidden sm:inline">{t("common.chatRing.ringButton")}</span>
                    </button>
                  ) : null}
                  <label className="flex h-9 max-w-44 items-center gap-1.5 rounded-full bg-[var(--chat-input)] px-2 text-[var(--chat-text)]">
                    <Search className="h-4 w-4 shrink-0" />
                    {searchQuery ? <span className="shrink-0 text-[11px] font-black tabular-nums text-[var(--chat-muted)]" dir="ltr">{searchMatchIds.length ? `${searchCursor + 1}/${searchMatchIds.length}` : "0"}</span> : null}
                    {searchQuery ? <button type="button" onClick={() => stepSearch(-1)} disabled={!searchMatchIds.length} aria-label={t("common.previous")} className="grid h-6 w-6 place-items-center rounded-full hover:bg-[var(--surface-hover)] disabled:opacity-40"><ChevronUp className="h-4 w-4" /></button> : null}
                    {searchQuery ? <button type="button" onClick={() => stepSearch(1)} disabled={!searchMatchIds.length} aria-label={t("common.next")} className="grid h-6 w-6 place-items-center rounded-full hover:bg-[var(--surface-hover)] disabled:opacity-40"><ChevronDown className="h-4 w-4" /></button> : null}
                    <input ref={messageSearchRef} value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1); } if (event.key === "Escape") setMessageSearch(""); }} placeholder={t("employeePortal.chat.admin.searchMessages")} className="min-w-0 flex-1 bg-transparent text-xs font-bold text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)]" />
                    {messageSearch ? <button type="button" onClick={() => setMessageSearch("")}><X className="h-3.5 w-3.5" /></button> : null}
                  </label>
                </div>
              </div>
              <div className="mx-auto mt-1.5 w-fit rounded-full bg-[var(--chat-pill)] px-2.5 py-0.5 text-center text-[10px] font-bold leading-4 text-[var(--chat-muted)]">
                {resolvedSecureNotice}
              </div>
              {chatRing.outgoing && String(chatRing.outgoing.thread_id) === String(activeThreadId) ? (
                <div className="px-3 pt-2"><ChatRingStatus outgoing={chatRing.outgoing} onClear={chatRing.clearOutgoing} /></div>
              ) : null}
              <PortalChatMessageList
                messages={visibleMessages}
                highlight={searchQuery}
                fetchLinkPreview={apiAdapter?.linkPreview || null}
                loading={loadingThread}
                labels={{
                  today: t("common.today"),
                  loading: t("employeePortal.chat.admin.openingThread"),
                  empty: t("employeePortal.chat.admin.threadEmpty"),
                  unread: t("employeePortal.chat.unread"),
                  image: t("employeePortal.chat.image"),
                  voice: t("employeePortal.chat.voiceMessage"),
                  file: t("employeePortal.chat.file"),
                  reply: t("employeePortal.chat.admin.reply"),
                }}
                outgoingSenderType="admin"
                outgoingLabel={t("employeePortal.chat.admin.management")}
                incomingLabel={selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || t("employeePortal.chat.admin.employee")}
                timeFormatter={formatMessageTime}
                messagesRef={messagesRef}
                onScroll={onMessagesScroll}
                showJump={showJump}
                jumpCount={unseenBelow}
                onJumpToBottom={scrollToBottom}
                onRetry={retrySend}
                onLoadOlder={loadOlder}
                hasOlder={Boolean(hasOlderByThread[String(activeThreadId)])}
                loadingOlder={loadingOlder}
                typingLabel={typingLabel}
                onImageClick={setImagePreview}
                onReply={allowReply ? setReplyTo : null}
                onForward={apiAdapter?.forwardMessage ? setForwardMessage : null}
                onStar={apiAdapter?.starMessage ? starMessage : null}
                onReact={apiAdapter?.reactMessage ? reactToMessage : null}
                onEdit={apiAdapter?.editMessage ? beginEditMessage : null}
                onDelete={apiAdapter?.deleteMessage ? deleteMessage : null}
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
                editingMessage={editingMessage}
                setEditingMessage={setEditingMessage}
                labels={{
                  outgoingSenderType: "admin",
                  you: t("employeePortal.chat.admin.management"),
                  management: selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || t("employeePortal.chat.admin.employee"),
                  placeholder: t("employeePortal.chat.admin.replyPlaceholder"),
                  attachFile: t("employeePortal.chat.attachFile"),
                  removeAttachment: t("employeePortal.chat.admin.removeAttachment"),
                  recordVoice: t("employeePortal.chat.voiceRecording"),
                  disabledNotice: t("employeePortal.chat.admin.disabledNotice"),
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
                onEditLast={apiAdapter?.editMessage ? () => { const last = [...messages].reverse().find((item) => item.sender_type === "admin" && item.body && !item.deleted_at && item.id); if (last) beginEditMessage(last); } : null}
                disabled={!activeThreadId}
              />
              <PortalChatContactInfo
                open={contactInfoOpen}
                onClose={() => setContactInfoOpen(false)}
                contact={{
                  name: selectedEmployeeRecord.full_name || selectedEmployeeRecord.employee_name || employeeFallback,
                  phone: selectedEmployeeRecord.phone || selectedEmployeeRecord.mobile || "",
                  avatar: resolveEmployeeProfileImageUrl(selectedEmployeeRecord.photo_url || selectedEmployeeRecord.image_url || ""),
                  about: selectedEmployeeRecord.branch_name || t("employeePortal.chat.admin.staffAbout"),
                }}
                messages={messages}
                onSearch={() => window.setTimeout(() => messageSearchRef.current?.focus?.(), 30)}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-[var(--muted)]">
              {t("employeePortal.chat.admin.pickEmployee")}
            </div>
          )}
        </div>

        {currentPanel ? (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-3 2xl:block">
            {currentPanel}
          </aside>
        ) : null}
      </div>
      <ChatMediaViewer
        open={Boolean(imagePreview)}
        initialUrl={imagePreview}
        messages={messages}
        onClose={() => setImagePreview("")}
        senderLabel={(message) => (message.sender_type === "admin" ? t("employeePortal.chat.admin.management") : (selectedEmployeeRecord?.full_name || selectedEmployeeRecord?.employee_name || t("employeePortal.chat.admin.employee")))}
        timeFormatter={formatChatDateTime}
      />
      {forwardMessage ? (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" dir={i18nInstance.dir()}>
          <button type="button" className="absolute inset-0" onClick={() => !forwarding && setForwardMessage(null)} aria-label={t("common.close")} />
          <div className="relative flex max-h-[78dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[1.75rem] border border-[var(--chat-border)] bg-[var(--chat-chrome)] text-[var(--chat-text)] shadow-2xl sm:rounded-[1.75rem]">
            <div className="flex items-center justify-between border-b border-[var(--chat-border)] px-4 py-3">
              <div><div className="text-base font-black">{t("employeePortal.chat.admin.forward.title")}</div><div className="mt-0.5 text-xs text-[var(--chat-muted)]">{t("employeePortal.chat.admin.forward.subtitle")}</div></div>
              <button type="button" onClick={() => setForwardMessage(null)} disabled={forwarding} className="grid h-[var(--control-height-md)] w-9 place-items-center rounded-full hover:bg-[var(--surface-hover)]"><X className="h-5 w-5" /></button>
            </div>
            <label className="mx-3 mt-3 flex h-11 items-center gap-2 rounded-full bg-[var(--chat-input)] px-3 text-[var(--chat-muted)]">
              <Search className="h-4 w-4" /><input autoFocus value={forwardSearch} onChange={(event) => setForwardSearch(event.target.value)} placeholder={t("employeePortal.chat.admin.forward.search")} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--chat-text)] outline-none" />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {forwardTargets.length ? forwardTargets.map(({ employee, thread: targetThread }) => (
                <button key={targetThread.id} type="button" disabled={forwarding} onClick={() => forwardToThread(targetThread.id)} className="mb-2 flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-[var(--chat-input)] p-3 text-start transition hover:bg-[var(--surface-hover)] disabled:opacity-50">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]"><UserRound className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-black" dir="auto">{employee?.full_name || employee?.employee_name || targetThread.employee_name || employeeFallback}</span><span className="mt-1 block truncate text-xs text-[var(--chat-muted)]">{employee?.branch_name || targetThread.branch_name || t("employeePortal.chat.admin.noBranch")}</span></span>
                  {forwarding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </button>
              )) : <div className="py-8 text-center text-sm font-bold text-[var(--chat-muted)]">{t("employeePortal.chat.admin.forward.empty")}</div>}
            </div>
          </div>
        </div>
      ) : null}
    </section>
    </>
  );
}

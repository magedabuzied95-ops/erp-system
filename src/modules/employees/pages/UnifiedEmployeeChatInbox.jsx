import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import SharedPortalChat from "../../../shared/chat/SharedPortalChat";
import { subscribeRealtime } from "../../../shared/realtime/socketStore";
import { socket } from "../../../socket";
import { getAttendanceEmployees } from "../../attendance/attendanceApi";

const safeArray = (value) => (Array.isArray(value) ? value : []);

export default function UnifiedEmployeeChatInbox({
  selectedEmployee = null,
  selectedEmployeeId = "",
  onSelectedEmployeeChange = null,
}) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  // Holds either OUR key or the raw server message, so a language switch relabels
  // a banner that is already on screen.
  const [error, setError] = useState({ key: "", text: "" });
  const errorMessage = error.key ? t(error.key) : error.text;

  useEffect(() => {
    let active = true;
    getAttendanceEmployees({ search: "" })
      .then((response) => {
        if (active) setEmployees(safeArray(response));
      })
      .catch((err) => {
        if (active) {
          const text = err?.responseBody?.message || err?.message || "";
          setError({ key: text ? "" : "employeePortal.chat.admin.errors.loadEmployees", text });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const apiAdapter = useMemo(() => ({
    listThreads: () => api.get("/employees/chat/threads"),
    getThread: (threadId) => api.get(`/employees/chat/threads/${encodeURIComponent(threadId)}`),
    sendMessage: (threadId, formData) => api.post(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages`, formData),
    forwardMessage: (messageId, targetThreadId) => api.post(`/employees/chat/messages/${encodeURIComponent(messageId)}/forward`, { target_thread_id: targetThreadId }),
    reactMessage: (messageId, emoji) => api.post(`/employees/chat/messages/${encodeURIComponent(messageId)}/reaction`, { emoji }),
    starMessage: (messageId) => api.post(`/employees/chat/messages/${encodeURIComponent(messageId)}/star`, {}),
    listStarred: () => api.get("/employees/chat/starred"),
    updatePrefs: (threadId, prefs) => api.patch(`/employees/chat/threads/${encodeURIComponent(threadId)}/prefs`, prefs),
    markDelivered: (threadId, upToMessageId) => api.post(`/employees/chat/threads/${encodeURIComponent(threadId)}/delivered`, { up_to_message_id: upToMessageId }),
    editMessage: (threadId, messageId, payload) => api.patch(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`, payload),
    deleteMessage: (threadId, messageId) => api.delete(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`),
    markRead: (threadId) => api.patch(`/employees/chat/threads/${encodeURIComponent(threadId)}/read`, {}),
    ring: (threadId) => api.post(`/employees/chat/threads/${encodeURIComponent(threadId)}/ring`, {}),
    answerRing: (threadId, messageId) => api.post(`/employees/chat/threads/${encodeURIComponent(threadId)}/ring/${encodeURIComponent(messageId)}/answer`, {}),
    emitTyping: (payload) => socket.emit("employee-chat:typing", payload),
    emitStopTyping: (payload) => socket.emit("employee-chat:stop-typing", payload),
    subscribe: (handlers = {}) => {
      const subscriptions = [
        subscribeRealtime("employee-chat:new-message", handlers.onMessage),
        subscribeRealtime("employee-chat:thread-updated", handlers.onThread),
        subscribeRealtime("employee-chat:read", handlers.onRead),
        subscribeRealtime("employee-chat:message-updated", handlers.onMutation),
        subscribeRealtime("employee-chat:message-deleted", handlers.onMutation),
        subscribeRealtime("employee-chat:typing", handlers.onTyping),
        subscribeRealtime("employee-chat:stop-typing", handlers.onStopTyping),
        subscribeRealtime("employee-chat:ring", handlers.onRing),
        subscribeRealtime("employee-chat:ring-answered", handlers.onRingAnswered),
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe?.());
    },
  }), []);

  return (
    <div className="space-y-3">
      {errorMessage ? <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{errorMessage}</div> : null}
      <SharedPortalChat
        apiAdapter={apiAdapter}
        employees={employees}
        selectedEmployee={selectedEmployee}
        selectedEmployeeId={selectedEmployeeId}
        onSelectedEmployeeChange={onSelectedEmployeeChange}
        headerKicker={t("employeePortal.chat.admin.headerKickerManagement")}
        className="xl:h-[calc(100dvh-12rem)]"
        pollMs={12000}
      />
    </div>
  );
}

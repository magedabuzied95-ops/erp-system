import { useEffect, useMemo, useState } from "react";

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
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAttendanceEmployees({ search: "" })
      .then((response) => {
        if (active) setEmployees(safeArray(response));
      })
      .catch((err) => {
        if (active) setError(err?.responseBody?.message || err?.message || "تعذر تحميل الموظفين");
      });
    return () => {
      active = false;
    };
  }, []);

  const apiAdapter = useMemo(() => ({
    listThreads: () => api.get("/employees/chat/threads"),
    getThread: (threadId) => api.get(`/employees/chat/threads/${encodeURIComponent(threadId)}`),
    sendMessage: (threadId, formData) => api.post(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages`, formData),
    editMessage: (threadId, messageId, payload) => api.patch(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`, payload),
    deleteMessage: (threadId, messageId) => api.delete(`/employees/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`),
    markRead: (threadId) => api.patch(`/employees/chat/threads/${encodeURIComponent(threadId)}/read`, {}),
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
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe?.());
    },
  }), []);

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</div> : null}
      <SharedPortalChat
        apiAdapter={apiAdapter}
        employees={employees}
        selectedEmployee={selectedEmployee}
        selectedEmployeeId={selectedEmployeeId}
        onSelectedEmployeeChange={onSelectedEmployeeChange}
        headerTitle="محادثات الموظفين"
        headerKicker="الإدارة / المحادثات"
        secureNotice="هذه المحادثة خاصة بين الموظف والإدارة"
        className="xl:h-[calc(100dvh-12rem)]"
        pollMs={12000}
      />
    </div>
  );
}

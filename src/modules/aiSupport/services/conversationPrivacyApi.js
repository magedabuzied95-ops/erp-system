import { api } from "../../../shared/api/api";

// Conversation privacy (owner only). The server is the authority: both endpoints
// are admin-gated, and a conversation the viewer may not see answers 403 on every
// route. This client only decides whether to DRAW the control.

const path = (conversationId) =>
  `/ai-inbox/conversations/${encodeURIComponent(String(conversationId || ""))}/privacy`;

export const PRIVACY_MODE_EVERYONE = "everyone";
export const PRIVACY_MODE_RESTRICTED = "restricted";

/**
 * Mirrors isAdminAccount on the server (ADMIN_ROLE_NAMES + is_super_admin). Keep
 * the two in step: a role listed here but not there draws a button that 403s.
 */
export const canManageConversationPrivacy = (user = {}) => {
  const role = String(user?.role || user?.role_name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return Boolean(
    user?.is_super_admin === true
      || ["admin", "super_admin", "superadmin", "platform_admin"].includes(role)
  );
};

export const conversationIsPrivate = (conversation = {}) =>
  String(conversation?.privacy_mode ?? "").trim() === PRIVACY_MODE_RESTRICTED;

export const fetchConversationPrivacy = (conversationId) =>
  api.get(path(conversationId), { cache: "no-store" });

export const saveConversationPrivacy = (conversationId, { mode, employeeIds = [] } = {}) =>
  api.put(path(conversationId), { mode, employee_ids: employeeIds });

export const fetchConversationPrivacyEmployees = () =>
  api.get("/ai-inbox/conversation-privacy/employees", { cache: "no-store" });

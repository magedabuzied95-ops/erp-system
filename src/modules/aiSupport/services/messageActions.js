// The local copy of a message after staff edited or deleted it from the inbox.
// Both surfaces (/admin/ai-inbox and /inbox) apply the server's answer to the thread
// they already hold, so the bubble changes on the tap instead of on the next refresh.

const clean = (value = "") => String(value ?? "").trim();

export const isSameInboxMessage = (item = {}, message = {}, targetMessageId = "") => {
  const target = clean(targetMessageId);
  if (message?.id && clean(item?.id) === clean(message.id)) return true;
  if (!target) return false;
  return clean(item?.provider_message_id) === target
    || clean(item?.external_message_id) === target
    || clean(item?.id) === target;
};

export const applyInboxMessageEdit = (item = {}, payload = {}, text = "") => {
  const nextText = clean(payload?.text) || clean(text);
  return {
    ...item,
    message_text: nextText,
    text: nextText,
    body: item.body ? nextText : item.body,
    content: item.content ? nextText : item.content,
    staff_message: item.staff_message ? nextText : item.staff_message,
    ai_answer: item.ai_answer ? nextText : item.ai_answer,
    edited_at: payload?.edited_at || new Date().toISOString(),
    edit_scope: payload?.edit_scope || payload?.scope || item.edit_scope || null,
    edit_history: Array.isArray(payload?.edit_history) ? payload.edit_history : item.edit_history,
    original_message_text: clean(payload?.original_message_text) || item.original_message_text || clean(payload?.previous_text),
  };
};

export const applyInboxMessageDelete = (item = {}, payload = {}, scope = "inbox") => ({
  ...item,
  deleted_at: payload?.deleted_at || new Date().toISOString(),
  deleted_scope: payload?.deleted_scope || scope,
});

// What the toast says, from the scope the server actually applied — an edit asked
// for without a scope lands on the customer's phone only when WhatsApp allowed it.
export const messageEditToast = (payload = {}) =>
  (payload?.edit_scope || payload?.scope) === "everyone"
    ? "تم تعديل الرسالة عند العميل"
    : "تم تعديل الرسالة في الإنبوكس بس";

export const messageDeleteToast = (payload = {}) =>
  payload?.deleted_scope === "everyone"
    ? "تم حذف الرسالة عند الجميع"
    : "تم حذف الرسالة من الإنبوكس";

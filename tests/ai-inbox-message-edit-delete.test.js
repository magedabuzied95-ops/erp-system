import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyInboxMessageDelete,
  applyInboxMessageEdit,
  isSameInboxMessage,
  messageDeleteToast,
  messageEditToast,
} from "../src/modules/aiSupport/services/messageActions.js";

// Some sources are CRLF; the slices below look for "\n});\n" and "\n};\n".
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const routes = read("server/routes/aiAgentOrders.js");
const agent = read("server/services/aiSalesAgentService.js");
const logService = read("server/services/aiSupportLogService.js");
const transcript = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");
const en = JSON.parse(read("src/locales/en/aiSupport.json"));
const ar = JSON.parse(read("src/locales/ar/aiSupport.json"));

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  return source.slice(from, source.indexOf(end, from + start.length));
};

test("the new columns are added by the ensure bootstrapStartup awaits, metadata-only", () => {
  const ddl = between(agent, "ALTER TABLE IF EXISTS ai_support_messages\n          ADD COLUMN IF NOT EXISTS deleted_at", "`);");
  for (const column of ["deleted_at TIMESTAMPTZ NULL", "deleted_by BIGINT NULL", "deleted_scope TEXT NULL", "edited_by BIGINT NULL", "edit_scope TEXT NULL", "edit_history JSONB NULL"]) {
    assert.ok(ddl.includes(column), column);
  }
  assert.doesNotMatch(ddl, /DEFAULT/);
  assert.match(read("server/server.js"), /await ensureAiSalesAgentSchema\(db\)/);
});

test("an edit keeps every replaced text with the moment it was replaced", () => {
  const fn = between(logService, "export const recordAiSupportMessageEdit", "\n};\n");
  assert.match(fn, /edit_history = COALESCE\(edit_history, '\[\]'::jsonb\) \|\| jsonb_build_array\(\$5::jsonb\)/);
  assert.match(fn, /replaced_at: new Date\(\)\.toISOString\(\)/);
  assert.match(fn, /edited_at = CURRENT_TIMESTAMP/);
  assert.match(fn, /original_message_text = CASE WHEN original_message_text = '' THEN \$4::text ELSE original_message_text END/);
  assert.match(fn, /AND deleted_at IS NULL/);
});

test("a provider echo or re-import cannot overwrite an edited text", () => {
  const updateSql = between(logService, "const updateSql = `", "`;");
  for (const [column, param] of [["message_text", 6], ["customer_message", 7], ["ai_answer", 8], ["staff_message", 17]]) {
    assert.ok(updateSql.includes(`${column} = CASE WHEN edited_at IS NULL THEN $${param} ELSE ${column} END`), column);
  }
});

test("a delete is soft and marks every copy of the message identity", () => {
  const fn = between(logService, "export const markAiSupportMessageDeleted", "\n};\n");
  assert.doesNotMatch(fn, /DELETE FROM/);
  assert.match(fn, /SET deleted_at = COALESCE\(deleted_at, CURRENT_TIMESTAMP\)/);
  // The transcript de-duplicates by identity and shows the newest copy, so marking
  // only the one row would let a duplicate stand in for it.
  assert.match(fn, /OR provider_message_id = ANY\(\$6::text\[\]\)/);
  assert.match(fn, /OR message_identity_key = ANY\(\$6::text\[\]\)/);
});

test("the customer's phone changes only through WhatsApp, and only after it accepts", () => {
  const edit = between(routes, `router.post("/conversations/:conversationId/message/edit"`, "\n});\n");
  assert.ok(edit.indexOf("editWhatsappTextMessage(") < edit.indexOf("recordAiSupportMessageEdit("), "edit stored after WhatsApp accepted");
  assert.match(edit, /const scope = requestedScope === "inbox" \|\| !reachesCustomer \? "inbox" : "everyone";/);
  assert.match(edit, /if \(scope === "everyone"\) \{\n\s+await editWhatsappTextMessage/);
  // No channel is refused any more: Messenger and Instagram edit the inbox copy.
  assert.doesNotMatch(edit, /Editing a sent message is only supported on WhatsApp/);

  const del = between(routes, `router.post("/conversations/:conversationId/message/delete"`, "\n});\n");
  assert.match(del, /protect, inboxReply\(\)/);
  assert.ok(del.indexOf("deleteWhatsappMessageForEveryone(") < del.indexOf("markAiSupportMessageDeleted("), "recall before marking");
  assert.match(del, /Date\.now\(\) - action\.sentAtMs > WHATSAPP_DELETE_WINDOW_MS/);
  assert.match(del, /if \(!action\.outbound\)/);
});

test("the inbox payload never shows a deleted message's text, media or cards", () => {
  const fn = between(agent, "export const normalizeInboxMessage", "\n};\n");
  assert.match(fn, /const row = rawRow\.deleted_at/);
  assert.match(fn, /visual_attachments: \[\]/);
  assert.match(fn, /product_cards: \[\]/);
  assert.match(fn, /deleted_at: row\.deleted_at \|\| null/);
  assert.match(fn, /edit_history: asArray\(row\.edit_history\)/);
  // The list preview spreads the SESSION row; its deleted_at is a deleted thread, not this message.
  assert.match(agent, /deleted_at: conversation\.latest_message_deleted_at \|\| null/);
  assert.match(agent, /msg\.deleted_at AS latest_message_deleted_at/);
});

test("both surfaces offer edit and delete on every channel, behind the reply permission", () => {
  assert.match(desktop, /onEditMessage=\{canReply \? editMessage : null\}/);
  assert.match(desktop, /onDeleteMessage=\{canReply \? deleteMessage : null\}/);
  assert.match(pwa, /onEditMessage=\{canReply \? editMessage : null\}/);
  assert.match(pwa, /onDeleteMessage=\{canReply \? deleteMessage : null\}/);
  for (const source of [desktop, pwa]) {
    assert.match(source, /"\/message\/delete"/);
    assert.match(source, /applyInboxMessageDelete\(item, payload, scope\)/);
    assert.match(source, /applyInboxMessageEdit\(item, payload, text\)/);
  }
});

test("the bubble shows when it was edited, its history, and a deleted placeholder", () => {
  assert.match(transcript, /t\("aiSupport\.inbox\.message\.editedAt", \{ time: actionStamp\(message\.edited_at\) \}\)/);
  assert.match(transcript, /data-ai-message-edit-history="true"/);
  assert.match(transcript, /if \(message\.deleted_at\) \{/);
  assert.match(transcript, /data-ai-message-deleted="true"/);
  // "Delete for everyone" is only offered where WhatsApp can actually recall it.
  const gate = between(transcript, "const canDeleteForEveryone = canDelete", ";\n");
  for (const part of ["whatsappThread", "outbound", "!isNote", "MESSAGE_DELETE_FOR_EVERYONE_WINDOW_MS"]) assert.ok(gate.includes(part), part);
  assert.match(transcript, /prev\.onDeleteMessage === next\.onDeleteMessage/);
});

test("the local thread applies the server's answer", () => {
  const original = { id: 7, provider_message_id: "wamid.1", staff_message: "بكام؟", message_text: "بكام؟" };
  assert.ok(isSameInboxMessage(original, {}, "wamid.1"));
  assert.ok(isSameInboxMessage(original, { id: 7 }, ""));
  assert.ok(!isSameInboxMessage(original, { id: 8 }, "wamid.2"));

  const history = [{ text: "بكام؟", replaced_at: "2026-09-15T10:00:00.000Z", scope: "inbox" }];
  const edited = applyInboxMessageEdit(original, { text: "السعر 500", edited_at: "2026-09-15T10:00:00.000Z", edit_scope: "inbox", edit_history: history, original_message_text: "بكام؟" }, "السعر 500");
  assert.equal(edited.staff_message, "السعر 500");
  assert.equal(edited.message_text, "السعر 500");
  assert.equal(edited.edited_at, "2026-09-15T10:00:00.000Z");
  assert.deepEqual(edited.edit_history, history);
  assert.equal(edited.original_message_text, "بكام؟");
  assert.equal(edited.ai_answer, undefined, "a staff message does not grow an AI answer");

  const deleted = applyInboxMessageDelete(original, { deleted_at: "2026-09-15T11:00:00.000Z", deleted_scope: "everyone" }, "everyone");
  assert.equal(deleted.deleted_at, "2026-09-15T11:00:00.000Z");
  assert.equal(deleted.deleted_scope, "everyone");

  assert.match(messageEditToast({ edit_scope: "everyone" }), /عند العميل/);
  assert.match(messageEditToast({ edit_scope: "inbox" }), /الإنبوكس/);
  assert.match(messageDeleteToast({ deleted_scope: "everyone" }), /الجميع/);
});

test("every new string exists in both locales", () => {
  const keys = [
    "editedAt", "editedInboxOnly", "editHintEveryone", "editHintInbox", "editHistory", "editHistoryOriginal",
    "editHistoryCurrent", "editHistoryReplaced", "editHistoryInboxOnly", "editHistoryEveryone", "delete", "deleteTitle",
    "deleteForEveryone", "deleteFromInbox", "deleteEveryoneHint", "deleteInboxHint", "deleteCancel", "deleting",
    "deleted", "deletedInboxOnly",
  ];
  for (const key of keys) {
    for (const [lang, dict] of [["en", en], ["ar", ar]]) {
      const value = dict?.aiSupport?.inbox?.message?.[key] ?? dict?.inbox?.message?.[key];
      assert.ok(typeof value === "string" && value.trim(), `${lang} ${key}`);
    }
  }
  for (const dict of [en, ar]) {
    const message = dict?.aiSupport?.inbox?.message ?? dict.inbox.message;
    assert.match(message.editedAt, /\{\{time\}\}/);
    assert.match(message.editHistoryReplaced, /\{\{time\}\}/);
  }
});

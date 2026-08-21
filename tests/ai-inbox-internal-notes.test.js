import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const logService = readFileSync("server/services/aiSupportLogService.js", "utf8");
const salesService = readFileSync("server/services/aiSalesAgentService.js", "utf8");
const routes = readFileSync("server/routes/aiAgentOrders.js", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const appendManualReply = logService.slice(
  logService.indexOf("export const appendManualAiSupportReply"),
  logService.indexOf("export const", logService.indexOf("export const appendManualAiSupportReply") + 40)
);
const sendManualReply = desktop.slice(
  desktop.indexOf("const sendManualReply = async"),
  desktop.indexOf("const sendCurrentReply = async")
);
const composer = desktop.slice(
  desktop.indexOf("function ManualReplyComposer"),
  desktop.indexOf("function ReplyCorrectionModal")
);

test("a stored note is distinguishable from a sent reply", () => {
  // The route has always answered delivery_status "internal_note" while writing
  // sender_type 'staff' / message_type 'text'. The note therefore looked like a
  // note in the composer and like a message sent to the customer after reload.
  assert.match(appendManualReply, /messageType: internalNote \? "internal_note" : messageType/);
  assert.match(appendManualReply, /senderType: internalNote \? "note" : "staff"/);
  assert.match(routes, /internalNote: true,/);
});

test("writing a note does not take the conversation over", () => {
  // A staff-only note used to flip the session to human_takeover, which pauses
  // the AI. Jotting "customer wants size 42" must not stop the assistant.
  assert.match(appendManualReply, /sessionStatus: internalNote \? "ai_active" : "human_takeover"/);
  assert.match(appendManualReply, /preserveSessionState: internalNote/);
  // And preserve means preserve: an existing takeover must survive the note too,
  // so the upsert reads the stored status rather than the incoming one.
  assert.match(logService, /WHEN \$10::boolean THEN ai_support_sessions\.status/);
});

test("a note never becomes the conversation preview", () => {
  // Two separate writes used to publish the private text: the upsert's
  // last_message, and a second UPDATE that forces it past the COALESCE.
  assert.match(logService, /WHEN \$10::boolean THEN ai_support_sessions\.last_message/);
  assert.match(logService, /if \(upsertSession && !internalNote && safeTenantId && safeSessionId\)/);

  // And a third path: the list reads its preview from the latest-message
  // lateral, which would happily return the note.
  const laterals = [];
  for (let at = salesService.indexOf(") m ON TRUE"); at !== -1; at = salesService.indexOf(") m ON TRUE", at + 1)) {
    const from = salesService.lastIndexOf("FROM ai_support_messages msg", at);
    if (from !== -1) laterals.push(salesService.slice(from, at));
  }
  assert.ok(laterals.length >= 2, `expected the latest-message laterals, found ${laterals.length}`);
  for (const lateral of laterals) {
    assert.match(lateral, /COALESCE\(msg\.message_type, ''\) <> 'internal_note'/);
    assert.match(lateral, /COALESCE\(msg\.sender_type, ''\) <> 'note'/);
  }
});

test("the desktop composer can write a note at all", () => {
  // The PWA has had note mode since it was written; the desktop workspace —
  // where these notes actually get typed — had no way to record one.
  assert.match(desktop, /const \[composerMode, setComposerMode\] = useState\("reply"\)/);
  assert.match(composer, /aiSupport\.inbox\.composer\.modeNote/);
  assert.match(composer, /onComposerModeChange\?\.\(key\)/);
  assert.equal((desktop.match(/composerMode=\{composerMode\}/g) || []).length, 2, "both composer call sites must pass the mode");
});

test("the desktop note takes the note route, not the send route", () => {
  assert.match(sendManualReply, /const isNote = options\.mode === "note" \|\| \(!options\.mode && composerMode === "note"\)/);
  assert.match(sendManualReply, /isNote\s*\?\s*await api\.post\(aiInboxConversationEndpoint\([^)]*, "\/reply"\)/);
  // A note is never transmitted, so a "this reply looks risky" prompt about it
  // is nonsense, and there is no AI draft to record a correction against.
  assert.match(sendManualReply, /if \(!isNote && warningCount > 0\)/);
  assert.match(sendManualReply, /if \(isNote\) \{/);
  // The optimistic bubble must not advertise the note in the list preview.
  assert.match(sendManualReply, /\.\.\.\(isNote \? \{\} : \{ latest_message_preview: message \}\)/);
});

test("note mode does not depend on the channel being live", () => {
  // A note is stored locally, so an operator can record one on a conversation
  // whose channel cannot currently send.
  assert.match(composer, /disabled=\{loading \|\| !clean\(value\) \|\| slashCommandActive \|\| \(!noteMode && !canSendLive\)\}/);
});

test("every new composer string exists in both locales", () => {
  for (const key of ["modeReply", "modeNote", "modeGroup", "writeInternalNote", "saveNote", "saveNoteTitle", "sendNow", "sendCommentReply", "sendCommentReplyTitle", "noteSaved", "readOnly"]) {
    assert.ok(en.inbox.composer[key], `en is missing aiSupport.inbox.composer.${key}`);
    assert.ok(ar.inbox.composer[key], `ar is missing aiSupport.inbox.composer.${key}`);
  }
});

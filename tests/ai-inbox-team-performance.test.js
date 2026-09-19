import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const service = read("server/services/aiInboxTeamPerformanceService.js");
const logService = read("server/services/aiSupportLogService.js");
const routes = read("server/routes/aiAgentOrders.js");
const panel = read("src/modules/aiSupport/components/controlCenter/TeamPerformancePanel.jsx");

test("attribution comes from message rows, never from the session's assigned_user_id", () => {
  // `assigned_user_id` means "currently held by": updateAiSupportConversationState nulls it the
  // moment a conversation goes back to the AI, so it cannot answer "who handled this last month".
  assert.match(
    logService,
    /assigned_user_id = CASE\s*\n\s*WHEN EXCLUDED\.status = 'human_takeover' THEN COALESCE\(EXCLUDED\.assigned_user_id, ai_support_sessions\.assigned_user_id\)\s*\n\s*ELSE NULL/
  );
  assert.match(service, /m\.staff_user_id IS NOT NULL/);
  assert.doesNotMatch(service.slice(service.indexOf("WITH staff_messages")), /assigned_user_id/);
});

test("a person's first reply is measured against the customer message it answers", () => {
  // The pre-existing metric averaged `message.created_at - session.created_at`, which grows with the
  // conversation's age and is not a reply latency at all.
  assert.match(service, /LEFT JOIN LATERAL/);
  assert.match(service, /COALESCE\(m\.customer_message, ''\) <> ''/);
  assert.match(service, /m\.created_at <= f\.created_at/);
  assert.match(service, /ORDER BY m\.created_at DESC/);
});

test("one row per person per conversation, so a chatty thread cannot inflate the average", () => {
  assert.match(service, /SELECT DISTINCT ON \(session_id, staff_user_id\)/);
  assert.match(service, /COUNT\(DISTINCT w\.session_id\) AS conversations_handled/);
});

test("stale replies are excluded and the exclusion is reported, not hidden", () => {
  assert.match(service, /RESPONSE_OUTLIER_CAP_SECONDS = 24 \* 60 \* 60/);
  assert.match(service, /excluded_conversations/);
  assert.match(panel, /performance\.excluded/);
});

test("deleted messages and conversations are left out of every count", () => {
  const deletedGuards = service.match(/deleted_at IS NULL/g) || [];
  assert.ok(deletedGuards.length >= 3, `expected the guard on each read, found ${deletedGuards.length}`);
});

test("the report ships with the index it needs", () => {
  // ai_support_messages had indexes on tenant/created_at and session/created_at, but none on the
  // staff column this groups by.
  assert.match(service, /CREATE INDEX IF NOT EXISTS idx_ai_support_messages_staff_created/);
  assert.match(service, /WHERE staff_user_id IS NOT NULL/);
});

test("a missing range defaults to the last 30 days rather than the whole table", () => {
  assert.match(service, /29 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(service, /Invalid date range/);
});

test("the endpoint is read-only and permission gated", () => {
  assert.match(routes, /router\.get\("\/analytics\/team-performance", protect, permit\("settings", "view"\)/);
  assert.match(routes, /loadInboxTeamPerformance\(\{/);
});

test("the panel reads durations in the unit a person thinks in", () => {
  assert.match(panel, /performance\.seconds/);
  assert.match(panel, /performance\.minutes/);
  assert.match(panel, /performance\.hours/);
});

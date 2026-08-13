// Phase 13.2 — MONOTONIC AI-draft reconciliation. A completed assisted send clears the server draft to a
// versioned TOMBSTONE (status "sent" + completed source_message_id). No stale list / socket / cache payload may
// resurrect a completed suggestion. The reconcile rule (extracted here as a pure mirror of the AiInbox helper):
//   1. newer source_message_id wins  2. same src: completed beats pending  3. else newer timestamp wins.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");
const routeSrc = read("server/routes/aiAgentOrders.js");
const stateSrc = read("server/services/aiSupportLogService.js");

// Pure mirror of reconcileConversationDraft (kept identical to the source; the source-contract test below pins it).
const draftMetaOf = (row) => {
  const d = row?.ai_reply_draft || row?.last_ai_reply_draft || null;
  const src = Number(d?.metadata?.source_message_id || d?.source_message_id || 0) || 0;
  const status = String(d?.status || "").toLowerCase();
  const t = row?.last_ai_reply_draft_updated_at || d?.updated_at || "";
  const ts = t ? new Date(t).getTime() : 0;
  return { src, completed: status === "sent" || status === "cleared", ts: Number.isFinite(ts) ? ts : 0 };
};
const reconcile = (existing, incoming) => {
  const e = draftMetaOf(existing), i = draftMetaOf(incoming);
  let w;
  if (i.src !== e.src) w = i.src > e.src ? incoming : existing;
  else if (i.completed !== e.completed) w = i.completed ? incoming : existing;
  else w = i.ts >= e.ts ? incoming : existing;
  return w;
};
const pending = (src, ts) => ({ last_ai_reply_draft: { status: "not_sent", text: "منتج...", metadata: { source_message_id: src } }, last_ai_reply_draft_updated_at: ts });
const tombstone = (src, ts) => ({ last_ai_reply_draft: { status: "sent", text: "", metadata: { source_message_id: src } }, last_ai_reply_draft_updated_at: ts });
const isActionable = (row) => { const m = draftMetaOf(row); const d = row?.last_ai_reply_draft; return !m.completed && Boolean(String(d?.text || "")); };

test("A: completion X then a stale list refresh carrying pending X → X stays hidden", () => {
  const local = tombstone(100, "2026-08-12T23:57:09Z"); // optimistic tombstone after approve
  const staleList = pending(100, "2026-08-12T23:56:00Z"); // list row fetched before the clear
  assert.equal(isActionable(reconcile(local, staleList)), false);
});

test("B: completion X then a stale socket payload with pending X → X stays hidden (same src, completed wins)", () => {
  const local = tombstone(100, "2026-08-12T23:57:09Z");
  const socket = pending(100, "2026-08-12T23:57:09Z"); // even same timestamp → completed wins on same src
  assert.equal(isActionable(reconcile(local, socket)), false);
});

test("C: completion X then cached page with pending X (switch away/back) → X stays hidden", () => {
  const cached = pending(100, "2026-08-12T23:50:00Z");
  const authoritative = tombstone(100, "2026-08-12T23:57:09Z");
  // whichever order they merge, the completed tombstone wins
  assert.equal(isActionable(reconcile(cached, authoritative)), false);
  assert.equal(isActionable(reconcile(authoritative, cached)), false);
});

test("D: completion X then fresh server load carrying the tombstone → X stays hidden", () => {
  const local = tombstone(100, "2026-08-12T23:57:09Z");
  const fresh = tombstone(100, "2026-08-12T23:57:12Z");
  assert.equal(isActionable(reconcile(local, fresh)), false);
});

test("E: completion X then a NEW inbound Y → fresh not_sent Y APPEARS (newer source_message_id wins)", () => {
  const local = tombstone(100, "2026-08-12T23:57:09Z");
  const newDraftY = pending(140, "2026-08-12T23:59:00Z");
  const w = reconcile(local, newDraftY);
  assert.equal(isActionable(w), true);
  assert.equal(draftMetaOf(w).src, 140);
});

test("null/absent incoming draft cannot revive a completed X (src 0 loses to completed X)", () => {
  const local = tombstone(100, "2026-08-12T23:57:09Z");
  const empty = { last_ai_reply_draft: null, last_ai_reply_draft_updated_at: "" };
  assert.equal(isActionable(reconcile(local, empty)), false);
});

// ---- source-contract: the shipped code matches this rule + the server defenses ----
test("the AiInbox list merge applies monotonic reconciliation (not a blind ...summary overwrite)", () => {
  assert.match(inboxSrc, /\.\.\.reconcileConversationDraft\(existing, summary\),/);
  assert.match(inboxSrc, /if \(i\.src !== e\.src\) winner = i\.src > e\.src \? incoming : existing;/);
  assert.match(inboxSrc, /else if \(i\.completed !== e\.completed\) winner = i\.completed \? incoming : existing;/);
});

test("F: server clears to a VERSIONED tombstone (status sent + source_message_id + cleared_at), not {}", () => {
  assert.match(stateSrc, /jsonb_build_object\(\s*'status', 'sent',[\s\S]*?'source_message_id', \$3::text,[\s\S]*?'cleared_at', to_jsonb\(NOW\(\)\)/);
});

test("F/8: a repeat assisted approve with NO current draft is rejected (NO_CURRENT_DRAFT) — never a manual send", () => {
  assert.match(routeSrc, /if \(req\.body\?\.assisted_approval === true && !hasCurrentDraft\) \{[\s\S]*?code: "NO_CURRENT_DRAFT", reason: "already_completed"/);
  // it returns BEFORE the manual-vs-assisted send path
  const guardIdx = routeSrc.indexOf('code: "NO_CURRENT_DRAFT"');
  const manualIdx = routeSrc.indexOf('status: "human_takeover", assignedUserId');
  assert.ok(guardIdx > 0 && manualIdx > guardIdx, "the NO_CURRENT_DRAFT guard precedes the manual send path");
});

test("G: the optimistic clear writes a completed tombstone carrying the approved source_message_id", () => {
  assert.match(inboxSrc, /const completedTombstone = \{ status: "sent", text: "", source_message_id: suggestionSourceId \|\| null/);
});

test("completion invariant: a completed/cleared draft is never actionable in the UI gate", () => {
  assert.match(inboxSrc, /const draftCompleted = \["sent", "cleared"\]\.includes\(String\(activeAiReplyDraft\?\.status \|\| ""\)\.toLowerCase\(\)\);/);
  assert.match(inboxSrc, /const aiSuggestionVisible = Boolean\(activeAiSuggestionText\) && !draftCompleted &&/);
});

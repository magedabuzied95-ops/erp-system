import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideSocialCommentBulkDeletion,
  extractSocialCommentRemovalEvents,
  isGraphObjectMissingError,
  planSocialCommentDeletionReconcile,
} from "../server/services/socialCommentDeletion.js";

/* A comment deleted on Facebook or Instagram used to stay in the inbox forever: the webhook gate
   dropped `verb: "remove"`, and every sync path only ever added rows. The owner opened a post and
   saw comments that were no longer on it. */

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const meta = read("../server/services/metaIntegrationService.js");
const center = read("../server/services/socialCommentsCenterService.js");
const automation = read("../server/services/socialCommentAutomationService.js");
const workspace = read("../src/modules/aiSupport/components/SocialCommentsWorkspace.jsx");

const feedChange = (value) => ({ object: "page", entry: [{ id: "109139174713691", changes: [{ field: "feed", value }] }] });

test("a Facebook comment removal is read out of the feed webhook", () => {
  const events = extractSocialCommentRemovalEvents({
    body: feedChange({ item: "comment", verb: "remove", comment_id: "111_222", post_id: "109139174713691_111", parent_id: "109139174713691_111" }),
  });
  assert.deepEqual(events, [{ platform: "facebook", comment_id: "111_222", post_id: "109139174713691_111", parent_id: "109139174713691_111" }]);
});

test("only a comment's removal counts, and only by the comment's own id", () => {
  assert.deepEqual(extractSocialCommentRemovalEvents({ body: feedChange({ item: "comment", verb: "add", comment_id: "111_222" }) }), []);
  assert.deepEqual(extractSocialCommentRemovalEvents({ body: feedChange({ item: "comment", verb: "edited", comment_id: "111_222" }) }), []);
  // An unliked post: same shape, no comment.
  assert.deepEqual(extractSocialCommentRemovalEvents({ body: feedChange({ item: "reaction", verb: "remove", post_id: "109139174713691_111" }) }), []);
  // A deleted POST must not be read as a deleted comment.
  assert.deepEqual(extractSocialCommentRemovalEvents({ body: feedChange({ item: "status", verb: "remove", post_id: "109139174713691_111" }) }), []);
  // No comment id: the page id in entry.id must never stand in for one.
  assert.deepEqual(extractSocialCommentRemovalEvents({ body: feedChange({ item: "comment", verb: "remove", post_id: "109139174713691_111" }) }), []);
});

test("an Instagram comment removal, if Meta ever sends one, is read too", () => {
  const events = extractSocialCommentRemovalEvents({
    body: { object: "instagram", entry: [{ id: "1784", changes: [{ field: "comments", value: { verb: "remove", id: "1790", media: { id: "1800" } } }] }] },
  });
  assert.deepEqual(events, [{ platform: "instagram", comment_id: "1790", post_id: "1800", parent_id: "" }]);
});

test("only Meta saying 'no such object' reads as a deletion", () => {
  const graph = (error, status = 400) => Object.assign(new Error(error.message || "x"), { status, meta: error });
  assert.equal(isGraphObjectMissingError(graph({ code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID '1_2' does not exist" })), true);
  assert.equal(isGraphObjectMissingError(graph({ code: 100, message: "Object with ID '1_2' does not exist" })), true);
  assert.equal(isGraphObjectMissingError(Object.assign(new Error("Not Found"), { status: 404 })), true);
  // None of these say anything about the comment.
  assert.equal(isGraphObjectMissingError(graph({ code: 4, message: "Application request limit reached" })), false);
  assert.equal(isGraphObjectMissingError(graph({ code: 17, message: "User request limit reached" })), false);
  assert.equal(isGraphObjectMissingError(graph({ code: 190, message: "Error validating access token" }, 401)), false);
  assert.equal(isGraphObjectMissingError(graph({ code: 2, message: "An unexpected error has occurred" }, 500)), false);
  assert.equal(isGraphObjectMissingError(graph({ code: 100, message: "Invalid parameter" })), false);
  assert.equal(isGraphObjectMissingError(new Error("fetch failed")), false);
});

test("a comment missing from a COMPLETE listing is checked; nothing is deleted from the list alone", () => {
  const plan = planSocialCommentDeletionReconcile({
    storedRows: [{ comment_id: "111_1" }, { comment_id: "111_2" }, { comment_id: "111_3" }],
    liveIds: ["111_1", "111_3"],
    complete: true,
  });
  assert.deepEqual(plan.toCheck, ["111_2"]);
  assert.deepEqual(plan.toRestore, []);
});

test("a partial listing checks nothing — it cannot tell a missing comment from an unread page", () => {
  const plan = planSocialCommentDeletionReconcile({
    storedRows: [{ comment_id: "111_1" }, { comment_id: "111_2" }],
    liveIds: ["111_1"],
    complete: false,
  });
  assert.deepEqual(plan.toCheck, []);
});

test("the same comment under a sibling object id is still listed", () => {
  // Facebook reports a comment as "<post id>_<comment id>" or "<photo id>_<comment id>".
  const plan = planSocialCommentDeletionReconcile({
    storedRows: [{ comment_id: "109139174713691_555_9001" }, { comment_id: "777_9002" }],
    liveIds: ["555_9001", "888_9002"],
    complete: true,
  });
  assert.deepEqual(plan.toCheck, []);
});

test("a comment marked deleted that is listed again comes back", () => {
  const plan = planSocialCommentDeletionReconcile({
    storedRows: [{ comment_id: "111_1", deleted_at: "2026-09-11T00:00:00Z" }, { comment_id: "111_2", deleted_at: "2026-09-11T00:00:00Z" }],
    liveIds: ["111_1"],
    complete: true,
  });
  assert.deepEqual(plan.toRestore, ["111_1"]);
  assert.deepEqual(plan.toCheck, [], "an already-deleted comment is not asked about again");
});

test("checks are capped, and a comment just confirmed alive is not asked about again", () => {
  const storedRows = Array.from({ length: 60 }, (_, index) => ({ comment_id: `111_${index}` }));
  const plan = planSocialCommentDeletionReconcile({ storedRows, liveIds: [], complete: true, maxChecks: 40, recentlyVerifiedIds: new Set(["111_0"]) });
  assert.equal(plan.toCheck.length, 40);
  assert.equal(plan.toCheck.includes("111_0"), false);
  assert.equal(plan.skippedChecks, 19);
});

/* Production: a post with 195 stored comments and 4 live ones; 40 confirmed gone one by one, then
   the app budget ran dry and the check stalled at 5 a pass with ~146 left. */
const POST = "109139174713691_1145934767769890";
const stalePost = ({ confirmed = 40, unlisted = 146, extra = [] } = {}) => [
  ...Array.from({ length: confirmed }, (_, index) => ({ comment_id: `1145934767769890_${1000 + index}`, post_id: POST, deleted_at: "2026-09-11T00:00:00Z", deleted_reason: "graph_missing" })),
  ...Array.from({ length: unlisted }, (_, index) => ({ comment_id: `1145934767769890_${2000 + index}`, post_id: POST })),
  { comment_id: "1145934767769890_1", post_id: POST },
  ...extra,
];
const LIVE = ["1145934767769890_1"];

test("a post whose unlisted comments proved to be deleted ones gets the rest marked from the listing", () => {
  const plan = planSocialCommentDeletionReconcile({ storedRows: stalePost(), liveIds: LIVE, complete: true, maxChecks: 60, graphPostId: POST });
  assert.equal(plan.priorConfirmed, 40);
  const bulk = decideSocialCommentBulkDeletion({ plan, confirmedDeletedIds: [], confirmedAliveIds: [] });
  assert.equal(bulk.reason, "listing_proven");
  assert.equal(bulk.ids.length, 146, "every unlisted comment on the post, even with zero checks this pass");
  assert.equal(bulk.ids.includes("1145934767769890_1"), false, "a listed comment is never marked");
});

test("no bulk marking without evidence — a fresh post is checked one by one", () => {
  const plan = planSocialCommentDeletionReconcile({ storedRows: stalePost({ confirmed: 0 }), liveIds: LIVE, complete: true, graphPostId: POST });
  assert.equal(decideSocialCommentBulkDeletion({ plan, confirmedDeletedIds: ["1145934767769890_2000"] }).reason, "not_enough_evidence");
  assert.equal(
    decideSocialCommentBulkDeletion({ plan, confirmedDeletedIds: plan.toCheck.slice(0, 5) }).reason,
    "listing_proven",
    "five confirmed this pass are enough"
  );
});

test("only a Graph-confirmed miss is evidence — a webhook removal says nothing about the listing", () => {
  const storedRows = stalePost({ confirmed: 0 }).concat(
    Array.from({ length: 10 }, (_, index) => ({ comment_id: `1145934767769890_${3000 + index}`, post_id: POST, deleted_at: "2026-09-11T00:00:00Z", deleted_reason: "webhook_remove" }))
  );
  const plan = planSocialCommentDeletionReconcile({ storedRows, liveIds: LIVE, complete: true, graphPostId: POST });
  assert.equal(plan.priorConfirmed, 0);
  assert.deepEqual(decideSocialCommentBulkDeletion({ plan }).ids, []);
});

test("one unlisted comment found ALIVE on the post turns bulk marking off", () => {
  const plan = planSocialCommentDeletionReconcile({ storedRows: stalePost(), liveIds: LIVE, complete: true, graphPostId: POST });
  const bulk = decideSocialCommentBulkDeletion({ plan, confirmedDeletedIds: [], confirmedAliveIds: ["1145934767769890_2000"] });
  assert.deepEqual(bulk.ids, []);
  assert.equal(bulk.reason, "unlisted_comment_alive");
  const cached = planSocialCommentDeletionReconcile({
    storedRows: stalePost(), liveIds: LIVE, complete: true, graphPostId: POST, recentlyVerifiedIds: new Set(["1145934767769890_2001"]),
  });
  assert.deepEqual(decideSocialCommentBulkDeletion({ plan: cached }).ids, [], "an alive verdict from an earlier pass counts too");
});

test("bulk marking never touches a comment we hid, or one filed here from another object", () => {
  const plan = planSocialCommentDeletionReconcile({
    storedRows: stalePost({
      extra: [
        { comment_id: "1145934767769890_9001", post_id: POST, hidden_at: "2026-09-10T00:00:00Z" },
        // An ad's dark post / the photo object: never listed on this post while alive.
        { comment_id: "555_9002", post_id: "109139174713691_555" },
      ],
    }),
    liveIds: LIVE,
    complete: true,
    graphPostId: POST,
    maxChecks: 500,
  });
  const bulk = decideSocialCommentBulkDeletion({ plan });
  assert.equal(bulk.ids.includes("1145934767769890_9001"), false, "a hidden comment is absent from the list, not deleted");
  assert.equal(bulk.ids.includes("555_9002"), false);
  assert.equal(plan.toCheck.includes("555_9002"), true, "those still get the one-by-one check");
});

test("a partial listing earns no bulk marking", () => {
  const plan = planSocialCommentDeletionReconcile({ storedRows: stalePost(), liveIds: LIVE, complete: false, graphPostId: POST });
  assert.deepEqual(decideSocialCommentBulkDeletion({ plan }).ids, []);
});

test("the reconcile marks the bulk under its own reason, after the checks", () => {
  const start = meta.indexOf("export const reconcileDeletedSocialCommentsForPost");
  const body = meta.slice(start, meta.indexOf("export const runMetaCommentsPollingScan", start));
  assert.match(body, /decideSocialCommentBulkDeletion\(\{ plan, confirmedDeletedIds: confirmedDeleted, confirmedAliveIds: confirmedAlive \}\)/);
  assert.match(body, /commentIds: bulk\.ids, reason: "graph_unlisted"/);
  assert.match(body, /SELECT comment_id, post_id, deleted_at, deleted_reason, hidden_at/, "the plan needs post_id, the prior verdicts and hidden_at");
});

test("the webhook marks a removed comment (and its replies) deleted", () => {
  const start = meta.indexOf("export const processMetaWebhook");
  assert.ok(start > 0, "processMetaWebhook is gone");
  const body = meta.slice(start, start + 12000);
  assert.match(body, /extractSocialCommentRemovalEvents\(\{ body: payload \}\)/, "the webhook no longer reads removals");
  assert.match(body, /markSocialCommentsDeleted\(\{[\s\S]{0,200}reason: "webhook_remove",[\s\S]{0,40}includeReplies: true/);
});

test("the reconcile deletes only what Graph confirmed missing, one by one", () => {
  const start = meta.indexOf("export const reconcileDeletedSocialCommentsForPost");
  assert.ok(start > 0, "the reconcile is gone");
  const body = meta.slice(start, meta.indexOf("export const runMetaCommentsPollingScan", start));
  assert.match(body, /deleted: isGraphObjectMissingError\(error\)/, "a deletion must come from Graph's own answer");
  assert.match(body, /commentIds: confirmedDeleted, reason: "graph_missing"/, "only confirmed ids may be marked");
  assert.doesNotMatch(body, /commentIds: plan\.(toCheck|bulkCandidates)/, "the listing alone must never delete unearned");
});

test("opening a thread runs the deletion check, and the thread skips deleted comments", () => {
  const start = center.indexOf("const listSocialCommentThreadComments = async");
  assert.ok(start > 0);
  const body = center.slice(start, center.indexOf("\n};", start));
  assert.match(body, /reconcileDeletedSocialCommentsForPost\(\{/, "the thread no longer checks for deletions");
  assert.match(body, /source\.deleted_at AS source_deleted_at/, "the inbox copy of a comment must carry its ledger's deletion flag");
  assert.match(body, /if \(row\.source_deleted_at\) continue;/, "a deleted comment's inbox copy still renders");
  assert.match(body, /AND \$\{socialCommentIsLiveRowSql\("source\."\)\}/, "the ledger rows still include deleted comments");
});

test("the post's comment count and the fast list skip deleted comments", () => {
  // The source is CRLF; \s+ spans the \r.
  assert.match(center, /AND \$\{socialCommentIsCommentRowSql\(\)\}\s+AND \$\{socialCommentIsLiveRowSql\(\)\}\s+GROUP BY post_id/, "the count still includes deleted comments");
  assert.match(center, /if \(columns\.has\("deleted_at"\)\) \{\s+whereClauses\.push\(socialCommentIsLiveRowSql\(\)\);/, "the fast list still shows deleted comments");
});

test("production gets deleted_at at BOOT, like hidden_at", () => {
  const start = automation.indexOf("export const ensureSocialCommentVisibilityColumns");
  const body = automation.slice(start, automation.indexOf("\n};", start));
  assert.match(body, /ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL/);
  assert.match(body, /ADD COLUMN IF NOT EXISTS deleted_reason TEXT NULL/);
});

test("the thread opens on the NEWEST comments and 'load older' grows it upwards", () => {
  // It used to render the oldest 50, with the "load older" button revealing newer ones — so a
  // busy post opened on comments the post itself no longer showed.
  assert.match(
    workspace,
    /displayComments\.slice\(Math\.max\(0, displayComments\.length - Math\.max\(50, commentWindowSize\)\)\)/,
    "the window must be the tail of the oldest-first list"
  );
  assert.doesNotMatch(workspace, /displayComments\.slice\(0, Math\.max\(50, commentWindowSize\)\)/);
});

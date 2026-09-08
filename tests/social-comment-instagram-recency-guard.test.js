import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// 2026-09-08, ~14:55 Cairo: the owner commented "Hm?" on an Instagram reel and got
// nothing back — no like, no public reply, no DM. Run 53091 says why:
// action_taken=automation_skipped_old_comment, error_code=old_comment_recency_guard,
// on a comment that was seconds old.
//
// Two defects stacked up:
//  1. An Instagram comments webhook carries NO created_time (value = id/from/text/media),
//     so resolveSocialCommentCreatedTime fell through its chain to `processed_at` —
//     when WE stored the row, never when the author wrote it.
//  2. processed_at was inserted through `$23::timestamp`, which throws away the `Z` on
//     the ISO string. The naive value then landed in a timestamptz column under the
//     session's Africa/Cairo zone, i.e. one whole UTC offset (3h) in the past.
//
// So a brand-new IG comment read as three hours old, past the 30-minute freshness
// window, and every automation step was skipped. Facebook never showed it because its
// feed webhook does carry value.created_time.

const AUTOMATION_SERVICE = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");

const importResolver = async () => {
  const mod = await import("../server/services/socialCommentAutomationService.js");
  return mod.resolveSocialCommentCreatedTime;
};

// The real production row, verbatim: processed_at sits 3h behind detected_at.
const instagramStoredRow = () => ({
  platform: "instagram",
  comment_id: "18024332384909839",
  comment_created_time: "",
  processed_at: "2026-09-08T08:55:39.787Z",
  raw_payload: {
    source: "meta_webhook",
    channel: "instagram_comment",
    comment_created_time: "",
    detected_at: "2026-09-08T11:55:39.734Z",
    value: {
      id: "18024332384909839",
      from: { id: "1777533973455570", username: "maged.abuzied" },
      text: "Hm?",
      media: { id: "18351259309173496", media_product_type: "REELS" },
    },
  },
});

test("an Instagram comment with no created_time resolves to unknown, not to our storage time", async () => {
  const resolveSocialCommentCreatedTime = await importResolver();
  assert.equal(resolveSocialCommentCreatedTime(instagramStoredRow()), "");
});

test("an unknown creation time lets the automation run instead of aging the comment out", () => {
  // maybeSkipOldSocialCommentAutomation's own contract: no created time => run.
  const guard = AUTOMATION_SERVICE.slice(
    AUTOMATION_SERVICE.indexOf("const maybeSkipOldSocialCommentAutomation"),
    AUTOMATION_SERVICE.indexOf("const buildRuntimeContextSnapshot")
  );
  assert.ok(guard.length > 0, "the recency guard must exist");
  assert.match(
    guard,
    /if \(!facebookCreatedAt\) \{\s*return \{ skipped: false, facebookCreatedAt: null, ageMs: null, isOld: false, shouldRunAutomation: true \};/
  );
});

test("Facebook's own created_time still wins over everything else", async () => {
  const resolveSocialCommentCreatedTime = await importResolver();
  assert.equal(
    resolveSocialCommentCreatedTime({
      processed_at: "2026-09-08T08:55:39.787Z",
      raw_payload: { value: { created_time: "2026-09-08T11:55:00+0000" } },
    }),
    "2026-09-08T11:55:00+0000"
  );
  assert.equal(
    resolveSocialCommentCreatedTime({
      comment_created_time: "2026-09-08T11:00:00.000Z",
      processed_at: "2026-09-08T08:55:39.787Z",
    }),
    "2026-09-08T11:00:00.000Z"
  );
});

test("neither created-time resolver may close its fallback chain on processed_at", () => {
  const commentResolver = AUTOMATION_SERVICE.slice(
    AUTOMATION_SERVICE.indexOf("export const resolveSocialCommentCreatedTime"),
    AUTOMATION_SERVICE.indexOf("const resolveSocialCommentPostCreatedTime")
  );
  const postResolver = AUTOMATION_SERVICE.slice(
    AUTOMATION_SERVICE.indexOf("const resolveSocialCommentPostCreatedTime"),
    AUTOMATION_SERVICE.indexOf("const resolveSocialCommentPostCreatedTime") + 700
  );
  assert.ok(commentResolver.length > 0 && postResolver.length > 0);
  assert.doesNotMatch(commentResolver, /processed_at/);
  assert.doesNotMatch(postResolver, /processed_at/);
});

test("processed_at is inserted as timestamptz so the UTC offset survives", () => {
  // `'...Z'::timestamp` silently drops the zone; the naive value is then read in the
  // session zone (Africa/Cairo), putting every stored instant 3 hours in the past.
  const code = AUTOMATION_SERVICE.split(/\r?\n/).filter((line) => !line.trim().startsWith("//"));
  const naiveCasts = code.filter((line) => /::timestamp(?!tz)/.test(line));
  assert.deepEqual(naiveCasts, [], "no timestamptz column may be fed through a naive ::timestamp cast");
  assert.match(AUTOMATION_SERVICE, /\$23::timestamptz, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP/);
  assert.match(AUTOMATION_SERVICE, /COALESCE\(\$24::timestamptz, CURRENT_TIMESTAMP\)/);
});

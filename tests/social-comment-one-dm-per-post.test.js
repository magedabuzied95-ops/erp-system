import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * ONE DM PER PERSON PER POST.
 *
 * The dedupe guard keys on comment_id, so a genuinely new comment is a new run and the whole
 * automation fires again. Six "Hm" comments from one person under one post produced six greetings
 * and six identical colour carousels — on the customer's phone and in the operator's transcript.
 *
 * The owner's call: the like and the public reply still happen per comment; only the DM is held.
 */

const AUTOMATION = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");

const LOOKUP = AUTOMATION.slice(
  AUTOMATION.indexOf("const findCommenterPostPrivateReply"),
  AUTOMATION.indexOf("const findSocialCommentAutomationRunByKey")
);

const GUARD = AUTOMATION.slice(
  AUTOMATION.indexOf("ONE DM PER PERSON PER POST"),
  AUTOMATION.indexOf("} else if (privateMessageNeeded) {", AUTOMATION.indexOf("ONE DM PER PERSON PER POST"))
);

test("the lookup is keyed on the person AND the post, not the comment", () => {
  assert.ok(LOOKUP.includes("AND post_id = $3::text"), "same post");
  assert.ok(LOOKUP.includes("AND commenter_id = $4::text"), "same person");
  assert.ok(LOOKUP.includes("AND comment_id <> $5::text"), "the comment being handled cannot block itself");
  assert.ok(LOOKUP.includes("WHERE tenant_id = $1::bigint"), "must stay inside the tenant");
});

// Only a DM that actually went out may silence the next one. A queued or failed run means the
// customer got nothing, and holding the retry would lose the sale outright.
test("only a DM that was really sent counts", () => {
  assert.ok(LOOKUP.includes(`LOWER(COALESCE(dm_status, '')) = 'sent'`));
});

// Missing ids are the dangerous direction: guessing "already sent" silences a DM that should go.
test("an unknown post or commenter never silences the DM", () => {
  assert.ok(LOOKUP.includes("if (!safeTenantId || !safePostId || !safeCommenterId) return null;"));
});

test("the guard holds the DM and nothing else", () => {
  assert.ok(GUARD.includes("findCommenterPostPrivateReply("), "the guard asks the lookup");
  assert.ok(GUARD.includes(`dmStatus = "skipped"`), "the DM is the step that is held");
  assert.ok(GUARD.includes(`automationState.dm_skipped_reason = "already_sent_for_post"`), "the reason is recorded");
  // The like and the public reply run ABOVE this guard, so they cannot be caught by it.
  const likeAt = AUTOMATION.indexOf("if (likeNeeded) {");
  const publicAt = AUTOMATION.indexOf("if (publicReplyNeeded) {");
  const guardAt = AUTOMATION.indexOf("ONE DM PER PERSON PER POST");
  assert.ok(likeAt > -1 && likeAt < guardAt, "the like already ran");
  assert.ok(publicAt > -1 && publicAt < guardAt, "the public reply already ran");
  for (const step of ["likeStatus =", "publicReplyStatus ="]) {
    assert.ok(!GUARD.includes(step), `the guard must not touch ${step}`);
  }
});

// The guard runs an extra query per comment; without an index that is a sequential scan of every
// run this tenant has ever had.
test("the lookup has an index behind it", () => {
  assert.ok(
    AUTOMATION.includes("idx_social_comment_automation_runs_tenant_commenter") ||
      AUTOMATION.includes("idx_social_comment_automation_runs_tenant_post_platform"),
    "a (tenant, commenter) or (tenant, post) index must exist"
  );
});

// The lookup is only worth running when a DM is actually about to be sent.
test("the lookup is skipped when no DM was going out anyway", () => {
  assert.ok(GUARD.includes("privateMessageNeeded\n    ? await findCommenterPostPrivateReply(") ||
    /privateMessageNeeded\s*\r?\n\s*\? await findCommenterPostPrivateReply\(/.test(GUARD));
});

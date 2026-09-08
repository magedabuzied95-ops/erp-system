import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Instagram comments came back with an empty like_status while Facebook's said "sent".
// That was deliberate: until 2026-04-22 Instagram had no way to like a comment at all —
// a comment node has no likes edge, and POST /{comment-id}/likes is Facebook-only.
//
// Meta then shipped the Like Media and Comments API (Instagram Platform changelog,
// 2026-04-22): the like is issued on the IG USER node and names its target in a
// parameter — POST /<IG_USER_ID>/likes with comment_id — under the new
// `instagram_manage_engagement` permission, on an Instagram Business/Creator account
// connected through Facebook Login, and only for comments on our own media. That is
// exactly the shape of this automation, so the like step is no longer gated off.

const AUTOMATION_SERVICE = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");
const MARKETING_SERVICE = fs.readFileSync("server/services/marketingCommentAutomationService.js", "utf8");

const importBuilder = async () => {
  const mod = await import("../server/services/marketingCommentAutomationService.js");
  return mod.buildCommentLikeRequest;
};

test("Instagram puts the like on the IG user and names the comment in a parameter", async () => {
  const buildCommentLikeRequest = await importBuilder();
  assert.deepEqual(
    buildCommentLikeRequest({
      platform: "instagram",
      commentId: "18024332384909839",
      instagramUserId: "17841460603593941",
    }),
    {
      endpoint: "/17841460603593941/likes",
      params: { comment_id: "18024332384909839" },
    }
  );
});

test("Facebook still takes the like on the comment itself", async () => {
  const buildCommentLikeRequest = await importBuilder();
  assert.deepEqual(
    buildCommentLikeRequest({
      platform: "facebook",
      commentId: "1141007521595948_1957094808298928",
      instagramUserId: "17841460603593941",
    }),
    {
      endpoint: "/1141007521595948_1957094808298928/likes",
      params: {},
    }
  );
});

test("a like with no target is refused instead of being posted somewhere wrong", async () => {
  const buildCommentLikeRequest = await importBuilder();
  // No comment id at all: /undefined/likes would be a real request to a wrong node.
  assert.throws(() => buildCommentLikeRequest({ platform: "instagram", instagramUserId: "IG_1" }), /comment id/i);
  assert.throws(() => buildCommentLikeRequest({ platform: "facebook", commentId: "" }), /comment id/i);
  // Instagram with no connected account: the comment id must never become the node.
  assert.throws(
    () => buildCommentLikeRequest({ platform: "instagram", commentId: "c1", instagramUserId: "" }),
    /Instagram account id/i
  );
});

test("the like step is no longer gated off on Instagram", () => {
  assert.match(
    AUTOMATION_SERVICE,
    /const likeSupportedOnPlatform = normalizedPlatform === "facebook" \|\| normalizedPlatform === "instagram";/
  );
});

test("the Instagram like asks for the permission Meta actually requires", () => {
  const permissions = MARKETING_SERVICE.slice(
    MARKETING_SERVICE.indexOf("const REQUIRED_META_PERMISSIONS"),
    MARKETING_SERVICE.indexOf("const getGrantedPermissions")
  );
  const instagram = permissions.slice(permissions.indexOf("instagram: {"));
  assert.match(instagram, /liked: \["instagram_manage_engagement"\]/);
  // instagram_manage_comments covers replying and hiding, never liking — asking for it
  // here would report the like as permitted and then fail at the Graph call.
  assert.doesNotMatch(instagram.slice(0, instagram.indexOf("public_reply")), /instagram_manage_comments/);
});

test("a failed like cannot take the public reply or the DM down with it", () => {
  // The whole point of leaving the step enabled without a proven grant: if
  // instagram_manage_engagement is missing, this one step reports failed and the run
  // continues. executeAutomationStep has to keep catching for that to hold.
  const step = AUTOMATION_SERVICE.slice(
    AUTOMATION_SERVICE.indexOf("const executeAutomationStep"),
    AUTOMATION_SERVICE.indexOf("const executeSocialCommentAutomationRuntime")
  );
  assert.match(step, /\} catch \(error\) \{[\s\S]*result\.status = "failed";/);
  assert.doesNotMatch(step, /throw error;/);
});

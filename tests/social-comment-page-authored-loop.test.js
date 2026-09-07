import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The page's own public reply comes back as a `feed` change with from.id === the page id.
// Read as a customer comment, the automation answered it, that answer fired the next
// webhook, and the page kept greeting itself by name under its own post — three replies
// in three minutes on 2026-09-08, each one addressed to "M1 Store".

const AUTOMATION_SERVICE = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");
const META_SERVICE = fs.readFileSync("server/services/metaIntegrationService.js", "utf8");

const facebookChange = ({ fromId, entryId = "PAGE_1", commentId = "c1" }) => ({
  object: "page",
  entry: [
    {
      id: entryId,
      time: 1,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: commentId,
            post_id: "p1",
            from: { id: fromId, name: fromId === entryId ? "M1 Store" : "Omar Ayoub" },
            message: "Hm",
          },
        },
      ],
    },
  ],
});

const instagramChange = ({ fromId, entryId = "IG_1", commentId = "ic1" }) => ({
  object: "instagram",
  entry: [
    {
      id: entryId,
      time: 1,
      changes: [
        {
          field: "comments",
          value: {
            item: "comment",
            verb: "add",
            id: commentId,
            media: { id: "m1" },
            from: { id: fromId, username: "someone" },
            text: "السعر كام؟",
          },
        },
      ],
    },
  ],
});

const extract = async (body, selfActorIds = []) => {
  const { extractSocialCommentWebhookEvents } = await import("../server/services/socialCommentAutomationService.js");
  return extractSocialCommentWebhookEvents({ body, tenantId: 1, selfActorIds });
};

test("a comment the page wrote itself is flagged, not treated as a customer", async () => {
  const [event] = await extract(facebookChange({ fromId: "PAGE_1" }));
  assert.equal(event.comment_id, "c1");
  assert.equal(event.is_page_authored, true);
  assert.equal(event.raw_payload.is_page_authored, true);
});

test("a real customer comment stays a customer comment", async () => {
  const [event] = await extract(facebookChange({ fromId: "USER_9" }));
  assert.equal(event.is_page_authored, false);
});

test("the page is recognised from the connected account too, not only from entry.id", async () => {
  // A page comment can arrive on an entry keyed by another connected asset.
  const [event] = await extract(facebookChange({ fromId: "CONFIG_PAGE", entryId: "PAGE_1" }), ["CONFIG_PAGE"]);
  assert.equal(event.is_page_authored, true);
});

test("the Instagram account replying to itself is flagged, a follower is not", async () => {
  const [own] = await extract(instagramChange({ fromId: "IG_1" }));
  assert.equal(own.is_page_authored, true);
  const [follower] = await extract(instagramChange({ fromId: "IG_FOLLOWER" }));
  assert.equal(follower.is_page_authored, false);
});

test("a flagged comment is stored but never automated and never becomes a lead", () => {
  const guard = AUTOMATION_SERVICE.slice(AUTOMATION_SERVICE.indexOf("export const storeSocialCommentAutomationRuns"));
  assert.match(guard, /const pageAuthored = event\.is_page_authored === true \|\| event\.raw_payload\?\.is_page_authored === true;/);
  const branch = guard.indexOf("if (pageAuthored) {");
  const skipBranch = guard.indexOf("if (skipAutomation) {");
  assert.ok(branch > 0, "the page-authored branch must exist");
  // It has to come first: skipAutomation still materializes a lead conversation, which
  // is exactly how the page ended up in the inbox as a customer named after itself.
  assert.ok(branch < skipBranch, "the page-authored branch must run before the skipAutomation branch");
  assert.doesNotMatch(
    guard.slice(branch, skipBranch),
    /materializeSocialCommentInboxConversation/,
    "a page-authored comment must not open an inbox conversation"
  );
});

test("the Instagram commenter ids collected from the body are not fed in as our own ids", () => {
  // webhookAccountIdsFromBody folds every Instagram commenter's from.id into
  // instagramBusinessAccountIds, so passing that array would silence real customers.
  const call = META_SERVICE.slice(
    META_SERVICE.indexOf("const selfActorIds = ["),
    META_SERVICE.indexOf("extractSocialCommentWebhookEvents({ body: payload")
  );
  assert.ok(call.includes("config.facebook_page_id"), "the connected page id belongs in the self list");
  assert.ok(call.includes("config.instagram_business_account_id"), "the connected IG account id belongs in the self list");
  assert.doesNotMatch(call, /\binstagramBusinessAccountIds\b/);
});

test("the polling path marks the page's own comments the same way", () => {
  const marked = META_SERVICE.match(/events: \[\{ \.\.\.event, is_page_authored: isPageOwnedComment \}\]/g) || [];
  assert.equal(marked.length, 2, "both polled comment writers must carry the flag");
});

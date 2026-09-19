import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The post a customer commented on, shown above the DM where the reply is actually typed.
//
// The first cut of this read the post off a `comment_private_reply` row in the DM session. There is
// no such row: the DM the automation opens reaches the transcript as Meta's ECHO of the message we
// sent (insert_source = meta_provider_echo), and an echo carries no post and no comment id. The only
// record that ties a DM back to the comment that started it is social_comment_automation_runs, via
// commenter_id — the same PSID the DM session is keyed by. These tests hold that path.

const { conversationOriginPost } = await import("../src/modules/aiSupport/lib/conversationHelpers.js");

const SERVICE = fs.readFileSync("server/services/aiSalesAgentService.js", "utf8");
// The whole lateral, SELECT list included — the permalink COALESCE lives above the FROM.
const LATERAL_END = SERVICE.indexOf(") op ON TRUE");
const LATERAL = SERVICE.slice(SERVICE.lastIndexOf("LEFT JOIN LATERAL (", LATERAL_END), LATERAL_END);

test("a DM thread resolves the post its comment came from", () => {
  const post = conversationOriginPost({
    channel: "facebook_messenger",
    origin_post: {
      post_id: "109139174713691_1145934767769890",
      post_full_picture: "https://scontent.xx.fbcdn.net/post.jpg",
      post_message: "وصل لون جديد من الكروكس",
      post_permalink_url: "https://www.facebook.com/reel/1411480424256917/",
      comment_id: "1145934767769890_3090567571289817",
      comment_text: "السعر كام؟",
      commenter_name: "Maged Abuzied",
      post_created_time: "2026-09-19T10:19:06.000Z",
    },
  });

  assert.equal(post.postId, "109139174713691_1145934767769890");
  assert.equal(post.image, "https://scontent.xx.fbcdn.net/post.jpg");
  assert.equal(post.caption, "وصل لون جديد من الكروكس");
  assert.equal(post.url, "https://www.facebook.com/reel/1411480424256917/");
  assert.equal(post.commentText, "السعر كام؟");
  assert.equal(post.commenterName, "Maged Abuzied");
});

// The whole point of the ask: a freshly published post has nothing linked to it yet, the automation
// greets the commenter without naming a product, and that is exactly when the operator has no idea
// what the customer is asking about. Nothing in the path may consult a product.
test("a post with no product linked still produces a card", () => {
  const post = conversationOriginPost({
    channel: "instagram",
    origin_post: { post_id: "9999", post_full_picture: "https://cdn/ig.jpg", comment_text: "متوفر؟" },
  });

  assert.ok(post, "an unlinked post must still resolve");
  assert.equal(post.postId, "9999");
  assert.equal(post.commentText, "متوفر؟");
});

// The Graph enrichment can come back with no thumbnail (it did for every Reel while the permalink
// was empty). The link alone is still worth a card: the operator clicks through and reads the post.
test("a link with no image or caption is still an origin", () => {
  const post = conversationOriginPost({
    origin_post: { post_permalink_url: "https://www.facebook.com/reel/1411480424256917/" },
  });
  assert.ok(post);
  assert.equal(post.url, "https://www.facebook.com/reel/1411480424256917/");
});

test("the comment url stands in when the post permalink is missing", () => {
  const post = conversationOriginPost({
    origin_post: { comment_url: "https://facebook.com/1/posts/2?comment_id=3" },
  });
  assert.equal(post.url, "https://facebook.com/1/posts/2?comment_id=3");
});

test("threads stored before origin_post existed fall back to channel metadata", () => {
  const post = conversationOriginPost({
    channel: "facebook_messenger",
    channel_metadata: { post_id: "5555", post_full_picture: "https://cdn/old.jpg", post_caption: "بوست قديم" },
  });
  assert.equal(post.postId, "5555");
  assert.equal(post.caption, "بوست قديم");
});

test("an ordinary thread with no post context has no card", () => {
  assert.equal(conversationOriginPost({ channel: "whatsapp", last_message: "تمام" }), null);
  assert.equal(conversationOriginPost({}), null);
  assert.equal(conversationOriginPost(null), null);
});

// The join that makes a DM find its comment. `facebook_messenger:5036593356360590` and the run's
// `commenter_id = 5036593356360590` are the same person; drop this and the card never appears on the
// surface the operator actually replies from, which is the bug this whole feature exists to fix.
test("the origin-post lateral matches a DM session to its commenter", () => {
  assert.ok(LATERAL.includes("run.commenter_id = COALESCE("), "must match on commenter_id");
  assert.ok(LATERAL.includes("NULLIF(c.external_customer_id, '')"));
  assert.ok(LATERAL.includes("NULLIF(split_part(s.session_id, ':', 2), '')"), "the PSID suffix is the fallback key");
  assert.ok(LATERAL.includes("run.tenant_id = s.tenant_id"), "must stay inside the tenant");
});

// The flattened post_* columns beside raw_payload are written before the Graph enrichment and stay
// empty; the webhook's own nested value.post.permalink_url is always there, Reel included.
test("the origin-post lateral digs the permalink out of the webhook payload", () => {
  assert.ok(LATERAL.includes(`run.raw_payload->'value'->'post'->>'permalink_url'`));
  assert.ok(LATERAL.includes("NULLIF(run.post_permalink, '')"), "the column still wins when set");
});

test("the origin post is never gated on a product", () => {
  assert.ok(!LATERAL.includes("product"), "the lateral must not consult a product");
  assert.ok(!LATERAL.includes("resolved_product_id"));
});

test("every conversation summary carries origin_post", () => {
  assert.ok(SERVICE.includes("origin_post: buildInboxOriginPost(conversation, channelMetadata)"));
});

const AUTOMATION = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");

// The run row is INSERTed from the bare webhook, and the Graph enrichment runs after it. Without a
// write-back the enriched copy lives only in memory for the rest of the request and the stored
// payload keeps the webhook's empty post_full_picture forever — which is why the inbox card had no
// picture and no link even when the Graph fetch succeeded.
test("the enriched post media is written back to the run row", () => {
  const callSite = AUTOMATION.slice(
    AUTOMATION.indexOf("storedRow = applyWebhookPostMediaToEvent(storedRow, webhookMedia);"),
    AUTOMATION.indexOf("const moderation = await moderateIncomingSocialComment")
  );
  assert.ok(callSite.includes("persistSocialCommentWebhookPostMedia"), "the enrichment must be persisted");

  const persist = AUTOMATION.slice(
    AUTOMATION.indexOf("const persistSocialCommentWebhookPostMedia"),
    AUTOMATION.indexOf("const resolveSocialCommentCustomerProfileId")
  );
  // Merge, never replace: a failed Graph fetch must not wipe a picture an earlier comment found.
  assert.ok(persist.includes(`raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb`));
  assert.ok(persist.includes("if (!found) return") || persist.includes("if (found) patch[key] = found"), "empty values must not be written");
  assert.ok(persist.includes(`COALESCE(NULLIF(post_permalink, ''), NULLIF($3, ''))`), "an existing permalink wins");
});

// The permalink resolver. Every chain in it used to start at a flattened key the webhook does not
// carry, so it returned "" on every comment -- which also starved fetchMetaPostPreviewDetails of the
// reel id and left every Reel comment with no thumbnail.
const { resolveSocialCommentPostPermalink } = await import("../server/services/socialCommentAutomationService.js");

// The media fetch must go through the resolver, not a private chain of flattened keys, or the reel
// id never reaches extractReelIdFromPermalink and no Reel ever gets a thumbnail.
test("the Graph media fetch is handed the resolved permalink", () => {
  const fetcher = AUTOMATION.slice(
    AUTOMATION.indexOf("const fetchSocialCommentWebhookPostMedia"),
    AUTOMATION.indexOf("const applyWebhookPostMediaToEvent")
  );
  assert.ok(fetcher.includes("const permalinkUrl = resolveSocialCommentPostPermalink(event)"));
  assert.ok(fetcher.includes("permalinkUrl"), "the permalink must reach fetchMetaPostPreviewDetails");
});

test("the permalink resolver reads the shape Meta actually sends", () => {
  const webhookEvent = {
    raw_payload: {
      body: {
        object: "page",
        entry: [
          {
            id: "109139174713691",
            changes: [
              {
                field: "feed",
                value: {
                  item: "comment",
                  post: {
                    id: "109139174713691_1145934767769890",
                    status_type: "added_video",
                    permalink_url: "https://www.facebook.com/reel/1411480424256917/",
                  },
                  message: "Hm",
                },
              },
            ],
          },
        ],
      },
      post_permalink_url: "",
      post_permalink: "",
    },
  };

  assert.equal(
    resolveSocialCommentPostPermalink(webhookEvent),
    "https://www.facebook.com/reel/1411480424256917/"
  );
});

test("the permalink resolver still prefers a flattened value when one is set", () => {
  assert.equal(
    resolveSocialCommentPostPermalink({
      post_permalink: "https://facebook.com/flat",
      raw_payload: { value: { post: { permalink_url: "https://facebook.com/nested" } } },
    }),
    "https://facebook.com/flat"
  );
});

test("the permalink resolver reads the already-flattened value shape too", () => {
  assert.equal(
    resolveSocialCommentPostPermalink({
      raw_payload: { value: { post: { permalink_url: "https://facebook.com/nested" } } },
    }),
    "https://facebook.com/nested"
  );
});

test("the permalink resolver returns empty rather than guessing", () => {
  assert.equal(resolveSocialCommentPostPermalink({}), "");
  assert.equal(resolveSocialCommentPostPermalink({ raw_payload: { value: { post: {} } } }), "");
});

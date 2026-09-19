import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The post a customer commented on, shown above the DM where the reply is actually typed.
//
// Before this, the post preview lived on the comment thread only. The comment automation answers a
// comment by opening a DM — a different conversation on a different channel — and that is the one
// an operator reads and replies in. It said nothing about the post, so "عندكم منه ٤٢؟" arrived with
// no referent. These tests hold the two halves that fix it: the SQL that carries the post onto every
// conversation row, and the resolver the two inbox surfaces read it with.

const { conversationOriginPost } = await import("../src/modules/aiSupport/lib/conversationHelpers.js");

const SERVICE = fs.readFileSync("server/services/aiSalesAgentService.js", "utf8");

test("a DM thread resolves the post its comment came from", () => {
  const post = conversationOriginPost({
    channel: "facebook_messenger",
    origin_post: {
      post_id: "1111_2222",
      post_full_picture: "https://scontent.xx.fbcdn.net/post.jpg",
      post_message: "وصل لون جديد من الكروكس",
      post_permalink_url: "https://facebook.com/1111/posts/2222",
      comment_id: "2222_3333",
      comment_url: "https://facebook.com/1111/posts/2222?comment_id=3333",
      comment_text: "السعر كام؟",
      commenter_name: "Mona",
      post_created_time: "2026-09-18T10:00:00Z",
    },
  });

  assert.equal(post.postId, "1111_2222");
  assert.equal(post.image, "https://scontent.xx.fbcdn.net/post.jpg");
  assert.equal(post.caption, "وصل لون جديد من الكروكس");
  assert.equal(post.url, "https://facebook.com/1111/posts/2222");
  assert.equal(post.commentText, "السعر كام؟");
  assert.equal(post.commenterName, "Mona");
});

// The whole point of the ask: a freshly published post has nothing linked to it yet, the automation
// greets the commenter without naming a product, and that is exactly when the operator has no idea
// what the customer is asking about. Nothing in the resolver may consult a product.
test("a post with no product linked still produces a card", () => {
  const post = conversationOriginPost({
    channel: "instagram",
    origin_post: {
      post_id: "9999",
      post_full_picture: "https://cdn/ig.jpg",
      post_message: "",
      post_permalink_url: "",
      comment_text: "متوفر؟",
    },
  });

  assert.ok(post, "an unlinked post must still resolve");
  assert.equal(post.postId, "9999");
  assert.equal(post.commentText, "متوفر؟");
});

// A signed Meta permalink is often all we get; the card links through and the operator reads the
// post on Facebook. Refusing to render without an image would throw that away.
test("a link with no image or caption is still an origin", () => {
  const post = conversationOriginPost({
    origin_post: { post_permalink_url: "https://facebook.com/1/posts/2" },
  });
  assert.ok(post);
  assert.equal(post.url, "https://facebook.com/1/posts/2");
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
    channel_metadata: {
      post_id: "5555",
      post_full_picture: "https://cdn/old.jpg",
      post_caption: "بوست قديم",
    },
  });
  assert.equal(post.postId, "5555");
  assert.equal(post.caption, "بوست قديم");
});

test("an ordinary thread with no post context has no card", () => {
  assert.equal(conversationOriginPost({ channel: "whatsapp", last_message: "تمام" }), null);
  assert.equal(conversationOriginPost({}), null);
  assert.equal(conversationOriginPost(null), null);
});

// `cm` is ordered to answer "who commented last" and settles on the newest row whose commenter_name
// is set, which for a DM can be a row with no post columns at all. Sharing it would blank the card
// out at random, so the origin post gets a lateral of its own that only reads rows carrying post
// context. Delete the filter and this test fails.
test("the origin-post lateral only reads rows that carry a post", () => {
  const lateral = SERVICE.slice(SERVICE.indexOf("FROM ai_support_messages origin_msg"), SERVICE.indexOf(") op ON TRUE"));
  assert.ok(lateral.includes("COALESCE(origin_msg.post_id, '') <> ''"), "must require post context");
  assert.ok(lateral.includes("OR COALESCE(origin_msg.post_permalink_url, '') <> ''"));
  assert.ok(lateral.includes("OR COALESCE(origin_msg.post_full_picture, '') <> ''"));
  assert.ok(!lateral.includes("product"), "the origin post must never be gated on a product");
});

// The DM row the automation writes stamps the customer's comment into source_comment_text; an
// inbound comment row keeps it in customer_message. The card quotes whichever exists.
test("the origin-post lateral reads the comment text from either column", () => {
  const lateral = SERVICE.slice(SERVICE.indexOf("FROM ai_support_messages origin_msg") - 900, SERVICE.indexOf(") op ON TRUE"));
  assert.ok(lateral.includes("NULLIF(origin_msg.source_comment_text, '')"));
  assert.ok(lateral.includes("NULLIF(origin_msg.customer_message, '')"));
});

test("every conversation summary carries origin_post", () => {
  assert.ok(SERVICE.includes("origin_post: buildInboxOriginPost(conversation, channelMetadata)"));
});

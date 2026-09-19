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

// ------------------------------------------------------------ folding away
//
// Pinned to the top of a phone-sized transcript the card eats real estate an operator mid-thread no
// longer needs, so the whole card toggles: tap it and it tucks into a pill on the leading edge, tap
// the pill and it comes back.

const CARD = fs.readFileSync("src/modules/aiSupport/components/OriginPostCard.jsx", "utf8");

test("the card folds into a pill and back", () => {
  assert.ok(CARD.includes("if (collapsed) {"), "there must be a folded render");
  const folded = CARD.slice(CARD.indexOf("if (collapsed) {"), CARD.indexOf("return (", CARD.indexOf("if (collapsed) {") + 400));
  assert.ok(folded.includes("justify-start"), "the pill sits on the leading edge");
  assert.ok(folded.includes("onClick={toggle}"), "tapping the pill brings the card back");
  assert.ok(folded.includes(`aria-expanded="false"`));
  // The pill keeps the thumbnail, so the operator can still tell which post it was without
  // unfolding it -- a bare chevron would make folding it a loss of information.
  assert.ok(folded.includes("thumbnail("), "the pill keeps the post thumbnail");
});

// The card holds the "open post" anchor, and an anchor may not live inside a <button>.
test("the expanded card toggles without nesting an anchor in a button", () => {
  assert.ok(CARD.includes(`role="button"`), "the expanded card is a div with a button role");
  assert.ok(CARD.includes("onKeyDown={onToggleKeyDown}"), "Enter and Space must work");
  assert.ok(!/=\{`sticky top-2 z-20 cursor-pointer \$\{skin\.shell\}`\}[\s\S]{0,4000}<button/.test(CARD), "no nested button inside the card shell");
});

// Opening the post must not also fold the card away behind the new tab.
test("opening the post does not fold the card", () => {
  const anchor = CARD.slice(CARD.indexOf("<a"), CARD.indexOf("</a>"));
  assert.ok(anchor.includes("onClick={(event) => event.stopPropagation()}"));
});

// Storage can be blocked, cleared, or throw outright in a private window. A forgotten preference is
// a shrug; a transcript that will not render because storage said no is not.
test("the fold preference survives a storage that refuses", () => {
  const read = CARD.slice(CARD.indexOf("const readCollapsedPreference"), CARD.indexOf("const writeCollapsedPreference"));
  const write = CARD.slice(CARD.indexOf("const writeCollapsedPreference"), CARD.indexOf("const SKINS"));
  assert.ok(read.includes("try {") && read.includes("} catch {"), "reads must not throw");
  assert.ok(write.includes("try {") && write.includes("} catch {"), "writes must not throw");
  assert.ok(read.includes("return false;"), "an unreadable storage means shown, not hidden");
});

// ---------------------------------------------------------------- Instagram
//
// An Instagram media object is not a Facebook post. It answers to `caption`, `permalink`,
// `media_url` and `timestamp`, and has no `message`, `permalink_url`, `full_picture` or `picture`.
// Asking it the Facebook list costs four invalid fields and the retry loop forgives only three, so
// an IG media resolved to nothing at all — which is why an Instagram thread showed an empty card.

const META = fs.readFileSync("server/services/metaIntegrationService.js", "utf8");

test("Instagram gets its own Graph field list", () => {
  const list = META.slice(META.indexOf("const META_POST_INSTAGRAM_FIELDS"), META.indexOf("const buildMetaPostPreviewFields"));
  for (const field of ["caption", "permalink", "media_url", "thumbnail_url", "timestamp"]) {
    assert.ok(list.includes(`"${field}"`), `Instagram must request ${field}`);
  }
  for (const field of ["permalink_url", "full_picture", "picture", "created_time", "message"]) {
    assert.ok(!list.includes(`"${field}"`), `${field} does not exist on an Instagram media`);
  }

  const builder = META.slice(META.indexOf("const buildMetaPostPreviewFields"), META.indexOf("const fetchMetaPostMediaCandidate"));
  assert.ok(builder.includes("if (instagramCandidate) {"), "the builder must branch on the platform");
  assert.ok(builder.includes("META_POST_INSTAGRAM_FIELDS.forEach(pushField)"));
});

// The platform was sniffed out of the permalink. An Instagram comment webhook carries no permalink
// at all -- only value.media.id -- so the sniff was always false and every IG comment was queried
// as a Facebook post.
test("the platform is believed, not sniffed out of a permalink", () => {
  const graph = META.slice(
    META.indexOf("const fetchMetaPostPreviewDetailsFromGraph"),
    META.indexOf("const bestPreview = primaryPreview")
  );
  assert.ok(graph.includes(`platform = ""`), "the fetch must accept a platform");
  assert.ok(graph.includes(`lower(platform) === "instagram"`), "the platform must decide Instagram");
  assert.ok(graph.includes("const instagramCandidate = isInstagram;"));
  // facebook_page_id never equals the IG business account id the webhook sends, so applying the
  // Facebook page guard to Instagram rejected every media before a field was asked for.
  assert.ok(graph.includes("if (!isInstagram && text(pageId) && configuredPageId"), "the page guard is Facebook-only");
  assert.ok(graph.includes("text(!isInstagram && pageId && safePostId"), "page_post ids are a Facebook convention");
});

test("the comment automation tells Graph which platform it is asking about", () => {
  assert.ok(AUTOMATION.includes("fetchMetaPostPreviewDetails({ tenantId, postId, pageId, permalinkUrl, platform: normalizedPlatform })"));
  const fetcher = AUTOMATION.slice(
    AUTOMATION.indexOf("const fetchSocialCommentWebhookPostMedia"),
    AUTOMATION.indexOf("const applyWebhookPostMediaToEvent")
  );
  assert.ok(fetcher.includes("event.raw_payload?.value?.media?.id"), "an IG comment carries the media id, not a post id");
});

// media_url is THE image on an Instagram media: an IG photo comes back with a media_url and no
// full_picture and no picture, so leaving it out normalized every IG post to an empty thumbnail.
test("the preview normalizer treats media_url as an image source", () => {
  const normalizer = META.slice(
    META.indexOf("const normalizeMetaPostPreview"),
    META.indexOf("const normalizeMetaReelPreview")
  );
  assert.ok(normalizer.includes("const mediaUrl = text(post.media_url"));
  assert.ok(normalizer.includes("fullPicture || picture || mediaUrl ||"), "media_url must be in the thumbnail chain");
  assert.ok(normalizer.includes("post.timestamp"), "an Instagram media is stamped with timestamp");
});

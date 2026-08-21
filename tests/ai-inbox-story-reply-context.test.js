import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { extractMetaWebhookMessages, findStoryAttachment } = await import(
  "../server/services/aiChannelAdapterService.js"
);
const { inboundAttachmentLabel } = await import("../server/services/inboundMediaService.js");
// Line endings are checked out per machine, so a source assertion that spans a
// newline has to read one shape.
const CR = String.fromCharCode(13);
const source = (path) => readFileSync(path, "utf8").split(CR).join("");
const integration = source("server/services/metaIntegrationService.js");
const routes = source("server/routes/aiAgentOrders.js");
const media = source("src/modules/aiSupport/components/MessageMedia.jsx");
const transcript = source("src/modules/aiSupport/components/TranscriptMessage.jsx");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const webhook = ({ object, pageId, message }) => ({
  object,
  entry: [{ id: pageId, messaging: [{ sender: { id: "CUST1" }, recipient: { id: pageId }, timestamp: 1755800000000, message }] }],
});

const firstMessage = async (body) => (await extractMetaWebhookMessages({ tenantId: 1, body }))[0];

test("an Instagram story reply carries the story, not just its text", async () => {
  // The whole defect: Meta puts a story reply in `reply_to.story` and nothing in
  // `attachments`, so reading only `attachments` dropped the story on the floor
  // and the inbox showed a bare "Hm?" with no sign of what it was about.
  const message = await firstMessage(webhook({
    object: "instagram",
    pageId: "IGPAGE",
    message: {
      mid: "mid.ig",
      text: "Hm?",
      reply_to: { story: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/story.jpg", id: "17999" } },
    },
  }));
  assert.equal(message.message_text, "Hm?");
  const story = findStoryAttachment(message.attachments);
  assert.ok(story, "the story reply must produce a story attachment");
  assert.equal(story.type, "story_reply");
  assert.equal(story.url, "https://lookaside.fbsbx.com/ig_messaging_cdn/story.jpg");
  assert.equal(story.metadata.story_id, "17999");
  assert.equal(story.metadata.story_kind, "story_reply");
});

test("a Facebook story reply is read the same way as an Instagram one", async () => {
  const message = await firstMessage(webhook({
    object: "page",
    pageId: "FBPAGE",
    message: {
      mid: "mid.fb",
      text: "بكام؟",
      reply_to: { story: { url: "https://scontent.xx.fbcdn.net/story.jpg", id: "881" } },
    },
  }));
  assert.equal(message.channel, "facebook_messenger");
  const story = findStoryAttachment(message.attachments);
  assert.equal(story?.metadata?.story_id, "881");
  assert.equal(story?.metadata?.story_kind, "story_reply");
});

test("a story mention keeps its own kind instead of being retyped as a reply", async () => {
  const message = await firstMessage(webhook({
    object: "instagram",
    pageId: "IGPAGE",
    message: { mid: "mid.mention", attachments: [{ type: "story_mention", payload: { url: "https://cdn/mention.jpg" } }] },
  }));
  const story = findStoryAttachment(message.attachments);
  assert.equal(story?.metadata?.story_kind, "story_mention");
  assert.equal(story?.url, "https://cdn/mention.jpg");
});

test("a story whose CDN link already expired still survives normalization", async () => {
  // normalizeAttachments drops an attachment with neither url nor title, which
  // would have thrown away the one fact worth keeping: this is a story reply.
  const message = await firstMessage(webhook({
    object: "instagram",
    pageId: "IGPAGE",
    message: { mid: "mid.noURL", text: "متاح؟", reply_to: { story: { id: "5150" } } },
  }));
  const story = findStoryAttachment(message.attachments);
  assert.equal(story?.metadata?.story_id, "5150");
  assert.equal(story?.url, "");
});

test("an ordinary photo is untouched by the story path", async () => {
  const message = await firstMessage(webhook({
    object: "page",
    pageId: "FBPAGE",
    message: { mid: "mid.photo", attachments: [{ type: "image", payload: { url: "https://cdn/photo.jpg" } }] },
  }));
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].type, "image");
  assert.equal(findStoryAttachment(message.attachments), null);
});

test("the conversation list says story, not photo", () => {
  // last_message is what the list column renders; "📷 صورة" on a story reply
  // reads as a picture the customer sent us.
  assert.equal(inboundAttachmentLabel([{ type: "story_reply" }]), "📸 رد على استوري");
  assert.equal(inboundAttachmentLabel([{ type: "story_mention" }]), "📸 منشن في استوري");
  assert.equal(inboundAttachmentLabel([{ type: "image" }]), "📷 صورة");
});

test("the story id is resolved to the product before the row is written", () => {
  // Resolving at write time means the transcript row carries the product; doing
  // it at render time would mean a lookup per bubble, per open.
  assert.match(integration, /const resolvePublishedStoryContext = async/);
  assert.match(integration, /FROM ai_marketing_content_queue q/);
  // One platform id lands in the column, the rest only in the results blob.
  assert.match(integration, /string_to_array\(COALESCE\(q\.platform_post_id, ''\), ','\)/);
  assert.match(integration, /payload->>'platform_story_id'/);
  assert.ok(
    integration.indexOf("enrichStoryAttachments({\n      tenantId: config.tenant_id") >
      integration.indexOf("message.attachments = await materializeInboundAttachments({"),
    "the story must be resolved after the media is re-hosted, on the same attachments"
  );
});

test("both Meta intake routes resolve the story", () => {
  // /api/meta/webhook is production; /api/ai-agent/channels/meta/webhook also
  // writes inbox rows, and a story that reads differently per route is a bug.
  assert.match(routes, /message\.attachments = await enrichStoryAttachments\(\{ tenantId, attachments: message\.attachments \}\)/);
});

test("a lookup failure never costs us the message", () => {
  const resolver = integration.slice(
    integration.indexOf("const resolvePublishedStoryContext = async"),
    integration.indexOf("export const enrichStoryAttachments")
  );
  assert.match(resolver, /catch \(error\) \{/);
  assert.match(resolver, /return null;/);
});

test("the story is quoted above the message, not tiled into the gallery", () => {
  assert.match(media, /export const messageStoryContext/);
  assert.match(media, /if \(storyAttachmentKind\(attachment\)\) continue;/);
  assert.match(transcript, /function StoryContext\(\{ story, variant = "desktop" \}\)/);
  // Both surfaces render the same component; the PWA used to be the one that
  // silently skipped attachment work the desktop inbox did.
  assert.match(transcript, /<StoryContext story=\{story\} variant="pwa" \/>/);
  assert.match(transcript, /<StoryContext story=\{story\} variant="desktop" \/>/);
});

test("the story labels are translated in both dictionaries", () => {
  for (const dictionary of [en, ar]) {
    assert.ok(dictionary.inbox.message.storyReply);
    assert.ok(dictionary.inbox.message.storyMention);
    assert.ok(dictionary.inbox.message.storyOpenProduct);
  }
  assert.notEqual(en.inbox.message.storyReply, ar.inbox.message.storyReply);
});

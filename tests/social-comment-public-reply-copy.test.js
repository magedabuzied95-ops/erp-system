import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SOCIAL_PUBLIC_REPLY_BODY,
  DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
  renderSocialTemplateText,
  selectSocialPublicReplyTemplate,
} from "../server/services/socialAutomationSettingsService.js";
import { buildSocialCommentMentionMessage } from "../server/services/marketingCommentAutomationService.js";

/* The public reply greets a name on Facebook and a HANDLE on Instagram, and the greeting is where
   the mention gets written. Three things follow from that, and each was wrong in production. */

const NAME_PLACEHOLDER = /\{\{\s*customer_name\s*\}\}/;
const renderWith = (template, name) =>
  renderSocialTemplateText(template, (key) => (key.toLowerCase() === "customer_name" ? name : undefined)).trim();

// The vocative particle as a standalone word. Whatever follows it in an opener ends up next to
// the name, and on Instagram the name is a handle: "يا صديقي @maged.abuzied".
const STANDALONE_VOCATIVE = /(^|\s)يا(\s|$)/;

test("no opener greets with a vocative particle", () => {
  for (const opener of DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) {
    assert.ok(!STANDALONE_VOCATIVE.test(opener), `"${opener}" puts a handle after "يا"`);
  }
});

test("the body does not greet a second time", () => {
  // The opener has already said hello by name. The body used to say "يا صديقي" one line later.
  assert.ok(!STANDALONE_VOCATIVE.test(DEFAULT_SOCIAL_PUBLIC_REPLY_BODY), "the body carries a vocative");
  assert.ok(!DEFAULT_SOCIAL_PUBLIC_REPLY_BODY.includes("صديقي"), "the body greets the customer again");
});

test("every opener carries the name, or the mention has nowhere to go", () => {
  for (const opener of DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) {
    assert.ok(NAME_PLACEHOLDER.test(opener), `"${opener}" has no {{customer_name}} to mention`);
  }
});

test("a rendered opener still mentions on both platforms", () => {
  for (const opener of DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) {
    const facebook = buildSocialCommentMentionMessage({
      platform: "facebook",
      message: renderWith(opener, "Maged Abuzied"),
      commenterId: "5036593356360590",
      commenterName: "Maged Abuzied",
    });
    assert.equal(facebook.mentionApplied, true, `Facebook lost the mention on "${opener}"`);
    assert.ok(facebook.message.includes("@[5036593356360590]"));

    const instagram = buildSocialCommentMentionMessage({
      platform: "instagram",
      message: renderWith(opener, "maged.abuzied"),
      commenterId: "17841400000000000",
      commenterName: "maged.abuzied",
      commenterUsername: "maged.abuzied",
    });
    assert.equal(instagram.mentionApplied, true, `Instagram lost the mention on "${opener}"`);
    assert.ok(instagram.message.includes("@maged.abuzied"));
  }
});

test("a nameless commenter still gets a greeting that reads", () => {
  // Reels hand over no identity at all — see the nameless-greeting guard. The opener has to
  // survive an empty name without stranding a particle or collapsing to an emoji on its own.
  for (const opener of DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS) {
    const rendered = renderWith(opener, "");
    assert.ok(rendered.length > 2, `"${opener}" collapses when there is no name`);
    // Only a dangling "يا" is stranded — "أهلاً بيك" is a whole greeting on its own.
    const withoutTrailingEmoji = rendered.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/gu, "");
    assert.ok(
      !/(^|\s)يا$/.test(withoutTrailingEmoji),
      `"${opener}" strands a vocative when there is no name: "${rendered}"`
    );
  }
});

test("the rotation still resolves to one of the openers", () => {
  const rendered = selectSocialPublicReplyTemplate({
    baseTemplate: DEFAULT_SOCIAL_PUBLIC_REPLY_BODY,
    openers: DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS,
    rotationEnabled: true,
    commentId: "18091886321216322",
    postId: "18351259309173496",
  });
  assert.ok(
    DEFAULT_SOCIAL_PUBLIC_REPLY_OPENERS.some((opener) => rendered.startsWith(opener)),
    `rotation produced an opener that is not in the list: "${rendered.split("\n")[0]}"`
  );
});

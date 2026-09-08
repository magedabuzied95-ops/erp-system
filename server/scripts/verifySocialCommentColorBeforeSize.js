import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildSocialCommentColorQuickReplies,
  buildSocialCommentProductQuickReplies,
  buildSocialCommentSizeQuickReplies,
  matchSocialCommentColorInput,
  parseSocialCommentColorQuickReplyPayload,
  parseSocialCommentProductQuickReplyPayload,
  parseSocialCommentSizeQuickReplyPayload,
} from "../services/socialCommentPrivateReplyService.js";

/* ======================================================
   COLOUR BEFORE SIZE, AND NEITHER OPTIONAL
   ------------------------------------------------------
   Order 1203 came from a carousel of three colours whose buttons were SIZES. The customer
   pressed "40", only Black had a 40 in stock, and the flow chose Black for him — a colour he
   never saw a question about. Nothing caught it because the eligibility gate checked the size
   and ignored the colour entirely.

   The rules this locks down:
     1. Colour buttons build with NO size in hand — otherwise the first question can only ever
        be a size, which is the original bug.
     2. Every size button carries the colour it belongs to, so "42" can never be read back
        against the wrong colour.
     3. A missing colour blocks the order exactly as hard as a missing size.
====================================================== */

// ── 1. Colour is askable first ────────────────────────────────────────────────────────────────
const colorButtons = buildSocialCommentColorQuickReplies({
  productId: 4,
  colors: ["Black", "White", "White & Black"],
});
assert.equal(colorButtons.length, 3, "colour buttons must build with no size chosen yet");
const parsedColor = parseSocialCommentColorQuickReplyPayload(colorButtons[0].payload);
assert.ok(parsedColor, "a sizeless colour payload must still parse");
assert.equal(parsedColor.color, "Black");
assert.equal(parsedColor.product_id, 4);

// ── 2. A size always names its colour ─────────────────────────────────────────────────────────
const sizeButtons = buildSocialCommentSizeQuickReplies({
  productContext: { product_id: 4, available_sizes: ["41", "42"] },
  selectedColor: "White",
});
assert.equal(sizeButtons.length, 2);
for (const button of sizeButtons) {
  const parsed = parseSocialCommentSizeQuickReplyPayload(button.payload);
  assert.ok(parsed, "size payload must parse");
  assert.equal(parsed.color, "White", "a size button must carry the colour it belongs to");
  assert.equal(parsed.product_id, 4, "a size button must carry its product");
}

// ── 3. Model buttons disambiguate a typed colour ──────────────────────────────────────────────
const productButtons = buildSocialCommentProductQuickReplies({
  products: [
    { product_id: 4, name: "Alexander Mcqueen" },
    { product_id: 9, name: "Puma Sneakers" },
    { product_id: 4, name: "Alexander Mcqueen" },
  ],
});
assert.equal(productButtons.length, 2, "the same model must not appear twice");
assert.equal(parseSocialCommentProductQuickReplyPayload(productButtons[1].payload).product_id, 9);

// ── 4. A typed colour resolves to what the catalog stores ─────────────────────────────────────
const catalog = ["Black", "White", "White & Black"];
assert.equal(matchSocialCommentColorInput("الابيض", catalog), "White");
assert.equal(matchSocialCommentColorInput("عايز الأسود", catalog), "Black");
assert.equal(matchSocialCommentColorInput("ابيض واسود", catalog), "White & Black");
assert.equal(matchSocialCommentColorInput("أحمر", catalog), "", "a colour we do not stock must not match");
assert.equal(matchSocialCommentColorInput("", catalog), "");
// A real colour may start with the same letter the joining "و" adds; stripping it must not
// invent a match.
assert.equal(matchSocialCommentColorInput("وردي", ["Pink", "Grey"]), "Pink");

// ── 5. The order gate treats colour like size ─────────────────────────────────────────────────
const metaSource = readFileSync(
  fileURLToPath(new URL("../services/metaIntegrationService.js", import.meta.url)),
  "utf8"
);
assert.match(
  metaSource,
  /reason_if_not_eligible[\s\S]{0,400}missing_selected_color/,
  "eligibility must refuse an order whose colour was never chosen"
);
assert.match(
  metaSource,
  /code: "MISSING_SELECTED_COLOR"/,
  "createSocialCommentDraftOrder must refuse a colourless order outright"
);
assert.match(
  metaSource,
  /code: "MISSING_SELECTED_SIZE"/,
  "createSocialCommentDraftOrder must refuse a sizeless order outright"
);

// The colour step has to hand off to the SIZE step; if it goes straight to the summary again the
// customer is back to never being asked for a size in that colour.
const colorHandlerIndex = metaSource.indexOf('reason: "social_comment_color_selected"');
assert.ok(colorHandlerIndex > 0, "colour handler is gone");
// Bounded by the handler's own opening line rather than a character count — the body grew past a
// 3000-char window and the assertions below started reading someone else's code.
const colorHandlerStart = metaSource.lastIndexOf("if (colorPayload || (socialCommentSalesFlowStepFromMemory", colorHandlerIndex);
assert.ok(colorHandlerStart > 0, "could not find the start of the colour handler");
const colorHandlerBody = metaSource.slice(colorHandlerStart, colorHandlerIndex);
assert.match(
  colorHandlerBody,
  /if \(!selectedSize\) \{\s*return presentSizeOptions\(/,
  "choosing a colour must lead to the size question, not to the order summary"
);

// A tapped colour carries its own size, and an empty one means "not chosen yet". Falling back to
// the conversation's size handed a customer who tapped Black and nothing else a summary for size
// 42 — a size left over from an earlier attempt in the same chat.
assert.match(
  colorHandlerBody,
  /const selectedSize = colorPayload\s*\?\s*text\(colorPayload\.size \|\| ""\)\s*:\s*text\(salesFlow\?\.selected_size \|\| ""\)/,
  "a tapped colour must take the size from its own payload only, never from leftover conversation state"
);
assert.doesNotMatch(
  colorHandlerBody,
  /text\(colorPayload\?\.size \|\| salesFlow\?\.selected_size/,
  "the old ||-chain silently inherits a stale size behind an empty payload"
);

// ── Instagram: a typed colour has something to resolve against ────────────────────────────────
// Instagram allows ONE private reply per comment and its template takes no postback button, so
// the customer's first answer is always typed. Matching it needs the product, which the DM never
// names — the link is the commenter id, which IS the same page-scoped id the DM arrives under.
assert.match(
  metaSource,
  /const loadCommentedProductsForCustomer = async/,
  "a typed colour on Instagram must be able to find the product the customer commented on"
);
assert.match(
  metaSource,
  /FROM social_comment_automation_runs r[\s\S]{0,400}r\.commenter_id = \$2::text/,
  "the comment is joined to the DM by the commenter id"
);
assert.match(
  metaSource,
  /r\.created_at > NOW\(\) - INTERVAL '7 days'/,
  "an id reused across months of comments must not drag an ancient product into today's chat"
);
// Cards the conversation really showed still win; the commented product is the fallback.
assert.match(
  metaSource,
  /const recentProducts = memoryProducts\.length \? memoryProducts : commentedProducts;/,
  "products the customer was actually shown must outrank the commented one"
);
assert.match(
  metaSource,
  /memoryProducts\.length\s*\?\s*\[\]\s*:\s*await loadCommentedProductsForCustomer/,
  "the lookup must not run when the conversation already has cards — it is on the ordinary text path"
);

// ── A tap is answered even when the AI is switched off ────────────────────────────────────────
// 36 of 238 live conversations had ai_enabled=false, and that gate skipped the whole reply
// pipeline — so a customer pressed a colour button and nothing happened, silently. The order
// buttons are not the AI composing text; they are the customer naming a product, colour and size.
assert.match(
  metaSource,
  /if \(isSocialCommentTap && !conversationAiEnabled\)/,
  "an explicit tap must be answered even when the conversation's AI is off"
);
assert.match(
  metaSource,
  /const isSocialCommentTap = Boolean\(socialCommentTapPayload\)/,
  "only a real payload counts as a tap"
);
// Typed text must still respect the switch, or a colleague handling a chat by hand gets talked over.
const tapGateStart = metaSource.indexOf("const socialCommentTapPayload = socialCommentQuickReplyPayloadFromMessage(message);");
assert.ok(tapGateStart > 0, "the tap gate is gone");
const tapGateBody = metaSource.slice(tapGateStart, tapGateStart + 2600);
assert.doesNotMatch(tapGateBody, /message_text|messageText/, "the tap gate must not act on typed text");
assert.match(
  tapGateBody,
  /__social_comment_quick_reply_routed = true/,
  "a tap answered here must not be answered again further down"
);

// ── Instagram gets colour BUTTONS, not a request to type ──────────────────────────────────────
// Instagram allows one private reply per comment and its template takes no postback, so the cards
// go first and the buttons follow as an ordinary DM to the commenter id — which IS the id the DM
// thread lives under.
assert.match(
  metaSource,
  /export const sendInstagramColorQuickReplies = async/,
  "Instagram must be able to send colour buttons after the private reply"
);
const igSenderStart = metaSource.indexOf("export const sendInstagramColorQuickReplies");
const igSenderBody = metaSource.slice(igSenderStart, igSenderStart + 2600);
assert.match(igSenderBody, /buildSocialCommentColorQuickReplies\(/, "the buttons must carry the same payload Messenger uses");
assert.match(igSenderBody, /catch \(error\)[\s\S]{0,400}return \{ sent: false/, "losing the buttons must not cost the private reply");
assert.match(
  readFileSync(fileURLToPath(new URL("../services/marketingCommentAutomationService.js", import.meta.url)), "utf8"),
  /sendInstagramColorQuickReplies\(\{/,
  "the comment→DM path must actually send them"
);

// Quick replies must reach Instagram, not just Messenger. Restricting them to Messenger stripped
// every button on Instagram silently — the colour step reached the customer (it sends direct),
// they tapped one, and the SIZE step arrived as bare text with nothing to press. Nothing logged
// it, because the buttons were dropped locally rather than rejected by Meta.
assert.match(
  metaSource,
  /quickReplies: Array\.isArray\(quickReplies\)[\s\S]{0,240}\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\s*\.includes\(normalizedChannel\)/,
  "Instagram must receive quick replies too"
);
assert.doesNotMatch(
  metaSource,
  /quickReplies: Array\.isArray\(quickReplies\) && normalizedChannel === AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER \?/,
  "the Messenger-only restriction is what dead-ended the Instagram flow one step in"
);

console.log("social comment colour-before-size OK");

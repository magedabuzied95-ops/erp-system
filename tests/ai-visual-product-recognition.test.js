import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import os from "node:os";
import path from "node:path";

import { firstInboundImageUrl, readLocalUploadImage } from "../server/services/aiVisualProductRecognitionService.js";
import { inboxMessageMedia, messageIsOnlyMediaPlaceholder, normalizeInboxMessage } from "../server/services/aiSalesAgentService.js";

// A customer sends a photo of a product on WhatsApp, Messenger or Instagram and the answer is the
// product itself: one card per colour, the colour they photographed first, each card carrying that
// colour's own price and its own available sizes. Two or more cards leave as ONE carousel — the
// adapters already do that — so the whole job is getting the right cards that far.

const recognition = fs.readFileSync(
  new URL("../server/services/aiVisualProductRecognitionService.js", import.meta.url), "utf8"
);
const inboxService = fs.readFileSync(
  new URL("../server/services/aiInboxService.js", import.meta.url), "utf8"
);
const gateway = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8"
);
const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);
const carouselService = fs.readFileSync(
  new URL("../server/services/aiProductColorCarouselService.js", import.meta.url), "utf8"
);
const salesAgent = fs.readFileSync(
  new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8"
);

// ── which attachment is the product photo ────────────────────────────────────────────────────

test("the product photo is picked out of whatever the channel attached", () => {
  const image = "https://api.example.com/uploads/whatsapp-media/abc.jpg";
  assert.equal(
    firstInboundImageUrl([{ type: "image", media_type: "image", url: image, mime_type: "image/jpeg" }]),
    image
  );
  // A sticker is how a lot of people forward a shoe screenshot.
  assert.equal(firstInboundImageUrl([{ type: "sticker", url: "https://x/s.webp", mime_type: "image/webp" }]), "https://x/s.webp");
  // The type field is not always populated; the mime alone is enough.
  assert.equal(firstInboundImageUrl([{ type: "", url: "https://x/p.png", mime_type: "image/png" }]), "https://x/p.png");
});

test("a voice note or a document never starts a visual search", () => {
  assert.equal(firstInboundImageUrl([{ type: "audio", url: "https://x/a.ogg", mime_type: "audio/ogg" }]), "");
  assert.equal(firstInboundImageUrl([{ type: "document", url: "https://x/d.pdf", mime_type: "application/pdf" }]), "");
  // and the image still wins when it arrives behind one
  assert.equal(
    firstInboundImageUrl([
      { type: "audio", url: "https://x/a.ogg", mime_type: "audio/ogg" },
      { type: "image", url: "https://x/i.jpg", mime_type: "image/jpeg" },
    ]),
    "https://x/i.jpg"
  );
});

test("a relative media path is refused - vision must be able to fetch it", () => {
  // /uploads on the SPA origin answers HTML 200, which is exactly how blank cards happen. Only an
  // absolute URL on the backend origin is a real image to anything outside this process.
  assert.equal(firstInboundImageUrl([{ type: "image", url: "/uploads/whatsapp-media/a.jpg", mime_type: "image/jpeg" }]), "");
  assert.equal(firstInboundImageUrl([]), "");
  assert.equal(firstInboundImageUrl(null), "");
});

// ── WhatsApp: the image has to REACH the AI ──────────────────────────────────────────────────

test("WhatsApp hands the downloaded photo to the auto-reply, not just to the inbox row", () => {
  // The gateway materializes inbound media to a public /uploads/whatsapp-media URL and always
  // saved it on the inbox row — but the object returned to triggerWhatsappAiAutoReply dropped it,
  // so the AI saw only the placeholder caption ("صورة") and answered a picture it never got.
  assert.match(gateway, /visualAttachments: mediaDescriptor\.visualAttachments,\r?\n\s*inbox,/,
    "the auto-reply payload carries the media descriptor");
  assert.match(gateway, /attachments: asArray\(message\.visualAttachments \|\| message\.visual_attachments\)/,
    "and it is passed into generateWhatsappAiAutoReply");
  assert.match(inboxService, /generateWhatsappAiAutoReply = async \(\{[^}]*attachments = \[\]/s,
    "the generator accepts them");
  assert.ok(!/message_text: body,\s*\r?\n\s*timestamp: timestamp \|\| new Date\(\)\.toISOString\(\),\s*\r?\n\s*attachments: \[\],/.test(inboxService),
    "the hard-coded empty attachments list is gone");
});

test("a recognised photo answers with cards; an unrecognised one falls through to the text reply", () => {
  const branch = inboxService.slice(
    inboxService.indexOf("const inboundImageUrl = firstInboundImageUrl(inboundAttachments)"),
    inboxService.indexOf("const loadedMemory = await loadAiConversationMemory")
  );
  assert.ok(branch.length > 0, "the visual branch runs before the text pipeline");
  assert.match(branch, /recogniseProductFromImage\(\{/, "it recognises the picture");
  assert.match(branch, /recognition\.matched && asArray\(recognition\.productCards\)\.length/,
    "cards are only sent on a real match");
  // The fall-through is the whole safety property: a photo we cannot place must still be answered.
  assert.match(branch, /visual-recognition-fallthrough/, "a miss is logged and continues");
  assert.ok(!/throw /.test(branch), "recognition never becomes a new way to lose a message");
  assert.match(branch, /\.catch\(\(error\) => \(\{ matched: false/, "even a thrown recogniser degrades to a miss");
});

test("the visual branch only reaches helpers that already exist at that point", () => {
  // The branch runs near the TOP of generateWhatsappAiAutoReply, before the function's own later
  // `const` helpers are initialised. Calling one of those is a temporal-dead-zone ReferenceError
  // that would fire on the single path whose whole job is to answer a photo — and only in
  // production, on a real image. Pin the ordering instead of trusting it.
  const branchStart = inboxService.indexOf("const inboundAttachments = asArray(attachments)");
  const branchEnd = inboxService.indexOf("const loadedMemory = await loadAiConversationMemory");
  const branch = inboxService.slice(branchStart, branchEnd);
  assert.ok(branchStart > -1 && branchEnd > branchStart, "the branch is where we think it is");
  // The premise, pinned on the helper that actually caused the bug: it is declared inside this
  // same function, below the branch, and closes over the loaded memory.
  const patchHelperAt = inboxService.indexOf("  const conversationMemoryV2Patch = ({");
  assert.ok(patchHelperAt > branchEnd, "conversationMemoryV2Patch is declared after the branch (guard premise)");
  for (const laterHelper of ["conversationMemoryV2Patch", "loadedMemoryWithV2", "unifiedDecision", "loadedMemory"]) {
    assert.ok(!branch.includes(laterHelper), `the visual branch must not reach ${laterHelper} before it exists`);
  }
  // and the memory writer is called with the parameters it actually declares
  assert.match(branch, /preferencesPatch: \{/, "the memory writer gets preferencesPatch, not an invented `patch`");
  assert.ok(!/\n\s*patch: \{/.test(branch), "no `patch` key — that parameter does not exist on updateAiConversationMemory");
});

test("the visual reply leaves the colours and sizes to the cards", () => {
  const builder = inboxService.slice(
    inboxService.indexOf("const buildVisualRecognitionPayload"),
    inboxService.indexOf("const buildBareConfirmationPayload")
  );
  assert.match(builder, /response_type: "product_card"/);
  assert.match(builder, /product_cards: cards/, "the cards are what carry the colours and sizes");
  // Listing every colour in the text as well makes the customer read the same catalogue twice —
  // the exact complaint that shrank the approve-and-send text leg.
  assert.ok(!/colors\.join/.test(builder), "the text does not re-narrate the carousel");
});

// ── The AI Inbox suggestion: the path that actually runs when auto-reply is off ───────────────

test("a channel's own placeholder for an uncaptioned attachment is not a customer question", () => {
  for (const placeholder of ["📷 صورة", "[صورة]", "صورة", "🎬 فيديو", "🖼️ ملصق", "📎 ملف", "", "   "]) {
    assert.equal(messageIsOnlyMediaPlaceholder(placeholder), true, `${placeholder || "(empty)"} is a placeholder`);
  }
});

test("a REAL caption is never thrown away in favour of what the photo looks like", () => {
  // The customer's own words outrank the picture: "عندكم ده مقاس ٤٣؟" already says what they want,
  // and rewriting the message from the image would lose the size they asked for.
  for (const caption of [
    "عندكم ده مقاس ٤٣؟",
    "الجزمة دي بكام",
    "الصورة دي بكام؟", // mentions the placeholder word inside a real sentence
    "ده متوفر؟",
    "فيه لون اسود؟",
    "بكام",
    "do you have this in 42",
  ]) {
    assert.equal(messageIsOnlyMediaPlaceholder(caption), false, `"${caption}" is a real question`);
  }
});

test("a WhatsApp photo on a real inbox row is found where the row actually keeps it", () => {
  // LIVE 2026-09-11: with the lookup fixed, a customer's photo still produced nothing — no match,
  // no miss, no log. The branch read `latestCustomerRow.attachments`, and an inbox row has no such
  // field: normalizeInboxMessage exposes the media as `visual_attachments`. So `firstInboundImageUrl`
  // got [] for every photo and the branch never ran. Checked on the REAL mapper, not on a hand-made
  // object, because a hand-made object is exactly what let the wrong field name through.
  const photoUrl = "https://api.m1store-egy.com/uploads/whatsapp-media/ABC.jpg";
  const row = normalizeInboxMessage({
    id: 1,
    session_id: "whatsapp:201022616025",
    sender_type: "customer",
    customer_message: "📷 صورة", // what saveWhatsappIncomingToAiInbox stores for an uncaptioned photo
    visual_attachments: [{ type: "image", media_type: "image", url: photoUrl, media_url: photoUrl, mime_type: "image/jpeg" }],
  });
  assert.equal(firstInboundImageUrl(row.attachments || []), "", "premise: the old read finds nothing on a real row");
  assert.equal(firstInboundImageUrl(inboxMessageMedia(row)), photoUrl, "the photo is found on the field the row carries");
  assert.equal(messageIsOnlyMediaPlaceholder(row.customer_message), true, "and its text is recognised as the channel placeholder");
  // The pipeline must read the media through the same helper this test exercises.
  assert.match(salesAgent, /const latestCustomerMedia = inboxMessageMedia\(latestCustomerRow\);/);
  assert.match(salesAgent, /const inboundImageUrl = firstInboundImageUrl\(latestCustomerMedia\);/);
});

test("an uncaptioned WhatsApp photo reaches the assisted-reply intake", () => {
  // LIVE 2026-09-11, the fourth gate: the gateway saves a caption-less photo as a media-only row
  // (trace reason `media_only_no_ai`) and returns `text: ""`, and the webhook route only called the
  // intake `if (normalized.text && …)`. So a customer's product photo never produced a suggestion,
  // however the pipeline behind it was fixed.
  const route = fs.readFileSync(new URL("../server/routes/whatsappGateway.js", import.meta.url), "utf8");
  const gate = route.slice(route.indexOf("const photoOnlyIntakeText ="), route.indexOf("fromMe: false,"));
  assert.ok(gate.length > 0, "the photo-only intake gate exists");
  assert.match(gate, /normalized\.media_type === "image"/, "only a PHOTO is let through — not voice, video or stickers");
  assert.match(gate, /normalized\.inbox\?\.reason === "media_saved"/, "and only a freshly saved media row");
  assert.match(gate, /const intakeText = normalized\.text \|\| photoOnlyIntakeText;/);
  assert.match(gate, /if \(intakeText && normalized\.fromMe !== true/, "the store's own photos stay out");
  assert.match(gate, /text: intakeText,/, "the intake gets the row's placeholder, which the pipeline reads as 'the picture is the message'");
  // and the gateway tells the route what it saved
  const mediaReturn = gateway.slice(gateway.indexOf('await finishTrace(trace, { status: "saved", reason: "media_only_no_ai" });'), gateway.indexOf('reason: mediaRow ? "media_saved" : "duplicate",'));
  assert.match(mediaReturn, /media_type: mediaDescriptor\.type,/);
  assert.match(mediaReturn, /media_label: mediaMessage,/);
});

test("a photo we saved is read off our own disk, never fetched back through the CDN", async () => {
  // Handing OpenAI the public URL makes it fetch api.m1store-egy.com through Cloudflare, which may
  // challenge a bot; every visual path that already works sends the bytes instead.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-upload-"));
  fs.mkdirSync(path.join(root, "uploads", "whatsapp-media"), { recursive: true });
  fs.writeFileSync(path.join(root, "uploads", "whatsapp-media", "abc.jpg"), "JPEGDATA");
  fs.writeFileSync(path.join(root, "secret.jpg"), "SECRET");
  const base = "https://api.m1store-egy.com";
  const read = await readLocalUploadImage(`${base}/uploads/whatsapp-media/abc.jpg`, { root });
  assert.equal(read?.mimeType, "image/jpeg");
  assert.equal(read?.buffer.toString(), "JPEGDATA");
  // The path comes from a URL, so nothing may walk out of ./uploads.
  for (const escape of ["/uploads/../secret.jpg", "/uploads/%2e%2e/secret.jpg", "/uploads/..%2fsecret.jpg", "/secret.jpg"]) {
    assert.equal(await readLocalUploadImage(`${base}${escape}`, { root }), null, `${escape} stays inside ./uploads`);
  }
  assert.equal(await readLocalUploadImage(`${base}/uploads/whatsapp-media/missing.jpg`, { root }), null, "a missing file falls back to the URL");
  assert.equal(await readLocalUploadImage(`${base}/uploads/whatsapp-media/abc.ogg`, { root }), null, "only image types are read");
  // and the recogniser hands vision the bytes, keeping the URL only for when there are none
  assert.match(recognition, /imageUrl: effectiveBuffer \? "" : safeImageUrl,/);
  assert.match(recognition, /uploadedImageBuffer: effectiveBuffer,/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a vision provider that refuses is reported as unavailable, not as an empty picture", async () => {
  // LIVE 2026-09-11: the miss read `no_visual_signal` while the real cause was OpenAI
  // `insufficient_quota` — the vision helper does not throw on a refusal, it returns an empty
  // reading with the provider error attached. Blank every key so this can never reach the network;
  // a missing key is refused the same way a spent quota is.
  const saved = { a: process.env.OPENAI_API_KEY, b: process.env.OPENAI_AGENT_API_KEY };
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_AGENT_API_KEY = "";
  try {
    const { recogniseProductFromImage } = await import("../server/services/aiVisualProductRecognitionService.js");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const result = await recogniseProductFromImage({ tenantId: 1, imageBuffer: png, mimeType: "image/png" });
    assert.equal(result.matched, false);
    assert.match(result.reason, /^vision_unavailable:/, `the provider's refusal is named (got ${result.reason})`);
  } finally {
    process.env.OPENAI_API_KEY = saved.a ?? "";
    process.env.OPENAI_AGENT_API_KEY = saved.b ?? "";
  }
});

test("an unrecognised photo is held with a question, never answered with a product", () => {
  // LIVE 2026-09-11: vision was refused, the pipeline ran on "📷 صورة", and a grey Skechers photo
  // was suggested back as "أيوه يا فندم. Air Jordan 4 for Men - black متوفر" — one tap from sent.
  assert.match(salesAgent, /const photoWentUnrecognised = Boolean\(inboundImageUrl && messageIsOnlyMediaPlaceholder\(lastMessage\)\);/,
    "decided AFTER the rewrite: still only a placeholder means the photo never became words");
  const hold = salesAgent.slice(salesAgent.indexOf("if (photoWentUnrecognised) {"), salesAgent.indexOf("const channelAdapterPayload = {"));
  assert.ok(hold.length > 0, "the hold runs after the grounding gate and before the draft is built");
  assert.match(hold, /reply\.answer = UNRECOGNISED_PHOTO_REPLY;/);
  assert.match(hold, /reply\.suggested_products = \[\];/, "no product card");
  assert.match(hold, /reply\.send_package = null;/, "and no colour choices to tick");
  const gateAt = salesAgent.indexOf("groundingResult = await applyInboxGroundingGate(");
  assert.ok(gateAt > -1 && gateAt < salesAgent.indexOf("if (photoWentUnrecognised) {"), "the gate cannot re-add a card after the hold");
  assert.match(salesAgent, /held_for_unrecognised_photo: photoWentUnrecognised,/, "the employee can see why the draft holds");
});

test("what the photo was read as goes first in the capped candidate set", async () => {
  // LIVE 2026-09-11: the visual scan returned `searched_indexed_images: 2500` — exactly its cap —
  // and the cap was filled by recency alone, so a product indexed long ago was never scored however
  // well it matched. Rows naming the brand/model the photo was read as now go first.
  const { visualCandidateLikeTerms } = await import("../server/services/aiVisualSearchProService.js");
  assert.deepEqual(visualCandidateLikeTerms({ brand: "Skechers", model: "Skechers Gorun Ride 7" }), ["%skechers%", "%skechers gorun ride 7%"]);
  assert.deepEqual(visualCandidateLikeTerms({ brand: "A_B", model: "50% off" }), ["%a\\_b%", "%50\\% off%"], "LIKE wildcards in a model name are literal");
  assert.deepEqual(visualCandidateLikeTerms({ brand: "NB" }), [], "a 2-letter term would match half the catalogue");
  assert.deepEqual(visualCandidateLikeTerms({ brand: "Nike", model: "nike" }), ["%nike%"]);
  assert.deepEqual(visualCandidateLikeTerms({}), []);
  const pro = fs.readFileSync(new URL("../server/services/aiVisualSearchProService.js", import.meta.url), "utf8");
  const query = pro.slice(pro.indexOf("FROM ai_product_image_visual_index idx"), pro.indexOf("LIMIT 2500") + 20);
  assert.match(query, /LIKE ANY\(\$2::text\[\]\)\s*\r?\n\s*THEN 0 ELSE 1\s*\r?\n\s*END,\s*\r?\n\s*COALESCE\(idx\.last_indexed_at/, "attribute matches sort before recency");
  assert.match(pro, /\[tenant, visualCandidateLikeTerms\(attributes\)\]/);
});

test("the inbox reply resolves its conversation by key, never by a 100-row sweep", () => {
  // LIVE 2026-09-10: the assisted intake logged `generation_blocked:Conversation not found` for
  // EVERY WhatsApp message — 0 suggestions out of 413 in a week — because generateAiInboxReply
  // loaded the first 100 inbox rows and searched them for `session_id ===`. The WhatsApp threads
  // the intake asked for were not among those 100 in any format, while a Messenger thread from the
  // same minutes was. So no suggestion — photo or text — ever reached a WhatsApp customer.
  const fn = salesAgent.slice(
    salesAgent.indexOf("export const generateAiInboxReply = async"),
    salesAgent.indexOf("const typedMessage = latestCustomerMessage(conversation.messages)")
  );
  assert.ok(fn.length > 0, "the conversation lookup sits at the top of the function");
  assert.match(fn, /findAiInboxConversationByKeys\(\{ tenantId, keys: \[conversationId\] \}\)/,
    "the conversation is resolved by key, wherever it ranks");
  assert.ok(!/loadAiInbox\(\{ tenantId, filter: "all", limit: 100 \}\)/.test(fn),
    "the 100-row sweep that could not see WhatsApp threads is gone");
  assert.ok(!/\.find\(\(item\) => item\.session_id === conversationId\)/.test(fn),
    "and so is the exact-string search over it");
});

test("the inbox pipeline turns a photo into words instead of bypassing the grounding gate", () => {
  const branch = salesAgent.slice(
    salesAgent.indexOf("const latestCustomerMedia = inboxMessageMedia(latestCustomerRow)"),
    salesAgent.indexOf("let replyHarness = null")
  );
  assert.ok(branch.length > 0, "the branch sits with the other inbound-resolution steps");
  assert.match(branch, /messageIsOnlyMediaPlaceholder\(lastMessage\)/, "it only fires when the picture IS the message");
  assert.match(branch, /lastMessage = `عندكم \$\{recognisedPhrase\}؟`/,
    "the photo becomes words the pipeline already knows how to read");
  // The gate stays authoritative: nothing here writes suggested_products or send_package.
  assert.ok(!branch.includes("suggested_products"), "the branch never assigns product cards itself");
  assert.ok(!branch.includes("send_package"), "and never builds the send package itself");
  assert.match(branch, /\.catch\(\(error\) => \(\{ matched: false/, "a thrown recogniser degrades to a miss");
});

// ── Meta: recognition already worked, but it answered with ONE colour ─────────────────────────

test("an exact image match on Meta fans back out into the colour carousel", () => {
  const branch = meta.slice(
    meta.indexOf("const baseGuardedCards = visualCards"),
    meta.indexOf("const compressionMemorySnapshot")
  );
  assert.ok(branch.length > 0, "the expansion sits between the gate and the send");
  assert.match(branch, /expandProductCardsByColor\(\{/, "the approved product is expanded by colour");
  assert.match(branch, /visualCards && baseGuardedCards\.length === 1/,
    "only a single approved product is expanded — never a multi-product batch");
  assert.match(branch, /leadColor: text\(/, "the photographed colour leads the carousel");
  assert.match(branch, /return baseGuardedCards;/, "a failed expansion still sends the single card");
});

test("the carousel is never followed by an offer to show the colours it just showed", () => {
  // "وفيه ألوان تانية كمان لو حابب أشوفهالك" is an offer. After the colour carousel every colour
  // is already on screen, so offering them again reads as if the cards never arrived.
  assert.match(meta, /const hasMultipleColors = !expandedToColorCarousel && \(/,
    "an expanded carousel suppresses the other-colours offer");
  assert.match(meta, /const expandedToColorCarousel = guardedCards\.length > baseGuardedCards\.length;/,
    "and it knows it expanded by comparing against the gated card");
});

test("the product gate that keeps the WRONG product out is untouched", () => {
  // The gate slicing to one entry is what stops a photo of a Jordan carding an Adidas. Expansion
  // happens AFTER it, so the answer is still exactly one product — just all of its colours.
  const gate = fs.readFileSync(new URL("../server/services/aiProductDecisionGate.js", import.meta.url), "utf8");
  assert.match(gate, /if \(exactMode && accepted\.length\) \{\s*\r?\n\s*accepted = accepted\.slice\(0, 1\);/,
    "an exact match still approves exactly one product");
  const gateIndex = meta.indexOf("const gate = evaluateProductDecisionGate({");
  const expandIndex = meta.indexOf("expandProductCardsByColor({");
  assert.ok(gateIndex > -1 && expandIndex > gateIndex, "expansion never runs before the gate");
});

// ── one implementation of the colour rules ───────────────────────────────────────────────────

test("every channel expands colours through the same service", () => {
  assert.match(recognition, /import \{ expandProductCardsByColor \} from "\.\/aiProductColorCarouselService\.js"/);
  assert.match(meta, /import \{ expandProductCardsByColor \} from "\.\/aiProductColorCarouselService\.js"/);
  // The hard-won rules live in one place: raw price columns for the canonical resolver, the
  // flattening that stops a colour card re-expanding, and the square-canvas photo.
  assert.match(carouselService, /purchase_selling_price/);
  assert.match(carouselService, /ensureSquareCardImageUrl/);
  assert.match(carouselService, /\.\.\.flatCard/);
});

test("the photographed colour sorts to the front of the carousel", () => {
  const sort = carouselService.slice(carouselService.indexOf("const leadKey = normalizeColorKey(leadColor)"), carouselService.indexOf("for (const colorCard of ordered)"));
  assert.ok(sort.length > 0, "the ordering exists");
  assert.match(sort, /leftLead - rightLead/, "the matched colour is ordered first");
  // Pinned to the exact condition: anything that disables the ordering (`false && leadKey`, a
  // dropped branch) still reads as "a ternary on leadKey" to a looser pattern.
  assert.match(sort, /const ordered = leadKey\s*\r?\n?\s*\?/, "no lead colour leaves the catalog order alone");
  assert.match(sort, /: colorCards;/, "and the untouched order is the catalog's own");
});

test("a recognised product with one colour still sends a real card", () => {
  const build = recognition.slice(recognition.indexOf("const cardsForRecognisedProduct"), recognition.indexOf("export const recogniseProductFromImage"));
  assert.match(build, /normalizeProductCards\(\[\{ \.\.\.product, variants: variantsResult\.rows \}\], \{ limit: 1 \}\)/,
    "the card is rebuilt from the catalog row, so it carries the price columns");
  assert.match(build, /return expandProductCardsByColor/, "and then expanded when there is more than one colour");
});

test("a low-confidence guess is not presented as the customer's product", () => {
  assert.match(recognition, /below_recognition_threshold/);
  assert.match(recognition, /!search\?\.exactMatch && score < minScore/,
    "only an exact index match skips the score floor");
  assert.match(recognition, /matched: false, reason: "recognised_product_has_no_sendable_card"/,
    "a product we cannot card is a miss, not a blank send");
});

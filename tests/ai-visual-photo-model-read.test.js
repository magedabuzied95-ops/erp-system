import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import db from "../server/database/db.js";
import {
  PHOTO_ONLY_CUSTOMER_QUESTION,
  findStockedProductsNamingModel,
  photoOnlyAutoReplyText,
  visualModelNamePhrases,
  visualModelQuestion,
} from "../server/services/aiVisualProductRecognitionService.js";
import { searchAiVisualProductsPro, visualSearchNeedsRelevanceGate } from "../server/services/aiVisualSearchProService.js";

// LIVE 2026-10-19, the owner's own WhatsApp test: a photo of an Adidas Terrex, read correctly by the
// vision (brand "Adidas", model "Terrex"), scored 2500 indexed images and named nothing — while seven
// Terrex pairs were in stock. And two photos sent with no caption got no reply at all.

const withFakeDb = async (handler, fn) => {
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => handler(String(sql), params || []);
  try {
    return await fn();
  } finally {
    db.query = originalQuery;
  }
};

const silenced = async (fn) => {
  const { log, info, warn } = console;
  console.log = console.info = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, info, warn });
  }
};

const terrexRow = (product_id, product_name, grade) => ({
  id: product_id * 10,
  tenant_id: 1,
  product_id,
  variant_id: product_id * 100,
  product_name,
  brand: "Adidas",
  grade,
  color: "Black",
  image_url: `https://res.cloudinary.com/demo/image/upload/p${product_id}.jpg`,
  stock: 4,
  price: 2400,
  available_sizes: ["41", "42", "43"],
  is_active: true,
});

test("an Adidas photo is not thrown away by the chat's text relevance gate", async () => {
  // The vision's Arabic keywords say "اديداس", which contains "دا" — read by the text gate as
  // "this one", so it gated, and without a model family nothing can reach its 65 points.
  const indexRows = [
    terrexRow(44, "TERREX TRAILMAKER 2", "mirror_original"),
    terrexRow(62, "Terrex Two Gore", "mirror_original"),
    terrexRow(358, "Adidas Terrex", "imported_from_vietnam"),
  ];
  const search = await silenced(() => withFakeDb((sql) => {
    if (sql.includes("information_schema.columns")) return { rows: ["id", "name", "slug", "tenant_id"].map((column_name) => ({ column_name })) };
    if (sql.includes("FROM ai_product_image_visual_index idx")) return { rows: indexRows };
    return { rows: [] };
  }, () => searchAiVisualProductsPro({
    tenantId: 1,
    detected: {
      brand_guess: "Adidas",
      model_guess: "Terrex",
      product_type: "trail running shoe",
      main_colors: ["black"],
      english_keywords: ["adidas terrex", "trail"],
      arabic_keywords: ["اديداس تيركس", "كوتشي"],
    },
    visualQuery: "Adidas Terrex trail running shoe black",
    limit: 24,
  })));
  assert.equal(search.searchedCount, 3);
  assert.ok(search.topMatches.length > 0, `the Terrex rows survive (fallback: ${search.fallbackReason})`);
  assert.deepEqual([...new Set(search.topMatches.map((row) => row.product_id))].sort((a, b) => a - b), [44, 62, 358]);
  assert.notEqual(search.fallbackReason, "no_usable_visual_candidates");
});

test("the text gate still guards a photo read as a model family it knows", () => {
  assert.equal(visualSearchNeedsRelevanceGate({ requires_relevance_gate: true, requested_model_family: "air_jordan_4" }), true);
  assert.equal(visualSearchNeedsRelevanceGate({ requires_relevance_gate: true, requested_model_family: "", requested_brand: "adidas" }), false);
  assert.equal(visualSearchNeedsRelevanceGate({ requires_relevance_gate: false, requested_model_family: "jordan" }), false);
  assert.equal(visualSearchNeedsRelevanceGate(), false);
});

test("the model words a photo was read as, longest first, brand and shoe-kind dropped", () => {
  assert.deepEqual(visualModelNamePhrases({ brand_guess: "Adidas", model_guess: "Terrex" }), ["terrex"]);
  assert.deepEqual(visualModelNamePhrases({ model_guess: "Adidas Terrex Free Hiker" }), ["terrex free hiker", "terrex free", "terrex"]);
  assert.deepEqual(visualModelNamePhrases({ model_guess: "Terrex", model_family: "Terrex Swift" }), ["terrex", "terrex swift"]);
  assert.deepEqual(visualModelNamePhrases({ model_guess: "black running shoe", brand_guess: "Nike" }), [], "no model word ⇒ nothing");
  assert.deepEqual(visualModelNamePhrases({ model_guess: "Adidas" }), [], "a brand alone is not a model");
  assert.deepEqual(visualModelNamePhrases({ model_guess: "Air Jordan 4" }), [], "a model whose first word is a number is left to the alias list");
  assert.deepEqual(visualModelNamePhrases({}), []);
});

test("a clearly read model finds the in-stock products that carry its name", async () => {
  const calls = [];
  const read = await withFakeDb((sql, params) => {
    calls.push({ sql, params });
    return { rows: params[1] === "terrex" ? [{ id: 44, name: "TERREX TRAILMAKER 2" }, { id: 358, name: "Terrex" }] : [] };
  }, () => findStockedProductsNamingModel({ tenantId: 1, detected: { model_guess: "Terrex Free Hiker" } }));
  assert.deepEqual(read, { phrase: "terrex", products: [{ id: 44, name: "TERREX TRAILMAKER 2" }, { id: 358, name: "Terrex" }] });
  assert.deepEqual(calls.map((call) => call.params[1]), ["terrex free hiker", "terrex free", "terrex"], "walks back to the family word");
  assert.match(calls[0].sql, /COALESCE\(v\.stock, 0\) > 0/, "only a pair in stock counts");
  assert.match(calls[0].sql, /lower\(p\.name\) ~ /, "matched as whole words in the product name");

  const none = await withFakeDb(() => ({ rows: [] }), () => findStockedProductsNamingModel({ tenantId: 1, detected: { model_guess: "Ozweego" } }));
  assert.equal(none, null, "nothing in stock by that name ⇒ the honest no-match reply stands");
  const unread = await withFakeDb(() => { throw new Error("must not query"); }, () => findStockedProductsNamingModel({ tenantId: 1, detected: { model_guess: "sneaker" } }));
  assert.equal(unread, null);
});

test("the lookup uses columns products really has, and Ultraboost finds Ultra Boost", async () => {
  // LIVE 2026-10-19: `p.deleted_at` does not exist on products, so this query threw on every photo
  // and no photo ever named a model; and "Ultraboost" never matched "Adidas Ultra Boost".
  const calls = [];
  await withFakeDb((sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 129, name: "Adidas Ultra Boost" }] };
  }, () => findStockedProductsNamingModel({ tenantId: 1, detected: { model_guess: "Adidas Ultraboost" } }));
  const { sql, params } = calls[0];
  assert.doesNotMatch(sql, /\bp\.deleted_at\b/, "products is archived by status, it has no deleted_at");
  assert.match(sql, /LOWER\(TRIM\(p\.status\)\)/, "archived products stay out");
  assert.match(sql, /regexp_replace\(lower\(p\.name\), '\[\^a-z0-9\]\+', '', 'g'\) LIKE/, "spacing-blind name match");
  assert.equal(params[3], "ultraboost");
});

test("the recogniser hands the model read back on every miss", () => {
  const recognition = fs.readFileSync(new URL("../server/services/aiVisualProductRecognitionService.js", import.meta.url), "utf8");
  const missPaths = recognition.match(/\.\.\.\(await modelReadFor\(\{ tenantId, understanding \}\)\)/g) || [];
  assert.equal(missPaths.length, 2, "index error and a match with no sendable card");
  // No confident match: the read is taken once, tried as a family pick, and handed back on a miss.
  assert.match(recognition, /const readForCompare = await modelReadFor\(\{ tenantId, understanding \}\);/);
  assert.match(recognition, /const modelRead = readForCompare;/);
  assert.equal((recognition.match(/\.\.\.modelRead,?\s*\}/g) || []).length + (recognition.match(/\.\.\.modelRead \}/g) || []).length >= 2, true, "both the family pick and the miss carry the read");
  assert.match(recognition, /return read \? \{ modelQuery: read\.phrase, modelProductIds:/);
});

test("a photo read as a stocked model is asked as that model, typed out", () => {
  assert.equal(visualModelQuestion("terrex"), "عندكم terrex؟");
  assert.equal(visualModelQuestion("terrex", PHOTO_ONLY_CUSTOMER_QUESTION), "عندكم terrex؟");
  assert.equal(visualModelQuestion("terrex", "دا موجود"), "عندكم terrex؟", "the typed 'is this available' adds nothing");
  assert.equal(visualModelQuestion("terrex", "\u{1F4F7} صورة"), "عندكم terrex؟", "the channel's placeholder is not a caption");
  assert.equal(visualModelQuestion("terrex", "مقاس 42"), "عندكم terrex؟ مقاس 42", "a real caption rides along");
  assert.equal(visualModelQuestion("", "مقاس 42"), "");

  const inbox = fs.readFileSync(new URL("../server/services/aiInboxService.js", import.meta.url), "utf8");
  const branch = inbox.slice(inbox.indexOf("const modelQuestion = visualModelQuestion(recognition.modelQuery, originalBody);"), inbox.indexOf("const loadedMemory = await loadAiConversationMemory({"));
  assert.ok(branch.length > 0, "the WhatsApp auto-reply turns the model read into a question");
  assert.match(branch, /\n\s*if \(modelQuestion\) \{\s*\r?\n[\s\S]*?return generateWhatsappAiAutoReply\(\{[\s\S]*messageText: modelQuestion,[\s\S]*attachments: \[\],/, "re-entered as text, the photo left behind");

  const salesAgent = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(salesAgent, /\} else if \(visualRecognition\?\.modelQuery\) \{\s*\r?\n(?:\s*\/\/.*\r?\n)*\s*lastMessage = visualModelQuestion\(visualRecognition\.modelQuery\);/, "the inbox draft does the same");
});

test("a photo with no caption is answered as 'is this available?'", () => {
  const photo = {
    text: "",
    media_type: "image",
    inbox: { saved: true, reason: "media_saved" },
    visualAttachments: [{ type: "image", url: "https://api.example.com/uploads/whatsapp-media/a.jpg", mime_type: "image/jpeg" }],
  };
  assert.equal(PHOTO_ONLY_CUSTOMER_QUESTION, "دا موجود؟");
  assert.equal(photoOnlyAutoReplyText(photo), PHOTO_ONLY_CUSTOMER_QUESTION);
  assert.equal(photoOnlyAutoReplyText({ ...photo, text: "بكام" }), "", "a caption is answered as itself");
  assert.equal(photoOnlyAutoReplyText({ ...photo, fromMe: true }), "", "our own photos never");
  assert.equal(photoOnlyAutoReplyText({ ...photo, media_type: "audio" }), "", "voice notes stay out");
  assert.equal(photoOnlyAutoReplyText({ ...photo, inbox: { saved: false, reason: "duplicate" } }), "", "a duplicate is not answered twice");
  assert.equal(photoOnlyAutoReplyText({ ...photo, visualAttachments: [] }), "", "no picture we can read ⇒ nothing to answer");

  const route = fs.readFileSync(new URL("../server/routes/whatsappGateway.js", import.meta.url), "utf8");
  const gate = route.slice(route.indexOf("const photoOnlyQuestion = photoOnlyAutoReplyText(normalized);"), route.indexOf("const photoOnlyIntakeText ="));
  assert.ok(gate.length > 0, "the webhook asks for the photo-only question");
  assert.match(gate, /const aiInput = photoOnlyQuestion \? \{ \.\.\.normalized, text: photoOnlyQuestion \} : normalized;/);
  assert.match(gate, /const aiReply = aiInput\.text && /);
  assert.match(gate, /triggerWhatsappAiAutoReply\(aiInput\)/);
});

test("a photo matched only to its family is told as the closest model, never as the same one", async () => {
  const { productIsReadModelLine } = await import("../server/services/aiVisualProductRecognitionService.js");
  const { buildVisualRecognitionPayload, VISUAL_SAME_MODEL_TEXT, VISUAL_CLOSEST_MODEL_TEXT } = await import("../server/services/aiInboxService.js");
  // LIVE 2026-10-19: a Terrex photo got all 18 Terrex cards. The owner: the same model, or the
  // closest — and the customer must be told it is the closest.
  assert.equal(productIsReadModelLine({ model_guess: "Terrex Two Gore" }, "Adidas Terrex Two Gore"), true);
  assert.equal(productIsReadModelLine({ model_guess: "Terrex" }, "Adidas Terrex"), false, "the family word alone cannot tell the lines apart");
  assert.equal(productIsReadModelLine({ model_guess: "Terrex Free Hiker" }, "Adidas TERREX TRAILMAKER 2"), false);
  const cards = [{ name: "Adidas Terrex - Grey", color: "Grey" }, { name: "Adidas Terrex - Black", color: "Black" }];
  assert.equal(buildVisualRecognitionPayload({ cards, recognition: { closest: true } }).channel_reply.text, VISUAL_CLOSEST_MODEL_TEXT);
  assert.equal(buildVisualRecognitionPayload({ cards, recognition: { closest: false } }).channel_reply.text, VISUAL_SAME_MODEL_TEXT);
  assert.match(VISUAL_CLOSEST_MODEL_TEXT, /أقرب/);
});

test("the photo comparison gets one candidate per product colour, from the right pool", async () => {
  const { photoCandidatePool, photoMatchKind } = await import("../server/services/aiVisualProductRecognitionService.js");
  const { buildVisualRecognitionPayload, VISUAL_OTHER_COLOR_TEXT, VISUAL_SAME_MODEL_TEXT, VISUAL_CLOSEST_MODEL_TEXT } = await import("../server/services/aiInboxService.js");
  const rows = [
    { product_id: "78", color: "Black & Gray", image_url: "/a.jpg", score_breakdown: { brandScore: 1 } },
    { product_id: "78", color: "black & gray", image_url: "/a2.jpg", score_breakdown: { brandScore: 1 } },
    { product_id: "44", color: "White", image_url: "/b.jpg", score_breakdown: { brandScore: 1 } },
    { product_id: "999", color: "White", image_url: "/c.jpg", score_breakdown: { brandScore: 0 } },
    { product_id: "45", color: "Navy", image_url: "", score_breakdown: { brandScore: 1 } },
  ];
  assert.deepEqual(photoCandidatePool(rows, { familyIds: ["78", "44"] }).map((row) => row.image_url), ["/a.jpg", "/b.jpg"], "family only, one per colour");
  assert.deepEqual(photoCandidatePool(rows).map((row) => row.image_url), ["/a.jpg", "/b.jpg"], "no family: same brand only, photos only");
  assert.equal(photoMatchKind({ sameModel: true, sameColor: true }), "same");
  assert.equal(photoMatchKind({ sameModel: true, sameColor: false }), "same_model_other_color");
  assert.equal(photoMatchKind({ sameModel: false, sameColor: true }), "closest");
  const cards = [{ name: "x", color: "White" }];
  assert.equal(buildVisualRecognitionPayload({ cards, recognition: { photoMatch: "same" } }).channel_reply.text, VISUAL_SAME_MODEL_TEXT);
  assert.equal(buildVisualRecognitionPayload({ cards, recognition: { photoMatch: "same_model_other_color" } }).channel_reply.text, VISUAL_OTHER_COLOR_TEXT);
  assert.equal(buildVisualRecognitionPayload({ cards, recognition: { photoMatch: "closest", closest: true } }).channel_reply.text, VISUAL_CLOSEST_MODEL_TEXT);
});

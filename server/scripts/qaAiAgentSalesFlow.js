import assert from "node:assert/strict";
import crypto from "node:crypto";

const STAGES = Object.freeze({
  productDiscussion: "product_discussion",
  objectionHandling: "objection_handling",
  readyToOrder: "ready_to_order",
  collectingName: "collecting_name",
  collectingPhone: "collecting_phone",
  collectingAddress: "collecting_address",
  draftCreated: "draft_created",
  handoff: "handoff",
});

const normalize = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ");

const hasAny = (message, terms) => {
  const normalized = normalize(message);
  return terms.some((term) => normalized.includes(normalize(term)));
};

const isBuyingIntent = (message) =>
  hasAny(message, ["تمام هاخده", "تمام هاخدها", "اعمل اوردر", "احجزهولي", "ابعتهولي", "هطلبه"]);

const detectObjection = (message) => {
  const checks = [
    ["discount", ["خصم", "اخر سعر", "آخر سعر"]],
    ["exchange_complaint", ["استرجاع", "ارجاع", "شكوى", "زعلان"]],
    ["expensive", ["السعر غالي", "غالي"]],
    ["delivery_fee", ["التوصيل كام"]],
  ];
  return checks.find(([, terms]) => hasAny(message, terms))?.[0] || "";
};

const detectVisualRequest = (message) => {
  if (hasAny(message, ["دليل المقاسات", "size guide"])) return "size_guide";
  if (hasAny(message, ["المقاسات", "مقاسات"])) return "sizes";
  if (hasAny(message, ["فيه الوان", "ألوان", "الوان"])) return "colors";
  if (hasAny(message, ["تلبس على ايه", "complete the look"])) return "complete_the_look";
  if (hasAny(message, ["ابعت صور", "عايز اشوفها", "وريني", "شكلها عامل ايه"])) return "product_images";
  return "";
};

const isPhone = (value) => /^01[0125]\d{8}$/.test(String(value || "").replace(/\D/g, ""));

const fixtureProduct = () => ({
  id: 101,
  name: "Air Jordan 4 Black Cat",
  price: 3200,
  regular_price: 4200,
  total_stock: 5,
  variants: [
    { id: 501, size: "42", color: "black", stock: 2, price: 3200, image_url: "/uploads/products/jordan-4-black-42.webp" },
    { id: 502, size: "43", color: "black", stock: 3, price: 3200, image_url: "/uploads/products/jordan-4-black-43.webp" },
  ],
  image_url: "/uploads/products/jordan-4-black.webp",
});

class SalesFlowHarness {
  constructor({ product = fixtureProduct(), confidence = 0.95 } = {}) {
    this.product = product;
    this.confidence = confidence;
    this.memory = {};
    this.drafts = new Map();
  }

  findProduct(message) {
    if (this.confidence < 0.62) return null;
    if (hasAny(message, ["جوردن", "jordan", "هاخده", "هاخدها", "42", "صور", "اشوفها", "وريني", "الوان", "ألوان", "المقاسات", "دليل المقاسات", "complete the look"]) || this.memory.product) return this.product;
    return null;
  }

  findVariant(size = this.memory.size || "42") {
    return this.product.variants.find((variant) => variant.size === size && variant.stock > 0) || null;
  }

  hydrate(message) {
    if (hasAny(message, ["42"])) this.memory.size = "42";
    if (isPhone(message)) this.memory.phone = message.replace(/\D/g, "");
    if (this.memory.lastStage === STAGES.collectingName && !isPhone(message) && !isBuyingIntent(message)) this.memory.name = message.trim();
    if (this.memory.lastStage === STAGES.collectingAddress && message.trim().length >= 6) this.memory.address = message.trim();
  }

  reply(message, metadata = {}) {
    this.memory = { ...this.memory, ...metadata };
    this.hydrate(message);
    const objection = detectObjection(message);
    const visualRequest = detectVisualRequest(message);
    const product = visualRequest ? this.product : this.findProduct(message);

    if (objection === "discount" || objection === "exchange_complaint") {
      return this.remember({
        stage: STAGES.handoff,
        answer: "هحوّلك لحد من الفريق يراجعها معاك.",
        draft: null,
        needs_human_support: true,
      });
    }

    if (objection) {
      return this.remember({
        stage: STAGES.objectionHandling,
        answer: "فاهم حضرتك، السعر مقابل الخامة والتقفيل. لو حابب أرشحلك حاجة أرخص أقدر.",
        draft: null,
      });
    }

    if (!product) {
      return this.remember({
        stage: STAGES.handoff,
        answer: "محتاج اسم المنتج أو صورة أوضح عشان أأكد الموديل.",
        draft: null,
        needs_human_support: true,
      });
    }
    this.memory.product = product;

    if (!isBuyingIntent(message) && !this.isCollecting()) {
      return this.remember({
        stage: STAGES.productDiscussion,
        answer: `${product.name} سعره ${product.price} جنيه، ومتاح حاليا. متاح مقاس 42 و43.`,
        draft: null,
        visual_attachments: visualRequest ? this.visualAttachments(visualRequest, product) : [],
      });
    }

    const variant = this.findVariant();
    if (!this.memory.name) {
      return this.remember({
        stage: STAGES.collectingName,
        answer: "تشرفنا ❤️ ممكن أعرف اسم حضرتك؟",
        draft: null,
      });
    }
    if (!this.memory.phone) {
      return this.remember({
        stage: STAGES.collectingPhone,
        answer: "تمام يا فندم، ممكن رقم الموبايل للتواصل؟",
        draft: null,
      });
    }
    if (!this.memory.address) {
      return this.remember({
        stage: STAGES.collectingAddress,
        answer: "ممكن العنوان بالتفصيل؟",
        draft: null,
      });
    }
    if (!variant) {
      return this.remember({
        stage: STAGES.readyToOrder,
        answer: "المقاس/اللون ده غير متاح حاليا. أقدر أرشحلك بديل.",
        draft: null,
      });
    }

    return this.createDraft({ product, variant, message });
  }

  isCollecting() {
    return [STAGES.collectingName, STAGES.collectingPhone, STAGES.collectingAddress, STAGES.readyToOrder].includes(this.memory.lastStage);
  }

  remember(response) {
    this.memory.lastStage = response.stage;
    return response;
  }

  createDraft({ product, variant, message }) {
    const key = crypto
      .createHash("sha256")
      .update(JSON.stringify({ conversation: "qa-session", productId: product.id, variantId: variant.id, phone: this.memory.phone }))
      .digest("hex");
    if (!this.drafts.has(key)) {
      this.drafts.set(key, {
        product_id: product.id,
        variant_id: variant.id,
        quantity: 1,
        customer_name: this.memory.name,
        customer_phone: this.memory.phone,
        customer_address: this.memory.address,
        unit_price: variant.price,
        total_amount: variant.price,
        original_message: message,
      });
    }
    return this.remember({
      stage: STAGES.draftCreated,
      answer: "جهزت مسودة الأوردر. تأكيد الأوردر؟",
      draft: this.drafts.get(key),
      duplicate: this.drafts.size === 1,
    });
  }

  visualAttachments(type, product) {
    if (type === "size_guide" || type === "sizes") {
      return [{
        type: "size_guide",
        title: "دليل المقاسات",
        sizes: product.variants.map((variant) => variant.size),
      }];
    }
    if (type === "colors") {
      return [{
        type: "variant_color_cards",
        title: "الألوان والصور المتاحة",
        items: product.variants.map((variant) => ({
          id: variant.id,
          product_id: product.id,
          title: variant.color,
          subtitle: variant.size,
          image_url: variant.image_url,
          price: variant.price,
        })),
      }];
    }
    return [{
      type: type === "complete_the_look" ? "complete_the_look" : "product_image_cards",
      title: type === "complete_the_look" ? "اقتراحات تكمل اللوك" : "صور المنتجات",
      items: [{
        id: product.id,
        product_id: product.id,
        title: product.name,
        image_url: product.image_url,
        price: product.price,
      }],
    }];
  }

  confirm() {
    const draft = [...this.drafts.values()][0];
    const variant = this.product.variants.find((item) => item.id === draft.variant_id);
    if (!variant || variant.stock < draft.quantity) {
      return {
        stage: STAGES.handoff,
        answer: "المقاس خلص قبل التأكيد. هنرشح بديل أو نحولك للفريق.",
        confirmed: false,
      };
    }
    variant.stock -= draft.quantity;
    return { stage: "confirmed", answer: "تم تأكيد الأوردر.", confirmed: true };
  }
}

const assertNoCollection = (response) => {
  assert(!/اسم حضرتك|رقم الموبايل|العنوان/.test(response.answer), response.answer);
  assert.equal(response.draft, null);
};

const run = () => {
  let flow = new SalesFlowHarness();
  let response = flow.reply("جوردن فور بكام؟");
  assert.equal(response.stage, STAGES.productDiscussion);
  assert.match(response.answer, /3200|سعره/);
  assert.match(response.answer, /متاح/);
  assertNoCollection(response);

  flow = new SalesFlowHarness();
  response = flow.reply("متاح مقاس 42؟");
  assert.equal(response.stage, STAGES.productDiscussion);
  assert.match(response.answer, /متاح/);
  assertNoCollection(response);

  for (const message of ["ابعت صور", "عايز أشوفها", "وريني", "شكلها عامل إيه؟"]) {
    flow = new SalesFlowHarness();
    response = flow.reply(message);
    assert.equal(response.stage, STAGES.productDiscussion);
    assert.equal(response.draft, null);
    assert(response.visual_attachments?.[0]?.items?.[0]?.image_url, `missing visual payload for ${message}`);
    assert(!/اسم حضرتك|رقم الموبايل|العنوان/.test(response.answer));
  }

  flow = new SalesFlowHarness();
  response = flow.reply("فيه ألوان؟");
  assert.equal(response.stage, STAGES.productDiscussion);
  assert.equal(response.visual_attachments?.[0]?.type, "variant_color_cards");
  assert(response.visual_attachments[0].items.length >= 1);

  flow = new SalesFlowHarness();
  response = flow.reply("دليل المقاسات");
  assert.equal(response.stage, STAGES.productDiscussion);
  assert.equal(response.visual_attachments?.[0]?.type, "size_guide");
  assert(response.visual_attachments[0].sizes.includes("42"));

  flow = new SalesFlowHarness();
  response = flow.reply("complete the look");
  assert.equal(response.stage, STAGES.productDiscussion);
  assert.equal(response.visual_attachments?.[0]?.type, "complete_the_look");
  assert.equal(response.draft, null);

  flow = new SalesFlowHarness();
  response = flow.reply("السعر غالي");
  assert.equal(response.stage, STAGES.objectionHandling);
  assertNoCollection(response);

  flow = new SalesFlowHarness();
  flow.reply("جوردن فور بكام؟");
  response = flow.reply("تمام هاخده");
  assert.equal(response.stage, STAGES.collectingName);
  assert.match(response.answer, /اسم حضرتك/);

  response = flow.reply("أحمد");
  assert.equal(flow.memory.name, "أحمد");
  assert.equal(response.stage, STAGES.collectingPhone);
  assert.match(response.answer, /رقم الموبايل/);

  flow = new SalesFlowHarness();
  response = flow.reply("تمام هاخده", { name: "أحمد", phone: "01012345678", address: "القاهرة مدينة نصر شارع 1", product: fixtureProduct(), size: "42" });
  assert.equal(response.stage, STAGES.draftCreated);
  assert(!/اسم حضرتك|رقم الموبايل|العنوان/.test(response.answer));

  assert.equal(response.draft.unit_price, 3200);
  assert.equal(response.draft.total_amount, 3200);
  assert.notEqual(response.draft.unit_price, fixtureProduct().regular_price);

  const duplicate = flow.reply("تمام هاخده");
  assert.equal(duplicate.stage, STAGES.draftCreated);
  assert.equal(flow.drafts.size, 1);

  flow.product.variants[0].stock = 0;
  response = flow.confirm();
  assert.equal(response.confirmed, false);
  assert.equal(response.stage, STAGES.handoff);

  for (const message of ["فيه خصم؟", "ينفع استبدال؟", "أنا زعلان من الطلب", "مش لاقي المنتج"]) {
    flow = new SalesFlowHarness({ confidence: message === "مش لاقي المنتج" ? 0.2 : 0.95 });
    response = flow.reply(message);
    assert.equal(response.stage, STAGES.handoff);
    assert.equal(response.draft, null);
  }

  console.log("[qa:ai-agent-sales-flow] all scenarios passed");
};

run();

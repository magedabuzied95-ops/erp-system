import { AI_INTENTS, classifyMetaConversationIntent } from "../services/metaIntegrationService.js";

const ALLOW_REAL_ORDER_CREATE = process.env.AI_INBOX_TEST_ALLOW_ORDER_CREATE === "true";

const text = (value = "") => String(value ?? "").trim();
const normalizePhone = (value = "") => {
  const normalized = text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  const match = normalized.match(/(?:\+?20|0020)?\s*(01[0125][\s-]?\d{4}[\s-]?\d{4})/);
  return match ? match[1].replace(/[^\d]/g, "") : "";
};

const extractSize = (value = "") => {
  const normalized = text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  const match = normalized.match(/\b(3[5-9]|4[0-8])\b/);
  return match ? match[1] : "";
};

const parseCheckoutData = (value = "") => {
  const lines = text(value).split(/\r?\n|,/).map(text).filter(Boolean);
  const phone = normalizePhone(value);
  const phoneIndex = lines.findIndex((line) => normalizePhone(line));
  const name = phoneIndex > 0 ? lines.slice(0, phoneIndex).join(" ") : "";
  const address = phoneIndex >= 0 ? lines.slice(phoneIndex + 1).join(" ") : "";
  return { name, phone, address };
};

const mockCatalog = {
  jordan4Black: {
    productId: "jordan-4",
    variantId: "jordan-4-black-43",
    model: "Jordan 4",
    brand: "Jordan",
    color: "Black",
    sizes: ["41", "42", "43", "44"],
    price: 1850,
    images: ["jordan4-black-1.jpg", "jordan4-black-2.jpg"],
  },
  jordan4Grey: {
    productId: "jordan-4",
    variantId: "jordan-4-grey-43",
    model: "Jordan 4",
    brand: "Jordan",
    color: "Grey",
    sizes: ["42", "43", "44"],
    price: 1850,
    images: ["jordan4-grey-1.jpg"],
  },
  northFace: {
    productId: "north-face-trail",
    variantId: "north-face-black-43",
    model: "North Face Trail",
    brand: "North Face",
    color: "Black",
    sizes: ["42", "43"],
    price: 2100,
    images: ["north-face-1.jpg"],
  },
};

const scenarioMessage = ({ sessionId, senderId, channel = "facebook_messenger", input = "", imageUrl = "", mid = "" }) => ({
  external_conversation_id: sessionId,
  external_customer_id: senderId,
  channel,
  message_text: input,
  external_message_id: mid,
  attachments: imageUrl ? [{ type: "image", payload: { url: imageUrl } }] : [],
});

const reply = (preview = "", productCards = []) => ({
  replyPreview: preview,
  productCards,
  sent: Boolean(preview || productCards.length),
});

const productCard = (product) => ({
  product_id: product.productId,
  variant_id: product.variantId,
  name: `${product.model} - ${product.color}`,
  brand: product.brand,
  color: product.color,
  sizes: product.sizes,
  price: product.price,
  image_url: product.images[0] || "",
});

const updateActiveProduct = (memory, product) => {
  memory.activeProductId = product.productId;
  memory.activeVariantId = product.variantId;
  memory.activeColor = product.color;
  memory.lastShownProductIds = [product.productId];
  memory.lastShownVariantIds = [product.variantId];
  memory.lastProductCards = [productCard(product)];
  memory.buyingStage = memory.buyingStage || "product_selected";
};

const mockBrain = ({ classification, message, memory, knownCustomer = null }) => {
  switch (classification.intent) {
    case AI_INTENTS.PRODUCT_SEARCH:
      updateActiveProduct(memory, mockCatalog.jordan4Black);
      return reply("عندي Jordan 4 متاح. أبدألك بأقرب لون.", [productCard(mockCatalog.jordan4Black)]);
    case AI_INTENTS.VISUAL_SEARCH:
      updateActiveProduct(memory, mockCatalog.northFace);
      memory.lastVisualAttributes = { brand: "North Face", confidence: 0.78 };
      return reply("ده أقرب موديل North Face شبه الصورة عندي.", [productCard(mockCatalog.northFace)]);
    case AI_INTENTS.COLOR_REQUEST:
      if (!memory.activeProductId) return reply("ألوان تانية لأنهي موديل؟");
      return reply("ألوان تانية من نفس الموديل.", [productCard(mockCatalog.jordan4Grey)]);
    case AI_INTENTS.ALTERNATIVES:
      if (!memory.activeProductId) return reply("بدائل لأنهي موديل؟");
      memory.lastIntent = "alternatives";
      return reply("بدائل قريبة من نفس الموديل.", [productCard(mockCatalog.jordan4Grey)]);
    case AI_INTENTS.SIZE_CHECK: {
      const size = classification.entities.size || extractSize(message.message_text) || memory.activeSize || "43";
      memory.activeSize = size;
      memory.buyingStage = "size_selected";
      return reply(`أيوه ${size} متوفر ✅\nالسعر ${mockCatalog.jordan4Black.price} جنيه.\nتحب أحجزهولك؟`);
    }
    case AI_INTENTS.MORE_IMAGES:
      if (!memory.activeProductId) return reply("صور أكتر لأنهي موديل؟");
      return reply("صور إضافية لنفس اللون.", [{ ...productCard(mockCatalog.jordan4Black), image_url: mockCatalog.jordan4Black.images[1] }]);
    case AI_INTENTS.BUYING_INTENT:
      if (knownCustomer?.phone && knownCustomer?.address) {
        memory.knownPhone = knownCustomer.phone;
        memory.lastAddressSummary = knownCustomer.address;
        memory.buyingStage = "checkout_collecting";
        memory.pendingAction = "confirm_reused_checkout_fields";
        return reply(`تمام يا ${knownCustomer.firstName}.\nنفس عنوان ${knownCustomer.address} ولا عنوان جديد؟`);
      }
      memory.buyingStage = "checkout_collecting";
      return reply("تمام، ابعتلي الاسم ورقم التليفون والمحافظة والمنطقة.");
    case AI_INTENTS.CHECKOUT: {
      const parsed = parseCheckoutData(message.message_text);
      if (parsed.name) memory.knownName = parsed.name;
      if (parsed.phone) memory.knownPhone = parsed.phone;
      if (parsed.address) memory.lastAddressSummary = parsed.address;
      if (memory.knownName && memory.knownPhone && memory.lastAddressSummary) {
        memory.buyingStage = "order_ready";
        return reply(`تمام\nالمنتج: Jordan 4 Black\nالمقاس: ${memory.activeSize || "43"}\nالشحن إلى: ${memory.lastAddressSummary}\nأأكد الطلب؟`);
      }
      return reply("ناقصني الاسم ورقم التليفون والعنوان.");
    }
    case AI_INTENTS.ORDER_CONFIRMATION:
      memory.buyingStage = "order_created";
      memory.orderDraftId = ALLOW_REAL_ORDER_CREATE ? "real-order-disabled-in-harness" : "mock-draft-order";
      return reply("تمام، عملتلك مسودة الطلب ✅");
    case AI_INTENTS.ORDER_STATUS:
      return reply("ابعتلي رقم الأوردر أو رقم الموبايل اللي اتعمل بيه الطلب، وأقولك وصل لفين.");
    case AI_INTENTS.FAQ:
      return reply("الشحن والدفع حسب المحافظة والمنطقة.");
    default:
      return reply("ابعتلي اسم الموديل أو صورة أوضح وأنا أجيبهولك.");
  }
};

const simulateTurn = ({ test, turn, memory, processedMids, knownCustomer }) => {
  const message = scenarioMessage({
    sessionId: test.sessionId,
    senderId: test.senderId,
    channel: test.channel,
    input: turn.input,
    imageUrl: turn.imageUrl,
    mid: turn.mid,
  });
  if (turn.mid && processedMids.has(turn.mid)) {
    return {
      duplicateSkipped: true,
      actualIntent: "DUPLICATE",
      replyPreview: "",
      memorySnapshot: { ...memory },
      productCards: [],
    };
  }
  if (turn.mid) processedMids.add(turn.mid);
  const classification = classifyMetaConversationIntent({ message, memory });
  const result = mockBrain({ classification, message, memory, knownCustomer });
  return {
    duplicateSkipped: false,
    actualIntent: classification.intent,
    confidence: classification.confidence,
    entities: classification.entities,
    replyPreview: result.replyPreview,
    productCards: result.productCards,
    memorySnapshot: { ...memory },
  };
};

const includesNoAdidasSuperstar = (cards = []) =>
  !cards.some((card) => /adidas|superstar/i.test([card.name, card.brand].join(" ")));

const tests = [
  {
    name: "A) Product memory and color request",
    sessionId: "test:product-memory",
    senderId: "sender-product-memory",
    turns: [
      {
        input: "فيه جوردن فور؟",
        expectedIntent: AI_INTENTS.PRODUCT_SEARCH,
        assert: ({ output }) => output.productCards.length > 0 && output.memorySnapshot.activeProductId,
      },
      {
        input: "ألوان تانية؟",
        expectedIntent: AI_INTENTS.COLOR_REQUEST,
        assert: ({ output }) => output.memorySnapshot.activeProductId === "jordan-4" && output.productCards.every((card) => card.product_id === "jordan-4"),
      },
    ],
  },
  {
    name: "B) Alternatives stay similar",
    sessionId: "test:alternatives",
    senderId: "sender-alternatives",
    seedMemory: { activeProductId: "jordan-4", activeVariantId: "jordan-4-black-43", activeColor: "Black", buyingStage: "product_selected" },
    turns: [{
      input: "بدائل",
      expectedIntent: AI_INTENTS.ALTERNATIVES,
      assert: ({ output }) => includesNoAdidasSuperstar(output.productCards),
    }],
  },
  {
    name: "C) Size check advances buying stage",
    sessionId: "test:size-check",
    senderId: "sender-size-check",
    seedMemory: { activeProductId: "jordan-4", activeVariantId: "jordan-4-black-43", activeColor: "Black" },
    turns: [{
      input: "43 موجود؟",
      expectedIntent: AI_INTENTS.SIZE_CHECK,
      assert: ({ output }) => output.memorySnapshot.activeSize === "43" && output.memorySnapshot.buyingStage === "size_selected",
    }],
  },
  {
    name: "D) More images uses active product",
    sessionId: "test:more-images",
    senderId: "sender-more-images",
    seedMemory: { activeProductId: "jordan-4", activeVariantId: "jordan-4-black-43", activeColor: "Black" },
    turns: [{
      input: "صور أكتر",
      expectedIntent: AI_INTENTS.MORE_IMAGES,
      assert: ({ output }) => output.productCards.length > 0 && !/أنهي|انهي/.test(output.replyPreview),
    }],
  },
  {
    name: "E) Visual search North Face",
    sessionId: "test:vision",
    senderId: "sender-vision",
    turns: [{
      input: "",
      imageUrl: "https://example.com/north-face-shoe.jpg",
      expectedIntent: AI_INTENTS.VISUAL_SEARCH,
      assert: ({ output }) => output.memorySnapshot.activeProductId === "north-face-trail" && /North Face/i.test(output.replyPreview),
    }],
  },
  {
    name: "F) Dedupe skips same mid",
    sessionId: "test:dedupe",
    senderId: "sender-dedupe",
    turns: [
      { input: "فيه جوردن فور؟", mid: "mid-1", expectedIntent: AI_INTENTS.PRODUCT_SEARCH },
      {
        input: "فيه جوردن فور؟",
        mid: "mid-1",
        expectedIntent: "DUPLICATE",
        assert: ({ output }) => output.duplicateSkipped === true,
      },
    ],
  },
  {
    name: "G) Sales flow to draft order",
    sessionId: "test:sales",
    senderId: "sender-sales",
    seedMemory: { activeProductId: "jordan-4", activeVariantId: "jordan-4-black-43", activeColor: "Black", activeSize: "43", buyingStage: "size_selected" },
    turns: [
      { input: "تمام احجزه", expectedIntent: AI_INTENTS.BUYING_INTENT },
      { input: "ماجد أبوزيد\n01024960585\nدمياط الجديدة شارع البشبيشي", expectedIntent: AI_INTENTS.CHECKOUT },
      {
        input: "تمام أكد",
        expectedIntent: AI_INTENTS.ORDER_CONFIRMATION,
        assert: ({ output }) => output.memorySnapshot.orderDraftId === "mock-draft-order",
      },
    ],
  },
  {
    name: "H) Customer brain reuses known fields",
    sessionId: "test:customer-brain",
    senderId: "sender-customer-brain",
    seedMemory: { activeProductId: "jordan-4", activeVariantId: "jordan-4-black-43", activeColor: "Black", activeSize: "43", buyingStage: "size_selected" },
    knownCustomer: { firstName: "أحمد", phone: "01024960585", address: "دمياط الجديدة" },
    turns: [{
      input: "احجزه",
      expectedIntent: AI_INTENTS.BUYING_INTENT,
      assert: ({ output }) => /نفس عنوان/.test(output.replyPreview) && output.memorySnapshot.pendingAction === "confirm_reused_checkout_fields",
    }],
  },
  {
    name: "I) Order tracking asks for reference",
    sessionId: "test:order-status",
    senderId: "sender-order-status",
    turns: [{
      input: "الأوردر وصل لفين؟",
      expectedIntent: AI_INTENTS.ORDER_STATUS,
      assert: ({ output }) => /رقم الأوردر|رقم الموبايل/.test(output.replyPreview),
    }],
  },
];

const run = () => {
  const report = [];
  let failed = 0;
  for (const test of tests) {
    console.log("[ai-test] running scenario", { name: test.name });
    const memory = { ...(test.seedMemory || {}) };
    const processedMids = new Set();
    const turnReports = [];
    let passed = true;
    let error = "";
    for (const turn of test.turns) {
      const output = simulateTurn({ test, turn, memory, processedMids, knownCustomer: test.knownCustomer || null });
      const intentMatches = output.actualIntent === turn.expectedIntent;
      const assertionMatches = typeof turn.assert === "function" ? Boolean(turn.assert({ output, memory })) : true;
      const turnPassed = intentMatches && assertionMatches;
      if (!turnPassed) {
        passed = false;
        error = `Expected ${turn.expectedIntent}, got ${output.actualIntent}`;
      }
      turnReports.push({
        input: turn.input || "[image]",
        expectedIntent: turn.expectedIntent,
        actualIntent: output.actualIntent,
        confidence: output.confidence ?? null,
        memorySnapshot: output.memorySnapshot,
        productCards: output.productCards?.map((card) => card.name || card.product_id) || [],
        replyPreview: text(output.replyPreview).slice(0, 180),
        duplicateSkipped: output.duplicateSkipped,
        passed: turnPassed,
      });
    }
    if (passed) {
      console.log("[ai-test] passed", { name: test.name });
    } else {
      failed += 1;
      console.error("[ai-test] failed", { name: test.name, error });
    }
    report.push({ name: test.name, passed, errors: error ? [error] : [], turns: turnReports });
  }

  console.log("\nAI Inbox Flow Test Report");
  console.log(JSON.stringify({
    safeMode: !ALLOW_REAL_ORDER_CREATE,
    total: report.length,
    passed: report.filter((item) => item.passed).length,
    failed,
    report,
  }, null, 2));

  if (failed) process.exitCode = 1;
};

run();

import assert from "node:assert/strict";

import { orchestrateAiResponse } from "../services/aiResponseOrchestratorService.js";
import { extractAiConversationMemory } from "../services/aiConversationMemoryService.js";
import { buildAiPriceGuard, guardAiNameCapture } from "../utils/aiProductReplyGuards.js";

const makeProduct = (overrides = {}) => ({
  product_id: 12,
  id: 12,
  name: "Nike Shox",
  title: "Nike Shox",
  productName: "Nike Shox",
  price: null,
  final_price: null,
  sale_price: null,
  regular_price: null,
  total_stock: 0,
  variants: [],
  ...overrides,
});

const missingPriceProduct = makeProduct({
  total_stock: 0,
  variants: [],
  price: null,
});

const guard = buildAiPriceGuard({
  productId: missingPriceProduct.product_id,
  variantId: null,
  rawPrice: missingPriceProduct.price,
  product: missingPriceProduct,
  productContext: { productId: missingPriceProduct.product_id, sizeOptions: ["42"] },
  memory: { selectedSize: "42" },
  messageText: "تمام",
  route: "verify-script",
});

assert.equal(guard.blockedDashPrice, true);
assert.equal(guard.memoryOnlyProduct, true);
assert.equal(guard.renderedPrice, "");

const missingPriceReply = orchestrateAiResponse({
  intent: "PRODUCT_SEARCH",
  customerMessage: "تمام",
  productContext: {
    productId: missingPriceProduct.product_id,
    productName: missingPriceProduct.name,
    price: null,
    total_stock: 0,
    variants: [],
  },
  selectedProduct: missingPriceProduct,
  availableSizes: ["42"],
  selectedSize: "42",
  customerMemory: {
    activeProductId: String(missingPriceProduct.product_id),
    selectedProductId: String(missingPriceProduct.product_id),
    selectedSize: "42",
  },
});

assert.ok(!/السعر:\s*-\s*جنيه/.test(missingPriceReply.replyText));
assert.ok(!/\bمتاح\b/.test(missingPriceReply.replyText));
assert.ok(/السعر محتاج يتأكد|ابعتلي اسمك ورقمك/.test(missingPriceReply.replyText));

const undefinedPriceReply = orchestrateAiResponse({
  intent: "PRODUCT_SEARCH",
  customerMessage: "اكد الاوردر",
  productContext: {
    productId: missingPriceProduct.product_id,
    productName: missingPriceProduct.name,
    price: undefined,
    total_stock: 0,
    variants: [],
  },
  selectedProduct: makeProduct({ price: undefined, total_stock: 0, variants: [] }),
  availableSizes: ["42"],
  selectedSize: "42",
  customerMemory: {
    activeProductId: String(missingPriceProduct.product_id),
    selectedProductId: String(missingPriceProduct.product_id),
    selectedSize: "42",
  },
});

assert.ok(!/-\s*جنيه/.test(undefinedPriceReply.replyText));
assert.ok(!/\bمتاح\b/.test(undefinedPriceReply.replyText));

const validPriceReply = orchestrateAiResponse({
  intent: "PRODUCT_SEARCH",
  customerMessage: "تمام",
  price: 2500,
  productContext: {
    productId: 22,
    productName: "Nike Shox TL",
    price: 2500,
    total_stock: 5,
    variants: [{ id: "v1", size: "42", stock: 3 }],
  },
  selectedProduct: makeProduct({ product_id: 22, id: 22, name: "Nike Shox TL", price: 2500, total_stock: 5, variants: [{ id: "v1", size: "42", stock: 3 }] }),
  availableSizes: ["42", "43"],
  selectedSize: "42",
  customerMemory: {
    activeProductId: "22",
    selectedProductId: "22",
    selectedSize: "42",
  },
});

assert.ok(/2500\s*جنيه/.test(validPriceReply.replyText) || /2,500\s*جنيه/.test(validPriceReply.replyText));

const blockedName = guardAiNameCapture({ messageText: "اكد الاوردر", route: "verify-script" });
assert.equal(blockedName.blockedAsName, true);

const extractedMemory = extractAiConversationMemory({
  message: "اكد الاوردر",
  metadata: {
    customer_name: "اكد الاوردر",
  },
});
assert.equal(extractedMemory.customer_name, "");

console.log("[verifyAiPriceAndNameGuards] ok");

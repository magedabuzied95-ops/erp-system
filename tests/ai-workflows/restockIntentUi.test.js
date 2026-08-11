// Phase 7.5 — storefront Restock Intent CTA pure helpers (visibility + per-variant text/key).

import test from "node:test";
import assert from "node:assert/strict";

const { shouldShowRestockCta, restockVariantKey, restockSuccessText } = await import("../../src/storefront/lib/restockIntentUi.js");

test("CTA visible only for a selected variant that is out of stock", () => {
  assert.equal(shouldShowRestockCta({ id: 5, stock: 0 }), true);
  assert.equal(shouldShowRestockCta({ id: 5, stock: 3 }), false); // in stock -> hidden
  assert.equal(shouldShowRestockCta({ id: 5 }), true);            // no stock field -> treat as 0
  assert.equal(shouldShowRestockCta({ stock: 0 }), false);        // no variant id -> hidden
  assert.equal(shouldShowRestockCta(null), false);
});

test("variant key is stable and per-variant (state never leaks across sizes)", () => {
  assert.equal(restockVariantKey({ id: 44 }), "44");
  assert.equal(restockVariantKey({ id: 45 }), "45");
  assert.notEqual(restockVariantKey({ id: 44 }), restockVariantKey({ id: 45 }));
  assert.equal(restockVariantKey({}), "");
});

test("success text uses the actual variant labels and promises no channel", () => {
  assert.equal(restockSuccessText({ size: "44" }), "هنبلغك لما مقاس 44 يتوفر");
  assert.equal(restockSuccessText({ size: "44", color: "أبيض" }), "هنبلغك لما أبيض مقاس 44 يتوفر");
  assert.equal(restockSuccessText({ color: "أسود" }), "هنبلغك لما أسود يتوفر");
  const generic = restockSuccessText({});
  assert.match(generic, /يتوفر/);
  // never promise a messaging channel (no WhatsApp/SMS wording)
  for (const s of [restockSuccessText({ size: "44" }), generic]) assert.doesNotMatch(s, /واتساب|SMS|رسالة/);
});

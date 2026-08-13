// Phase 13.4 — unit tests for the shared multi-product selection primitives (pure, no React).
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_PRODUCTS, SELECTION_MODES, isMultiSelectMode,
  productSelectionKey, isSelected, toggleProductSelection, keepFailedSelections,
  summarizeSendResults, selectedCountText, manualSendButtonText, assistedSendButtonText,
  maxBatchReachedText, sendOutcomeText,
} from "../../src/modules/aiSupport/lib/productSelection.js";

const card = (product_id, variant_id) => ({ product_id, variant_id, name: `p${product_id}` });

test("MAX_BATCH_PRODUCTS is an explicit hard limit of 5", () => {
  assert.equal(MAX_BATCH_PRODUCTS, 5);
});

test("canonical key uses product_id + variant_id, not name", () => {
  assert.equal(productSelectionKey({ product_id: 208, variant_id: 9 }), "208:9");
  assert.equal(productSelectionKey({ id: 39 }), "39:");
  assert.equal(productSelectionKey({ name: "Jordan" }), "");
});

test("toggle adds then removes (deselect on re-click)", () => {
  let list = [];
  ({ list } = toggleProductSelection(list, card(1)));
  assert.equal(list.length, 1);
  ({ list } = toggleProductSelection(list, card(1)));
  assert.equal(list.length, 0);
});

test("duplicate canonical identity cannot be selected twice", () => {
  let list = [];
  ({ list } = toggleProductSelection(list, card(208, 9)));
  const res = toggleProductSelection(list, { id: 208, variant_id: 9 }); // same canonical key via alias
  assert.equal(res.removed, true); // treated as the same item → toggles off
});

test("selection order is preserved (append order)", () => {
  let list = [];
  for (const id of [3, 1, 2]) ({ list } = toggleProductSelection(list, card(id)));
  assert.deepEqual(list.map((c) => c.product_id), [3, 1, 2]);
});

test("max 5 enforced; sixth selection blocked, not silently dropped", () => {
  let list = [];
  for (const id of [1, 2, 3, 4, 5]) ({ list } = toggleProductSelection(list, card(id)));
  assert.equal(list.length, 5);
  const res = toggleProductSelection(list, card(6));
  assert.equal(res.blocked, true);
  assert.equal(res.list.length, 5);
});

test("isSelected checks canonical identity", () => {
  const list = [card(1), card(2)];
  assert.equal(isSelected(list, { id: 2 }), true);
  assert.equal(isSelected(list, card(9)), false);
});

test("keepFailedSelections: full success clears, total failure keeps all, partial keeps only failed", () => {
  const selected = [card(1), card(2), card(3)];
  const key = (c) => productSelectionKey(c);
  // full success
  assert.equal(keepFailedSelections(selected, selected.map((c) => ({ key: key(c), ok: true }))).length, 0);
  // total failure
  assert.equal(keepFailedSelections(selected, selected.map((c) => ({ key: key(c), ok: false }))).length, 3);
  // partial: only #2 failed
  const partial = keepFailedSelections(selected, [
    { key: key(card(1)), ok: true }, { key: key(card(2)), ok: false }, { key: key(card(3)), ok: true },
  ]);
  assert.deepEqual(partial.map((c) => c.product_id), [2]);
});

test("summarizeSendResults counts sent/failed", () => {
  assert.deepEqual(summarizeSendResults([{ ok: true }, { ok: false }, { ok: true }]), { total: 3, sent: 2, failed: 1 });
});

test("mode helpers: manual + recommendation are multi, disambiguation is single", () => {
  assert.equal(isMultiSelectMode(SELECTION_MODES.MANUAL), true);
  assert.equal(isMultiSelectMode(SELECTION_MODES.RECOMMENDATION), true);
  assert.equal(isMultiSelectMode(SELECTION_MODES.DISAMBIGUATION), false);
});

test("labels: singular vs count wording", () => {
  assert.equal(manualSendButtonText(1), "إرسال المنتج المحدد");
  assert.match(manualSendButtonText(3), /\(3\)/);
  assert.match(selectedCountText(3), /3 منتجات/);
  assert.match(assistedSendButtonText(3), /\(3 منتجات\)/);
  assert.match(maxBatchReachedText(), /5/);
});

test("sendOutcomeText is honest about partial failure", () => {
  assert.match(sendOutcomeText({ total: 5, sent: 4, failed: 1 }), /4 من 5/);
  assert.match(sendOutcomeText({ total: 3, sent: 3, failed: 0 }), /تم إرسال/);
  assert.match(sendOutcomeText({ total: 2, sent: 0, failed: 2 }), /فشل/);
});

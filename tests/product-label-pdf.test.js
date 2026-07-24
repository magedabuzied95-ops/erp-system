import test from "node:test";
import assert from "node:assert/strict";

import { buildProductLabelTemplateContent, generateProductLabelJobPdf } from "../src/modules/products/lib/productLabelJobsPdf.js";

test("new templates contain Code 128 source fields and no QR", () => {
  const content = buildProductLabelTemplateContent({ type: "display", barcodeValue: "ABC123", productName: "Runner", price: 500, size: "42" });
  assert.deepEqual(content, { barcode: "ABC123", name: "Runner", price: 500, fieldLabel: "المقاس", fieldValue: "42", qr: false });
  assert.equal(JSON.stringify(content).toLowerCase().includes("qrsvg"), false);
});

test("bag template uses color", () => {
  const content = buildProductLabelTemplateContent({ type: "bag", barcodeValue: "B1", productName: "Bag", price: 300, size: "L", color: "Blue" });
  assert.equal(content.fieldLabel, "اللون");
  assert.equal(content.fieldValue, "Blue");
});

test("generated PDF uses the exact job page dimensions", async () => {
  const result = await generateProductLabelJobPdf({
    widthMm: 25,
    heightMm: 35,
    labels: [{ type: "crocs", barcodeValue: "C1", productName: "Crocs", price: 200, size: "40" }],
  });
  assert.ok(Math.abs(result.debug.widthMm - 25) < 0.01);
  assert.ok(Math.abs(result.debug.heightMm - 35) < 0.01);
  assert.equal(result.debug.pages, 1);
  assert.equal(result.debug.qr, false);
});

test("empty PDF jobs are rejected", async () => {
  await assert.rejects(() => generateProductLabelJobPdf({ widthMm: 100, heightMm: 50, labels: [] }), /empty/);
});


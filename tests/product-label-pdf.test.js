import test from "node:test";
import assert from "node:assert/strict";

import { buildProductLabelTemplateContent, generateProductLabelJobPdf } from "../src/modules/products/lib/productLabelJobsPdf.js";

test("new templates contain Code 128 source fields and no QR", () => {
  const content = buildProductLabelTemplateContent({ type: "display", barcodeValue: "ABC123", productName: "Runner", price: 500, size: "42" });
  assert.deepEqual(content, { barcode: "ABC123", name: "Runner", price: 500, fieldLabel: "SIZE", fieldValue: "42", article: "", imageUrl: "", qr: false });
  assert.equal(JSON.stringify(content).toLowerCase().includes("qrsvg"), false);
});

test("bag template uses color", () => {
  const content = buildProductLabelTemplateContent({ type: "bag", barcodeValue: "B1", productName: "Bag", price: 300, size: "L", color: "Blue", articleCode: "BG-22" });
  assert.equal(content.fieldLabel, "COLOR");
  assert.equal(content.fieldValue, "Blue");
  assert.equal(content.article, "BG-22");
});

test("shoe template prints size and color together", () => {
  const content = buildProductLabelTemplateContent({
    type: "box",
    barcodeValue: "830841729693",
    productName: "Sneakers",
    price: 1850,
    size: "41",
    color: "White & Black",
  });
  assert.equal(content.fieldLabel, "SIZE");
  assert.equal(content.fieldValue, "41 / COLOR: White & Black");
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

test("long bag names keep price, color, and barcode in separate vertical slots", async () => {
  const result = await generateProductLabelJobPdf({
    widthMm: 55,
    heightMm: 40,
    labels: [{
      type: "bag",
      barcodeValue: "700524083479",
      productName: "chrisbella Hand & Crossbody Bag",
      price: 1350,
      color: "Mint",
      articleCode: "MINT-101",
    }],
  });
  const layout = result.debug.layouts[0];
  const finalNameBaseline = layout.nameBaselines.at(-1);
  assert.ok(layout.nameLines.length <= 2);
  assert.ok(layout.contentWidth >= 52);
  assert.ok(layout.priceFontSize > layout.detailFontSize);
  assert.ok(layout.nameFontSize >= 10);
  assert.ok(layout.priceFontSize >= 13);
  assert.ok(layout.priceBox.height > 5);
  assert.ok(layout.priceY > finalNameBaseline);
  assert.ok(layout.fieldY - layout.priceY > 4);
  assert.ok(layout.articleY > layout.fieldY);
  assert.ok(layout.barcodeY > layout.fieldY);
  assert.ok(layout.barcodeTextY > layout.barcodeY + layout.barcodeHeight);
  assert.ok(layout.barcodeHeight >= 9);
  assert.ok(layout.barcodeHeight <= 10);
  assert.ok(layout.barcodeTextY < 40);
});

test("empty PDF jobs are rejected", async () => {
  await assert.rejects(() => generateProductLabelJobPdf({ widthMm: 100, heightMm: 50, labels: [] }), /empty/);
});

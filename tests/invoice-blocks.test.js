import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";

import {
  BUILT_IN_BLOCK_TYPES,
  DEFAULT_INVOICE_BLOCKS,
  blocksForOutput,
  createInvoiceBlock,
  localizedBlockText,
  moveInvoiceBlock,
  normalizeInvoiceBlocks,
  qrSvgMarkup,
  resolveBarcodeValue,
  resolveFieldRowValue,
  resolveQrValue,
  toggleBlockOutput,
} from "../shared/invoiceBlocks.js";
import { normalizeInvoiceTemplateConfig, mergeInvoiceTemplateConfig } from "../shared/invoiceTemplate.js";

test("the default layout is the one the renderers had written into them", () => {
  const blocks = normalizeInvoiceBlocks([]);
  assert.deepEqual(blocks.map((block) => block.type), [
    "brand",
    "order_meta",
    "customer_meta",
    "items_table",
    "totals",
    "policy",
    "social",
    "store_contact",
  ]);
  // The in-app card has never shown the policy, the review buttons or the footer; the
  // customer's public link always has.
  assert.deepEqual(blocksForOutput(blocks, "card").map((b) => b.type), [
    "brand", "order_meta", "customer_meta", "items_table", "totals",
  ]);
  assert.equal(blocksForOutput(blocks, "public").length, 8);
  assert.equal(blocksForOutput(blocks, "print").length, 8);
});

test("an empty or missing layout falls back rather than printing nothing", () => {
  assert.equal(normalizeInvoiceBlocks(undefined).length, DEFAULT_INVOICE_BLOCKS.length);
  assert.equal(normalizeInvoiceBlocks([]).length, DEFAULT_INVOICE_BLOCKS.length);
  assert.equal(normalizeInvoiceTemplateConfig({}).blocks.length, DEFAULT_INVOICE_BLOCKS.length);
});

test("a layout saved by an older build keeps every section it did not know about", () => {
  // A template stored before `social` existed must not lose the section forever.
  const stored = [
    { id: "builtin:items_table", type: "items_table" },
    { id: "builtin:brand", type: "brand" },
  ];
  const blocks = normalizeInvoiceBlocks(stored);
  const types = blocks.map((block) => block.type);
  for (const builtIn of BUILT_IN_BLOCK_TYPES) {
    assert.ok(types.includes(builtIn), `${builtIn} was restored`);
  }
  // ...while the order the operator chose for the ones it did know about survives.
  assert.ok(types.indexOf("items_table") < types.indexOf("brand"));
});

test("unknown and duplicated blocks are dropped", () => {
  const blocks = normalizeInvoiceBlocks([
    { id: "a", type: "brand" },
    { id: "b", type: "brand" },
    { id: "c", type: "definitely_not_a_block" },
  ]);
  assert.equal(blocks.filter((block) => block.type === "brand").length, 1);
  assert.equal(blocks.some((block) => block.type === "definitely_not_a_block"), false);
});

test("a custom block only keeps the properties its type defines", () => {
  const [block] = normalizeInvoiceBlocks([
    { id: "x", type: "text", content: { ar: "شكرًا", en: "Thanks" }, size: "lg", bold: true, boxed: true, onclick: "alert(1)" },
  ]).filter((entry) => entry.type === "text");
  assert.equal(block.content.ar, "شكرًا");
  assert.equal(block.size, "lg");
  assert.equal(block.bold, true);
  assert.equal("onclick" in block, false);
  // An out-of-vocabulary alignment or size falls back instead of reaching the renderer.
  const [odd] = normalizeInvoiceBlocks([{ id: "y", type: "text", align: "diagonal", size: "enormous" }])
    .filter((entry) => entry.type === "text");
  assert.equal(odd.align, "start");
  assert.equal(odd.size, "md");
});

test("an image or QR the customer's browser would fetch must be http(s)", () => {
  const [image] = normalizeInvoiceBlocks([{ id: "i", type: "image", url: "javascript:alert(1)" }])
    .filter((entry) => entry.type === "image");
  assert.equal(image.url, "");
  const [ok] = normalizeInvoiceBlocks([{ id: "j", type: "image", url: "https://cdn.example.com/stamp.png" }])
    .filter((entry) => entry.type === "image");
  assert.equal(ok.url, "https://cdn.example.com/stamp.png");
});

test("moving a block reorders without losing one", () => {
  const blocks = normalizeInvoiceBlocks([]);
  const moved = moveInvoiceBlock(blocks, 4, 0);
  assert.equal(moved.length, blocks.length);
  assert.equal(moved[0].type, "totals");
  assert.equal(moved[1].type, "brand");
  // Out-of-range targets clamp instead of dropping the block.
  assert.equal(moveInvoiceBlock(blocks, 0, 99).at(-1).type, "brand");
  assert.deepEqual(moveInvoiceBlock(blocks, 99, 0).map((b) => b.type), blocks.map((b) => b.type));
});

test("hiding a block affects only the output it was hidden in", () => {
  const blocks = normalizeInvoiceBlocks([]);
  const hiddenBrand = toggleBlockOutput(blocks[0], "print", false);
  assert.deepEqual(hiddenBrand.hidden_in, ["print"]);

  const layout = [hiddenBrand, ...blocks.slice(1)];
  assert.equal(blocksForOutput(layout, "print").some((block) => block.type === "brand"), false);
  assert.equal(blocksForOutput(layout, "public").some((block) => block.type === "brand"), true);
  assert.deepEqual(toggleBlockOutput(hiddenBrand, "print", true).hidden_in, []);
});

test("blocksForOutput normalizes first, so it never renders a half layout", () => {
  // Handing it a partial list is how a stale template arrives; it restores the missing
  // sections rather than printing an invoice with no items table.
  const restored = blocksForOutput([{ id: "builtin:brand", type: "brand" }], "public");
  assert.equal(restored.some((block) => block.type === "items_table"), true);
  assert.equal(restored.some((block) => block.type === "totals"), true);
});

test("a custom row can read the order instead of being typed out", () => {
  const invoice = {
    invoiceNumber: "INV-1042",
    customer: { name: "ماجد", phone: "0102", address: "الإسكندرية" },
    paymentMethod: "cod",
    totals: { subtotal: 3150, remainingAmount: 2060 },
    publicUrl: "https://erp.example.com/invoice/abc",
  };
  const money = (value) => `EGP ${Number(value || 0)}`;
  assert.equal(resolveFieldRowValue({ source: "invoice_number" }, invoice, { money }), "INV-1042");
  assert.equal(resolveFieldRowValue({ source: "customer_phone" }, invoice, { money }), "0102");
  assert.equal(resolveFieldRowValue({ source: "remaining" }, invoice, { money }), "EGP 2060");
  assert.equal(resolveFieldRowValue({ source: "custom", value: "مندوب: كريم" }, invoice, { money }), "مندوب: كريم");
  assert.equal(resolveQrValue({ source: "public_url" }, invoice), "https://erp.example.com/invoice/abc");
  assert.equal(resolveQrValue({ source: "custom", value: "https://x.test" }, invoice), "https://x.test");
  assert.equal(resolveBarcodeValue({ source: "invoice_number" }, invoice), "INV-1042");
});

test("a block filled in one language still shows in the other", () => {
  assert.equal(localizedBlockText({ ar: "شكرًا", en: "Thanks" }, "en"), "Thanks");
  assert.equal(localizedBlockText({ ar: "شكرًا", en: "" }, "en"), "شكرًا", "falls back rather than vanishing");
  assert.equal(localizedBlockText({ ar: "", en: "Thanks" }, "ar"), "Thanks");
  assert.equal(localizedBlockText(null, "ar"), "");
});

test("QR draws synchronously so a print builder never has to await it", () => {
  const svg = qrSvgMarkup("https://erp.example.com/invoice/abc", { size: 120 }, QRCode.create);
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="120" height="120"/);
  assert.ok(svg.includes("<path d=\"M"), "the module matrix became a path");
  // Nothing to draw must produce nothing, not a broken empty code.
  assert.equal(qrSvgMarkup("", {}, QRCode.create), "");
  assert.equal(qrSvgMarkup("https://x.test", {}, null), "");
});

test("a new block starts from a usable shape", () => {
  assert.equal(createInvoiceBlock("text").size, "md");
  assert.equal(createInvoiceBlock("image").align, "center");
  assert.equal(createInvoiceBlock("qr").source, "public_url");
  assert.equal(createInvoiceBlock("spacer").height_px, 16);
  assert.notEqual(createInvoiceBlock("text").id, createInvoiceBlock("text").id, "ids are unique");
});

test("patching a template replaces the layout rather than merging two orderings", () => {
  const base = normalizeInvoiceTemplateConfig({});
  const reordered = moveInvoiceBlock(base.blocks, 3, 0);
  const merged = mergeInvoiceTemplateConfig(base, { blocks: reordered });
  assert.equal(merged.blocks[0].type, "items_table");
  // A patch that says nothing about the layout leaves it alone.
  const untouched = mergeInvoiceTemplateConfig(merged, { identity: { address: "Damietta" } });
  assert.equal(untouched.blocks[0].type, "items_table");
  assert.equal(untouched.identity.address, "Damietta");
});

import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

process.env.PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || "https://api.example.test";

const {
  buildPackingDescription,
  describePackingItem,
  packingToken,
  renderPackingPage,
  findPackingQrSpot,
  stampPackingQrOnAirwayBill,
  verifyPackingToken,
} = await import("../server/modules/shipping/packingSlip.js");
const { mapOrderToBostaDeliveryPayload } = await import("../server/modules/shipping/providers/bosta.mapper.js");

test("each piece is described with colour, size, article code and quantity", () => {
  assert.equal(
    describePackingItem({ product_name: "Adidas Ultra Boost", color: "Grey", size: "39", article_code: "ART-12345", quantity: 1 }),
    "Adidas Ultra Boost - Grey - مقاس 39 - ART-12345 (x1)"
  );
  assert.equal(describePackingItem({ product_name: "Crocs Classic", size: "M9", quantity: 2 }), "Crocs Classic - مقاس M9 (x2)", "no article, no empty dash");
});

test("a long parcel counts the pieces it could not fit instead of dropping them", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ product_name: `Model number ${index} with a fairly long name`, color: "Black", size: "42", article_code: `ART-${index}`, quantity: 1 }));
  const description = buildPackingDescription(items);
  assert.match(description, /\+ \d+ قطع تانية$/);
  assert.ok(description.length <= 440);
});

test("the Bosta payload uses the detailed description, and falls back to names when it is off", () => {
  const base = { order: { id: 9, customer_name: "Hadeer Ahmed" }, items: [{ product_name: "Adidas Ultra Boost" }] };
  assert.equal(mapOrderToBostaDeliveryPayload({ ...base, description: "Adidas Ultra Boost - Grey - مقاس 39 (x1)" }).specs.packageDetails.description, "Adidas Ultra Boost - Grey - مقاس 39 (x1)");
  assert.equal(mapOrderToBostaDeliveryPayload(base).specs.packageDetails.description, "Adidas Ultra Boost");
});

test("the packing link is signed per order, so ids cannot be walked", () => {
  const token = packingToken(1616);
  assert.equal(verifyPackingToken(token), 1616);
  assert.equal(verifyPackingToken(token.replace(/^1616/, "1617")), null);
  assert.equal(verifyPackingToken("1616.forged"), null);
  assert.equal(verifyPackingToken(""), null);
});

test("the packing page shows the models and nothing about money or the customer", () => {
  const html = renderPackingPage({
    orderNumber: "INV-1616",
    items: [{ product_name: "Adidas <Ultra> Boost", color: "Grey", size: "39", article_code: "ART-1", quantity: 1, image_url: "https://res.cloudinary.com/x/shoe.jpg", unit_price: 1200 }],
  });
  assert.match(html, /INV-1616/);
  assert.match(html, /shoe\.jpg/);
  assert.match(html, /مقاس <b dir="ltr">39<\/b>/);
  assert.match(html, /ART-1/);
  assert.match(html, /Adidas &lt;Ultra&gt; Boost/, "names are escaped");
  assert.doesNotMatch(html, /1200|جنيه/);
  assert.match(html, /noindex/);
});

const blankPdf = async (pages) => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([288, 432]);
  return Buffer.from(await pdf.save()).toString("base64");
};

test("every airway bill page gets a QR strip added under it, the label itself untouched", async () => {
  const result = await stampPackingQrOnAirwayBill(await blankPdf(2), [{ order_id: 1, order_number: "INV-1" }, { order_id: 2, order_number: "INV-2" }]);
  assert.equal(result.stamped, true);
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  for (const page of pdf.getPages()) {
    const box = page.getMediaBox();
    assert.equal(box.height, 432 + 96);
    assert.equal(box.y, -96, "the page grows downwards; Bosta's label keeps its own area");
  }
});

test("a page count that does not match the orders prints the plain label rather than a wrong QR", async () => {
  const original = await blankPdf(1);
  const result = await stampPackingQrOnAirwayBill(original, [{ order_id: 1 }, { order_id: 2 }]);
  assert.equal(result.stamped, false);
  assert.equal(result.pdf_base64, original);
});

/* The QR used to ride on a 96pt strip bolted under every label, which made an ERP print a
 * fifth taller than Bosta's own. It now goes INSIDE the notes box at Bosta's exact page size,
 * placed by reading the label: its drawn rules give the box, and every glyph and path point on
 * the page is ink the QR may not cover. A label shaped like Bosta's is built here rather than
 * committing a real one, which would carry a customer's name, phone and address. */
const bostaShapedLabel = async (pages = 1, { notes = false } = {}) => {
  const { StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const glyphs = (count, x, y, step) => ({ count, x, y, step });
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([297.12, 420]);
    // The label's full-width rules, measured off a real Bosta airway bill.
    for (const y of [36.7, 86.4, 186.8, 260, 305.8, 332.1, 352.6]) {
      page.drawRectangle({ x: 8.8, y, width: 278.8, height: 0.97, color: rgb(0, 0, 0) });
    }
    // The one divider in the foot row: tracking barcode on the narrow side, notes on the wide one.
    page.drawRectangle({ x: 104.3, y: 37.7, width: 0.97, height: 48.7, color: rgb(0, 0, 0) });
    for (let bar = 0; bar < 40; bar += 1) {
      page.drawLine({ start: { x: 20 + bar * 1.8, y: 50 }, end: { x: 20 + bar * 1.8, y: 73 }, thickness: 0.6 });
    }
    const runs = [glyphs(12, 113, 42.5, 5.7), glyphs(6, 244, 74.7, 5.8)];
    if (notes) runs.push(glyphs(28, 118, 70, 5.9));
    for (const run of runs) {
      for (let step = 0; step < run.count; step += 1) page.drawText("x", { x: run.x + step * run.step, y: run.y, size: 5, font });
    }
  }
  return Buffer.from(await pdf.save()).toString("base64");
};

test("the QR lands inside the notes box, clear of everything Bosta printed", async () => {
  const pdf = await PDFDocument.load(Buffer.from(await bostaShapedLabel(1), "base64"));
  const spot = findPackingQrSpot(pdf.getPages()[0]);
  assert.ok(spot, "the notes box should be readable on a Bosta-shaped label");
  assert.ok(spot.size >= 34, `a QR under 12 mm stops scanning off a phone, got ${spot.size}`);
  assert.ok(spot.x >= 104.3 && spot.x + spot.size <= 287.6, "inside the notes cell horizontally");
  assert.ok(spot.y >= 36.7 && spot.y + spot.size <= 86.4, "inside the notes cell vertically");
  assert.ok(spot.x > 113 + 11 * 5.7, "clear of the Order Reference line");
  assert.ok(spot.x + spot.size < 244, "clear of the ملاحظات label");
});

test("printing keeps Bosta's own page size when the QR goes in the notes box", async () => {
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(2), [{ order_id: 1, order_number: "INV-1" }, { order_id: 2, order_number: "INV-2" }]);
  assert.equal(result.stamped, true);
  assert.equal(result.placement, "notes_box");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  for (const page of pdf.getPages()) {
    const box = page.getMediaBox();
    assert.equal(box.height, 420, "no strip, no taller label");
    assert.equal(box.y, 0);
  }
});

// What the owner asked for: a parcel that carries written notes keeps them readable. There is
// no room for both, so the QR goes back under the label rather than over somebody's words.
test("notes already written in the box push the QR back under the label", async () => {
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(1, { notes: true }), [{ order_id: 1, order_number: "INV-1" }]);
  assert.equal(result.stamped, true);
  assert.equal(result.placement, "strip");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  assert.equal(pdf.getPages()[0].getMediaBox().height, 420 + 96);
});

// One printer job, one page size: a batch where some labels grew and some did not is a batch
// the printer either scales or jams.
test("a batch prints one page size even when a single label has notes", async () => {
  const mixed = await PDFDocument.create();
  for (const withNotes of [false, true]) {
    const source = await PDFDocument.load(Buffer.from(await bostaShapedLabel(1, { notes: withNotes }), "base64"));
    const [copied] = await mixed.copyPages(source, [0]);
    mixed.addPage(copied);
  }
  const result = await stampPackingQrOnAirwayBill(Buffer.from(await mixed.save()).toString("base64"), [{ order_id: 1 }, { order_id: 2 }]);
  assert.equal(result.placement, "strip");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  const heights = new Set(pdf.getPages().map((page) => page.getMediaBox().height));
  assert.equal(heights.size, 1, "every page in one print has the same height");
});

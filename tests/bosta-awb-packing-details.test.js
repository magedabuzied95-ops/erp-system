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

// A page with nothing readable on it cannot be proved to belong to any order, so it gets no QR
// at all. The label still prints; it just prints the way Bosta sent it.
test("a page that cannot be identified is printed plain rather than guessed at", async () => {
  const original = await blankPdf(2);
  const result = await stampPackingQrOnAirwayBill(original, [{ order_id: 1, order_number: "INV-1" }, { order_id: 2, order_number: "INV-2" }]);
  assert.equal(result.stamped, false);
  assert.equal(result.reason, "pages_not_identified");
  assert.equal(result.pdf_base64, original);
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
const bostaShapedLabel = async (pages = 1, { notes = false, tracking = ["5784437282"], rowAbove = "address" } = {}) => {
  const { StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const glyphs = (count, x, y, step) => ({ count, x, y, step });
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([297.12, 420]);
    // Bosta prints the tracking number on every label; it is what tells one page from another.
    page.drawText(`Tracking Number${tracking[index] || tracking[0]}`, { x: 14, y: 400, size: 6, font });
    // The rounded frame Bosta draws round the whole label, as one curved path — read as a box it
    // covers the entire page, which is what kept the QR out of the row above on real labels.
    page.drawSvgPath("M 8 0 L 272 0 C 277 0 280 3 280 8 L 280 400 C 280 405 277 408 272 408 L 8 408 C 3 408 0 405 0 400 L 0 8 C 0 3 3 0 8 0 Z", { x: 8.3, y: 414, borderWidth: 0.6 });
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
    // The row above the notes: the address at its top, open paper under it — as measured on real
    // labels. "full" packs it with text; "barcode" draws bars across its lower half.
    runs.push(glyphs(42, 31, 157.5, 5.9));
    if (rowAbove === "full") for (let line = 0; line < 6; line += 1) runs.push(glyphs(42, 14, 92 + line * 11, 6.4));
    if (rowAbove === "barcode") {
      for (let bar = 0; bar < 80; bar += 1) {
        page.drawLine({ start: { x: 14 + bar * 3.4, y: 90 }, end: { x: 14 + bar * 3.4, y: 150 }, thickness: 0.6 });
      }
    }
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
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(2, { tracking: ["5784437282", "1515188641"] }), [
    { order_id: 1, order_number: "INV-1", tracking_number: "5784437282" },
    { order_id: 2, order_number: "INV-2", tracking_number: "1515188641" },
  ]);
  assert.equal(result.stamped, true);
  assert.equal(result.placement, "notes_box");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  for (const page of pdf.getPages()) {
    const box = page.getMediaBox();
    assert.equal(box.height, 420, "no strip, no taller label");
    assert.equal(box.y, 0);
  }
});

// What the owner asked for: a parcel that carries written notes keeps them readable. Orders
// 2194 and 2192 (2026-10-19) had notes on the box's top line and went back to the old taller
// label; the QR now takes the open paper in the row above instead.
test("notes in the box move the QR into the row above, at Bosta's own page size", async () => {
  const pdf = await PDFDocument.load(Buffer.from(await bostaShapedLabel(1, { notes: true }), "base64"));
  const spot = findPackingQrSpot(pdf.getPages()[0]);
  assert.equal(spot?.where, "above_notes");
  assert.ok(spot.size >= 40, `same size as the notes box gives, got ${spot.size}`);
  assert.ok(spot.y >= 86.4 && spot.y + spot.size < 157.5 - 3, "under the address, inside the row");
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(1, { notes: true }), [{ order_id: 1, order_number: "INV-1", tracking_number: "5784437282" }]);
  assert.equal(result.placement, "inside_label");
  const stamped = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  assert.equal(stamped.getPages()[0].getMediaBox().height, 420);
});

test("a row above packed with text still sends the QR under the label", async () => {
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(1, { notes: true, rowAbove: "full" }), [{ order_id: 1, order_number: "INV-1", tracking_number: "5784437282" }]);
  assert.equal(result.placement, "strip");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  assert.equal(pdf.getPages()[0].getMediaBox().height, 420 + 96);
});

// Bars are drawn as lines whose only points are their two ends; the space between them is a
// barcode, not paper.
test("the QR never lands between the bars of a barcode", async () => {
  const pdf = await PDFDocument.load(Buffer.from(await bostaShapedLabel(1, { notes: true, rowAbove: "barcode" }), "base64"));
  const spot = findPackingQrSpot(pdf.getPages()[0]);
  assert.ok(!spot || spot.y >= 150 + 3 || spot.x >= 14 + 79 * 3.4, `landed on the bars: ${JSON.stringify(spot)}`);
});

// One printer job, one page size: a batch where some labels grew and some did not is a batch
// the printer either scales or jams.
test("a batch prints one page size even when a single label has no room", async () => {
  const mixed = await PDFDocument.create();
  for (const [index, withNotes] of [false, true].entries()) {
    const source = await PDFDocument.load(Buffer.from(await bostaShapedLabel(1, { notes: withNotes, rowAbove: withNotes ? "full" : "address", tracking: [["5784437282", "1515188641"][index]] }), "base64"));
    const [copied] = await mixed.copyPages(source, [0]);
    mixed.addPage(copied);
  }
  const result = await stampPackingQrOnAirwayBill(Buffer.from(await mixed.save()).toString("base64"), [
    { order_id: 1, tracking_number: "5784437282" },
    { order_id: 2, tracking_number: "1515188641" },
  ]);
  assert.equal(result.placement, "strip");
  const pdf = await PDFDocument.load(Buffer.from(result.pdf_base64, "base64"));
  const heights = new Set(pdf.getPages().map((page) => page.getMediaBox().height));
  assert.equal(heights.size, 1, "every page in one print has the same height");
});

/* The mix-up that reached a customer, 2026-10-12: four labels printed at once came back from
 * Bosta in Bosta's own order, not the order the delivery ids were sent in, and the code paired
 * page i with order i. The UGG parcel went out carrying the QR of a two-piece Nike parcel and
 * the Nike one carried the UGG's. Position is never trusted again: each page is identified by
 * the tracking number Bosta printed on it. */
test("pages are matched to orders by what is printed on them, not by position", async () => {
  const pdf = await bostaShapedLabel(3, { tracking: ["5784437282", "1755400942", "1515188641"] });
  // The order the shipping board happened to select them in — deliberately not Bosta's.
  const printed = [
    { order_id: 2074, order_number: "INV-2074", tracking_number: "1515188641" },
    { order_id: 2029, order_number: "INV-2029", tracking_number: "5784437282" },
    { order_id: 2061, order_number: "INV-2061", tracking_number: "1755400942" },
  ];
  const result = await stampPackingQrOnAirwayBill(pdf, printed);
  assert.equal(result.stamped, true);
  assert.deepEqual(result.matched, [2029, 2061, 2074], "each page gets the order whose label it is");
});

test("a label whose order is not in the batch is never stamped with somebody else's QR", async () => {
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(1, { tracking: ["5784437282"] }), [
    { order_id: 2061, order_number: "INV-2061", tracking_number: "1755400942" },
  ]);
  assert.equal(result.stamped, false);
  assert.equal(result.reason, "pages_not_identified");
});

// Two orders whose references both appear on one page, or one order matching two pages, is the
// same mix-up wearing a different hat.
test("an ambiguous match is refused rather than resolved by guessing", async () => {
  const result = await stampPackingQrOnAirwayBill(await bostaShapedLabel(2, { tracking: ["5784437282", "5784437282"] }), [
    { order_id: 1, order_number: "INV-1", tracking_number: "5784437282" },
    { order_id: 2, order_number: "INV-2", tracking_number: "1515188641" },
  ]);
  assert.equal(result.stamped, false);
  assert.equal(result.reason, "pages_not_identified");
});
